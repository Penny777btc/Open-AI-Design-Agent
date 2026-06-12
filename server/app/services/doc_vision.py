"""文档视觉理解（Gemini 原生接口）：看渲染后的页面，产出结构化摘要 + 产品页定位。

解决两类盲取问题：
1. 嵌入图无语义 —— 不知道哪张是产品图、哪张是 logo/合影
2. 扫描件无文字层 —— 视觉摘要兼作 OCR
失败时静默降级（返回 None），不阻塞基础解析。
"""

import base64
import json
import logging
import re

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

VISION_MODEL = "gemini-2.5-flash"

PROMPT = """这是一份用户上传的产品/品牌资料文档的逐页截图（按顺序）。请通读全部页面后只输出一个 JSON 对象：

{
  "summary": "结构化摘要：品牌名、产品线、每个产品的名称/品种/年份/规格/价格/卖点、品牌故事要点、奖项荣誉。设计师将依据它做海报，务必保留可直接引用的事实与文案，500-1500字",
  "product_pages": [包含清晰产品照片（产品主体大图，适合做设计参考）的页码列表，从1开始],
  "doc_type": "一句话描述文档类型"
}"""


CLASSIFY_PROMPT = """以下是从产品资料中提取的候选图片（按序号标注）。逐张判断哪些是「产品照片」——产品本体的清晰展示图（如商品白底图/包装图/产品特写），不包括：风景、人物合影、logo、奖牌、装饰图。

只输出 JSON：{"product_indices": [产品照片的序号列表，按作为设计参考的价值降序]}"""


async def classify_images(images: list[bytes]) -> list[int] | None:
    """对候选图分类，返回产品图序号（0 起）按价值降序；失败返回 None。"""
    if not settings.gemini_api_key or not images:
        return None
    from io import BytesIO

    from PIL import Image

    parts = [{"text": CLASSIFY_PROMPT}]
    for i, raw in enumerate(images):
        try:
            img = Image.open(BytesIO(raw)).convert("RGB")
            img.thumbnail((256, 256))
            buf = BytesIO()
            img.save(buf, "JPEG", quality=70)
            parts.append({"text": f"#{i}"})
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}})
        except Exception:
            continue

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{settings.sub2api_base_url.rstrip('/')}/v1beta/models/{VISION_MODEL}:generateContent",
                headers={"x-goog-api-key": settings.gemini_api_key},
                json={"contents": [{"role": "user", "parts": parts}]},
            )
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        if m := re.search(r"\{.*\}", text, re.DOTALL):
            indices = json.loads(m.group(0)).get("product_indices", [])
            return [int(i) for i in indices if isinstance(i, int) or str(i).isdigit()]
    except Exception as exc:
        logger.warning("doc vision classify failed: %s", str(exc)[:200])
    return None


async def analyze(page_renders: list[tuple[int, bytes]]) -> dict | None:
    """page_renders: [(页码从1开始, png bytes)]。返回 {summary, product_pages, doc_type} 或 None。"""
    if not settings.gemini_api_key or not page_renders:
        return None
    parts = [{"text": PROMPT}]
    for page_no, png in page_renders[:16]:
        parts.append({"text": f"—— 第 {page_no} 页 ——"})
        parts.append({"inline_data": {"mime_type": "image/png", "data": base64.b64encode(png).decode()}})

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            resp = await client.post(
                f"{settings.sub2api_base_url.rstrip('/')}/v1beta/models/{VISION_MODEL}:generateContent",
                headers={"x-goog-api-key": settings.gemini_api_key},
                json={"contents": [{"role": "user", "parts": parts}]},
            )
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        if m := re.search(r"\{.*\}", text, re.DOTALL):
            data = json.loads(m.group(0))
            return {
                "summary": str(data.get("summary", ""))[:8000],
                "product_pages": [int(p) for p in data.get("product_pages", []) if str(p).isdigit() or isinstance(p, int)],
                "doc_type": str(data.get("doc_type", ""))[:200],
            }
    except Exception as exc:
        logger.warning("doc vision analyze failed: %s", str(exc)[:200])
    return None
