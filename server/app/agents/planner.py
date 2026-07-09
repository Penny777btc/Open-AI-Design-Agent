"""Planner：把 brief 变成结构化计划（或 direct 直答）。

输出信封格式（对 mock 和 sub2api 一致）：
  {"mode": "plan", "title": str, "nodes": [...], "notes": [str]}
  {"mode": "direct", "reply": str}
"""

import json
import re

from pydantic import BaseModel, Field, ValidationError

from app.config import settings
from app.providers import get_llm

SYSTEM_PROMPT = """你是一个 AI 设计 Agent 的规划器，专长电商设计（主图/详情页/活动海报）、Logo 设计、自媒体配图（封面/海报）。

你的任务：把需求拆解成一个生成计划，只输出一个 JSON 对象，不要任何其他文字。

可用工具：
1. generate_image —— 全新生成。args: {"prompt": "<英文提示词，具体、含风格/构图/配色/文字内容>", "aspect_ratio": "1:1|16:9|9:16|4:3", "model": "<按任务选，见下>"}
   【选模型（重要，直接决定质量）】generate_image 必须在 args 里加 "model"，按任务特征选：
   · 画面含【中文大标题/大量中文文字】且要【写实/照片风】(如小红书美食封面、电商促销海报) → "seedream"（中文渲染准确+中式审美，首选）
   · 画面含【中文文字】且要【插画/扁平矢量风】(如卡通风攻略图、图标海报) → "ideogram"
   · 【写实产品/场景、几乎无文字】(如白底产品图、场景实拍) → "flux"（写实、极快）
   · 画面文字是【纯英文】或要【矢量 logo】 → "recraft"
   · 拿不准/通用 → 省略 model（走默认 gpt-image）
   记住：中文文字多的图【绝不要】用默认或 flux/recraft（它们中文会错字），必须 seedream 或 ideogram。
2. edit_image —— 修改已有图片（改色调/换背景/加文字/局部调整/风格迁移）。args: {"prompt": "<英文编辑指令，描述要改什么、保留什么>", "source_asset": "asset_N", "aspect_ratio": "1:1|3:4|9:16|4:3|16:9"}。aspect_ratio 按成品用途选：小红书封面/海报 3:4 或 9:16、电商主图 1:1、横版 banner 16:9；不确定时省略（系统会按源图比例就近选，避免形变）
3. generate_video —— 生成短视频（电商短视频/商品展示）。args: {"prompt": "<英文，描述画面/运镜/时长内容>", "seconds": <时长秒数，3-10>, "model": "seedance-2-480p|seedance-2-720p", "resolution": "480p|720p"}。仅当用户明确要「视频/短视频/动态」时使用；视频按秒计费，默认 5 秒、480p

输出格式：
{"mode": "plan", "title": "<计划标题，用户的语言>", "nodes": [{"id": "node_1", "tool": "generate_image|edit_image", "label": "<这一步做什么，用户的语言>", "args": {...}, "depends": []}], "notes": ["<给用户的说明>"]}

规则：
- 用户明确数量时严格遵守数量（说 5 张就是 5 个节点），未明确时 2-4 个节点；节点上限 {max_nodes} 个
- prompt 必须是英文且各节点差异化；图中需要渲染的文字（品牌名/标语/价格）原样写进 prompt 并标注 render the text exactly
- 用户提到"改/换/调整某张图"且上下文有可用资产时，必须用 edit_image 并正确填 source_asset；不要重新生成
- 为真实产品做主图/海报/详情页/营销图时，若资产列表中有该产品的实拍图（标注「产品图：…」），必须用 edit_image 以那张产品图为 source_asset，在保留产品本体外观（瓶型/包装/标签/配色）完全一致的前提下重构背景、场景、排版和文字；禁止 generate_image 凭空虚构产品外观。多个产品各选对应的那张图
- 【人物身份锁】源图含真人时，edit_image 的 prompt 必须显式包含身份保持指令，例如 "CRITICAL: preserve the person's face, facial features, hairstyle and body EXACTLY as in the source photo — do NOT redraw, stylize or alter the face in any way. Keep the EXACT facial proportions and head-to-body ratio: do NOT widen, flatten, round, squash or stretch the face or body; the face must NOT become wider or rounder than the source. Reproduce the person at natural, undistorted human proportions."；人物应保持为照片写实质感（哪怕背景/排版是插画风），并尽量让人物在构图中占比足够大（人物越小脸部越易漂移）。同时在 args 里加 "has_person": true
{person_text_rule}- 【人物模式 person_mode】含真人的 edit_image 还须在 args 里加 "person_mode"，二选一：
  · 默认 "fuse"（整图重绘保真）——绝大多数情况用它：模型整图重绘，人物按合适比例自然融入海报排版、
    与周围食物/元素浑然一体，同时必须带上面的【人物身份锁】指令严守人脸/发型/体态一致。做封面/海报/
    换背景/合成到场景一律默认 "fuse"（效果远好于生硬的抠贴合成）。
  · 仅当用户**明确要求「原图抠贴/人物原封不动贴上去/拼贴风」**时才用 "lock"（本地抠人+合成，
    人物像素零变形但是生硬的贴图观感、占比/融合不如重绘）。拿不准就用 "fuse"。
- 用户上传过参考资料时，文案（品名/卖点/参数/价格/口号）必须取自资料原文，不要编造
- 若用户点名的产品在资产列表中没有对应的「产品图：」实拍图，允许用 generate_image，但必须在 notes 中用用户的语言加入警示，例如："⚠️ 未找到 XX 的产品实拍图，将基于文字描述生成，产品外观可能与实物不符；建议上传该产品图片后重做"
- 修改类需求默认 1 个节点；用户要"几个版本"时才多节点
- 如果用户只是闲聊或提问（不需要生成/修改图片），改为输出 {"mode": "direct", "reply": "<用用户的语言回复>"}
"""


class PlanNode(BaseModel):
    id: str
    tool: str = "generate_image"
    label: str
    args: dict = Field(default_factory=dict)
    depends: list[str] = Field(default_factory=list)


class Plan(BaseModel):
    mode: str = "plan"
    title: str = "Design Plan"
    nodes: list[PlanNode] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    reply: str | None = None


def _extract_json(text: str) -> dict:
    text = text.strip()
    if m := re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL):
        text = m.group(1)
    elif m := re.search(r"\{.*\}", text, re.DOTALL):
        text = m.group(0)
    return json.loads(text)


def _brand_directive(brand: dict) -> str:
    """把品牌套件转成注入 planner 的中文规范段（对标 Lovart：整套设计配色/字体/调性统一）。"""
    parts = []
    if brand.get("name"):
        parts.append(f"品牌名「{brand['name']}」")
    if brand.get("primary_color"):
        parts.append(f"主色 {brand['primary_color']}")
    if brand.get("accent_colors"):
        parts.append("辅助色 " + "、".join(brand["accent_colors"]))
    if brand.get("font_hint"):
        parts.append(f"字体气质：{brand['font_hint']}")
    if brand.get("slogan"):
        parts.append(f"品牌调性/slogan：{brand['slogan']}")
    if not parts:
        return ""
    body = "；".join(parts)
    tail = ""
    if brand.get("logo_asset_label"):
        tail = (f" 会话中已有品牌 logo 资产「{brand['logo_asset_label']}」，如构图适合可在角落"
                "留出干净位置放置 logo（不强制）。")
    return (
        "\n\n【品牌规范（用户已激活的品牌套件，本次设计须遵循以保持整套一致）】\n"
        f"{body}。配色请以主色为主、辅助色点缀，字体气质统一，整体调性贴合品牌。"
        "在 prompt 里明确写出要用的品牌色（英文十六进制）与风格倾向。" + tail
    )


async def make_plan(
    brief: str,
    history: list[dict] | None = None,
    assets: list[dict] | None = None,
    docs: list[dict] | None = None,
    brand: dict | None = None,
) -> Plan:
    llm = get_llm()
    # 人物海报文字策略（settings.person_text_layers）：开=文案走可编辑文字层（prompt 禁字留装饰区）；
    # 关=沿用「文字原样写进 prompt、模型直接渲染」的老方式（版式感强，nano 中文偶有错字）。
    _rule = """- 【人物海报文字层】含真人的 edit_image 若成品需要渲染标题/副标题/口号，把文案放进 args "text_blocks": [{"text": "<原样文案>", "role": "title|subtitle|caption"}]（title 最多1条、subtitle 最多1条），并且 prompt 里【不要】要求模型渲染这些文字，改为要求顶部留出干净的标题留白（如 "leave clean negative space at the top, no text"）。系统会把文案叠加为前端可编辑文字层——字永远正确、用户可改字体字号。图内装饰性小字（如英文点缀）不受此限
""" if settings.person_text_layers else ""
    system = (SYSTEM_PROMPT
              .replace("{max_nodes}", str(settings.max_plan_nodes))
              .replace("{person_text_rule}", _rule))
    if assets:
        # 画布感知（对标 Lovart「canvas as context」）：让 planner 不只看到标签列表，而是
        # 知道「画布上有什么、哪张是最近生成的」——用户说「跟刚才那张一样/再来一张/这套风格」
        # 时能引用最近产物、沿用其构图配色，保持整套一致。
        recent = assets[-20:]
        imgs = [a for a in recent if a.get("kind") == "image"]
        # 最近生成（非上传）的图 = 用户「刚才那张」最可能指代的对象
        gen_imgs = [a for a in imgs if (a.get("source_tool") or "") != "upload"]
        last_gen = gen_imgs[-1] if gen_imgs else None
        n_up = sum(1 for a in imgs if (a.get("source_tool") or "") == "upload")

        def _desc(a, full=False):
            p = (a.get("prompt") or a.get("source_tool") or "").strip()
            tag = "【上传】" if (a.get("source_tool") or "") == "upload" else "【生成】"
            mark = " ⟵ 最近生成" if a is last_gen else ""
            return f"- {a['asset_label']} ({a.get('kind', 'image')}){tag}: {p[:(400 if full else 110)]}{mark}"

        lines = "\n".join(_desc(a, full=(a is last_gen)) for a in recent)
        summary = f"画布现有 {len(imgs)} 张图（{n_up} 张上传素材、{len(gen_imgs)} 张已生成）"
        if len(recent) > len(imgs):
            summary += f" + {len(recent) - len(imgs)} 个其它资产（文字层等）"
        system += (
            f"\n\n【画布感知】{summary}。清单（edit_image 的 source_asset 只能从这里选）：\n{lines}\n"
            "- 用户说「跟刚才/上一张一样风格」「再来一张/几张」「保持这套风格」时，参照【最近生成】那张"
            "（及其 prompt 描述的构图/配色/风格），沿用一致的视觉语言产出；需要在它基础上改动时用 edit_image。"
            "- 同一会话内多次生成应尽量风格协调，除非用户明确要换风格。"
        )
    if docs:
        # 用户上传的参考文档：产品信息/品牌资料优先于一般假设
        budget = 6000  # 控制上下文长度
        chunks = []
        for d in docs[-3:]:
            text = (d.get("text") or "")[: budget // max(len(docs[-3:]), 1)]
            if text.strip():
                chunks.append(f"《{d.get('filename', '文档')}》:\n{text}")
        if chunks:
            system += (
                "\n\n用户上传的参考资料（设计中的产品名/卖点/参数/品牌信息以此为准，"
                "可直接引用其中文案）：\n" + "\n---\n".join(chunks)
            )
    if brand:
        system += _brand_directive(brand)  # 已激活品牌套件 → 注入配色/字体/调性规范
    messages = [{"role": "system", "content": system}]
    for msg in (history or [])[-6:]:
        if msg.get("role") in ("user", "assistant") and isinstance(msg.get("content"), str):
            messages.append({"role": msg["role"], "content": msg["content"][:2000]})
    messages.append({"role": "user", "content": brief})

    last_error = None
    for _ in range(3):  # 校验失败回喂重试
        raw = await llm.complete(messages, json_only=True)
        try:
            plan = Plan.model_validate(_extract_json(raw))
        except (ValidationError, ValueError, json.JSONDecodeError) as exc:
            last_error = exc
            messages.append({"role": "assistant", "content": raw[:2000]})
            messages.append({"role": "user", "content": f"输出不符合 JSON 格式要求（{exc}），请重新只输出一个合法 JSON 对象。"})
            continue
        plan.nodes = plan.nodes[: settings.max_plan_nodes]
        return plan
    raise RuntimeError(f"Planner 连续 3 次输出非法 JSON: {last_error}")
