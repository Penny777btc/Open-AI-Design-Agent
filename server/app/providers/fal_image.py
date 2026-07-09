"""fal.ai 图像 provider——目前只承担「人物一致性编辑」（nano-banana / Gemini 图像系）。

why：vibetools 中转的 nano key 失效且 gpt-image-2 排队 2 分钟+/张；fal.ai 官方托管
nano-banana 推理端点，实测 ~9s/张、$0.039/张（拿货 ¥0.28 < vibetools 口径 ¥0.8，毛利更优）。
只在 settings.fal_api_key 配置时启用（get_person_edit_provider 路由），否则回落 sub2api。
"""

import base64
import io

import httpx

from app.config import settings
from app.providers.base import GeneratedImage

# nano-banana 图像编辑端点（Gemini 2.5 Flash Image via fal）。同步端点：POST fal.run/<model>
_EDIT_ENDPOINT = "https://fal.run/fal-ai/nano-banana/edit"

# 支持的画幅（fal nano-banana 的 aspect_ratio 枚举子集；不认时 422 → 去参重试）
_AR_OK = {"1:1", "16:9", "9:16", "4:3", "3:4", "2:3", "3:2"}


class FalNanoBanana:
    """人物一致性编辑：图文入 → 整图重绘（nano 系人脸保真业界最强）。不支持 mask。"""

    def __init__(self):
        self.api_key = settings.fal_api_key

    async def edit(self, prompt: str, image: bytes, aspect_ratio: str = "1:1",
                   mask: bytes | None = None, transparent: bool = False) -> GeneratedImage:
        if mask is not None:
            raise RuntimeError("该模型不支持蒙版局部重绘")  # 路由保证带 mask 的编辑不走这里
        headers = {"Authorization": f"Key {self.api_key}", "Content-Type": "application/json"}
        data_uri = "data:image/png;base64," + base64.b64encode(image).decode()
        payload: dict = {"prompt": prompt, "image_urls": [data_uri], "output_format": "png"}
        if aspect_ratio in _AR_OK:
            payload["aspect_ratio"] = aspect_ratio

        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(_EDIT_ENDPOINT, headers=headers, json=payload)
            if resp.status_code == 422 and "aspect_ratio" in payload:
                payload.pop("aspect_ratio")  # 端点 schema 变动不认画幅参数 → 去参重试
                resp = await client.post(_EDIT_ENDPOINT, headers=headers, json=payload)
            resp.raise_for_status()
            d = resp.json()
            imgs = d.get("images") or []
            if not imgs or not imgs[0].get("url"):
                raise RuntimeError(f"fal 返回无图片: {str(d)[:200]}")
            url = imgs[0]["url"]
            if url.startswith("data:"):
                raw = base64.b64decode(url.split(",", 1)[1])
            else:
                resp2 = await client.get(url)  # fal.media 产物 URL 会过期 → 立即取回落盘
                # 4xx/5xx 必须显式抛错：错误页字节流喂给 PIL 会变成难排查的解析异常，
                # 且取回失败属单节点问题，抛 HTTPStatusError 后由调用方按状态码分类（不误触熔断）
                resp2.raise_for_status()
                raw = resp2.content

        from PIL import Image

        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
            fmt = (im.format or "PNG").lower()
        return GeneratedImage(data=raw, mime=f"image/{fmt}", width=w, height=h,
                              model="nano-banana-2")


# fal 各专长模型的 endpoint + 画幅参数风格（实测：seedream/flux 用 image_size 枚举；
# ideogram 用 image_size 但枚举不同；统一在下方按 aspect→各家枚举映射，不认就去参重试）。
FAL_GEN_MODELS = {
    "seedream": "fal-ai/bytedance/seedream/v3/text-to-image",  # 中文写实+中式审美（治中文错字首选）
    "ideogram": "fal-ai/ideogram/v3",                          # 中文插画/扁平矢量
    "flux": "fal-ai/flux/schnell",                             # 写实无字，1.4s 超快超便宜
    "recraft": "fal-ai/recraft/v3/text-to-image",              # 英文文字/矢量（中文不行）
}
# aspect_ratio → fal image_size 枚举（多数 fal t2i 模型通用；不认时去 image_size 用默认方图）
_SIZE_MAP = {
    "1:1": "square_hd", "4:3": "landscape_4_3", "3:4": "portrait_4_3",
    "16:9": "landscape_16_9", "9:16": "portrait_16_9", "3:2": "landscape_4_3", "2:3": "portrait_4_3",
}


class FalTextToImage:
    """fal 专长模型的文生图（Seedream/Ideogram/Flux/Recraft）。按 model key 选 endpoint。
    only generate（无 edit）——含真人/局部编辑等仍走原有 gpt-image/nano 路由。"""

    def __init__(self, model_key: str):
        self.api_key = settings.fal_api_key
        self.model_key = model_key
        self.endpoint = FAL_GEN_MODELS.get(model_key)
        if not self.endpoint:
            raise ValueError(f"未知 fal 模型：{model_key}")

    async def generate(self, prompt: str, aspect_ratio: str = "1:1", input_images=None) -> GeneratedImage:
        headers = {"Authorization": f"Key {self.api_key}", "Content-Type": "application/json"}
        payload: dict = {"prompt": prompt}
        size = _SIZE_MAP.get(aspect_ratio)
        if size:
            payload["image_size"] = size
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(f"https://fal.run/{self.endpoint}", headers=headers, json=payload)
            if resp.status_code in (400, 422) and "image_size" in payload:
                payload.pop("image_size")  # 该模型不认此画幅枚举 → 去参用默认方图重试
                resp = await client.post(f"https://fal.run/{self.endpoint}", headers=headers, json=payload)
            resp.raise_for_status()
            d = resp.json()
            imgs = d.get("images") or []
            if not imgs or not imgs[0].get("url"):
                raise RuntimeError(f"fal 返回无图片: {str(d)[:200]}")
            url = imgs[0]["url"]
            if url.startswith("data:"):
                raw = base64.b64decode(url.split(",", 1)[1])
            else:
                resp2 = await client.get(url)
                resp2.raise_for_status()
                raw = resp2.content

        from PIL import Image

        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
            fmt = (im.format or "PNG").lower()
        return GeneratedImage(data=raw, mime=f"image/{fmt}", width=w, height=h, model=self.model_key)
