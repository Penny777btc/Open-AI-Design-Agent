"""fal.ai 视频 provider（对标 Lovart 视频能力；用现有 fal key）。

图生视频（animate 一张产品/场景图）是电商刚需；文生视频次之。视频生成耗时 1-3 分钟，
用 fal 队列 API（submit → 轮询 status → 取 result）而非同步端点，避免长连接超时。
仅在 fal_api_key 配置时启用（get_video_provider 优先返回它）。
"""

import asyncio
import base64
import io

import httpx

from app.config import settings
from app.providers.base import GeneratedVideo

# 逻辑模型名 → fal endpoint（图生 / 文生分开；缺图生时回落文生）。价位见 model_catalog。
FAL_VIDEO_MODELS = {
    "kling-video": {
        "i2v": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
        "t2v": "fal-ai/kling-video/v2.5-turbo/pro/text-to-image",  # kling 无纯文生占位，回落见下
    },
    "seedance-video": {
        "i2v": "fal-ai/bytedance/seedance/v1/lite/image-to-video",
        "t2v": "fal-ai/bytedance/seedance/v1/lite/text-to-video",
    },
    "wan-video": {
        "i2v": "fal-ai/wan/v2.2-a14b/image-to-video",
        "t2v": "fal-ai/wan/v2.2-a14b/text-to-video",
    },
}
_QUEUE = "https://queue.fal.run"


class FalVideo:
    def __init__(self, default_model: str = "seedance-video"):
        self.api_key = settings.fal_api_key
        self.default_model = default_model

    async def generate(self, prompt: str, *, seconds: float = 5, model: str = "seedance-video",
                        resolution: str = "480p", input_image: bytes | None = None) -> GeneratedVideo:
        spec = FAL_VIDEO_MODELS.get(model) or FAL_VIDEO_MODELS.get(self.default_model) \
            or FAL_VIDEO_MODELS["seedance-video"]
        mode = "i2v" if input_image else "t2v"
        endpoint = spec.get(mode) or spec.get("i2v") or spec.get("t2v")
        headers = {"Authorization": f"Key {self.api_key}", "Content-Type": "application/json"}
        payload: dict = {"prompt": prompt, "duration": int(round(seconds))}
        if input_image:
            payload["image_url"] = "data:image/png;base64," + base64.b64encode(input_image).decode()

        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
            # 1) 提交到队列 → 拿 status/response url
            sub = await client.post(f"{_QUEUE}/{endpoint}", headers=headers, json=payload)
            sub.raise_for_status()
            info = sub.json()
            status_url = info.get("status_url") or f"{_QUEUE}/{endpoint}/requests/{info['request_id']}/status"
            response_url = info.get("response_url") or f"{_QUEUE}/{endpoint}/requests/{info['request_id']}"

            # 2) 轮询直到 COMPLETED（视频最长 ~5 分钟；节点级心跳在 job 层撑住前端）
            for _ in range(150):  # 150 × 2s = 300s
                await asyncio.sleep(2)
                st = await client.get(status_url, headers=headers)
                st.raise_for_status()
                s = st.json().get("status")
                if s == "COMPLETED":
                    break
                if s in ("FAILED", "ERROR", "CANCELLED"):
                    raise RuntimeError(f"fal 视频生成失败：{s}")
            else:
                raise RuntimeError("fal 视频生成超时")

            # 3) 取结果 → 视频 URL → 下载
            res = await client.get(response_url, headers=headers)
            res.raise_for_status()
            d = res.json()
            vurl = (d.get("video") or {}).get("url") or (
                (d.get("videos") or [{}])[0].get("url") if d.get("videos") else None)
            if not vurl:
                raise RuntimeError(f"fal 视频响应无 url: {str(d)[:200]}")
            dl = await client.get(vurl, timeout=120)
            dl.raise_for_status()
            raw = dl.content

        # 尺寸/时长：从响应元数据取，取不到给合理缺省（不阻断落库）
        w = (d.get("video") or {}).get("width") or 720
        h = (d.get("video") or {}).get("height") or 1280
        return GeneratedVideo(data=raw, mime="video/mp4", width=int(w), height=int(h),
                              seconds=float(seconds), model=model)
