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
1. generate_image —— 全新生成。args: {"prompt": "<英文提示词，具体、含风格/构图/配色/文字内容>", "aspect_ratio": "1:1|16:9|9:16|4:3"}
2. edit_image —— 修改已有图片（改色调/换背景/加文字/局部调整/风格迁移）。args: {"prompt": "<英文编辑指令，描述要改什么、保留什么>", "source_asset": "asset_N"}
3. generate_video —— 生成短视频（电商短视频/商品展示）。args: {"prompt": "<英文，描述画面/运镜/时长内容>", "seconds": <时长秒数，3-10>, "model": "seedance-2-480p|seedance-2-720p", "resolution": "480p|720p"}。仅当用户明确要「视频/短视频/动态」时使用；视频按秒计费，默认 5 秒、480p

输出格式：
{"mode": "plan", "title": "<计划标题，用户的语言>", "nodes": [{"id": "node_1", "tool": "generate_image|edit_image", "label": "<这一步做什么，用户的语言>", "args": {...}, "depends": []}], "notes": ["<给用户的说明>"]}

规则：
- 用户明确数量时严格遵守数量（说 5 张就是 5 个节点），未明确时 2-4 个节点；节点上限 {max_nodes} 个
- prompt 必须是英文且各节点差异化；图中需要渲染的文字（品牌名/标语/价格）原样写进 prompt 并标注 render the text exactly
- 用户提到"改/换/调整某张图"且上下文有可用资产时，必须用 edit_image 并正确填 source_asset；不要重新生成
- 为真实产品做主图/海报/详情页/营销图时，若资产列表中有该产品的实拍图（标注「产品图：…」），必须用 edit_image 以那张产品图为 source_asset，在保留产品本体外观（瓶型/包装/标签/配色）完全一致的前提下重构背景、场景、排版和文字；禁止 generate_image 凭空虚构产品外观。多个产品各选对应的那张图
- 【人物身份锁】源图含真人时，edit_image 的 prompt 必须显式包含身份保持指令，例如 "CRITICAL: preserve the person's face, facial features, hairstyle and body proportions EXACTLY as in the source photo — do NOT redraw, stylize or alter the face in any way"；人物应保持为照片写实质感（哪怕背景/排版是插画风），并尽量让人物在构图中占比足够大（人物越小脸部越易漂移）。同时在 args 里加 "has_person": true
- 【人物模式 person_mode】含真人的 edit_image 还须在 args 里加 "person_mode"，二选一：
  · 默认 "lock"（锁人物合成）——绝大多数情况用它：系统会本地抠出人物原始像素(零变形) + AI 只生成背景/排版 + 合成，人脸/身材 100% 不动。凡是「换背景/加海报排版/做封面/合成到场景/加文字」这类"人不变、只改人周围"的需求，一律 person_mode:"lock"。
  · 仅当用户**明确要求把人物本身画进画面/风格化/画成插画/改造人物外观**（如"把他画成动漫风""让她的服装变成…""把人物融进油画质感"）时才用 "fuse"——此时才允许扩散模型重绘人物。拿不准就用 "lock"。
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


async def make_plan(
    brief: str,
    history: list[dict] | None = None,
    assets: list[dict] | None = None,
    docs: list[dict] | None = None,
) -> Plan:
    llm = get_llm()
    system = SYSTEM_PROMPT.replace("{max_nodes}", str(settings.max_plan_nodes))
    if assets:
        lines = "\n".join(
            f"- {a['asset_label']} ({a.get('kind', 'image')}): {(a.get('prompt') or a.get('source_tool') or '')[:120]}"
            for a in assets[-20:]
        )
        system += f"\n\n当前会话已有资产（edit_image 的 source_asset 只能从这里选）：\n{lines}"
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
