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


# ============================================================================
# 电商主图六联：从「单个产品」生成 6 张角色分工的电商主图（对标真实交付物）
# 与套图不同——套图是「N 张同款式」，主图六联是「1 个产品 × 6 个固定职责」。
# 风格：明亮通透、柔和拱门背景、金色点缀、粗体/衬线中文标题、图标卖点项、1:1。
# 文案由 generate_main_content 从产品说明 + PDF 自动生成，AI 直接渲染进画面。
# ============================================================================

# 全集共享约束：一致 = 品牌一致（配色/金色/字体/光感氛围），**不是构图一致**。
# 关键：每张必须用「不同的机位、瓶子大小与位置、裁切、道具」，否则 6 张会像同一张换字。
_MAIN_STYLE = (
    "PREMIUM bright e-commerce product main image. This is one of a 6-image set: keep the BRAND look consistent "
    "(same airy light-gray studio palette, refined GOLD accents, elegant bold Chinese title with a thin gold rule, "
    "neat icon+text rows, soft pro lighting) — but each image MUST have a DISTINCT composition. VARY the camera "
    "angle, the bottle's scale and placement, the crop and the props from image to image so the set reads as a rich "
    "editorial series, NEVER near-duplicate frames. This is an EDIT of a product photo: you MUST RE-STAGE the scene "
    "as the role specifies (new angle / scale / placement) — do NOT preserve the source framing. Keep the product "
    "itself and its label EXACTLY accurate. Square 1:1, high-end, uncluttered, generous negative space."
)

MAIN_ROLES = [
    {
        "key": "hero", "label": "白底主图",
        "prompt": _MAIN_STYLE + (
            " ROLE — clean HERO: straight-on EYE-LEVEL, pure white seamless background, the FULL bottle and a poured "
            "glass CENTERED at medium scale, a sweep of soft silk and a few fresh fruits at the base. No text at all "
            "— a pristine clean product hero."
        ),
    },
    {
        "key": "sell", "label": "标题卖点",
        "prompt": _MAIN_STYLE + (
            " ROLE — title + selling points: a dramatic LOW-ANGLE looking UP at the bottle so it stands tall and "
            "heroic on the RIGHT third; on the LEFT a large bold two-line Chinese TITLE + subtitle + thin gold rule, "
            "then 4 icon+text bullet rows (origin / aging / alcohol / variety). Minimal props, lots of clean space."
        ),
    },
    {
        "key": "flavor", "label": "风味口感",
        "prompt": _MAIN_STYLE + (
            " ROLE — flavor & tasting: a gently HIGH-ANGLE styled TABLETOP looking down ~30°, the bottle laid/standing "
            "mid-scene with the specific tasting fruits & spices artfully scattered (the actual notes, not generic "
            "fruit); top-left a bold title + product name; a column of 5 icon+text tasting-note rows down the left."
        ),
    },
    {
        "key": "craft", "label": "工艺陈酿",
        "prompt": _MAIN_STYLE + (
            " ROLE — craft / oak aging: a 3/4 SIDE angle, the bottle nestled among stacked OAK BARRELS toward the "
            "LEFT in a warm wood-toned setting (props = oak, cork, staves — no fruit); a bold title + subtitle and 4 "
            "icon+text craft bullets on the right; a row of 3 small rounded thumbnail cards along the bottom."
        ),
    },
    {
        "key": "scene", "label": "场景佐餐",
        "prompt": _MAIN_STYLE + (
            " ROLE — serving & pairing: a TABLE-LEVEL low shot of an elegant place setting, PLATED FOOD prominent in "
            "the foreground and the bottle + glass set back to one side (props = food, not loose fruit); a bold title "
            "+ subtitle and 3 icon+text rows (serving temperature / food pairings / tannin)."
        ),
    },
    {
        "key": "spec", "label": "产品档案",
        "prompt": _MAIN_STYLE + (
            " ROLE — product profile: combine TWO scales — the full bottle standing on the RIGHT plus a large circular "
            "MACRO close-up inset of the LABEL (extreme detail crop); clean minimal studio, no fruit; a bold title + "
            "a small 'PRODUCT PROFILE' kicker and a column of 5 icon+text spec rows (region / grade / variety / "
            "vintage / alcohol)."
        ),
    },
]

# 每个角色需要的文案字段（None=无文案，纯画面）
_MAIN_CONTENT_SPEC = {
    "sell": "title（产品标题，简短两行内）、subtitle（一句卖点）、points（4 条：产地/陈酿/酒精度/品类，每条很短）",
    "flavor": "title（固定『风味口感』）、points（5 条品鉴词：酒色/香气/果味/陈酿气息/单宁余味，每条很短）",
    "craft": "title（如『橡木桶陈酿』或工艺主题）、points（4 条工艺卖点，每条很短）",
    "scene": "title（固定『佐餐推荐』）、points（3 条：建议侍酒温度/适合搭配/单宁佐餐）",
    "spec": "title（固定『产品档案』）、points（5 条参数，写成『产区：xx』『等级：xx』『品种：xx』『年份：xx』『酒精度：xx』）",
}


async def generate_main_content(item: dict, doc_text: str, lang: str = "zh") -> dict:
    """为单个产品生成主图六联各角色的真实文案（取自产品说明 + 文档）。

    返回 {role_key: {title, subtitle?, points[]}}，hero 角色无文案不返回。
    """
    from app.providers import get_llm

    lang_word = "中文" if lang != "en" else "English"
    roles_desc = "\n".join(f'- {k}: {v}' for k, v in _MAIN_CONTENT_SPEC.items())
    schema = ('{"sell":{"title":"...","subtitle":"...","points":["...","...","...","..."]},'
              '"flavor":{"title":"风味口感","points":["...","...","...","...","..."]},'
              '"craft":{"title":"...","points":["...","...","...","..."]},'
              '"scene":{"title":"佐餐推荐","points":["...","...","..."]},'
              '"spec":{"title":"产品档案","points":["产区：...","等级：...","品种：...","年份：...","酒精度：..."]}}')
    prompt = (
        f"为一款电商产品生成「主图六联」各页的文案。需要这几页：\n{roles_desc}\n\n"
        f"用{lang_word}，文案精炼、真实、可直接用，**优先取自下方参考资料里的事实**（产地/年份/规格/口感/工艺/卖点），不要编造；"
        f"没有依据的就给行业通用且稳妥的表述。\n\n"
        f"产品：{item.get('label', '')} — {item.get('caption', '')}\n\n"
        f"参考资料（产品手册）：\n{(doc_text or '（无）')[:5000]}\n\n"
        f"只输出一个 JSON：{schema}"
    )
    try:
        import json
        import re

        raw = await get_llm().complete([{"role": "user", "content": prompt}], json_only=True)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
        out = {}
        for key in _MAIN_CONTENT_SPEC:
            c = data.get(key) or {}
            out[key] = {
                "title": str(c.get("title", ""))[:30],
                "subtitle": str(c.get("subtitle", ""))[:60],
                "points": [str(p)[:40] for p in (c.get("points") or [])][:5],
            }
        return out
    except Exception:
        return {}


def _main_block(content: dict, lang: str = "zh") -> str:
    """把一页的真实文案拼成给生成模型的「请把这些文字画进设计」指令。"""
    if not content:
        return ""
    lines = []
    if content.get("title"):
        lines.append(f'Title: {content["title"]}')
    if content.get("subtitle"):
        lines.append(f'Subtitle: {content["subtitle"]}')
    for p in (content.get("points") or []):
        lines.append(f"• {p}")
    if not lines:
        return ""
    word = "中文" if lang != "en" else "English"
    return (
        f" Render EXACTLY this {word} text into the design, spelled correctly and legibly, "
        f"placed per the layout above:\n" + "\n".join(lines)
    )


def build_main_set_plan(source_label: str, content_map: dict | None = None, lang: str = "zh") -> Plan:
    """从单个产品图构造 6 张角色分工的电商主图计划（AI 直接渲染文案，明亮风格）。

    节点 id 用 set_1..set_6 → 复用 job_service 的网格落位/arrange/计费逻辑。
    """
    if not source_label:
        raise ValueError("未选择产品图")
    content_map = content_map or {}
    nodes = []
    for i, role in enumerate(MAIN_ROLES):
        rc = content_map.get(role["key"]) if role["key"] != "hero" else None
        prompt = role["prompt"] + (_main_block(rc, lang) if rc else "")
        nodes.append(PlanNode(
            id=f"set_{i + 1}", tool="edit_image",
            label=f"主图 {i + 1}/6 · {role['label']}",
            args={
                "prompt": prompt, "source_asset": source_label,
                "aspect_ratio": "1:1", "set_member": True,
            },
            depends=[],
        ))
    return Plan(
        mode="plan", title="电商主图六联（6 张）", nodes=nodes,
        notes=["AI 生成 6 张角色分工的电商主图：白底 / 卖点 / 风味 / 工艺 / 场景 / 参数，文案取自产品信息与文档"],
    )


# ============================================================================
# 电商详情页七段：从「单个产品」生成 7 段长详情页（暗调影院风、中英双语、竖版）
# 与主图六联是「一套两风格」：主图明亮通透，详情页暗调高级。竖版便于拼成长图。
# ============================================================================

# 一致 = 品牌一致（暗调影院氛围/金色衬线/中英双语/金色描边图标），**构图必须每段不同**。
# 每段强制不同的机位、瓶子大小与位置、裁切、道具，避免 7 段像同一张图换文字。
_DETAIL_STYLE = (
    "PREMIUM cinematic e-commerce DETAIL-PAGE section for a wine product. This is one of a 7-section page: keep the "
    "BRAND mood consistent (dark moody premium atmosphere, deep burgundy-to-black, GOLD serif typography, BILINGUAL "
    "Chinese+English headings, thin gold dividers and line icons) — but each section MUST have a DISTINCT "
    "composition. VARY the camera angle, the bottle's scale and placement, the crop, the depth and the props from "
    "section to section so the page reads as a rich editorial spread, NEVER near-duplicate frames. This is an EDIT "
    "of a product photo: you MUST RE-STAGE each section as specified (new angle / scale / placement / setting) — do "
    "NOT preserve the source framing. Keep the product and its label EXACTLY accurate. Vertical 3:4, luxurious, high "
    "contrast."
)

DETAIL_ROLES = [
    {"key": "banner", "label": "封面",
     "prompt": _DETAIL_STYLE + (
         " ROLE — cover banner: a WIDE cinematic establishing shot. Place the bottle SMALLER in the LOWER-RIGHT "
         "within a vast dusk vineyard-and-mountain panorama with lots of sky and depth (environmental, not a "
         "studio). A large bilingual product name in gold serif across the top, a one-line meta strip "
         "(aging | vintage | alcohol) beneath. No loose fruit.")},
    {"key": "coreinfo", "label": "核心信息",
     "prompt": _DETAIL_STYLE + (
         " ROLE — core info: combine TWO scales — the full bottle standing on the LEFT and a LARGE MACRO close-up of "
         "the LABEL filling the upper-right (extreme detail crop). Dark studio, minimal props. Bold bilingual heading "
         "核心信息; a neat BILINGUAL spec table (each row: gold icon + Chinese label + value + small English) for "
         "region / grade / variety / vintage / alcohol / aging / aging-potential.")},
    {"key": "flavor", "label": "风味口感",
     "prompt": _DETAIL_STYLE + (
         " ROLE — tasting notes: a dramatic slightly LOW spotlit angle, the bottle + glass CENTER on near-black with "
         "the actual tasting fruits & spices catching the light (the real notes, not generic fruit). Bilingual "
         "heading 风味口感 / TASTING NOTES; a column of 6 round-icon tasting-note rows; and a FLAVOR PYRAMID "
         "infographic at the bottom with 4 tiers (初闻 / 中段 / 后段 / 余味), each a thin gold band with a short note.")},
    {"key": "craft", "label": "橡木桶陈酿",
     "prompt": _DETAIL_STYLE + (
         " ROLE — oak aging: a 3/4 angle deep inside a DIM CELLAR, the bottle among stacked OAK BARRELS in heavy "
         "shadow (props = oak, char, cork — no fruit), texture-rich. Bilingual heading 橡木桶陈酿 / OAK BARREL AGING; "
         "a short poetic line; 4 icon+text craft bullets; and a strip of 3 atmospheric MACRO photos along the bottom "
         "(barrel grain / charred oak / swirling wine).")},
    {"key": "origin", "label": "产区与酒庄",
     "prompt": _DETAIL_STYLE + (
         " ROLE — origin & winery: a GOLDEN-HOUR vineyard LANDSCAPE, warmer and brighter than the other sections (a "
         "deliberate contrast), the bottle SMALL in the lower foreground among grapevines (props = grapes on the "
         "vine). Bilingual heading 产区与酒庄 / ORIGIN & WINERY; a short winery story; a row of 4 gold-icon feature "
         "cards (sunlight / terroir / quality grapes / heritage).")},
    {"key": "pairing", "label": "侍酒与餐配",
     "prompt": _DETAIL_STYLE + (
         " ROLE — serving & pairing: a TABLE-LEVEL candle-lit dining scene, PLATED FOOD prominent in the foreground "
         "and the bottle + glass set back to one side (props = food, not loose fruit), warm and intimate. Bilingual "
         "heading 侍酒与餐配 / SERVING & PAIRING; 3 icon+text rows (serving temperature / food pairings / tannin).")},
    {"key": "footer", "label": "规格物流",
     "prompt": _DETAIL_STYLE + (
         " ROLE — footer: a WIDE SHORT banner-feel composition, a refined brand crest centered at top, the bottle "
         "off to ONE SIDE in a dim luxurious setting with minimal props; the bilingual product name and 2 icon+text "
         "lines for packaging spec and shipping note; brand sign-off at the bottom.")},
]

_DETAIL_CONTENT_SPEC = {
    "banner": "name（产品中文名）、subtitle（产品英文名/系列）、points（1 条：陈酿|年份|酒精度 合并成一行）",
    "coreinfo": "title（固定『核心信息』）、points（7 条参数：产区/等级/品种/年份/酒精度/陈酿/陈年潜力，写成『产区：xx』）",
    "flavor": "title（固定『风味口感』）、points（6 条品鉴词，每条很短）",
    "craft": "title（固定『橡木桶陈酿』）、subtitle（一句诗意文案）、points（4 条工艺卖点）",
    "origin": "title（固定『产区与酒庄』）、subtitle（一句酒庄简介）、points（4 条：充足日照/得天独厚/优质葡萄/百年传承 各配很短说明）",
    "pairing": "title（固定『侍酒与餐配』）、points（3 条：建议侍酒温度/适合搭配/单宁佐餐）",
    "footer": "title（产品中文名）、points（2 条：规格如『一箱6瓶装』、运费如『偏远地区运费另计』）",
}


async def generate_detail_content(item: dict, doc_text: str, lang: str = "zh") -> dict:
    """为单个产品生成详情页七段各段的真实文案。返回 {role_key: {title, subtitle?, points[]}}。"""
    from app.providers import get_llm

    lang_word = "中文" if lang != "en" else "English"
    roles_desc = "\n".join(f'- {k}: {v}' for k, v in _DETAIL_CONTENT_SPEC.items())
    schema = ('{"banner":{"name":"...","subtitle":"...","points":["..."]},'
              '"coreinfo":{"title":"核心信息","points":["产区：...","等级：...","品种：...","年份：...","酒精度：...","陈酿：...","陈年潜力：..."]},'
              '"flavor":{"title":"风味口感","points":["...","...","...","...","...","..."]},'
              '"craft":{"title":"橡木桶陈酿","subtitle":"...","points":["...","...","...","..."]},'
              '"origin":{"title":"产区与酒庄","subtitle":"...","points":["...","...","...","..."]},'
              '"pairing":{"title":"侍酒与餐配","points":["...","...","..."]},'
              '"footer":{"title":"...","points":["...","..."]}}')
    prompt = (
        f"为一款电商产品生成「详情页七段」各段的文案。需要这几段：\n{roles_desc}\n\n"
        f"用{lang_word}，文案精炼、真实、可直接用，**优先取自下方参考资料里的事实**，不要编造；"
        f"banner 的 name 用中文名、subtitle 用英文名/系列。\n\n"
        f"产品：{item.get('label', '')} — {item.get('caption', '')}\n\n"
        f"参考资料（产品手册）：\n{(doc_text or '（无）')[:5000]}\n\n"
        f"只输出一个 JSON：{schema}"
    )
    try:
        import json
        import re

        raw = await get_llm().complete([{"role": "user", "content": prompt}], json_only=True)
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        data = json.loads(m.group(0)) if m else {}
        out = {}
        for key in _DETAIL_CONTENT_SPEC:
            c = data.get(key) or {}
            out[key] = {
                "title": str(c.get("title", "") or c.get("name", ""))[:30],
                "subtitle": str(c.get("subtitle", ""))[:60],
                "points": [str(p)[:48] for p in (c.get("points") or [])][:7],
            }
        return out
    except Exception:
        return {}


def build_detail_set_plan(source_label: str, content_map: dict | None = None, lang: str = "zh") -> Plan:
    """从单个产品图构造 7 段详情页计划（AI 直接渲染文案，暗调影院风，竖版 3:4）。"""
    if not source_label:
        raise ValueError("未选择产品图")
    content_map = content_map or {}
    nodes = []
    for i, role in enumerate(DETAIL_ROLES):
        rc = content_map.get(role["key"])
        prompt = role["prompt"] + (_main_block(rc, lang) if rc else "")
        nodes.append(PlanNode(
            id=f"set_{i + 1}", tool="edit_image",
            label=f"详情页 {i + 1}/7 · {role['label']}",
            args={
                "prompt": prompt, "source_asset": source_label,
                "aspect_ratio": "3:4", "set_member": True,
            },
            depends=[],
        ))
    return Plan(
        mode="plan", title="电商详情页七段（7 张）", nodes=nodes,
        notes=["AI 生成 7 段详情页：封面 / 核心信息 / 风味 / 工艺 / 产区 / 餐配 / 规格，暗调影院风，文案取自产品与文档"],
    )
