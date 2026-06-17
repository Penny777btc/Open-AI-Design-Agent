"""智能四层拆解（Smart 4-Layer Split）：把一张 AI 生成的成品图拆成可独立编辑、
完整、对齐的图层（背景 / 装饰元素 / 主体 / 文字），叠回源图同一位置 → 还原原图，但已分层。

四层架构（自底向上）：
- 背景层：移除前景（主体+装饰+文字）后真实补全的干净背景场景。
- 装饰元素层：叠加在背景上的道具/水果/花卉/光斑等，逐个按 bbox 裁子图内抠图，贴回整帧。
- 主体层：核心产品，整图直抠 ∪ bbox 求交，保留原像素的透明 PNG。
- 文字层：OCR 识别的叠加营销文字 → 可编辑文字节点（持久化为 kind=text_layer Asset）。

每层都做成与源帧同尺寸的整帧透明 PNG → 叠回同坐标 = 像素级完美重叠、可分别编辑、可导出分层 PSD。

管线（每个对象）：bbox 裁子图 → 子图内 rembg → _clean_fragments 清碎片 → 贴回整帧透明画布原坐标
→ 完整性校验（几何/occluded/二次 vision）→ 不完整则 provider.edit 补全（masked inpaint）
→ 必须重抠成透明（edit 输出是不透明 RGB）→ 补坏自检回退。

识别在 plan 构造期同步完成（build_smart_split_plan 为 async），DAG/节点数在审批前定型；
识别失败 → 降级回 build_split_plan（背景+主体+文字 三层）。
"""

import base64
import io
import json
import re

import httpx

from app.agents.planner import Plan, PlanNode
from app.config import settings

_rembg_session = None

# 单张拆图的模型调用上限（§7.2）——operator 真实成本护栏
MAX_ELEMENTS = 6   # 装饰元素数上限（识别 prompt 限 + _normalize_layout 截断）


def cutout_subject(src: bytes, *, lift_lo: int = 25, lift_scale: int = 4) -> bytes:
    """本地抠主体 → 透明 PNG。

    用 isnet-general-use 模型（比默认 u2net 对产品更利落）+ mask 后处理，
    再把 alpha 抬升「二值化」：玻璃瓶身这类半透明主体不再发虚/透明，主体变实心，
    边缘保留一点过渡做抗锯齿。

    lift_lo/lift_scale 参数化（§4.1）：实心产品/主体用默认硬阈值（25/4，向后兼容旧调用）；
    水花/光斑/飘带等半透明装饰元素用更柔的阈值（如 10/2）避免切成硬边毛刺。
    """
    global _rembg_session

    import numpy as np
    from PIL import Image
    from rembg import new_session, remove

    if _rembg_session is None:
        _rembg_session = new_session("isnet-general-use")
    png = remove(src, session=_rembg_session, post_process_mask=True)
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    arr = np.array(im)
    a = arr[:, :, 3].astype("float32")
    arr[:, :, 3] = np.clip((a - lift_lo) * lift_scale, 0, 255).astype("uint8")  # 抬升 alpha → 实心
    out = io.BytesIO()
    Image.fromarray(arr).save(out, "PNG")
    return out.getvalue()


SPLIT_ROLES = [
    {
        "key": "bg", "label": "背景层",
        "transparent": False,
        "prompt": (
            "Extract a CLEAN, EMPTY BACKGROUND PLATE from this design image. Remove the MAIN PRODUCT, AND remove "
            "EVERY foreground / decorative object — props, fruit, glassware, bowls, utensils, flowers, garnishes — "
            "AND ALL overlaid marketing text / titles / captions / icon rows. Realistically inpaint every removed "
            "area using ONLY the plain background surface (the table / fabric / backdrop / gradient) that sits "
            "behind it, matching the existing background color, lighting, texture and perspective. "
            "CRITICAL: do NOT regenerate, invent, or add ANY new objects, products, fruit, props, garnishes, or "
            "text to fill the gaps — fill them with the EMPTY background ONLY, as if nothing was ever placed there. "
            "Output ONLY the clean empty background scene — no product, no props, no fruit, no text, no floating "
            "shadow, no remnants of any removed object."
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
    """降级用的「背景层 + 主体层 + 文字层」三层拆分计划（智能识别失败时回退）。

    split_1 背景层(edit_image, 去主体+去文字)、split_2 主体层(cutout_layer 抠图)、
    split_3 文字层(OCR 识别叠加文字 → 持久化为可编辑文字层)。
    """
    if not source_label:
        raise ValueError("未选择要拆分的图片")
    nodes = [
        PlanNode(
            id="split_bg", tool="edit_image", label="AI 拆分 · 背景层",
            args={"prompt": SPLIT_ROLES[0]["prompt"], "source_asset": source_label,
                  "split_role": "bg", "z_index": 0},
            depends=[],
        ),
        PlanNode(
            id="split_subject", tool="cutout_layer", label="AI 拆分 · 主体层",
            args={"source_asset": source_label, "split_role": "subject", "z_index": 1},
            depends=["split_bg"],  # 背景先落(在下)、主体后落(在上)
        ),
        PlanNode(
            id="split_text", tool="extract_text", label="AI 拆分 · 文字层",
            args={"source_asset": source_label, "split_role": "text", "z_index": 10000},
            depends=["split_subject"],  # 文字最后落 → 叠在最上层
        ),
    ]
    return Plan(
        mode="plan", title="AI 拆分（背景层 + 主体层 + 文字层）", nodes=nodes,
        notes=["把选中的 AI 图拆成『背景层』+『主体层(透明)』+『可编辑文字层』，叠回原位 → 可分别编辑、可导出分层 PSD"],
    )


# ============================================================================
# 公共 Gemini vision helper（消除识别/校验/OCR 的重复骨架）
# ============================================================================

async def _gemini_vision_json(image: bytes, prompt: str, *, max_dim: int = 1024, timeout: float = 90.0) -> dict | None:
    """通用 Gemini vision → JSON：thumbnail→JPEG→inline_data→generateContent→解析首个 {..}。

    任何异常 / 无 gemini_api_key → 返回 None（绝不抛到 plan 层）。
    """
    if not settings.gemini_api_key or not image:
        return None
    try:
        from PIL import Image

        im = Image.open(io.BytesIO(image)).convert("RGB")
        im.thumbnail((max_dim, max_dim))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode()
        parts = [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(
                f"{settings.sub2api_base_url.rstrip('/')}/v1beta/models/gemini-2.5-flash:generateContent",
                headers={"x-goog-api-key": settings.gemini_api_key},
                json={"contents": [{"role": "user", "parts": parts}]},
            )
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        m = re.search(r"\{.*\}", text, re.DOTALL)
        return json.loads(m.group(0)) if m else None
    except Exception:
        return None


# ============================================================================
# 第 1 步 识别（analyze_layers）：背景描述 + 主体(bbox,occluded) + 装饰元素[]
# ============================================================================

_IDENTIFY_PROMPT = (
    "你在按「四层设计架构」拆解一张电商成品图。识别画面里：\n"
    "- background: 背景场景的一句话描述（材质/色调/光向，用于补洞参考）。\n"
    "- subject: 核心主体/产品，给 {box:[ymin,xmin,ymax,xmax] 归一化 0-1000, occluded:是否被遮挡或出血裁切}。\n"
    "- elements: 叠加在背景上的【装饰元素】(道具/水果/花卉/几何块/光斑/飘带等，非主产品、非文字)，\n"
    "  每个 {label, box:[...0-1000], occluded:bool, in_front:bool(相对主体在前/上为 true)}。最多 6 个。没有就空数组。\n"
    "- 不要识别叠加文字（文字层单独 OCR）；不要把印在产品标签上的字当元素。\n"
    "只输出 JSON：\n"
    '{"background":"..","subject":{"box":[..],"occluded":false},\n'
    ' "elements":[{"label":"..","box":[..],"occluded":false,"in_front":true}]}'
)


def _rel_from_box(box) -> dict | None:
    """[ymin,xmin,ymax,xmax]（0-1000）→ {relX,relY,relW,relH}（0-1），退化框返回 None。"""
    if not isinstance(box, (list, tuple)) or len(box) != 4:
        return None
    try:
        ymin, xmin, ymax, xmax = [max(0.0, min(1000.0, float(v))) / 1000.0 for v in box]
    except (TypeError, ValueError):
        return None
    if xmax <= xmin or ymax <= ymin:
        return None
    return {"relX": xmin, "relY": ymin, "relW": xmax - xmin, "relH": ymax - ymin}


def _normalize_layout(raw: dict | None) -> dict | None:
    """把识别原始 JSON 归一化为内部结构；subject 缺失/退化 → 返回 None（触发降级）。"""
    if not isinstance(raw, dict):
        return None
    subj_raw = raw.get("subject") or {}
    subj_rel = _rel_from_box(subj_raw.get("box")) if isinstance(subj_raw, dict) else None
    if subj_rel is None:
        return None  # 主体识别失败 → analyze_layers 返回 None → 降级三层
    subject = {**subj_rel, "occluded": bool(subj_raw.get("occluded", False))}

    elements = []
    for el in (raw.get("elements") or []):
        if not isinstance(el, dict):
            continue
        rel = _rel_from_box(el.get("box"))
        if rel is None:
            continue
        elements.append({
            "label": str(el.get("label", "装饰"))[:40],
            **rel,
            "occluded": bool(el.get("occluded", False)),
            "in_front": bool(el.get("in_front", False)),
        })
    # 按 box 面积降序截断到 MAX_ELEMENTS（大元素优先）
    elements.sort(key=lambda e: e["relW"] * e["relH"], reverse=True)
    elements = elements[:MAX_ELEMENTS]

    return {
        "background": str(raw.get("background", ""))[:300],
        "subject": subject,
        "elements": elements,
    }


async def analyze_layers(image: bytes) -> dict | None:
    """识别四层布局：返回 {background, subject{relX..,occluded}, elements[{label,relX..,occluded,in_front}]}。
    无 key / 调用失败 / 主体缺失 → 返回 None（调用方据此降级到 build_split_plan 三层）。"""
    raw = await _gemini_vision_json(image, _IDENTIFY_PROMPT, max_dim=1024, timeout=90.0)
    return _normalize_layout(raw)


# ============================================================================
# 第 2 步 抠图：按 bbox 裁子图 + 子图内 rembg + _clean_fragments + 贴回整帧
# ============================================================================

def _decode_size(src: bytes) -> tuple[int, int]:
    """源图真实解码像素尺寸（mask 必须按此画，§6 强制约束）。"""
    from app.providers.openai_compat import _png_dims

    dims = _png_dims(src)
    if dims is not None:
        return dims
    from PIL import Image

    with Image.open(io.BytesIO(src)) as im:
        return im.size


def _px_box(rel: dict, W: int, H: int, pad: float = 0.0) -> tuple[int, int, int, int]:
    """rel bbox(+pad) → 整数像素框 (x0,y0,x1,y1)，clamp 到 [0,W]/[0,H]。"""
    x0 = (rel["relX"] - pad) * W
    y0 = (rel["relY"] - pad) * H
    x1 = (rel["relX"] + rel["relW"] + pad) * W
    y1 = (rel["relY"] + rel["relH"] + pad) * H
    x0 = max(0, min(W, int(round(x0))))
    y0 = max(0, min(H, int(round(y0))))
    x1 = max(0, min(W, int(round(x1))))
    y1 = max(0, min(H, int(round(y1))))
    return x0, y0, x1, y1


def _alpha_stats(rgba) -> tuple[int, tuple[int, int, int, int] | None]:
    """RGBA numpy/PIL → (alpha 实心面积像素数, alpha 包围盒 (x0,y0,x1,y1) 或 None)。"""
    import numpy as np

    a = np.array(rgba)[:, :, 3]
    mask = a > 40
    area = int(mask.sum())
    if area == 0:
        return 0, None
    ys, xs = np.where(mask)
    return area, (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)


def cutout_region(src: bytes, rel_box: dict, *, pad: float = 0.06,
                  lift_lo: int = 25, lift_scale: int = 4, min_frac: float = 0.05) -> bytes:
    """按 rel bbox(含 pad) 裁子图 → cutout_subject(lift 参数化) → _clean_fragments
    → 贴回 W×H 整帧透明画布的原 px 位置。返回整帧 RGBA PNG。

    多元素分离不串：每个元素独立裁子图 → rembg 只见单对象（物理隔离）→ _clean_fragments 清邻居碎片。
    """
    from PIL import Image

    from app.agents.composite import _clean_fragments

    im = Image.open(io.BytesIO(src)).convert("RGBA")
    W, H = im.size
    x0, y0, x1, y1 = _px_box(rel_box, W, H, pad)
    if x1 - x0 < 2 or y1 - y0 < 2:
        # 退化框 → 整帧空透明
        return _blank_frame(W, H)
    sub = im.crop((x0, y0, x1, y1))
    sub_buf = io.BytesIO()
    sub.save(sub_buf, "PNG")
    cut = cutout_subject(sub_buf.getvalue(), lift_lo=lift_lo, lift_scale=lift_scale)
    cut = _clean_fragments(cut, min_frac)
    cut_im = Image.open(io.BytesIO(cut)).convert("RGBA")
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    frame.alpha_composite(cut_im, (x0, y0))
    out = io.BytesIO()
    frame.save(out, "PNG")
    return out.getvalue()


def cutout_subject_full(src: bytes, rel_box: dict, *, lift_lo: int = 25, lift_scale: int = 4,
                        min_frac: float = 0.05) -> bytes:
    """主体抠图双路（§4，质量更优）：整图直抠 ∪ 与 subject bbox 求交，
    取落在 bbox 内 alpha 面积更大者；若 bbox 内整图直抠面积不占优，回退 cutout_region。
    返回整帧 W×H 透明 PNG。"""
    import numpy as np
    from PIL import Image

    from app.agents.composite import _clean_fragments

    im = Image.open(io.BytesIO(src)).convert("RGBA")
    W, H = im.size
    x0, y0, x1, y1 = _px_box(rel_box, W, H, pad=0.04)

    # 路 A：整图直抠（isnet 对最大连通主体边缘最干净）
    try:
        full = cutout_subject(src, lift_lo=lift_lo, lift_scale=lift_scale)
        full = _clean_fragments(full, min_frac)
        full_im = Image.open(io.BytesIO(full)).convert("RGBA")
        if full_im.size != (W, H):
            full_im = full_im.resize((W, H), Image.LANCZOS)
        # 与 bbox 求交：只保留落在主体框内的 alpha
        arr = np.array(full_im)
        bbmask = np.zeros((H, W), dtype=bool)
        bbmask[y0:y1, x0:x1] = True
        arr[~bbmask, 3] = 0
        a_full = int((arr[:, :, 3] > 40).sum())
        full_clipped = Image.fromarray(arr)
    except Exception:
        a_full, full_clipped = 0, None

    # 路 B：bbox 裁子图内抠（识别误差导致主体超框时更稳）
    region = cutout_region(src, rel_box, pad=0.04, lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac)
    region_im = Image.open(io.BytesIO(region)).convert("RGBA")
    a_region = int((np.array(region_im)[:, :, 3] > 40).sum())

    if full_clipped is not None and a_full >= a_region:
        out = io.BytesIO()
        full_clipped.save(out, "PNG")
        return out.getvalue()
    return region


def _blank_frame(W: int, H: int) -> bytes:
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGBA", (max(1, W), max(1, H)), (0, 0, 0, 0)).save(out, "PNG")
    return out.getvalue()


def dislocation_guard(layer_png: bytes, rel_box: dict) -> bool:
    """抠图错位防护（§4.2）：alpha 包围盒中心相对识别 bbox 中心偏离 >50% bbox 边长，
    或 alpha 面积 < bbox 面积 3% → 判定抠空/抠错，返回 True（应丢弃该层）。"""
    from PIL import Image

    im = Image.open(io.BytesIO(layer_png)).convert("RGBA")
    W, H = im.size
    area, bb = _alpha_stats(im)
    if bb is None:
        return True  # 全透明 = 抠空
    bx0, by0, bx1, by1 = _px_box(rel_box, W, H)
    bbox_w = max(1, bx1 - bx0)
    bbox_h = max(1, by1 - by0)
    bbox_area = bbox_w * bbox_h
    if area < bbox_area * 0.03:
        return True
    a_cx = (bb[0] + bb[2]) / 2
    a_cy = (bb[1] + bb[3]) / 2
    b_cx = (bx0 + bx1) / 2
    b_cy = (by0 + by1) / 2
    if abs(a_cx - b_cx) > 0.5 * bbox_w or abs(a_cy - b_cy) > 0.5 * bbox_h:
        return True
    return False


# ============================================================================
# 第 3 步 完整性校验 + 补全
# ============================================================================

def _touches_frame_edge(rel_box: dict, eps: float = 0.01) -> str | None:
    """识别 bbox 是否贴近画框某边 → 返回该边方向（出血裁切疑似）。"""
    if rel_box["relX"] <= eps:
        return "left"
    if rel_box["relX"] + rel_box["relW"] >= 1.0 - eps:
        return "right"
    if rel_box["relY"] <= eps:
        return "top"
    if rel_box["relY"] + rel_box["relH"] >= 1.0 - eps:
        return "bottom"
    return None


def _fragment_count(layer_png: bytes) -> tuple[int, float]:
    """连通块数 + 第二大块/最大块占比（碎裂判据，§5.1）。"""
    try:
        import numpy as np
        from PIL import Image
        from scipy import ndimage

        arr = np.array(Image.open(io.BytesIO(layer_png)).convert("RGBA"))
        mask = arr[:, :, 3] > 40
        lbl, n = ndimage.label(mask)
        if n <= 1:
            return n, 0.0
        sizes = sorted(ndimage.sum(mask, lbl, range(1, n + 1)), reverse=True)
        ratio = (sizes[1] / sizes[0]) if sizes[0] > 0 else 0.0
        return n, float(ratio)
    except Exception:
        return 1, 0.0


_VERIFY_PROMPT = (
    "这是从整图抠出的单个对象（透明背景，已合到白底），判断它作为独立完整对象是否完整、"
    "有无被遮挡/裁切缺一块。\n"
    '只输出 JSON：{"complete":true|false,"missing":"缺失部位简短描述(如 右下角被裁切 / 中部被遮挡)"}'
)


def _on_white(layer_png: bytes) -> bytes:
    """透明层合到白底 → 喂 vision 校验（透明 PNG 直接喂常被忽略 alpha）。"""
    from PIL import Image

    im = Image.open(io.BytesIO(layer_png)).convert("RGBA")
    bg = Image.new("RGBA", im.size, (255, 255, 255, 255))
    bg.alpha_composite(im)
    out = io.BytesIO()
    bg.convert("RGB").save(out, "JPEG", quality=85)
    return out.getvalue()


async def verify_complete(layer_png: bytes, rel_box: dict, occluded: bool) -> tuple[bool, str | None]:
    """判定对象是否「不完整」。返回 (incomplete, missing_desc)。

    几何先行（免费）：触边/出血裁切 或 碎裂（≥3 块且第二大>最大 0.3）→ 残缺；
    occluded==true → 残缺；几何/occluded 疑似时才调一次 vision 复核。
    都不疑似 → (False, None)，零补全调用。
    """
    edge = _touches_frame_edge(rel_box)
    n_frag, ratio = _fragment_count(layer_png)
    geom_suspect = edge is not None or (n_frag >= 3 and ratio > 0.3)
    if not geom_suspect and not occluded:
        return False, None
    # 二次 vision 复核（调用方用 MAX_VERIFY 限次）
    res = await _gemini_vision_json(_on_white(layer_png), _VERIFY_PROMPT, max_dim=768, timeout=60.0)
    if res is None:
        # 无 vision：保守地，仅当 occluded 或明显碎裂时才认定残缺（触边可能本就在边缘）
        if occluded or (n_frag >= 3 and ratio > 0.3):
            return True, ("被遮挡" if occluded else "碎裂")
        return False, None
    if res.get("complete") is True:
        return False, None
    return True, str(res.get("missing", ""))[:60]


async def verify_label_match(layer_png: bytes, label: str) -> bool:
    """补全后复检：补出来的还是不是「label」本身？防止 inpaint 幻觉成别的东西
    （实测把"金色餐具"补成小酒瓶）。无法判断（无 key/异常）时默认放行，避免误杀。"""
    if not label:
        return True
    prompt = (
        f"这是一张从设计图里抠出的单个对象（已合成到白底）。判断它是不是一个「{label}」。"
        f"只有当画面里明显是**别的东西**（不是 {label}）时才回 false。"
        '只输出 JSON：{"match": true|false}'
    )
    res = await _gemini_vision_json(_on_white(layer_png), prompt, max_dim=512, timeout=40.0)
    if not res or "match" not in res:
        return True  # 判断不了就放行，不阻断补全
    return bool(res.get("match"))


def build_completion_mask(layer_png: bytes, rel_box: dict) -> bytes | None:
    """补全 mask（透明区=重绘区），两形态（§5.2）：

    - 触边/出血裁切 → outpaint：朝触边方向把 alpha 包围盒外扩 ~15% 设透明（重画外扩环）。
    - 被前景遮挡（内部洞）→ inpaint：mask = bbox 矩形 − alpha 实心区（中间镂空的遮挡孔设透明）。

    mask 与 layer_png 同尺寸（= 源帧）。若算出「全不透明无洞」→ 返回 None（对象已完整，跳过补全）。
    """
    import numpy as np
    from PIL import Image

    im = Image.open(io.BytesIO(layer_png)).convert("RGBA")
    W, H = im.size
    alpha = np.array(im)[:, :, 3]
    solid = alpha > 40
    if not solid.any():
        return None
    bx0, by0, bx1, by1 = _px_box(rel_box, W, H)

    # mask alpha：255=保留(不动)，0=重绘(透明洞)
    mask_a = np.full((H, W), 255, dtype=np.uint8)
    edge = _touches_frame_edge(rel_box)
    if edge is not None:
        # outpaint：alpha 包围盒朝触边方向外扩 15%
        ys, xs = np.where(solid)
        ax0, ay0, ax1, ay1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        ew = int((ax1 - ax0) * 0.15)
        eh = int((ay1 - ay0) * 0.15)
        ox0, oy0, ox1, oy1 = ax0, ay0, ax1, ay1
        if edge == "left":
            ox0 = max(0, ax0 - ew)
        elif edge == "right":
            ox1 = min(W, ax1 + ew)
        elif edge == "top":
            oy0 = max(0, ay0 - eh)
        elif edge == "bottom":
            oy1 = min(H, ay1 + eh)
        region = np.zeros((H, W), dtype=bool)
        region[oy0:oy1, ox0:ox1] = True
        hole = region & (~solid)  # 外扩环里非实心的部分 = 要补的
    else:
        # inpaint 镂空孔：bbox 矩形 − alpha 实心区
        region = np.zeros((H, W), dtype=bool)
        region[by0:by1, bx0:bx1] = True
        hole = region & (~solid)
    if not hole.any():
        return None
    mask_a[hole] = 0
    mask = np.zeros((H, W, 4), dtype=np.uint8)
    mask[:, :, 3] = mask_a
    out = io.BytesIO()
    Image.fromarray(mask, "RGBA").save(out, "PNG")
    return out.getvalue()


_COMPLETE_PROMPT = (
    "Complete this partially occluded/clipped object into a single WHOLE, intact {label}. "
    "Inpaint ONLY the transparent (missing) area so it becomes complete and natural, "
    "matching its own color/material/lighting/perspective. Do not add background, props, or text."
)


def build_bg_hole_mask(src: bytes, layout: dict, *, pad: float = 0.02) -> bytes:
    """背景洞 mask：主体 ∪ 所有元素 ∪ 文字 bbox 的并集设透明（要补的洞），其余 255（保留）。

    按源图真实解码像素 W×H 绘制（§6 mask 同尺寸硬约束），rel-bbox × 真实 W/H 整数化后 clamp。
    """
    import numpy as np
    from PIL import Image

    W, H = _decode_size(src)
    mask_a = np.full((H, W), 255, dtype=np.uint8)
    boxes = [layout["subject"]] + list(layout.get("elements") or [])
    for b in boxes:
        x0, y0, x1, y1 = _px_box(b, W, H, pad)
        if x1 > x0 and y1 > y0:
            mask_a[y0:y1, x0:x1] = 0
    mask = np.zeros((H, W, 4), dtype=np.uint8)
    mask[:, :, 3] = mask_a
    out = io.BytesIO()
    Image.fromarray(mask, "RGBA").save(out, "PNG")
    return out.getvalue()


# ── 子图回帧 helper（补全：edit 输出回到子图裁切框尺寸再重抠，§5.2 末） ──

def resize_cover(png: bytes, w: int, h: int) -> bytes:
    """把图 resize 到 w×h；宽高比不同则 cover（铺满）+ 中心裁切，保持不变形。"""
    from PIL import Image

    im = Image.open(io.BytesIO(png)).convert("RGBA")
    sw, sh = im.size
    if (sw, sh) == (w, h) or w < 1 or h < 1:
        if (sw, sh) != (w, h):
            im = im.resize((max(1, w), max(1, h)), Image.LANCZOS)
        out = io.BytesIO()
        im.save(out, "PNG")
        return out.getvalue()
    scale = max(w / sw, h / sh)
    nw, nh = max(1, int(round(sw * scale))), max(1, int(round(sh * scale)))
    im = im.resize((nw, nh), Image.LANCZOS)
    left = (nw - w) // 2
    top = (nh - h) // 2
    im = im.crop((left, top, left + w, top + h))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def _alpha_area(png: bytes) -> int:
    from PIL import Image

    area, _ = _alpha_stats(Image.open(io.BytesIO(png)).convert("RGBA"))
    return area


def recut_completed(edit_rgb: bytes, src: bytes, rel_box: dict, *, lift_lo: int, lift_scale: int,
                    min_frac: float) -> bytes:
    """补全后强制重抠（§5.2 闭环）：provider.edit 返回不透明整帧 RGB →
    先回帧到子图裁切框尺寸 → cutout_subject + _clean_fragments 重抠成透明 → 贴回整帧原坐标。"""
    from PIL import Image

    from app.agents.composite import _clean_fragments

    W, H = _decode_size(src)
    x0, y0, x1, y1 = _px_box(rel_box, W, H, pad=0.06)
    cw, ch = max(2, x1 - x0), max(2, y1 - y0)
    # edit 输出是 gpt-image 固定档位 → 回到子图裁切框尺寸（与贴回坐标像素对齐）
    sub = resize_cover(edit_rgb, cw, ch)
    cut = cutout_subject(sub, lift_lo=lift_lo, lift_scale=lift_scale)
    cut = _clean_fragments(cut, min_frac)
    cut_im = Image.open(io.BytesIO(cut)).convert("RGBA")
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    frame.alpha_composite(cut_im, (x0, y0))
    out = io.BytesIO()
    frame.save(out, "PNG")
    return out.getvalue()


async def complete_object(layer_png: bytes, src: bytes, rel_box: dict, label: str, *,
                          lift_lo: int, lift_scale: int, min_frac: float) -> bytes:
    """补全不完整对象：构造 mask → provider.edit(transparent=False) inpaint → 回帧 → 重抠
    → 补坏自检（重抠 alpha 面积反而 < 补全前 → 丢弃补全，用补全前）。

    任何失败 → 返回补全前的 layer_png（残缺也成层，§7 降级 3）。
    """
    from app.providers import get_image_provider

    mask = build_completion_mask(layer_png, rel_box)
    if mask is None:
        return layer_png  # 无洞 → 对象已完整，跳过补全
    provider = get_image_provider()
    prompt = _COMPLETE_PROMPT.replace("{label}", label or "object")
    try:
        # transparent=False（§强制：transparent=True → 502）；mask 透明区=重绘区
        edited = await provider.edit(prompt, src, "1:1", mask=mask, transparent=False)
    except Exception:
        return layer_png  # edit 失败 / URL 型 raise → 退回未补全
    try:
        recut = recut_completed(edited.data, src, rel_box, lift_lo=lift_lo,
                                lift_scale=lift_scale, min_frac=min_frac)
    except Exception:
        return layer_png
    # 补坏自检：补全后 alpha 面积反而变小 → 判定补坏，用补全前
    if _alpha_area(recut) < _alpha_area(layer_png):
        return layer_png
    return recut


# ============================================================================
# 智能四层拆解 plan 构造（async：识别在审批前定型，DAG/节点数 fixed）
# ============================================================================

async def build_smart_split_plan(session_id: str, source_label: str, src_bytes: bytes | None) -> Plan:
    """识别四层布局 → 构造显式 z_index、单 depends 链的拆解 DAG。
    识别失败（无 key / 无主体 / 无源图）→ return build_split_plan（三层降级，master switch）。"""
    if not source_label:
        raise ValueError("未选择要拆分的图片")
    layout = await analyze_layers(src_bytes) if src_bytes else None
    if layout is None:
        return build_split_plan(source_label)  # 识别失败 → 三层降级（§7.1 总开关）

    elements = layout["elements"]
    behind = [e for e in elements if not e["in_front"]]
    front = [e for e in elements if e["in_front"]]

    # 背景洞 mask 在 plan 期预构造（§2.1）：前景并集洞，按真实像素尺寸绘制
    bg_args = {"prompt": SPLIT_ROLES[0]["prompt"], "source_asset": source_label,
               "split_role": "bg", "z_index": 0}
    try:
        from app.routers.chat import _write_mask

        bg_mask = build_bg_hole_mask(src_bytes, layout)
        bg_args["mask_key"] = _write_mask(session_id, bg_mask)
    except Exception:
        pass  # mask 失败 → 背景走无 mask 整图重绘（§7.1 降级 4）

    nodes: list[PlanNode] = []
    prev: list[str] = []

    def _chain(node: PlanNode):
        nonlocal prev
        node.depends = list(prev)  # 单链：每个节点只依赖上一个 → 串行 emit → z 序稳定
        nodes.append(node)
        prev = [node.id]

    # 1 底 背景（z=0）：edit_image + mask 走通用带 mask 分支，输出经 _resize_to_frame 回帧
    _chain(PlanNode(id="split_bg", tool="edit_image", label="智能拆解 · 背景层", args=bg_args))

    z = 1
    # behind 装饰元素（主体之后）
    for i, el in enumerate(behind):
        _chain(PlanNode(
            id=f"split_el{i + 1}", tool="cutout_layer", label=f"智能拆解 · 装饰「{el['label']}」",
            args={"source_asset": source_label, "split_role": "element", "bbox": el,
                  "label": el["label"], "occluded": el["occluded"], "z_index": z},
        ))
        z += 1

    # 主体（behind 之上、front 之下）
    _chain(PlanNode(
        id="split_subject", tool="cutout_layer", label="智能拆解 · 主体层",
        args={"source_asset": source_label, "split_role": "subject", "bbox": layout["subject"],
              "occluded": layout["subject"]["occluded"], "z_index": z},
    ))
    z += 1

    # front 装饰元素（主体之前）
    for j, el in enumerate(front):
        _chain(PlanNode(
            id=f"split_elf{j + 1}", tool="cutout_layer", label=f"智能拆解 · 前景「{el['label']}」",
            args={"source_asset": source_label, "split_role": "element", "bbox": el,
                  "label": el["label"], "occluded": el["occluded"], "z_index": z},
        ))
        z += 1

    # 末 文字层（z=10000，最上）
    _chain(PlanNode(
        id="split_text", tool="extract_text", label="智能拆解 · 文字层",
        args={"source_asset": source_label, "split_role": "text", "z_index": 10000},
    ))

    return Plan(
        mode="plan", title="智能四层拆解（背景 / 装饰 / 主体 / 文字）", nodes=nodes,
        notes=[
            "把成品图智能拆成『背景 / 装饰元素 / 主体 / 文字』四类完整图层，叠回原位 → 可分别编辑、可导出分层 PSD",
            "残缺/被遮挡的对象会自动 AI 补全为完整对象；背景洞自动补绘",
        ],
    )


def _ink_color(im, rel: tuple) -> str | None:
    """从文字框区域采样真实「墨色」：与背景反差最大的那批像素的平均色。
    比 vision 猜色更准（修复"提取出的可编辑文字颜色发虚/不对"）。失败返回 None。"""
    try:
        import numpy as np

        W, H = im.size
        x0, y0 = int(rel[0] * W), int(rel[1] * H)
        x1, y1 = int(rel[2] * W), int(rel[3] * H)
        if x1 <= x0 or y1 <= y0:
            return None
        crop = np.asarray(im.crop((x0, y0, x1, y1)).convert("RGB")).reshape(-1, 3).astype(float)
        if len(crop) < 12:
            return None
        bg = np.median(crop, axis=0)                       # 背景 ≈ 区域中位色
        dist = np.linalg.norm(crop - bg, axis=1)
        ink = crop[dist >= max(40.0, float(np.percentile(dist, 80)))]  # 反差最大的 ~20% = 墨
        if len(ink) < 6:
            ink = crop[dist >= float(np.percentile(dist, 70))]
        if len(ink) < 6:
            return None
        r, g, b = (int(v) for v in ink.mean(axis=0))
        return f"#{r:02x}{g:02x}{b:02x}"
    except Exception:
        return None


async def detect_text_blocks(image: bytes, lang: str = "zh") -> list[dict]:
    """OCR：识别图中「叠加的营销文字」（不含印在产品标签上的字），返回相对坐标的文字块。

    返回 [{text, relX, relY, relW, relH, color, align}]，坐标/尺寸均为相对图片的 0~1 比例。
    color 优先从源图真实像素采样（_ink_color），比 vision 猜色更忠实、不发虚。
    """
    if not settings.gemini_api_key:
        return []
    try:
        from PIL import Image

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
            # 真实像素采样优先，失败回退 vision 猜色
            color = _ink_color(im, (xmin, ymin, xmax, ymax)) or str(b.get("color", "#222222"))[:9]
            out.append({
                "text": t, "relX": xmin, "relY": ymin, "relW": xmax - xmin, "relH": ymax - ymin,
                "color": color, "align": b.get("align", "left"),
            })
        return out
    except Exception:
        return []
