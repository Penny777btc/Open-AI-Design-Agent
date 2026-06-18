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
            "This image has transparent HOLES where the foreground product, some props and the overlaid text were "
            "removed. Inpaint ONLY those holes: seamlessly EXTEND the surrounding background SCENE into them — the "
            "draped cloth / fabric / silk and its folds, the table surface, the backdrop, the ambient light and "
            "soft shadows — matching the existing texture, color, folds, lighting and perspective, so it looks like "
            "those objects were simply never placed there. Do NOT paint any product, new prop, object or text into "
            "the holes — fill them with the natural continuation of the cloth / scene only. "
            "KEEP EVERY NON-HOLE PIXEL EXACTLY AS IT IS — the cloth, fabric, and any remaining scene elements must "
            "stay untouched; do NOT empty or whiten the scene. Output a natural, complete background SCENE."
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


def _drop_foreign_blobs(cut_png: bytes, ox: int, oy: int,
                        self_box: tuple, other_boxes: list, *, protect_largest: bool = False) -> bytes:
    """连通块归属裁决：把明显属于「邻居对象」的连通块从本抠图里抹掉（alpha 置 0）。

    每个连通块按质心（全帧坐标 = (ox,oy)+局部）归属：若某邻居框包含该质心、且其框中心比本框中心
    更近 → 判为邻居、丢弃。保守：只在「邻居明确拥有」时才丢，避免误删本体偏心碎块。
    解决相邻/重叠对象的串入问题（如酒杯框抓进旁边瓶子、主体抓进盘子边）。

    protect_largest=True（主体用）：永不丢「最大连通块」——主体是核心，哪怕 vision 把某个元素框
    画到了主体身上，也绝不能把主体本体丢空（曾出现「酒杯」框压住瓶子 → 主体被抠空）。
    """
    if not other_boxes:
        return cut_png
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    im = Image.open(io.BytesIO(cut_png)).convert("RGBA")
    arr = np.array(im)
    lbl, n = ndimage.label(arr[:, :, 3] > 8)
    if n <= 1:
        return cut_png

    keep_id = 0
    if protect_largest:  # 找最大块（本体），永不丢
        counts = np.bincount(lbl.ravel())
        counts[0] = 0
        keep_id = int(counts.argmax())

    def _cx(b):
        return ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0)

    def _inside(b, x, y):
        return b[0] <= x <= b[2] and b[1] <= y <= b[3]

    def _d2(x, y, b):
        mx, my = _cx(b)
        return (x - mx) ** 2 + (y - my) ** 2

    changed = False
    for i in range(1, n + 1):
        if i == keep_id:
            continue
        ys, xs = np.where(lbl == i)
        if len(xs) == 0:
            continue
        cx = ox + float(xs.mean())
        cy = oy + float(ys.mean())
        in_self = _inside(self_box, cx, cy)
        d_self = _d2(cx, cy, self_box)
        if any(_inside(o, cx, cy) and (not in_self or _d2(cx, cy, o) < d_self) for o in other_boxes):
            arr[ys, xs, 3] = 0  # 邻居明确拥有 → 丢弃该块
            changed = True
    if not changed:
        return cut_png
    out = io.BytesIO()
    Image.fromarray(arr, "RGBA").save(out, "PNG")
    return out.getvalue()


def subtract_alpha(cut_png: bytes, minus_png: bytes, *, dilate: int = 2, thr: int = 80) -> bytes:
    """从 cut 的 alpha 里按 minus 的真实形状扣掉重叠区域（比 bbox 邻居裁决更准）。

    用于：元素抠图串入了主体像素——尤其透明物（酒杯）抠不动自己、却抓到旁边实心的瓶子。按主体真实
    alpha 形状整片扣除后，这种"伪元素"会变空 → 被 dislocation_guard 拦下丢弃 → 主体不再被复制成两层。
    主体被前景元素遮挡处其 alpha 本就缺失，故不会误扣真正在主体之上的前景元素。
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    c = np.array(Image.open(io.BytesIO(cut_png)).convert("RGBA"))
    H, W = c.shape[:2]
    mim = Image.open(io.BytesIO(minus_png)).convert("RGBA")
    if mim.size != (W, H):
        mim = mim.resize((W, H), Image.LANCZOS)
    mask = np.array(mim)[:, :, 3] > thr
    if dilate:
        mask = ndimage.binary_dilation(mask, iterations=dilate)
    c[mask, 3] = 0
    out = io.BytesIO()
    Image.fromarray(c, "RGBA").save(out, "PNG")
    return out.getvalue()


def cutout_region(src: bytes, rel_box: dict, *, pad: float = 0.06,
                  lift_lo: int = 25, lift_scale: int = 4, min_frac: float = 0.05,
                  other_rel_boxes: list | None = None) -> bytes:
    """按 rel bbox(含 pad) 裁子图 → cutout_subject(lift 参数化) → _clean_fragments
    → 邻居块裁决 → 贴回 W×H 整帧透明画布的原 px 位置。返回整帧 RGBA PNG。

    多元素分离不串：每个元素独立裁子图 → rembg 只见单对象（物理隔离）→ _clean_fragments 清邻居碎片
    → 若给了 other_rel_boxes，再按几何归属丢掉串入的邻居整块（相邻对象 bbox 重叠时关键）。
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
    if other_rel_boxes:  # 邻居块裁决（子图坐标系：原点=裁切框左上 (x0,y0)）
        self_px = _px_box(rel_box, W, H, 0.0)
        other_px = [_px_box(b, W, H, 0.0) for b in other_rel_boxes]
        cut = _drop_foreign_blobs(cut, x0, y0, self_px, other_px)
    cut_im = Image.open(io.BytesIO(cut)).convert("RGBA")
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    frame.alpha_composite(cut_im, (x0, y0))
    out = io.BytesIO()
    frame.save(out, "PNG")
    return out.getvalue()


def cutout_subject_full(src: bytes, rel_box: dict, *, lift_lo: int = 25, lift_scale: int = 4,
                        min_frac: float = 0.05, other_rel_boxes: list | None = None) -> bytes:
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
        result = out.getvalue()
    else:
        result = region
    if other_rel_boxes:  # 邻居块裁决（整帧坐标系，原点 0,0）：丢掉串入的盘子边/邻物；
        self_px = _px_box(rel_box, W, H, 0.0)  # protect_largest：主体本体永不丢空（防 vision 元素框压主体）
        other_px = [_px_box(b, W, H, 0.0) for b in other_rel_boxes]
        result = _drop_foreign_blobs(result, 0, 0, self_px, other_px, protect_largest=True)
    return result


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


def judge_element_complete(cut_png: bytes, subj_png: bytes | None = None, *,
                           edge_frac: float = 0.08, subj_adj_frac: float = 0.24) -> bool:
    """执行期实判：这个抠出来的元素「是否完整」（不靠 vision 的 occluded 猜测）。

    两条几何判据（都满足才算完整）：
    1) 出血裁切：元素轮廓落在图像边缘的比例 > edge_frac → 被画框切掉 → 不完整。
    2) 主体遮挡：元素轮廓紧贴主体剪影的比例 > subj_adj_frac → 一截藏在主体后面 → 不完整。
    保守取阈值（宁可多抠成层，也少误判把好元素丢进背景）。返回 True=完整(抠成独立层)。
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    a = np.array(Image.open(io.BytesIO(cut_png)).convert("RGBA"))[:, :, 3] > 40
    H, W = a.shape
    if int(a.sum()) < max(64, int(0.005 * H * W)):
        return False  # 几乎抠空 / 太小碎片（<0.5% 帧）→ 当不完整，留背景，不吐废层
    boundary = a & ~ndimage.binary_erosion(a)
    nb = int(boundary.sum())
    if nb == 0:
        return True

    # 1) 画框出血
    edge = np.zeros_like(a)
    edge[:3, :] = edge[-3:, :] = edge[:, :3] = edge[:, -3:] = True
    if int((boundary & edge).sum()) / nb > edge_frac:
        return False

    # 2) 主体遮挡（贴着主体剪影）
    if subj_png:
        sa = np.array(Image.open(io.BytesIO(subj_png)).convert("RGBA"))[:, :, 3] > 40
        if sa.shape != a.shape:
            sa = np.array(Image.open(io.BytesIO(subj_png)).convert("RGBA").resize((W, H)))[:, :, 3] > 40
        near = ndimage.binary_dilation(sa, iterations=4) & ~sa  # 主体外缘 4px 环
        if int((boundary & near).sum()) / nb > subj_adj_frac:
            return False
    return True


def build_bg_hole_mask_from_layers(src: bytes, layer_pngs: list, text_blocks: list | None = None,
                                   *, pad: float = 0.012, dilate: int = 4) -> bytes:
    """背景洞 mask（执行期/背景最后生成）：把「已成功抠出的层」alpha 并集 + 文字框挖成洞。

    用真实抠出的形状（而非 bbox）精确挖洞，外扩 dilate px 吃掉残边；不完整(未抠出)的元素
    不在 layer_pngs 里 → 不挖 → 自动留在背景。其余像素 255 保留（衬布/场景/残留元素）。
    """
    import numpy as np
    from PIL import Image
    from scipy import ndimage

    W, H = _decode_size(src)
    hole = np.zeros((H, W), dtype=bool)
    for png in layer_pngs:
        if not png:
            continue
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        if im.size != (W, H):
            im = im.resize((W, H), Image.LANCZOS)
        hole |= np.array(im)[:, :, 3] > 40
    if hole.any() and dilate:
        hole = ndimage.binary_dilation(hole, iterations=dilate)
    for b in (text_blocks or []):
        x0, y0, x1, y1 = _px_box(b, W, H, pad)
        if x1 > x0 and y1 > y0:
            hole[y0:y1, x0:x1] = True
    mask = np.zeros((H, W, 4), dtype=np.uint8)
    mask[:, :, 3] = np.where(hole, 0, 255).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(mask, "RGBA").save(out, "PNG")
    return out.getvalue()


# ── resize helper：provider.edit 产出的整帧回到目标尺寸（背景层叠回画布前对齐用） ──

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


# ============================================================================
# 智能四层拆解 plan 构造（async：识别在审批前定型，DAG/节点数 fixed）
# ============================================================================

# ============================================================================
# 护栏式 AI 补全（仅主体 + 手动标记的关键元素）：窄范围 inpaint → 重抠 → 多重校验 → 退回保底
# ============================================================================

def _area(png: bytes) -> int:
    from PIL import Image

    return _alpha_stats(Image.open(io.BytesIO(png)).convert("RGBA"))[0]


def build_inpaint_mask(src: bytes, occ_rels: list, *, pad: float = 0.01) -> bytes:
    """补全用 inpaint mask：把「被遮挡的缺口区域」(occ_rels，整帧 rel-box) 设透明(=重绘)，其余 255 保留。"""
    import numpy as np
    from PIL import Image

    W, H = _decode_size(src)
    a = np.full((H, W), 255, dtype=np.uint8)
    for b in occ_rels:
        x0, y0, x1, y1 = _px_box(b, W, H, pad)
        if x1 > x0 and y1 > y0:
            a[y0:y1, x0:x1] = 0
    mask = np.zeros((H, W, 4), dtype=np.uint8)
    mask[:, :, 3] = a
    out = io.BytesIO()
    Image.fromarray(mask, "RGBA").save(out, "PNG")
    return out.getvalue()


def recut_to_frame(edited_rgb: bytes, src: bytes, rel_box: dict, *,
                   lift_lo: int, lift_scale: int, min_frac: float) -> bytes:
    """补全后强制重抠：edit 输出是不透明整帧 RGB → 回帧到源尺寸 → 裁主体 bbox → cutout_subject
    → _clean_fragments → 贴回整帧原坐标透明 PNG（与其它层像素对齐）。"""
    from PIL import Image

    from app.agents.composite import _clean_fragments

    W, H = _decode_size(src)
    ed = Image.open(io.BytesIO(edited_rgb)).convert("RGB")
    if ed.size != (W, H):
        ed = ed.resize((W, H), Image.LANCZOS)
    x0, y0, x1, y1 = _px_box(rel_box, W, H, pad=0.04)
    sub = io.BytesIO()
    ed.crop((x0, y0, x1, y1)).save(sub, "PNG")
    cut = cutout_subject(sub.getvalue(), lift_lo=lift_lo, lift_scale=lift_scale)
    cut = _clean_fragments(cut, min_frac)
    cim = Image.open(io.BytesIO(cut)).convert("RGBA")
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    frame.alpha_composite(cim, (x0, y0))
    out = io.BytesIO()
    frame.save(out, "PNG")
    return out.getvalue()


async def verify_object_label(png: bytes, label: str) -> bool:
    """补全防幻觉复检：vision 判「这是不是一个完整、单个的 {label}」。无 key/失败 → True（不拦，靠面积护栏）。"""
    if not label:
        return True
    r = await _gemini_vision_json(
        png, f'这张透明背景图里是不是一个完整的、单独的「{label}」（没有变成别的东西、没有多出别的物体）？'
             '只输出 JSON：{"match": true 或 false}')
    if r is None:
        return True
    return bool(r.get("match", True))


async def complete_object(layer_png: bytes, src: bytes, rel_box: dict, label: str, occ_rels: list, *,
                          attempts: int = 2, lift_lo: int = 25, lift_scale: int = 4,
                          min_frac: float = 0.05) -> bytes:
    """护栏式补全：在 occ_rels（被遮挡缺口）内 inpaint 补成完整对象 → 重抠 → 多重校验：
    面积合理（不缩水/不暴涨）+ vision label 复检 → 过检里挑最克制那张；全不过 → 退回 layer_png。

    保底：永远不会比「不补」更差——成功给完整对象，失败就还是原残缺图，绝不吐幻觉。
    """
    if not occ_rels:
        return layer_png
    from app.providers import get_image_provider

    base = _area(layer_png)
    if base < 64:
        return layer_png
    mask = build_inpaint_mask(src, occ_rels)
    provider = get_image_provider()
    prompt = (
        f"Complete the main {label or 'product'} into a single WHOLE, intact object. Fill ONLY the masked "
        "(transparent) area by naturally extending the object ITSELF — its own shape, material, color, label and "
        "lighting — as if the thing in front of it were removed. Do NOT add any new object, prop, hand, garnish, "
        "text or background; do NOT change the visible part. Keep edges clean."
    )
    best = None
    for _ in range(max(1, attempts)):
        try:
            edited = await provider.edit(prompt, src, "1:1", mask=mask, transparent=False)
            recut = recut_to_frame(edited.data, src, rel_box,
                                   lift_lo=lift_lo, lift_scale=lift_scale, min_frac=min_frac)
        except Exception:
            continue
        a = _area(recut)
        if a < base or a > base * 2.3:          # 缩水=补坏；暴涨=乱画 → 弃
            continue
        if not await verify_object_label(recut, label):  # 变成别的东西 → 弃
            continue
        if best is None or a < best[0]:         # 过检里挑增量最小（最克制）的
            best = (a, recut)
    return best[1] if best else layer_png       # 全不过 → 退回残缺版（永不更差）


def _rel_iou(a: dict, b: dict) -> float:
    """两个 rel-box 的 IoU。"""
    ax1, ay1 = a["relX"] + a["relW"], a["relY"] + a["relH"]
    bx1, by1 = b["relX"] + b["relW"], b["relY"] + b["relH"]
    iw = max(0.0, min(ax1, bx1) - max(a["relX"], b["relX"]))
    ih = max(0.0, min(ay1, by1) - max(a["relY"], b["relY"]))
    inter = iw * ih
    union = a["relW"] * a["relH"] + b["relW"] * b["relH"] - inter
    return inter / union if union > 0 else 0.0


def _rel_intersection(a: dict, b: dict) -> dict | None:
    """两 rel-box 的交集 rel-box；不相交返回 None。"""
    ix0, iy0 = max(a["relX"], b["relX"]), max(a["relY"], b["relY"])
    ix1 = min(a["relX"] + a["relW"], b["relX"] + b["relW"])
    iy1 = min(a["relY"] + a["relH"], b["relY"] + b["relH"])
    if ix1 <= ix0 or iy1 <= iy0:
        return None
    return {"relX": ix0, "relY": iy0, "relW": ix1 - ix0, "relH": iy1 - iy0}


def _covered_frac(a: dict, b: dict) -> float:
    """a 的面积有多大比例落在 b 里。"""
    ax1, ay1 = a["relX"] + a["relW"], a["relY"] + a["relH"]
    bx1, by1 = b["relX"] + b["relW"], b["relY"] + b["relH"]
    iw = max(0.0, min(ax1, bx1) - max(a["relX"], b["relX"]))
    ih = max(0.0, min(ay1, by1) - max(a["relY"], b["relY"]))
    aa = a["relW"] * a["relH"]
    return (iw * ih) / aa if aa > 0 else 0.0


def _dedup_elements(elements: list, subject: dict, text_blocks: list,
                    *, subj_iou: float = 0.55, text_cov: float = 0.6) -> list:
    """plan 期几何去重 vision 标注噪声：
    - 与主体 IoU > subj_iou → vision 把主体重复标成元素 → 丢（防重复主体层）。
    - 面积 >text_cov 落在某文字框里 → 那是叠加文字、单独成层 → 丢（防文字被当道具抠）。
    """
    out = []
    for e in elements:
        if _rel_iou(e, subject) > subj_iou:
            continue
        if any(_covered_frac(e, t) > text_cov for t in (text_blocks or [])):
            continue
        out.append(e)
    return out


async def build_smart_split_plan(session_id: str, source_label: str, src_bytes: bytes | None) -> Plan:
    """识别四层布局 → 构造显式 z_index、单 depends 链的拆解 DAG。
    识别失败（无 key / 无主体 / 无源图）→ return build_split_plan（三层降级，master switch）。"""
    if not source_label:
        raise ValueError("未选择要拆分的图片")
    layout = await analyze_layers(src_bytes) if src_bytes else None
    if layout is None:
        return build_split_plan(source_label)  # 识别失败 → 三层降级（§7.1 总开关）

    # 文字框：plan 期 OCR 一次——既用于背景挖掉文字、又复用给文字层（避免二次识别/坐标漂移）
    try:
        text_blocks = await detect_text_blocks(src_bytes) if src_bytes else []
    except Exception:
        text_blocks = []

    # plan 期几何去重（治 vision 标注噪声的根）：丢掉①与主体高度重叠的元素框（vision 偶尔把主体
    # 又标成一个装饰元素 → 重复瓶子层）②大部分落在文字框里的元素框（那是文字、单独成层，别当道具抠）。
    elements = _dedup_elements(layout["elements"], layout["subject"], text_blocks)
    # 执行期实判：plan 期不靠 vision 的 occluded 猜测，先把每个元素都尝试抠；抠出来后按
    # 「实际是否完整(画框出血/主体遮挡)」决定成层还是留背景。z 序按 in_front 排（执行序≠z序）。
    behind = [e for e in elements if not e["in_front"]]
    front = [e for e in elements if e["in_front"]]

    # 邻居块裁决用：每个对象抠图时把「其它对象」的框传下去，丢掉串入的邻居整块
    def _box(e: dict) -> dict:
        return {k: e[k] for k in ("relX", "relY", "relW", "relH")}

    all_objs = [layout["subject"], *elements]
    z_subject = 1 + len(behind)                       # behind: z=1..k；主体: k+1；front: k+2..
    subject_id = "split_subject"
    nodes: list[PlanNode] = []
    element_ids: list[str] = []

    # 主体被前景元素遮挡的缺口（front 元素框 ∩ 主体框）→ 主体补全只在这些洞里 inpaint（窄范围）
    subj = layout["subject"]
    subj_occ = [r for r in (_rel_intersection(f, subj) for f in front) if r]

    # 主体最先抠（z=k+1）——元素的「被主体遮挡」实判要用主体 alpha，故主体须先于元素执行。
    # 主体默认开启护栏式补全：被前景挡住一截 → 在缺口里补成完整产品（过不了护栏则退回残缺版）。
    nodes.append(PlanNode(
        id=subject_id, tool="cutout_layer", label="智能拆解 · 主体层", depends=[],
        args={"source_asset": source_label, "split_role": "subject", "bbox": subj,
              "z_index": z_subject, "other_boxes": [_box(o) for o in elements],
              "label": subj.get("label") or "product",
              "complete": bool(subj_occ), "occlusion": subj_occ},
    ))

    # 装饰元素：都 depends=[主体]（拿到主体 alpha 后实判完整性）。behind 在主体下、front 在主体上
    for i, el in enumerate(behind):
        nid = f"split_el{i + 1}"
        element_ids.append(nid)
        nodes.append(PlanNode(
            id=nid, tool="cutout_layer", label=f"智能拆解 · 装饰「{el['label']}」", depends=[subject_id],
            args={"source_asset": source_label, "split_role": "element", "bbox": el, "is_element": True,
                  "label": el["label"], "z_index": i + 1,
                  "other_boxes": [_box(o) for o in all_objs if o is not el]},
        ))
    for j, el in enumerate(front):
        nid = f"split_elf{j + 1}"
        element_ids.append(nid)
        nodes.append(PlanNode(
            id=nid, tool="cutout_layer", label=f"智能拆解 · 前景「{el['label']}」", depends=[subject_id],
            args={"source_asset": source_label, "split_role": "element", "bbox": el, "is_element": True,
                  "label": el["label"], "z_index": z_subject + 1 + j,
                  "other_boxes": [_box(o) for o in all_objs if o is not el]},
        ))

    # 文字层（z=10000，最上）：独立执行，用 plan 期 OCR 结果
    nodes.append(PlanNode(
        id="split_text", tool="extract_text", label="智能拆解 · 文字层", depends=[],
        args={"source_asset": source_label, "split_role": "text", "z_index": 10000,
              "text_blocks": text_blocks},
    ))

    # 背景最后生成（z=0，依赖主体+全部元素）：mask 在执行期按「真正抠出来的层 alpha 并集 + 文字框」
    # 精确挖洞——没抠出来的(不完整)元素不在并集里 → 自动留在背景。衬布/场景永远保留。
    nodes.append(PlanNode(
        id="split_bg", tool="edit_image", label="智能拆解 · 背景层",
        depends=[subject_id, *element_ids],
        args={"prompt": SPLIT_ROLES[0]["prompt"], "source_asset": source_label,
              "split_role": "bg", "z_index": 0, "bg_last": True,
              "text_blocks": text_blocks, "layer_nodes": [subject_id, *element_ids]},
    ))

    return Plan(
        mode="plan", title="智能四层拆解（背景 / 装饰 / 主体 / 文字）", nodes=nodes,
        notes=[
            "把成品图智能拆成『背景 / 装饰元素 / 主体 / 文字』四类图层，叠回原位 → 可分别编辑、可导出分层 PSD",
            "完整元素抠成独立层；被遮挡/出血的不完整元素留在背景；背景最后按真实抠出形状精确补绘",
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
