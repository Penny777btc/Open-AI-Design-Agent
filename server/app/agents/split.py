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
            "Remove the MAIN SUBJECT / product from this image COMPLETELY, and realistically inpaint and "
            "extend the background so the scene looks natural and complete as if the product was never there. "
            "Keep the exact same background style, colors, lighting, perspective and composition. Output ONLY "
            "the clean background scene — no product, no floating shadow of the product."
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
    """从一张源图构造「背景层 + 主体层」的拆分计划（两个 edit_image 节点）。"""
    if not source_label:
        raise ValueError("未选择要拆分的图片")
    nodes = []
    for i, role in enumerate(SPLIT_ROLES):
        # 主体层依赖背景层先完成 → 背景先落画布(在下)、主体后落(在上)，叠放顺序正确
        depends = ["split_1"] if role["key"] == "subject" else []
        nodes.append(PlanNode(
            id=f"split_{i + 1}", tool="edit_image",
            label=f"AI 拆分 · {role['label']}",
            args={
                "prompt": role["prompt"],
                "source_asset": source_label,
                "split_role": role["key"],
                "transparent": role["transparent"],
            },
            depends=depends,
        ))
    return Plan(
        mode="plan", title="AI 拆分（背景层 + 主体层）", nodes=nodes,
        notes=["把选中的 AI 图拆成『背景层』+『主体层(透明)』，叠回原位 → 可分别移动、可导出分层 PSD"],
    )
