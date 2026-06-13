"""套图模板：把「固定排版 + 固定字体 + 统一风格」写成生成约束提示。

机制：用户选一批产品图，选一个模板，系统为每张图建一个 edit_image 节点，
每个节点的提示词都注入【同一段】模板约束 → AI 生成出来的一组新图在
版式/字体/配色/风格上保持一致（靠系统提示约束生成，而非事后叠图层）。
"""

from app.agents.planner import Plan, PlanNode

# 每个模板：面向用户的名字 + 注入每张生成的英文约束提示（全集共享 → 一致性来源）
SET_TEMPLATES = {
    "ecom": {
        "label": "电商主图套图",
        "prompt": (
            "Redesign this into a premium e-commerce product MAIN IMAGE. "
            "Keep the product's exact appearance from the source photo (bottle shape, label, packaging, colors) unchanged. "
            "Apply this FIXED template consistently (this image is part of a set that must look identical in layout and typography): "
            "clean light-gray studio gradient background; product centered and prominent; "
            "a BOLD sans-serif PRODUCT TITLE at the top center; a one-line SUBTITLE directly below the title; "
            "THREE short selling-point lines as a left-aligned list in the lower-left corner. "
            "Typography is fixed: one clean modern sans-serif family, consistent weights and sizes, same color scheme across the whole set. "
            "Square 1:1 composition, professional studio lighting."
        ),
        "aspect_ratio": "1:1",
    },
    "rednote": {
        "label": "小红书封面套图",
        "prompt": (
            "Redesign this into a Xiaohongshu (RED) cover image, part of a consistent set. "
            "Keep the product's exact appearance from the source unchanged. "
            "FIXED template across the set: bright clean lifestyle background; product placed naturally; "
            "a LARGE bold title across the upper-middle; a smaller subtitle line below it; "
            "fixed typography (one warm modern sans-serif, same weights and sizes, same accent color) for the whole set. "
            "Vertical 3:4 composition, soft natural lighting, cohesive cover style."
        ),
        "aspect_ratio": "3:4",
    },
    "minimal": {
        "label": "极简画册套图",
        "prompt": (
            "Redesign this into a minimal product catalog image, part of a consistent set. "
            "Keep the product's exact appearance from the source unchanged. "
            "FIXED template across the set: pure off-white seamless background; product centered with generous negative space; "
            "a single understated title in the lower-left; one thin sans-serif typeface, same size and weight across the whole set; monochrome palette. "
            "Square 1:1, even soft lighting, editorial minimal aesthetic."
        ),
        "aspect_ratio": "1:1",
    },
}


def build_set_plan(template_key: str, asset_labels: list[str]) -> Plan:
    """为选中的每张产品图建一个 edit_image 节点，注入同一模板约束。"""
    tpl = SET_TEMPLATES.get(template_key)
    if tpl is None:
        raise ValueError(f"未知套图模板：{template_key}")
    labels = [l for l in (asset_labels or []) if l][:12]  # 单次套图上限 12 张
    if not labels:
        raise ValueError("未选择任何图片")
    nodes = [
        PlanNode(
            id=f"set_{i + 1}",
            tool="edit_image",
            label=f"套图 {i + 1}/{len(labels)} · {tpl['label']}",
            args={"prompt": tpl["prompt"], "source_asset": label, "aspect_ratio": tpl["aspect_ratio"]},
            depends=[],
        )
        for i, label in enumerate(labels)
    ]
    return Plan(mode="plan", title=f"{tpl['label']}（{len(labels)} 张统一风格）", nodes=nodes,
                notes=[f"已选 {len(labels)} 张，将按「{tpl['label']}」统一排版/字体/风格生成"])
