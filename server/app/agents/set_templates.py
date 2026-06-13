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


# 每个模板要几条文案槽位（与前端 SET_TEMPLATE_SLOTS 的 key 对应）
SET_CONTENT_SPEC = {
    "ecom": {"title": True, "subtitle": True, "points": 3},
    "rednote": {"title": True, "subtitle": True, "points": 0},
    "minimal": {"title": True, "subtitle": False, "points": 0},
}


async def generate_set_content(template_key: str, items: list[dict], doc_text: str, lang: str = "zh") -> dict:
    """用 LLM 为每张产品图生成真实套图文案（取自产品说明 + 文档），而非占位符。

    items: [{"label": "asset_3", "caption": "SANITY 5 Reserva Chardonnay 2020 白葡萄酒"}]
    返回 {label: {"title": str, "subtitle": str, "points": [str, ...]}}；失败时返回 {} （前端回退占位符）。
    """
    spec = SET_CONTENT_SPEC.get(template_key, {})
    if not items:
        return {}
    from app.providers import get_llm

    lang_word = "中文" if lang != "en" else "English"
    need = ["title（产品标题，简短）"]
    if spec.get("subtitle"):
        need.append("subtitle（一句核心卖点/副标题）")
    if spec.get("points"):
        need.append(f"points（{spec['points']} 条卖点小标题，每条很短，如规格/产地/年份/口感）")
    schema = '{"<label>": {"title": "...", "subtitle": "...", "points": ["...", "..."]}}'
    products = "\n".join(f'- {it["label"]}: {it.get("caption", "")}' for it in items)
    prompt = (
        f"为一组电商套图生成文案。每个产品需要：{('；'.join(need))}。\n"
        f"用{lang_word}，文案要精炼、真实、可直接用，**优先取自下方参考资料里的事实**（产地/年份/规格/口感/卖点），不要编造。\n\n"
        f"产品列表：\n{products}\n\n"
        f"参考资料（产品手册）：\n{(doc_text or '（无）')[:5000]}\n\n"
        f"只输出一个 JSON，按产品 label 为 key：{schema}。没有 subtitle/points 的模板就省略对应字段。"
    )
    try:
        raw = await get_llm().complete([{"role": "user", "content": prompt}], json_only=True)
        import json
        import re

        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
        out = {}
        for it in items:
            c = data.get(it["label"]) or {}
            out[it["label"]] = {
                "title": str(c.get("title", "") or it.get("caption", ""))[:60],
                "subtitle": str(c.get("subtitle", ""))[:80],
                "points": [str(p)[:40] for p in (c.get("points") or [])][: spec.get("points", 0)],
            }
        return out
    except Exception:
        return {}


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
