"""AI 拆图：把一张 AI 生成的成品图拆成可独立编辑的图层。

- 背景层：把主体（产品）移除，并真实补全/延展背景，得到完整干净的背景场景。
- 主体层：只保留主体（产品），其余全部去掉，输出透明背景 PNG（带 alpha）。

两层在画布上叠回源图的同一位置/尺寸 → 看起来还是原图，但已是可分别移动、可导出分层 PSD 的两层。
"""

from app.agents.planner import Plan, PlanNode

_rembg_session = None


def cutout_subject(src: bytes) -> bytes:
    """本地抠主体 → 透明 PNG。

    用 isnet-general-use 模型（比默认 u2net 对产品更利落）+ mask 后处理，
    再把 alpha 抬升「二值化」：玻璃瓶身这类半透明主体不再发虚/透明，主体变实心，
    边缘保留一点过渡做抗锯齿。这是上次主体「透明模糊重影」问题的修复。
    """
    global _rembg_session
    import io

    import numpy as np
    from PIL import Image
    from rembg import new_session, remove

    if _rembg_session is None:
        _rembg_session = new_session("isnet-general-use")
    png = remove(src, session=_rembg_session, post_process_mask=True)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    arr = np.array(im)
    a = arr[:, :, 3].astype("float32")
    arr[:, :, 3] = np.clip((a - 25) * 4, 0, 255).astype("uint8")  # 抬升 alpha → 主体实心
    out = io.BytesIO()
    Image.fromarray(arr).save(out, "PNG")
    return out.getvalue()

SPLIT_ROLES = [
    {
        "key": "bg", "label": "背景层",
        "transparent": False,
        "prompt": (
            "Remove the MAIN SUBJECT / product from this image COMPLETELY, AND remove ALL overlaid marketing "
            "text / titles / captions / icon-text rows. Realistically inpaint and extend the background so the "
            "scene looks natural and complete as if the product and text were never there. Keep the exact same "
            "background style, colors, lighting, perspective and composition. Output ONLY the clean background "
            "scene — no product, no text, no floating shadow."
        ),
    },
    {
        "key": "subject", "label": "主体层",
        "transparent": True,
        "prompt": (
            "Keep ONLY the main subject / product exactly as it is (same shape, label, colors, lighting). "
            "Remove EVERYTHING else — background, props, text, surfaces — and output the product cut out on a "
            "FULLY TRANSPARENT background (alpha). Clean tight edges, no background remnants, no added shadow plate."
        ),
    },
]


def build_split_plan(source_label: str) -> Plan:
    """构造「背景层 + 主体层 + 文字层」的拆分计划。

    split_1 背景层(edit_image, 去主体+去文字)、split_2 主体层(rembg 抠图)、
    split_3 文字层(OCR 识别叠加文字 → 前端重建为可编辑文字节点)。
    """
    if not source_label:
        raise ValueError("未选择要拆分的图片")
    nodes = [
        PlanNode(
            id="split_1", tool="edit_image", label="AI 拆分 · 背景层",
            args={"prompt": SPLIT_ROLES[0]["prompt"], "source_asset": source_label, "split_role": "bg"},
            depends=[],
        ),
        PlanNode(
            id="split_2", tool="edit_image", label="AI 拆分 · 主体层",
            args={"prompt": SPLIT_ROLES[1]["prompt"], "source_asset": source_label, "split_role": "subject"},
            depends=["split_1"],  # 背景先落(在下)、主体后落(在上)
        ),
        PlanNode(
            id="split_3", tool="extract_text", label="AI 拆分 · 文字层",
            args={"source_asset": source_label, "split_role": "text"},
            depends=["split_2"],  # 文字最后落 → 叠在最上层
        ),
    ]
    return Plan(
        mode="plan", title="AI 拆分（背景层 + 主体层 + 文字层）", nodes=nodes,
        notes=["把选中的 AI 图拆成『背景层』+『主体层(透明)』+『可编辑文字层』，叠回原位 → 可分别编辑、可导出分层 PSD"],
    )


async def detect_text_blocks(image: bytes, lang: str = "zh") -> list[dict]:
    """OCR：识别图中「叠加的营销文字」（不含印在产品标签上的字），返回相对坐标的文字块。

    返回 [{text, relX, relY, relW, relH, color, align}]，坐标/尺寸均为相对图片的 0~1 比例。
    """
    import base64
    import io
    import json
    import re

    import httpx
    from PIL import Image

    from app.config import settings

    if not settings.gemini_api_key:
        return []
    try:
        im = Image.open(io.BytesIO(image)).convert("RGB")
        im.thumbnail((1024, 1024))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode()
        prompt = (
            "识别这张电商设计图里**叠加在画面上的营销文字**（标题/卖点/说明/图标旁文字），"
            "**不要**识别印在产品本身标签/包装上的文字。每块文字返回：text(原文)、"
            "box([ymin,xmin,ymax,xmax] 归一化到 0-1000)、color(文字颜色十六进制)、align(left/center/right)。"
            '只输出 JSON：{"blocks":[{"text":"..","box":[..],"color":"#..","align":".."}]}'
        )
        parts = [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]
        async with httpx.AsyncClient(timeout=90.0) as client:
            resp = await client.post(
                f"{settings.sub2api_base_url.rstrip('/')}/v1beta/models/gemini-2.5-flash:generateContent",
                headers={"x-goog-api-key": settings.gemini_api_key},
                json={"contents": [{"role": "user", "parts": parts}]},
            )
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        m = re.search(r"\{.*\}", text, re.DOTALL)
        blocks = json.loads(m.group(0)).get("blocks", []) if m else []
        out = []
        for b in blocks:
            box = b.get("box") or []
            t = str(b.get("text", "")).strip()
            if not t or len(box) != 4:
                continue
            ymin, xmin, ymax, xmax = [max(0, min(1000, float(v))) / 1000 for v in box]
            if xmax <= xmin or ymax <= ymin:
                continue
            out.append({
                "text": t, "relX": xmin, "relY": ymin, "relW": xmax - xmin, "relH": ymax - ymin,
                "color": str(b.get("color", "#222222"))[:9], "align": b.get("align", "left"),
            })
        return out
    except Exception:
        return []
