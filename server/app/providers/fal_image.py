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
                raw = (await client.get(url)).content  # fal.media 产物 URL 会过期 → 立即取回落盘

        from PIL import Image

        with Image.open(io.BytesIO(raw)) as im:
            w, h = im.size
            fmt = (im.format or "PNG").lower()
        return GeneratedImage(data=raw, mime=f"image/{fmt}", width=w, height=h,
                              model="nano-banana-2")
