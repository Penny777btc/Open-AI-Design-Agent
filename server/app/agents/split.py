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
_human_session = None  # u2net_human_seg：人像专用分割（只抠人，不带桌子/餐盘/食物）
# pymatting(alpha matting) 底层 Numba workqueue 线程层【不允许任何并发访问】——两个抠图
# 同时进线程池会把整个进程干崩（实测：Numba 'Concurrent access has been detected' 后
# terminating，后端死、任务永远卡 running）。全局锁强制串行；抠图每节点仅一次，代价可忽略。
import threading as _threading

_matting_lock = _threading.Lock()

# 单张拆图的模型调用上限（§7.2）——operator 真实成本护栏
MAX_ELEMENTS = 6   # 装饰元素数上限（识别 prompt 限 + _normalize_layout 截断）


# gpt-image edits 实际支持的三档输出画布（比例值 → 传给接口的 label）。
# 用于：aspect 缺省时按源图就近推断 + pad_to_aspect 的目标比例。
EDIT_AR_CHOICES = [("1:1", 1.0), ("16:9", 1.5), ("9:16", 2 / 3)]
_AR_VALUE = {"1:1": 1.0, "4:3": 1.5, "16:9": 1.5, "3:4": 2 / 3, "9:16": 2 / 3, "2:3": 2 / 3}


def pick_edit_ar(requested: str | None, src: bytes | None) -> str:
    """选 edit 输出画布：显式给了就映射到最近支持档；没给就按源图比例就近推断。

    why：gpt-image edits 的输出画布与源图比例不一致时，模型会把整图（含人物）压/拉去
    适配画布——「人变扁」的形变量 = 比例差。缺省一律 1:1 方图是最坏解（竖版人像压扁最狠），
    按源图就近选档能把比例差压到最小。
    """
    if requested and requested in _AR_VALUE:
        target = _AR_VALUE[requested]
    elif src:
        try:
            from PIL import Image
            with Image.open(io.BytesIO(src)) as im:
                target = im.width / max(im.height, 1)
        except Exception:
            return "1:1"
    else:
        return "1:1"
    return min(EDIT_AR_CHOICES, key=lambda c: abs(c[1] - target))[0]


def pad_to_aspect(src: bytes, ar_label: str) -> bytes:
    """把源图**无变形**地垫成目标画布比例（blur-letterbox），供 edit 输入。

    原图像素原样居中放置、一像素不缩放；短出来的边用「自身 cover 放大 + 高糊」填充
    （比纯色垫自然，模型会把这些区域理解成可重绘的背景，正好用来排标题/贴纸）。
    输入输出比例一致后，模型没有任何拉伸源图内容（尤其人物）的动机——治「人变扁」的根。
    比例差 < 2% 时原样返回（不做无谓的重编码）。纯 PIL、纯本地。
    """
    from PIL import Image, ImageFilter

    target = _AR_VALUE.get(ar_label, 1.0)
    im = Image.open(io.BytesIO(src)).convert("RGB")
    w, h = im.size
    if h < 1 or abs(w / h - target) < 0.02:
        return src
    if w / h < target:   # 源更窄 → 往两侧垫宽
        W, H = max(w, int(round(h * target))), h
    else:                # 源更宽 → 往上下垫高
        W, H = w, max(h, int(round(w / target)))
    # 垫边填充用「边缘延展 + 高糊」而非 cover 放大自身：cover 高糊里含放大的人影/物影，
    # 扩图/重绘时模型会把幽灵人影「还原」成第二个人（用户实测出现人物重叠）。
    # 边缘行/列外扩只带颜色氛围、不带任何形体先验。
    import numpy as np

    arr = np.array(im)
    px, py = (W - w) // 2, (H - h) // 2
    padded = np.pad(arr, ((py, H - h - py), (px, W - w - px), (0, 0)), mode="edge")
    bg = Image.fromarray(padded).filter(ImageFilter.GaussianBlur(25))
    bg.paste(im, (px, py))  # 原图原像素居中，零缩放零变形
    out = io.BytesIO()
    bg.save(out, "PNG")
    return out.getvalue()


async def outpaint_person_locked(provider, prompt: str, src: bytes, ar_label: str):
    """扩图锁人：人物区域像素级锁定，模型只重绘人物以外的一切（纯 gpt-image 实现）。

    与「整图重绘」的本质区别：重绘时人物是模型笔下之物（画宽画扁全凭它）；这里人物是
    **蒙版保护区**——模型贴着人物真实轮廓画海报（有光影/构图上下文，不是硬贴），完成后
    再把原始人物像素等比回贴（双保险：即使模型碰了保留区也被原像素盖回）。
    人物 100% 原像素原比例 → 拉伸/变形物理上不可能发生；融合感来自模型围绕轮廓作画。

    流程：pad_to_aspect(原像素垫到画布比例) → cut_person_soft(人物轮廓) → 蒙版(人物=保留,
    其余=重绘) → provider.edit 带蒙版 → 原人物层等比回贴（垫图与输出同比例=均匀缩放零变形）。
    返回 (png_bytes, w, h, model)；人物抠空/任一环节失败则 raise（调用方降级整图重绘）。
    """
    import asyncio

    import numpy as np
    from PIL import Image

    loop = asyncio.get_running_loop()
    padded = await loop.run_in_executor(None, lambda: pad_to_aspect(src, ar_label))
    person = await loop.run_in_executor(None, lambda: cut_person_soft(padded))
    pa = np.array(Image.open(io.BytesIO(person)).convert("RGBA"))[:, :, 3]
    if int((pa > 40).sum()) < pa.size * 0.01:
        raise RuntimeError("人物抠图为空（<1% 前景）")

    # 【防重影关键】发给模型的输入图先把人物 inpaint 抹掉——gpt-image 的蒙版是「软遵守」，
    # 输入里有人它就会照着再画一个（姿势略偏），与回贴的原像素叠成双人重影（用户实测）。
    # 模型全程看不见人 → 画不出第二个人；人物位置信息由蒙版轮廓 + 指令传达。
    def _erase_person():
        import cv2
        rgb = np.array(Image.open(io.BytesIO(padded)).convert("RGB"))
        m = (pa > 60).astype("uint8") * 255
        m = cv2.dilate(m, np.ones((15, 15), np.uint8))  # 外扩防边缘残影/发丝残留
        filled = cv2.inpaint(rgb, m, 12, cv2.INPAINT_TELEA)
        b = io.BytesIO()
        Image.fromarray(filled).save(b, "PNG")
        return b.getvalue()

    erased = await loop.run_in_executor(None, _erase_person)

    # 蒙版语义（与拆图/补全一致）：alpha=0 的区域=允许重绘；人物轮廓区 alpha=255=保留（留位）。
    marr = np.array(Image.open(io.BytesIO(erased)).convert("RGBA"))
    marr[:, :, 3] = np.where(pa > 128, 255, 0).astype("uint8")
    mbuf = io.BytesIO()
    Image.fromarray(marr).save(mbuf, "PNG")

    directive = (
        "The PROTECTED silhouette area in this image is RESERVED: a real person will be composited "
        "into it afterwards. Do NOT draw, paint or render ANY person, human figure, face, silhouette "
        "or body part anywhere in the image — the final image must contain ZERO painted humans. "
        "Design the layout AROUND the reserved silhouette: keep titles, text and key decorations "
        "clear of it, and make the background lighting/scene coherent so a person composited there "
        "will blend naturally. Brief: "
    )
    out = await provider.edit(directive + prompt, erased, ar_label, mask=mbuf.getvalue())

    def _repaste():
        o = Image.open(io.BytesIO(out.data)).convert("RGBA")
        # 垫图与输出画幅同比例 → resize 是均匀缩放，人物比例严格不变
        pl = Image.open(io.BytesIO(person)).convert("RGBA").resize(o.size, Image.LANCZOS)
        o.alpha_composite(pl)
        b = io.BytesIO()
        o.convert("RGB").save(b, "PNG")
        return b.getvalue(), o.size

    data, (w, h) = await loop.run_in_executor(None, _repaste)
    return data, w, h, out.model


def cut_person_soft(src: bytes, *, feather: float = 1.6, keep_only_largest: bool = True) -> bytes:
    """人像专用抠图 → 柔边透明 PNG（解决「拉伸」+「强抠图感」两个病根）。

    与 cutout_subject（isnet 通用前景 + 硬二值化）的关键差异：
    - 用 **u2net_human_seg** 人像专用模型：只分割「人」，不会把桌子/餐盘/纸杯当前景一起带走。
      → 主体框里只有人 → 后续等比缩放/落位不再被桌子撑歪 = 根治「拉伸」。
    - 用 **alpha matting** 出柔和的发丝/边缘（而非产品用的硬阈值二值化）+ 轻高斯羽化边缘，
      叠背景时没有「贴纸硬边」= 大幅削弱「抠图感」。
    - keep_only_largest：只留最大连通块（人），丢掉零星误检（远处第二个人/桌上反光碎块）。

    纯本地（rembg + PIL + scipy），无外部调用；异常/抠空回退整帧透明（调用方判空降级）。
    """
    global _human_session

    import numpy as np
    from PIL import Image, ImageFilter
    from rembg import new_session, remove

    if _human_session is None:
        _human_session = new_session("u2net_human_seg")
    # alpha_matting：柔化发丝/边缘，去白边（pymatting 已装）；失败自动回落普通 remove。
    # 必须持 _matting_lock 串行：pymatting 的 Numba 线程层并发访问会干崩整个进程。
    with _matting_lock:
        try:
            png = remove(src, session=_human_session, post_process_mask=True,
                         alpha_matting=True, alpha_matting_foreground_threshold=240,
                         alpha_matting_background_threshold=15, alpha_matting_erode_size=3)
        except Exception:
            png = remove(src, session=_human_session, post_process_mask=True)

    im = Image.open(io.BytesIO(png)).convert("RGBA")
    arr = np.array(im)
    a = arr[:, :, 3]

    if keep_only_largest:
        # 只保留最大连通块（人本体）——u2net_human_seg 偶尔会漏检出零星小块，一并清掉
        try:
            from scipy import ndimage
            mask = a > 40
            lbl, n = ndimage.label(mask)
            if n > 1:
                sizes = ndimage.sum(mask, lbl, range(1, n + 1))
                keep = int(np.argmax(sizes)) + 1
                arr[lbl != keep, 3] = 0
                a = arr[:, :, 3]
        except Exception:
            pass

    # 轻羽化：只柔化 alpha 通道边缘（RGB 不动），消除「贴纸硬边」，又不至于糊成半透明
    if feather and feather > 0:
        alpha_im = Image.fromarray(a, "L").filter(ImageFilter.GaussianBlur(feather))
        arr[:, :, 3] = np.array(alpha_im)

    out = io.BytesIO()
    Image.fromarray(arr).save(out, "PNG")
    return out.getvalue()


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


async def cut_locked_person(src: bytes) -> bytes | None:
    """锁人物前置：把含人物的图抠成「只有人、柔边」的人物透明层，供锁人物合成叠背景。

    与 cut_locked_subject（产品版）分开，因为病根不同：
    - 用 cut_person_soft（u2net_human_seg 人像模型）→ 只抠人，不带桌子/餐盘 → 治「拉伸」。
    - 柔边 alpha matting + 羽化 → 治「强抠图感」。
    - 不做 complete_object（产品补全）：人被前景挡住不该 AI 脑补身体，保留原样更安全。
    - dislocation_guard 判空：抠空/几乎全透明 → 返回 None（调用方降级 gpt-image 重绘）。

    纯本地、同步 CPU 密集 → 调用方应丢线程池执行。
    """
    if not src:
        return None
    try:
        cut = cut_person_soft(src)
        # 判空：人像抠图不做 bbox 错位校验（人可在画面任意位置），只查是否几乎全透明
        import numpy as np
        from PIL import Image
        a = np.array(Image.open(io.BytesIO(cut)).convert("RGBA"))[:, :, 3]
        if int((a > 40).sum()) < (a.size * 0.01):  # 前景不足 1% → 视为抠空
            return None
        return cut
    except Exception:
        return None  # 任何异常 → 降级重绘，绝不硬失败


async def cut_locked_subject(src: bytes) -> bytes | None:
    """锁主体前置：把产品图抠成「一份」主体透明层，供整套图复用（跨图一致的唯一真源）。

    流程：analyze_layers 拿主体 bbox（拿不到就用整帧框兜底）→ cutout_subject_full 双路抠图
    → 若被前景遮挡则 complete_object 护栏式补成完整产品 → dislocation_guard 兜底判空。
    任一环节抠空/异常 → 返回 None（调用方据此优雅降级回「约束式重生成」，不硬失败）。

    只跑一次（不是每张套图跑一次）：省成本、且保证 6/7 张共用同一像素 → 主体不会漂移。
    """
    if not src:
        return None
    try:
        # 主体 bbox：优先 vision 识别，失败用整帧框（cutout_subject_full 会与整图直抠求交）
        layout = await analyze_layers(src)
        subj = (layout or {}).get("subject") if layout else None
        rel_box = subj if subj else {"relX": 0.0, "relY": 0.0, "relW": 1.0, "relH": 1.0}
        cut = cutout_subject_full(src, rel_box)
        if dislocation_guard(cut, rel_box):
            return None  # 抠空/严重错位 → 降级（不吐一张看不见的主体层）

        # 主体被前景元素遮挡 → 在缺口里护栏式补全成完整产品（补不好会自动退回残缺版，永不更差）
        if layout and layout.get("elements"):
            front = [e for e in layout["elements"] if e.get("in_front")]
            occ = [r for r in (_rel_intersection(f, rel_box) for f in front) if r]
            if occ:
                cut = await complete_object(
                    cut, src, rel_box, (subj or {}).get("label") or "product", occ)
        return cut
    except Exception:
        return None  # 任何异常 → 降级路径（约束式重生成），绝不硬失败


# ============================================================================
# 锁人物合成（locked-person composite）——单张 edit_image 的人物锁：
# 含人物的图片编辑默认不让扩散模型重绘人（gpt-image/nano 整图重绘会让脸/身材变形），
# 而是「本地抠出人物(原始像素零变形) + AI 只生成背景/排版(明确 NO PERSON、留位) + 合成」。
# 与「套图锁主体」同源（cut_locked_subject / place_subject_on_bg），只是这里作用于单张。
# why：卖家/自媒体最怕人脸漂移；抠一次贴回，人物 100% 零变形，AI 只负责它擅长的背景与文字。
# ============================================================================

# 原编辑指令里对「人/人物」的描述词——改写背景 prompt 时用来软性剔除（避免 AI 又去画人）。
# 只做提示层面的约束（append 硬指令），不强删原句，避免误伤合法语义（如 "personal"）。
_PERSON_BG_DIRECTIVE = (
    " IMPORTANT COMPOSITING CONSTRAINT: do NOT draw, paint or render ANY person, human, face, "
    "figure or body in this image — a real subject will be composited in afterwards. Produce ONLY "
    "the background scene, environment, props and graphic layout described above. Leave the "
    "LOWER-CENTER area open and unobstructed as clear space for a subject to be placed later. "
    "If any text / title / caption is requested, render that text EXACTLY as specified, correctly "
    "spelled and legible, but keep it clear of the lower-center subject area."
)


def rewrite_bg_prompt_no_person(prompt: str) -> str:
    """把「含人物的编辑指令」改写成「只画背景/排版、明确 NO PERSON、给人物留位」的背景生成 prompt。

    策略（保守、纯字符串）：保留原 prompt 的场景/风格/排版/文字诉求（AI 擅长的部分），
    只在末尾追加一段硬约束——禁止画任何人、下中部留白给人物、要求的文字照旧精确渲染。
    不去正则删原文里的「人」描述：删得不干净反而更乱，且可能误伤；靠 append 的强指令压住即可。
    该函数是纯函数（无 I/O）→ 便于离线自测「改写后 prompt 含 NO PERSON 且保留原诉求」。
    """
    base = (prompt or "").strip()
    return (base + _PERSON_BG_DIRECTIVE) if base else _PERSON_BG_DIRECTIVE.strip()


# ============================================================================
# 锁主体（locked-subject）合成：把「一次抠好的同一个主体透明层」按各模板槽位
# 排布，叠合到 AI 生成的背景上 → 整套图共用同一主体像素 → 跨图 100% 一致。
# why：约束式重生成让扩散模型每张重画主体，logo/形态漂移；抠一次、贴到底，才真一致。
# ============================================================================

def place_subject_on_bg(bg_png: bytes, subject_png: bytes, *,
                        scale: float = 0.62, anchor: str = "center",
                        margin: float = 0.06, contact_shadow: bool = True,
                        light: dict | None = None) -> bytes:
    """把主体透明层等比缩放后按 anchor 摆到背景帧上，返回合成后的整帧 RGBA PNG。

    - bg_png：AI 生成的背景（无产品）。合成结果尺寸 = 背景尺寸（模板槽位就是背景的画幅）。
    - subject_png：一次抠好的主体透明 PNG（整套复用同一份 → 一致）。先裁掉透明边拿真实内容框，
      再按 scale（占帧高度比例，宽超 0.9 帧宽时以宽约束）等比缩放，绝不变形。
    - anchor：主体在帧内的落位（center / center-lower / right-lower / left / right ...）。
    - contact_shadow：落地锚点(带 lower/bottom)时在主体脚下垫一枚接触阴影，避免"贴纸感"。

    纯 PIL、无外部调用 → 便宜、可离线自测；异常时回退返回背景本身（降级不崩）。
    """
    from PIL import Image

    from app.agents.composite import _clean_fragments, _open_trim

    try:
        bg = Image.open(io.BytesIO(bg_png)).convert("RGBA")
        FW, FH = bg.size
        subj = _open_trim(_clean_fragments(subject_png))  # 裁透明边 → 真实内容框，缩放/定位才准
        cw, ch = subj.size
        if cw < 1 or ch < 1 or FW < 1 or FH < 1:
            return bg_png

        # 等比缩放：目标高 = scale×帧高；若因此过宽（>0.9 帧宽）则改以宽约束，保持不变形
        th = FH * scale
        tw = th * cw / ch
        if tw > FW * 0.9:
            tw = FW * 0.9
            th = tw * ch / cw
        tw, th = max(1, int(round(tw))), max(1, int(round(th)))
        subj = subj.resize((tw, th), Image.LANCZOS)

        # anchor → 帧内像素位置（水平/垂直各三档，靠 margin 留边）
        a = (anchor or "center").lower()
        mx, my = int(FW * margin), int(FH * margin)
        if "left" in a:
            x = mx
        elif "right" in a:
            x = FW - tw - mx
        else:
            x = (FW - tw) // 2
        if "lower" in a or "bottom" in a:
            y = FH - th - my
        elif "upper" in a or "top" in a:
            y = my
        else:
            y = (FH - th) // 2

        out_frame = bg.copy()
        # 落地锚点：先垫接触阴影（用主体剪影估宽度），主体再压上去 → 有重量、不像贴纸
        if contact_shadow and ("lower" in a or "bottom" in a):
            try:
                shadow = _contact_shadow_at(tw, th, x, y, FW, FH, light)
                out_frame.alpha_composite(shadow)
            except Exception:
                pass  # 阴影是锦上添花，失败不影响主体合成
        out_frame.alpha_composite(subj, (x, y))
        buf = io.BytesIO()
        out_frame.save(buf, "PNG")
        return buf.getvalue()
    except Exception:
        return bg_png  # 合成任何异常 → 退回背景（降级不崩，调用方仍得到一张可用图）


def _contact_shadow_at(sw: int, sh: int, sx: int, sy: int, FW: int, FH: int,
                       light: dict | None) -> "object":
    """在 (sx,sy,sw,sh) 主体脚下画一枚高斯椭圆接触阴影，返回整帧 RGBA Image。
    比 make_contact_shadow 更直接：那个按 grounded 几何自己算落位，这里主体位置已定，只据其定阴影。"""
    import math

    from PIL import Image, ImageDraw, ImageFilter

    cx = sx + sw / 2
    cy = min(sy + sh, FH * 0.98)     # 阴影中心 ≈ 主体底边，但夹住不贴帧底
    ew = sw * 0.82                    # 椭圆宽略窄于主体
    eh = max(6.0, sw * 0.12)          # 压扁
    az = str((light or {}).get("azimuth", "upper-left")).lower()
    dx = ew * 0.12 if "left" in az else (-ew * 0.12 if "right" in az else 0.0)
    try:
        elev = max(10.0, min(80.0, float((light or {}).get("elevation", 35))))
    except (TypeError, ValueError):
        elev = 35.0
    dx *= max(0.6, min(1.2, 1.0 / math.tan(math.radians(elev))))
    blur = max(4.0, ew * 0.05)
    half = ew / 2 + blur
    ccx = max(half, min(FW - half, cx + dx))
    shadow = Image.new("RGBA", (FW, FH), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [ccx - ew / 2, cy - eh / 2, ccx + ew / 2, cy + eh / 2], fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur))
    r, g, b, aa = shadow.split()
    aa = aa.point(lambda v: int(v * 0.8))
    return Image.merge("RGBA", (r, g, b, aa))


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
