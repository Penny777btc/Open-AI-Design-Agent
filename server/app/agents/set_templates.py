"""套图模板（AI 直出方案）：AI 直接生成整张设计图——文字也由 AI 渲染、融入画面，
靠「统一的版式/字体/风格约束 + 真实文案」让一组图既有设计感又尽量一致。

权衡：AI 渲染文字做不到 100% 像素一致（扩散模型每张独立解读），但设计感更强、
文字与画面融为一体（用户更看重这一点）。文案取自产品信息 + PDF（generate_set_content）。
"""

from app.agents.planner import Plan, PlanNode

# 共享版式/风格约束（全集同一段 → 一致性来源）。{content} 处插入该产品的真实文案。
SET_TEMPLATES = {
    "ecom": {
        "label": "电商主图",
        # AI 融合版：AI 直接把文字画进画面
        "layout": (
            "Create a PREMIUM e-commerce product main image. This image is part of a CONSISTENT SET — "
            "every image in the set MUST share the exact same layout, typography and color treatment. "
            "Keep the product EXACTLY as in the source photo, including its own label and branding. "
            "Layout (identical across the set): clean light-gray studio gradient background; the product centered and prominent; "
            "render an elegant SERIF product TITLE across the TOP CENTER, a thin gold divider rule beneath it, a short SUBTITLE line below that, "
            "and THREE short spec lines as a neat list in the LOWER-LEFT. "
            "Typography is refined and consistent: an elegant serif, dark charcoal ink with a muted gold accent, generous letter-spacing, balanced hierarchy. "
            "Square 1:1, soft professional studio lighting."
        ),
        # 可编辑版：AI 只出干净留白场景，文字区留空（前端叠可编辑文字）
        "clean": (
            "Create a PREMIUM e-commerce product image. Keep the product EXACTLY as the source, including its own label/branding. "
            "Do NOT add any title, caption, marketing text or graphic overlay — produce a clean image. "
            "Composition (consistent across the set): clean light-gray studio gradient background; place the product and any props in the CENTER-LOWER and RIGHT of the frame; "
            "keep the TOP ~25% a clean EMPTY band and the LOWER-LEFT corner clean and EMPTY (those areas are reserved for text added later). "
            "Square 1:1, soft professional studio lighting."
        ),
        "aspect_ratio": "1:1",
    },
    "rednote": {
        "label": "小红书封面",
        "layout": (
            "Create a Xiaohongshu (RED) cover image, part of a CONSISTENT SET sharing identical layout and typography. "
            "Keep the product exactly as the source, including its label. "
            "Layout: bright clean lifestyle background; product placed naturally; a LARGE elegant serif TITLE across the upper-middle, "
            "a thin divider, and a smaller SUBTITLE below it. Refined consistent typography (elegant serif, dark ink, soft accent). "
            "Vertical 3:4, soft natural lighting."
        ),
        "clean": (
            "Create a Xiaohongshu (RED) cover image. Keep the product exactly as the source, including its label. "
            "Do NOT add any text — clean image. Composition (consistent across the set): bright clean lifestyle background; "
            "place the product in the LOWER 2/3; keep the UPPER 1/3 a clean EMPTY area reserved for a title later. Vertical 3:4, soft natural lighting."
        ),
        "aspect_ratio": "3:4",
    },
    "minimal": {
        "label": "极简画册",
        "layout": (
            "Create a minimal editorial product image, part of a CONSISTENT SET sharing identical layout and typography. "
            "Keep the product exactly as the source, including its label. "
            "Layout: pure off-white seamless background; product centered with generous negative space; a single understated serif TITLE "
            "in the lower-left with a short thin rule beneath it. Monochrome refined typography, identical across the set. "
            "Square 1:1, even soft lighting, editorial minimal aesthetic."
        ),
        "clean": (
            "Create a minimal editorial product image. Keep the product exactly as the source, including its label. "
            "Do NOT add any text — clean image. Composition: pure off-white seamless background; place the product slightly RIGHT-of-center "
            "with generous negative space; keep the LOWER-LEFT clean and EMPTY for a title later. Square 1:1, even soft lighting."
        ),
        "aspect_ratio": "1:1",
    },
}

SET_CONTENT_SPEC = {
    "ecom": {"title": True, "subtitle": True, "points": 3},
    "rednote": {"title": True, "subtitle": True, "points": 0},
    "minimal": {"title": True, "subtitle": False, "points": 0},
}


async def generate_set_content(template_key: str, items: list[dict], doc_text: str, lang: str = "zh") -> dict:
    """用 LLM 为每张产品图生成真实文案（取自产品说明 + 文档）。返回 {label: {title, subtitle, points}}。"""
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


def _content_block(content: dict, lang: str = "zh") -> str:
    """把一张图的真实文案拼成给生成模型的「请渲染这些文字」指令。"""
    if not content:
        return ""
    lines = [f'Title: {content.get("title", "")}']
    if content.get("subtitle"):
        lines.append(f'Subtitle: {content["subtitle"]}')
    pts = content.get("points") or []
    if pts:
        lines.append("Spec lines: " + " / ".join(pts))
    word = "中文" if lang != "en" else "English"
    return (
        f" Render EXACTLY this {word} text into the design, spelled correctly and legibly, "
        f"placed per the layout above:\n" + "\n".join(lines)
    )


def build_set_plan(template_key: str, asset_labels: list[str], content_map: dict | None = None,
                   lang: str = "zh", mode: str = "ai") -> Plan:
    """每张选中图建一个 edit_image 节点。
    mode="ai"：AI 直接把文案画进设计图（融合、不可编辑）。
    mode="editable"：AI 出干净留白场景，文案随节点带给前端去叠可编辑文字层。
    """
    tpl = SET_TEMPLATES.get(template_key)
    if tpl is None:
        raise ValueError(f"未知套图模板：{template_key}")
    labels = [l for l in (asset_labels or []) if l][:12]
    if not labels:
        raise ValueError("未选择任何图片")
    content_map = content_map or {}
    editable = mode == "editable"
    nodes = []
    for i, label in enumerate(labels):
        if editable:
            args = {
                "prompt": tpl["clean"], "source_asset": label, "aspect_ratio": tpl["aspect_ratio"],
                "set_template": template_key, "slot_content": content_map.get(label),
            }
        else:
            args = {
                "prompt": tpl["layout"] + _content_block(content_map.get(label), lang),
                "source_asset": label, "aspect_ratio": tpl["aspect_ratio"], "set_member": True,
            }
        nodes.append(PlanNode(
            id=f"set_{i + 1}", tool="edit_image",
            label=f"套图 {i + 1}/{len(labels)} · {tpl['label']}", args=args, depends=[],
        ))
    note = (
        f"AI 出 {len(labels)} 张干净底图 + 可编辑文字层（排版/字体一致，可改内容可换字体）"
        if editable else
        f"AI 直接生成 {len(labels)} 张统一版式/字体/风格的设计图，文案取自产品信息与文档"
    )
    return Plan(mode="plan", title=f"{tpl['label']}（{len(labels)} 张统一风格）", nodes=nodes, notes=[note])
