"""复合/分层用的 PIL 与光向工具集（智能四层拆解复用）。

历史上承载「四层复合图（生成时分层合成）」，该入口已被「智能四层拆解（split.py）」取代。
这里保留的都是被新拆解管线复用的纯函数：

  - 抠图后处理：_clean_fragments（去碎块）、_open_trim（裁透明边）
  - 整帧落位：compose_layer（把透明内容摆到与帧同尺寸的画布上，grounded/passthrough）
  - 接触阴影：make_contact_shadow（高斯椭圆，按光向偏移）
  - 落地几何：_grounded_box / _GROUND_BASELINE
  - 比例纠偏：_safe_ar / _VALID_AR
  - 读光向：_read_light（Gemini vision 估主光向，供补绘约束光照）

每一层都做成**与帧同尺寸的整帧透明 PNG**，叠回同一位置 → 像素级完美重叠、可分别移动/
调透明度/导出分层 PSD，且刷新不丢位不丢尺寸。
"""

import io
import json
import math
import re

from app.config import settings

# ── 输出比例：站点 _SIZES 仅支持 1:1/16:9/9:16/4:3，3:4 会静默回退方图 → 显式纠偏为 9:16 ──
_VALID_AR = {
    "1:1": "1:1", "16:9": "16:9", "9:16": "9:16", "4:3": "4:3",
    "3:4": "9:16", "portrait": "9:16", "square": "1:1", "landscape": "16:9",
}


def _safe_ar(ar: str | None) -> str:
    return _VALID_AR.get((ar or "1:1").strip().lower(), "1:1")


# ============================================================================
# 读光向：智能拆解的背景补洞/补全可据此约束补绘光照（保留复用）
# ============================================================================


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


def _grounded_box(fw: int, fh: int, cw: int, ch: int, horizon: float, h_ratio: float):
    """主体/阴影：等比缩到目标高度、水平居中、底边坐到 _GROUND_BASELINE（桌面前部）。"""
    th = fh * h_ratio
    tw = th * cw / ch
    if tw > fw * 0.78:  # 太宽则按宽度约束（放宽到 0.78，主体更具存在感）
        tw = fw * 0.78
        th = tw * ch / cw
    return ((fw - tw) / 2, fh * _GROUND_BASELINE - th, tw, th)


def compose_layer(content_png: bytes, frame_w: int, frame_h: int, *, mode: str = "grounded",
                  anchor: str = "center", scale: float = 0.25, horizon: float = 0.7,
                  h_ratio: float = 0.6) -> bytes:
    """把一个透明内容（已抠图）摆到整帧透明画布上，返回整帧 PNG。
    mode="grounded"：等比落到支撑面（主体）；其余（passthrough/center）：保持原尺寸、水平居中。"""
    from PIL import Image

    frame = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
    c = _open_trim(_clean_fragments(content_png))  # 先去碎块再裁边定位
    cw, ch = c.size
    if cw < 1 or ch < 1:
        return content_png
    if mode == "grounded":
        x, y, tw, th = _grounded_box(frame_w, frame_h, cw, ch, horizon, h_ratio)
    else:
        # passthrough/center：保持内容原尺寸，水平居中、垂直居中
        tw, th = cw, ch
        x, y = (frame_w - tw) / 2, (frame_h - th) / 2
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
