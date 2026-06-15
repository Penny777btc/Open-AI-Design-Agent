"""AI 拆图：把一张 AI 生成的成品图拆成可独立编辑的图层。

- 背景层：把主体（产品）移除，并真实补全/延展背景，得到完整干净的背景场景。
- 主体层：只保留主体（产品），其余全部去掉，输出透明背景 PNG（带 alpha）。

两层在画布上叠回源图的同一位置/尺寸 → 看起来还是原图，但已是可分别移动、可导出分层 PSD 的两层。
"""

from app.agents.planner import Plan, PlanNode

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
