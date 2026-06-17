"""四层复合图（单张合成）：按「内容定义 → 四层架构 → 合成质检」的结构化链路，
把一张产品图合成为一张**原生分层**的电商主图：

  第1层 背景(Background)  —— AI 生成的空场景，确立统一基调 + 透视 + 光向（坐标系）
  第2层 装饰元素(Elements) —— 逐个独立生成的道具（水果/花卉…），抠成透明、按层叠序定位
  第3层 核心主体(Subject) —— 原产品抠图，物理落地（坐到支撑面、带接触阴影、不漂浮）
  第4层 文案(Typography)  —— AI 只产出排版规范参数（字号/字体/色值/浮雕/投影），前端渲染

一致性的根：一段**共享 scene_spec**（同一相机角度 + 同一光向 + 同一支撑面）逐字注入每层
提示，并由「先读真实产品图的光向 → 反过来约束背景/元素/阴影」保证主体不可改的光照成为基准。

关键工程取舍（诚实标注）：跨独立生成图层的透视/光影一致是**prompt 级软约束**（本站点无
ControlNet/depth），残差靠「主体作基准 + 共享 scene_spec」压低、无法消除；接触阴影是
合成的椭圆近似而非物理剪切投影。但每一层都做成**与背景同尺寸的整帧透明 PNG**，叠回背景
同一位置 → 四层像素级完美重叠、可分别移动/调透明度/导出分层 PSD，且刷新不丢位不丢尺寸。
"""

import io
import json
import math
import re

from app.agents.planner import Plan, PlanNode
from app.config import settings

# ── 输出比例：站点 _SIZES 仅支持 1:1/16:9/9:16/4:3，3:4 会静默回退方图 → 显式纠偏为 9:16 ──
_VALID_AR = {
    "1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:3": "4:3",
    "3:4": "9:16", "portrait": "9:16", "square": "1:1", "landscape": "16:9",
}


def _safe_ar(ar: str | None) -> str:
    return _VALID_AR.get((ar or "1:1").strip().lower(), "1:1")


_DEFAULT_SCENE = {
    "aspect_ratio": "1:1",
    "camera": "eye-level, slight 8° downward tilt, 50mm lens, straight-on frontal product view",
    "light": {"azimuth": "upper-left", "elevation": 35, "quality": "soft large diffused softbox"},
    "color_temp": "warm 4800K",
    "surface": {"desc": "matte light-oak wooden tabletop receding into a softly blurred backdrop", "horizon": 0.7},
    "palette": "warm neutral beige with soft shadow grey and one muted accent",
    "mood": "premium, calm, editorial e-commerce",
    "empty_zones": "top ~22% and lower-left kept clean for typography",
}


def _spec_clause(scene: dict) -> str:
    """把 scene_spec 序列化成「每层逐字遵守、跨层一致」的英文约束尾段。
    light.azimuth/elevation 同时被背景提示、元素提示、阴影几何三方消费 —— 跨层一致性的唯一强约束。"""
    s = {**_DEFAULT_SCENE, **(scene or {})}
    l = {**_DEFAULT_SCENE["light"], **(s.get("light") or {})}
    surf = {**_DEFAULT_SCENE["surface"], **(s.get("surface") or {})}
    return (
        "\n\nSHARED SCENE SPEC — obey EXACTLY, identical across every layer:\n"
        f"- Camera: {s['camera']}.\n"
        f"- Key light: from {l['azimuth']} at {l['elevation']}° elevation, {l['quality']}; "
        "a SINGLE light direction, shadows fall to the opposite side.\n"
        f"- Color temperature: {s['color_temp']}.\n"
        f"- Support surface: {surf['desc']}; the surface horizon line sits at "
        f"~{int(float(surf.get('horizon', 0.62)) * 100)}% of image height; everything rests ON this surface.\n"
        f"- Palette / mood: {s['palette']}; {s['mood']}.\n"
        f"- Aspect: {_safe_ar(s.get('aspect_ratio'))}. Every object shares THIS perspective and THIS one light direction."
    )


def _bg_prompt(scene: dict) -> str:
    """第1层背景：三重否定保证空场景；前景画一个占下部 40% 的大支撑面（产品要坐在它上面，故必须够大够前）；
    背景保持简洁不与产品争视觉；预留排版留白。"""
    horizon = int(float(scene.get("surface", {}).get("horizon", 0.7)) * 100)
    return (
        "Create ONLY a photorealistic premium e-commerce BACKGROUND scene. "
        "ABSOLUTELY NO product, NO bottle, NO props, NO decorative objects, NO text, NO logo, "
        "NO people, NO floating object. Render an EMPTY staged environment ONLY: a LARGE foreground "
        f"SUPPORT SURFACE (a clean table / podium / slab) whose TOP edge sits at ~{horizon}% of the image "
        f"height and which FILLS the entire lower {100 - horizon}% of the frame with a clear, visible front — "
        "a product will be placed STANDING ON this surface near the front-center, so the surface must read as a "
        "solid plane the product can rest on, not a thin line. Behind it, a SIMPLE uncluttered backdrop — keep it "
        "calm and out of focus, NO competing architecture or busy detail. Keep the surface an evenly-lit empty "
        "plane and reserve clean negative space for typography. Photorealistic studio render, no watermark."
        + _spec_clause(scene)
    )


def _element_prompt(el: dict, scene: dict) -> str:
    """第2层装饰元素：单个、实心、中性灰底（对 isnet 抠图比纯白更干净），逐字共享 scene_spec。"""
    desc = el.get("prompt_en") or el.get("name") or "a small decorative prop"
    return (
        f"Create ONE single isolated object for compositing: {desc}. "
        "The object centered, full and complete, on a PLAIN FLAT MID-GRAY (#9a9a9a) seamless background — "
        "NO other objects, NO surface, NO text, NO ground-shadow plate. Even rim separation from the gray "
        "background for a clean cutout. Solid opaque object (avoid feathers / gauze / translucent材质). "
        "Match this scene's light direction and perspective EXACTLY so it composites seamlessly:"
        + _spec_clause(scene)
    )


# ============================================================================
# 规范生成：先读真实产品图光向 → 据此定 scene_spec → 一次 LLM 产出元素清单 + 文案规范
# ============================================================================

_GOOD_FONTS = {"Noto Serif SC", "Noto Sans SC", "Playfair Display", "Montserrat", "Oswald"}


async def _read_light(image: bytes) -> dict | None:
    """最大杠杆的真实感手段：用 Gemini vision 读产品实拍图的主光向，让背景/元素/阴影迁就它
    （主体抠图保留原始光照、不可改）。失败/无 key 时返回 None，回退默认光向。"""
    if not settings.gemini_api_key or not image:
        return None
    try:
        import base64

        import httpx
        from PIL import Image

        im = Image.open(io.BytesIO(image)).convert("RGB")
        im.thumbnail((768, 768))
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode()
        prompt = (
            "Look at this product photo. Estimate the MAIN light direction on the product. "
            'Reply ONLY JSON: {"azimuth":"upper-left|upper-right|top|left|right","elevation":<10-80 int>}.'
        )
        parts = [{"text": prompt}, {"inline_data": {"mime_type": "image/jpeg", "data": b64}}]
        async with httpx.AsyncClient(timeout=40.0) as client:
            resp = await client.post(
                f"{settings.sub2api_base_url.rstrip('/')}/v1beta/models/gemini-2.5-flash:generateContent",
                headers={"x-goog-api-key": settings.gemini_api_key},
                json={"contents": [{"role": "user", "parts": parts}]},
            )
            resp.raise_for_status()
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if not m:
            return None
        d = json.loads(m.group(0))
        az = str(d.get("azimuth", "")).strip().lower()
        if az not in {"upper-left", "upper-right", "top", "left", "right"}:
            return None
        elev = int(float(d.get("elevation", 35)))
        return {"azimuth": az, "elevation": max(10, min(80, elev))}
    except Exception:
        return None


def _sanitize_spec(raw: dict, n: int) -> dict:
    """把 LLM 原始输出归一成稳定结构：补默认、夹取范围、白名单字体。任何缺字段都不致命。"""
    scene = {**_DEFAULT_SCENE, **(raw.get("scene_spec") or {})}
    scene["aspect_ratio"] = _safe_ar(scene.get("aspect_ratio"))
    scene["light"] = {**_DEFAULT_SCENE["light"], **(scene.get("light") or {})}
    surf = {**_DEFAULT_SCENE["surface"], **(scene.get("surface") or {})}
    try:
        surf["horizon"] = max(0.55, min(0.80, float(surf.get("horizon", 0.7))))
    except (TypeError, ValueError):
        surf["horizon"] = 0.7
    scene["surface"] = surf

    elements = []
    for el in (raw.get("elements") or [])[: max(0, min(4, n))]:
        if not isinstance(el, dict):
            continue
        anchor = str(el.get("anchor", "bottom-left")).strip().lower()
        if anchor not in {"bottom-left", "bottom-right", "beside-left", "beside-right", "top-left", "top-right"}:
            anchor = "bottom-left"
        try:
            scale = max(0.1, min(0.42, float(el.get("scale", 0.2))))
        except (TypeError, ValueError):
            scale = 0.2
        elements.append({
            "name": str(el.get("name", "prop"))[:40],
            "prompt_en": str(el.get("prompt_en") or el.get("name") or "a small decorative prop")[:160],
            "z_band": "front" if str(el.get("z_band", "behind")).lower() == "front" else "behind",
            "anchor": anchor,
            "scale": scale,
        })
    # 去重锚点：LLM 常把多个装饰塞到同一个角 → 互相重叠。按优先序把冲突的挪到下一个空位。
    _ORDER = ["bottom-left", "bottom-right", "beside-left", "beside-right", "top-left", "top-right"]
    used: set[str] = set()
    for el in elements:
        if el["anchor"] in used:
            el["anchor"] = next((o for o in _ORDER if o not in used), el["anchor"])
        used.add(el["anchor"])

    typography = []
    for b in (raw.get("typography") or [])[:6]:
        if not isinstance(b, dict) or not str(b.get("text", "")).strip():
            continue
        fam = str(b.get("fontFamily", "")).strip()
        fam = fam if fam in _GOOD_FONTS else "Noto Serif SC"
        eff = b.get("effect") if isinstance(b.get("effect"), dict) else {}
        clean_eff = {}
        if isinstance(eff.get("stroke"), dict):
            clean_eff["stroke"] = {"color": str(eff["stroke"].get("color", "#ffffff"))[:9],
                                   "width": max(0, min(8, int(eff["stroke"].get("width", 2) or 0)))}
        if isinstance(eff.get("shadow"), dict):
            sh = eff["shadow"]
            clean_eff["shadow"] = {"color": str(sh.get("color", "#00000055"))[:9],
                                   "blur": max(0, min(40, int(sh.get("blur", 8) or 0))),
                                   "offsetX": int(sh.get("offsetX", 0) or 0), "offsetY": int(sh.get("offsetY", 2) or 0),
                                   "opacity": max(0.0, min(1.0, float(sh.get("opacity", 0.4) or 0)))}
        if isinstance(eff.get("emboss"), dict) and eff["emboss"].get("on", True):
            em = eff["emboss"]
            clean_eff["emboss"] = {"highlight": str(em.get("highlight", "#ffffff"))[:9],
                                   "shadow": str(em.get("shadow", "#00000066"))[:9],
                                   "depth": max(1, min(4, int(em.get("depth", 2) or 1)))}

        def _f(key, default):
            try:
                return max(0.0, min(1.0, float(b.get(key, default))))
            except (TypeError, ValueError):
                return default

        typography.append({
            "text": str(b["text"])[:60],
            "relX": _f("relX", 0.08), "relY": _f("relY", 0.08),
            "relW": _f("relW", 0.6), "relH": _f("relH", 0.07),
            "color": str(b.get("color", "#262320"))[:9],
            "align": b.get("align", "left") if b.get("align") in ("left", "center", "right") else "left",
            "fontFamily": fam,
            "fontStyle": "bold" if str(b.get("fontStyle", "")).lower() in ("bold", "bold italic") else "normal",
            "letterSpacing": max(0, min(12, int(b.get("letterSpacing", 1) or 0))),
            "effect": clean_eff,
        })
    return {"scene_spec": scene, "elements": elements, "typography": typography}


async def generate_composite_spec(
    item: dict, doc_text: str, *, n: int = 3, lang: str = "zh", source_image: bytes | None = None,
) -> dict:
    """产出四层合成的统一规范：scene_spec（含从产品图反推的光向）+ 元素清单 + 文案规范。
    失败返回 {}，调用方据此降级回成熟的分层模式（build_layered_plan）。"""
    from app.providers import get_llm

    light = await _read_light(source_image) if source_image else None
    lang_word = "中文" if lang != "en" else "English"
    light_hint = (
        f"已知产品实拍图主光向为 {light['azimuth']}、仰角约 {light['elevation']}°，"
        f"scene_spec.light 必须与之一致，让背景/元素/阴影都迁就这个光向。\n"
        if light else ""
    )
    schema = (
        '{"scene_spec":{"aspect_ratio":"1:1","camera":"...","light":{"azimuth":"upper-left","elevation":35,"quality":"..."},'
        '"color_temp":"...","surface":{"desc":"...","horizon":0.62},"palette":"...","mood":"...","empty_zones":"..."},'
        '"elements":[{"name":"...","prompt_en":"<英文，单个实心道具>","z_band":"behind|front","anchor":"bottom-left|bottom-right|beside-left|beside-right|top-left|top-right","scale":0.22}],'
        '"typography":[{"text":"<' + lang_word + '文案>","relX":0.08,"relY":0.08,"relW":0.6,"relH":0.08,'
        '"color":"#262320","align":"center","fontFamily":"Noto Serif SC","fontStyle":"bold","letterSpacing":2,'
        '"effect":{"shadow":{"color":"#00000055","blur":8,"offsetX":0,"offsetY":2,"opacity":0.4}}}]}'
    )
    prompt = (
        "你是高端电商产品摄影的视觉总监 + 道具搭配师。为一张『单张四层合成主图』设计统一场景规范。\n"
        f"{light_hint}"
        "严格遵循：\n"
        f"- elements：{max(2, min(4, n))} 个，与产品品类/调性相符、服务主体不喧宾夺主；每个是 SINGLE 实心不透明道具"
        "（避免羽毛/纱/半透明）；behind 放主体两侧/后方桌面，front 只占边角小面积、绝不遮挡产品标签。\n"
        "- typography：标题/卖点等文案，**优先取自下方参考资料的事实**（产地/年份/规格/口感/卖点），不要编造；"
        f"用{lang_word}；relX/relY/relW/relH 为相对画面 0-1 的位置/尺寸，放在背景预留的留白区（顶部/左下）；"
        "fontFamily 只能用 'Noto Serif SC' 或 'Noto Sans SC'；可给 effect.shadow / effect.stroke / effect.emboss 工艺。\n"
        "- scene_spec：统一相机角度、单一光向、支撑面与 horizon（0.45-0.78）、配色与氛围。\n\n"
        f"产品：{item.get('label', '')} — {item.get('caption', '')}\n\n"
        f"参考资料（产品手册）：\n{(doc_text or '（无）')[:5000]}\n\n"
        f"只输出一个 JSON，不要任何多余文字：{schema}"
    )
    try:
        raw = await get_llm().complete([{"role": "user", "content": prompt}], json_only=True)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
        if not isinstance(data, dict):
            return {}
        spec = _sanitize_spec(data, n)
        if light:  # 以产品反推光向为准，覆盖 LLM 自拟
            spec["scene_spec"]["light"] = {**spec["scene_spec"]["light"], **light}
        return spec
    except Exception:
        return {}


# ============================================================================
# 计划构造：背景 → 后景元素 → 接触阴影 → 主体 → 前景元素 → 文案，单 depends 链保证 z 序
# ============================================================================

def build_composite4_plan(source_label: str, spec: dict, lang: str = "zh") -> Plan:
    if not source_label or not spec:
        raise ValueError("缺少产品图或合成规范")
    scene = spec["scene_spec"]
    ar = _safe_ar(scene.get("aspect_ratio"))
    horizon = float(scene.get("surface", {}).get("horizon", 0.62))
    light = scene.get("light")
    elements = spec.get("elements") or []
    behind = [e for e in elements if e["z_band"] == "behind"]
    front = [e for e in elements if e["z_band"] == "front"]
    typography = spec.get("typography") or []

    nodes: list[PlanNode] = []
    z = 0
    prev: list[str] = []

    def _chain(node: PlanNode):
        nonlocal prev
        node.depends = list(prev)  # 单链：每个节点只依赖上一个 → 严格串行 emit → z 序稳定
        nodes.append(node)
        prev = [node.id]

    # 第1层 背景（坐标系基准）
    _chain(PlanNode(
        id="lay_1", tool="generate_image", label="第1层 · 背景场景",
        args={"prompt": _bg_prompt(scene), "aspect_ratio": ar, "composite_role": "bg", "z_index": z},
    ))
    z += 1

    # 第2层 装饰元素（后景，落在主体之后）
    for i, el in enumerate(behind):
        _chain(PlanNode(
            id=f"lay_el_b{i + 1}", tool="generate_image", label=f"第2层 · 装饰「{el['name']}」",
            args={"prompt": _element_prompt(el, scene), "aspect_ratio": "1:1", "split_role": "element",
                  "overlay_on": "lay_1", "place": {"mode": "anchor", "anchor": el["anchor"], "scale": el["scale"]},
                  "horizon": horizon, "z_index": z},
        ))
        z += 1

    # 第3层 接触阴影（独立层，叠在主体之下、后景之上 → 主体落地不漂浮）
    _chain(PlanNode(
        id="lay_shadow", tool="edit_image", label="第3层 · 接触阴影",
        args={"source_asset": source_label, "split_role": "shadow", "overlay_on": "lay_1",
              "place": {"mode": "grounded"}, "horizon": horizon, "light": light, "z_index": z},
    ))
    z += 1

    # 第3层 核心主体（原图抠图，坐到支撑面）
    _chain(PlanNode(
        id="lay_subject", tool="edit_image", label="第3层 · 核心主体",
        args={"source_asset": source_label, "split_role": "subject", "overlay_on": "lay_1",
              "place": {"mode": "grounded"}, "horizon": horizon, "z_index": z},
    ))
    z += 1

    # 第2层 装饰元素（前景，落在主体之前）
    for i, el in enumerate(front):
        _chain(PlanNode(
            id=f"lay_el_f{i + 1}", tool="generate_image", label=f"第2层 · 前景「{el['name']}」",
            args={"prompt": _element_prompt(el, scene), "aspect_ratio": "1:1", "split_role": "element",
                  "overlay_on": "lay_1", "place": {"mode": "anchor", "anchor": el["anchor"], "scale": el["scale"]},
                  "horizon": horizon, "z_index": z},
        ))
        z += 1

    # 第4层 文案（AI 只产出排版规范参数，前端渲染成可编辑文字层）
    if typography:
        _chain(PlanNode(
            id="lay_text", tool="extract_text", label="第4层 · 文案排版",
            args={"split_role": "typography", "type_spec": typography, "overlay_on": "lay_1", "z_index": z},
        ))

    return Plan(
        mode="plan", title="四层合成主图（背景 / 装饰 / 主体 / 文案）", nodes=nodes,
        notes=[
            "原生分层合成：每层都是与背景同尺寸的整帧透明图，叠回同位置 → 完美重叠、可分别编辑、可导出分层 PSD",
            "主体坐到支撑面并合成接触阴影（不漂浮）；背景/装饰/阴影统一光向（按产品实拍图反推）",
        ],
    )


# ============================================================================
# 服务端合成（PIL）：把内容（元素/主体/阴影）摆到「与背景同尺寸的整帧透明画布」上。
# 所有层同尺寸 → 叠回背景同坐标 = 像素级完美重叠，且刷新不丢位/不丢尺寸。
# ============================================================================

def _clean_fragments(png: bytes, min_frac: float = 0.05) -> bytes:
    """去掉抠图里的细小离散碎块（源图自带的小装饰/标签碎片、rembg 噪点）：
    保留面积 ≥ 最大连通块 min_frac 的部件，其余清零。主要部件（瓶/盒/卡）都远大于阈值，不受影响。"""
    try:
        import numpy as np
        from PIL import Image
        from scipy import ndimage

        im = Image.open(io.BytesIO(png)).convert("RGBA")
        arr = np.array(im)
        mask = arr[:, :, 3] > 40
        lbl, n = ndimage.label(mask)
        if n <= 1:
            return png
        sizes = ndimage.sum(mask, lbl, range(1, n + 1))
        thresh = sizes.max() * min_frac
        drop = np.isin(lbl, [i + 1 for i, s in enumerate(sizes) if s < thresh])
        if not drop.any():
            return png
        arr[drop, 3] = 0
        out = io.BytesIO()
        Image.fromarray(arr).save(out, "PNG")
        return out.getvalue()
    except Exception:
        return png


def _open_trim(png: bytes):
    from PIL import Image

    im = Image.open(io.BytesIO(png)).convert("RGBA")
    bbox = im.getbbox()  # 裁掉透明边 → 拿到真实内容框，定位更准
    return im.crop(bbox) if bbox else im


# 落地基线：产品底边坐到画面**靠下、桌面前部**（而非 horizon=桌面后沿，会让产品悬在墙根）。
# 这是 v1/v2 校准发现的关键——把产品基线与 horizon 解耦，产品才落在可见桌面上、够大够前。
_GROUND_BASELINE = 0.85   # 主体/阴影底边
_ELEM_BASELINE = 0.80     # 装饰元素底边（略靠后于主体，仍在桌面上）


def _grounded_box(fw: int, fh: int, cw: int, ch: int, horizon: float, h_ratio: float):
    """主体/阴影：等比缩到目标高度、水平居中、底边坐到 _GROUND_BASELINE（桌面前部）。"""
    th = fh * h_ratio
    tw = th * cw / ch
    if tw > fw * 0.78:  # 太宽则按宽度约束（放宽到 0.78，主体更具存在感）
        tw = fw * 0.78
        th = tw * ch / cw
    return ((fw - tw) / 2, fh * _GROUND_BASELINE - th, tw, th)


def _anchor_box(anchor: str, fw: int, fh: int, cw: int, ch: int, scale: float, horizon: float):
    """装饰元素：宽 = 帧宽 × scale，按锚点贴角/贴边；落地类锚点底边坐到 _ELEM_BASELINE（与主体共面、略靠后）。"""
    tw = fw * scale
    th = tw * ch / cw
    max_h = fh * 0.45  # 高度封顶：细高道具（木条/烛台/高瓶）按宽 scale 会竖向爆到顶、喧宾夺主 → 改按高度约束
    if th > max_h:
        th = max_h
        tw = th * cw / ch
    surf_y = fh * _ELEM_BASELINE - th
    if anchor in ("bottom-left", "beside-left"):
        return (fw * 0.04, surf_y, tw, th)
    if anchor in ("bottom-right", "beside-right"):
        return (fw * 0.96 - tw, surf_y, tw, th)
    if anchor == "top-left":
        return (fw * 0.05, fh * 0.08, tw, th)
    if anchor == "top-right":
        return (fw * 0.95 - tw, fh * 0.08, tw, th)
    return ((fw - tw) / 2, surf_y, tw, th)


def compose_layer(content_png: bytes, frame_w: int, frame_h: int, *, mode: str = "anchor",
                  anchor: str = "center", scale: float = 0.25, horizon: float = 0.7,
                  h_ratio: float = 0.6) -> bytes:
    """把一个透明内容（已抠图）摆到整帧透明画布上，返回整帧 PNG。"""
    from PIL import Image

    frame = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
    c = _open_trim(_clean_fragments(content_png))  # 先去碎块再裁边定位
    cw, ch = c.size
    if cw < 1 or ch < 1:
        return content_png
    if mode == "grounded":
        x, y, tw, th = _grounded_box(frame_w, frame_h, cw, ch, horizon, h_ratio)
    else:
        x, y, tw, th = _anchor_box(anchor, frame_w, frame_h, cw, ch, scale, horizon)
    c = c.resize((max(1, int(tw)), max(1, int(th))), Image.LANCZOS)
    frame.alpha_composite(c, (int(x), int(y)))
    out = io.BytesIO()
    frame.save(out, "PNG")
    return out.getvalue()


def make_contact_shadow(cutout_png: bytes, frame_w: int, frame_h: int, *, horizon: float = 0.7,
                        light: dict | None = None, h_ratio: float = 0.6) -> bytes:
    """据主体抠图估算落地宽度，画一枚高斯模糊椭圆作接触阴影；方向按光向反向偏移、偏移量随光仰角变化。"""
    from PIL import Image, ImageDraw, ImageFilter

    c = _open_trim(_clean_fragments(cutout_png))
    cw, ch = c.size
    if cw < 1 or ch < 1:
        return cutout_png
    x, y, tw, th = _grounded_box(frame_w, frame_h, cw, ch, horizon, h_ratio)
    base_cx = x + tw / 2
    base_cy = min(y + th, frame_h * 0.9)  # 底边 = 落地基线，但夹住不贴帧底
    ew = tw * 0.80                          # 收紧：原 0.92 会糊一大坨
    eh = max(8.0, tw * 0.13)                # 压扁：原 0.20 太厚

    az = str((light or {}).get("azimuth", "upper-left")).lower()
    dx = ew * 0.12 if "left" in az else (-ew * 0.12 if "right" in az else 0.0)
    try:
        elev = max(10.0, min(80.0, float((light or {}).get("elevation", 35))))
    except (TypeError, ValueError):
        elev = 35.0
    dx *= max(0.6, min(1.2, 1.0 / math.tan(math.radians(elev))))  # 光越低 → 阴影越长（封顶 1.2，防糊出画面）
    blur = max(4.0, ew * 0.05)
    half = ew / 2 + blur
    cx = max(half, min(frame_w - half, base_cx + dx))  # 夹在画面内，绝不溢出边缘

    shadow = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse(
        [cx - ew / 2, base_cy - eh / 2, cx + ew / 2, base_cy + eh / 2], fill=(0, 0, 0, 165),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=blur))
    r, g, b, a = shadow.split()
    a = a.point(lambda v: int(v * 0.8))  # 整体压淡 → 自然不死黑
    shadow = Image.merge("RGBA", (r, g, b, a))
    out = io.BytesIO()
    shadow.save(out, "PNG")
    return out.getvalue()
