"""套图模板（混合方案）：AI 出「干净无字底图」+ 前端固定矢量模板叠字。

为什么这么做：扩散模型每张图独立生成，字体/位置必然漂移，纯 AI 无法做到 100% 排版统一。
所以分两步——
  1) AI 只负责生成统一风格的「干净产品图」，明确禁止渲染任何文字、并预留标题区/卖点区；
  2) 前端在生成图上叠加【固定矢量文字模板】（位置/字体/字号锁死），只有文字内容可改。
这样画面是 AI 生成的（风格统一），排版字体是模板锁死的（100% 一致）。

模板的【文字槽位坐标/字体】定义在前端（CanvasArea 的 SET_TEMPLATE_SLOTS），与这里的
key 一一对应；后端只管生成提示 + 把模板 key 透传给前端去叠字。
"""

from app.agents.planner import Plan, PlanNode

_NO_TEXT = (
    "CRITICAL: do NOT render any text, words, letters, numbers, logos or labels onto the image. "
    "Produce a clean image with ZERO typography — text will be added afterward by a fixed template. "
)

SET_TEMPLATES = {
    "ecom": {
        "label": "电商主图",
        "prompt": (
            "Redesign this into a clean premium e-commerce product MAIN IMAGE. "
            "Keep the product's exact appearance from the source photo (bottle, label, packaging, colors) unchanged. "
            + _NO_TEXT +
            "Reserve clean EMPTY space: a clear horizontal band across the TOP (for a title later) and a clear area in the LOWER-LEFT (for spec lines later). "
            "Consistent across the whole set: light-gray studio gradient background, product centered and prominent, identical professional studio lighting and composition. Square 1:1."
        ),
        "aspect_ratio": "1:1",
    },
    "rednote": {
        "label": "小红书封面",
        "prompt": (
            "Redesign this into a Xiaohongshu (RED) cover, part of a consistent set. "
            "Keep the product's exact appearance from the source unchanged. "
            + _NO_TEXT +
            "Reserve a clean EMPTY band across the UPPER-MIDDLE for a title to be added later. "
            "Consistent across the set: bright clean lifestyle background, product placed naturally, identical soft lighting and composition. Vertical 3:4."
        ),
        "aspect_ratio": "3:4",
    },
    "minimal": {
        "label": "极简画册",
        "prompt": (
            "Redesign this into a minimal product catalog image, part of a consistent set. "
            "Keep the product's exact appearance from the source unchanged. "
            + _NO_TEXT +
            "Reserve clean EMPTY space in the LOWER-LEFT for a single title line later. "
            "Consistent across the set: pure off-white seamless background, product centered with generous negative space, identical even soft lighting. Square 1:1."
        ),
        "aspect_ratio": "1:1",
    },
}


def build_set_plan(template_key: str, asset_labels: list[str]) -> Plan:
    """每张选中图建一个 edit_image 节点，注入同一「干净无字底图」约束，并带上模板 key。"""
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
            args={
                "prompt": tpl["prompt"],
                "source_asset": label,
                "aspect_ratio": tpl["aspect_ratio"],
                "set_template": template_key,  # 透传给前端：生成完用此模板叠固定文字
            },
            depends=[],
        )
        for i, label in enumerate(labels)
    ]
    return Plan(mode="plan", title=f"{tpl['label']}（{len(labels)} 张统一风格）", nodes=nodes,
                notes=[f"AI 生成 {len(labels)} 张干净统一底图，再叠固定模板文字（排版/字体 100% 一致，可改内容）"])
