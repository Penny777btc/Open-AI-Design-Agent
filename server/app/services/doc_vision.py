"""文档视觉理解（Gemini 原生接口）：看渲染后的页面，产出结构化摘要 + 产品页定位。

解决两类盲取问题：
1. 嵌入图无语义 —— 不知道哪张是产品图、哪张是 logo/合影
2. 扫描件无文字层 —— 视觉摘要兼作 OCR
失败时静默降级（返回 None），不阻塞基础解析。
"""

import asyncio
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
  "doc_type": "一句话描述文档类型",
  "products": ["文档中每个具体产品的名称（含品种/型号），最多8个"]
}"""


CLASSIFY_PROMPT = """以下是从产品资料中提取的候选图片（按序号标注）。逐张判断是否为「产品照片」——产品本体的清晰展示图（如商品白底图/包装图/产品特写）；风景、人物合影、logo、奖牌、装饰图不算。

仔细阅读每张图中产品标签/包装上的文字（产品名、型号、品种、规格），写进描述——后续要靠它区分同系列的不同产品。

只输出 JSON，每张候选图一条（产品图按设计参考价值降序排在前面）：
{"images": [{"index": <序号>, "is_product": true|false, "caption": "<这是什么图；产品图必须含标签上可辨认的产品名/型号/品种，30字内>"}]}"""


async def classify_images(images: list[bytes]) -> list[dict] | None:
    """逐图打标，返回 [{"index": 序号(0起), "is_product": bool, "caption": 描述}]，产品图按价值降序在前；失败返回 None。"""
    if not settings.gemini_api_key or not images:
        return None

    def _build_parts() -> list[dict]:
        # PIL 解码/缩放 16 张图是 CPU 同步操作，放线程里避免冻结事件循环
        from io import BytesIO

        from PIL import Image

        parts = [{"text": CLASSIFY_PROMPT}]
        for i, raw in enumerate(images):
            try:
                img = Image.open(BytesIO(raw)).convert("RGB")
                img.thumbnail((512, 512))  # 256px 读不清标签上的品种/型号小字
                buf = BytesIO()
                img.save(buf, "JPEG", quality=80)
                parts.append({"text": f"#{i}"})
                parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}})
            except Exception:
                continue
        return parts

    parts = await asyncio.to_thread(_build_parts)

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
            items = json.loads(m.group(0)).get("images", [])
            out = []
            for it in items:
                if isinstance(it, dict) and str(it.get("index", "")).lstrip("-").isdigit():
                    out.append({
                        "index": int(it["index"]),
                        "is_product": bool(it.get("is_product")),
                        "caption": str(it.get("caption", ""))[:120],
                    })
            return out
    except Exception as exc:
        logger.warning("doc vision classify failed: %s", str(exc)[:200])
    return None


async def analyze(page_renders: list[tuple[int, bytes]], lang: str = "zh") -> dict | None:
    """page_renders: [(页码从1开始, png bytes)]。返回 {summary, product_pages, doc_type, products} 或 None。"""
    if not settings.gemini_api_key or not page_renders:
        return None
    # summary 是喂给 planner 的内部上下文，保持中文无妨；doc_type 会原样展示给用户
    prompt = PROMPT + ("\n\ndoc_type 字段请用英文书写。" if lang == "en" else "")
    parts = [{"text": prompt}]
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
                "products": [str(p)[:60] for p in data.get("products", []) if str(p).strip()][:8],
            }
    except Exception as exc:
        logger.warning("doc vision analyze failed: %s", str(exc)[:200])
    return None
