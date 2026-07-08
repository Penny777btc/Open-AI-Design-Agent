from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Job, SessionMessages
from app.routers.sessions import _owned_session
from app.services import job_service

router = APIRouter()


def _write_mask(session_id: str, png: bytes) -> str:
    """蒙版落盘（透明区域 = 重绘范围），返回 storage key。
    region_edit 与智能拆解的背景补洞共用此写盘 pattern（masks/{session}/{uuid}.png）。"""
    import uuid as uuidlib

    from app.services import storage

    if len(png) > 8 * 1024 * 1024:
        raise ValueError("mask too large")
    key = f"masks/{session_id}/{uuidlib.uuid4().hex[:12]}.png"
    storage.save_bytes(key, png)
    return key


async def _enqueue(db: AsyncSession, user, session_id: str, kind: str, payload: dict) -> dict:
    session = await _owned_session(db, user, session_id)

    # 幂等：同一 client_request_id 的重复提交直接返回已有 job（防双击/重放造成重复扣费）
    request_id = payload.get("client_request_id")
    if request_id:
        existing = (
            await db.execute(
                select(Job).where(Job.session_id == session_id, Job.client_request_id == request_id)
            )
        ).scalars().first()
        if existing:
            return {"job_id": existing.id, "deduplicated": True}

    message = payload.get("message") or " ".join(str(v) for v in (payload.get("inputs") or {}).values())

    # 用户消息立即落库：刷新/跨页进入时聊天历史完整（不依赖前端 PATCH）
    if message:
        row = await db.get(SessionMessages, session_id)
        user_msg = {
            "role": "user",
            "content": message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if row is None:
            db.add(SessionMessages(session_id=session_id, payload=[user_msg]))
        else:
            existing_payload = list(row.payload or [])
            if not any(m.get("role") == "user" and m.get("content") == message for m in existing_payload[-3:]):
                row.payload = existing_payload + [user_msg]

    # 首条消息自动命名会话（替代满屏 Untitled）
    if message and session.name in ("Untitled", "", None):
        session.name = message[:40]

    job = Job(
        session_id=session_id,
        user_id=user.id,
        kind=kind,
        model=payload.get("model"),
        client_request_id=request_id,
        input={k: v for k, v in payload.items() if k not in ("model", "client_request_id")},
    )
    db.add(job)
    await db.commit()
    job_service.start_job(job.id)
    return {"job_id": job.id}


from app.services.rate_limit import rate_limit

# QA P2：单条消息长度上限。规划 LLM 按 token 计费，超长输入既烧钱又容易把
# 规划器撑爆；正常设计指令远小于此，8000 字符只拦滥用不误伤。
MAX_CHAT_MESSAGE_CHARS = 8000


def _payload_has_attachments(payload: dict) -> bool:
    """判断这次 chat 请求有没有带附件/资产引用。

    前端「只发图不打字」的正常场景里 message 为空串，附件信息不在顶层字段，
    而是挂在 messages_snapshot 最后一条 user 消息的 attachments 里
    （见 CreativeCanvas.jsx sendMessage）——所以除了顶层 attachments（向前兼容），
    还要回看快照里本次发送的那条 user 消息。只看最后一条 user 消息而不是全量扫描，
    避免「历史里有附件」让本次纯空消息蒙混过关。
    """
    if payload.get("attachments"):
        return True
    for m in reversed(payload.get("messages_snapshot") or []):
        if isinstance(m, dict) and m.get("role") == "user":
            return bool(m.get("attachments"))
    return False


# 审计 R3：规划阶段调用 LLM 有真实成本，限流防刷
@router.post("/sessions/{session_id}/chat", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def chat(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    payload = await request.json()
    # QA P1：前端有拦但 API 层没校验——空/纯空格消息会入队一个永远卡在 planning、
    # 零事件的幽灵任务（规划器拿到空 brief 无从下手）。带附件但无文字是合法场景
    # （如「以这张图为基础」的默认操作），只有【既无文字又无附件】才拒。
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="消息不能为空")
    raw_message = payload.get("message")
    message = raw_message.strip() if isinstance(raw_message, str) else ""
    if not message and not _payload_has_attachments(payload):
        raise HTTPException(status_code=422, detail="消息不能为空")
    if len(message) > MAX_CHAT_MESSAGE_CHARS:
        raise HTTPException(status_code=422, detail="消息过长，请精简")
    return await _enqueue(db, user, session_id, "chat", payload)


@router.post("/sessions/{session_id}/set-template", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def set_template(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """套图：选一批产品图 + 一个模板，AI 按统一排版/字体/风格批量生成新图。

    走正常审批流（计划卡显示 N 张 + 总积分 → 用户批准 → 执行），计划由固定模板
    构造而非 AI 规划器，保证每张注入同一约束、产出一致。
    """
    from app.agents.set_templates import SET_TEMPLATES

    body = await request.json()
    template = body.get("template")
    labels = body.get("asset_labels") or []
    single_kinds = {"main6": ("电商主图六联", 6), "detail7": ("电商详情页七段", 7),
                    "social5": ("社交媒体封面五联", 5)}
    if template not in single_kinds and template not in SET_TEMPLATES:
        raise HTTPException(status_code=422, detail="未知套图模板")
    if not labels:
        raise HTTPException(status_code=422, detail="请先选择图片")
    if template in single_kinds:
        # 电商主图六联 / 详情页七段：取第一张产品图，出固定张数
        name, n = single_kinds[template]
        message = f"🛍 生成{name}（{n} 张）"
    else:
        message = f"🎨 套图 · {SET_TEMPLATES[template]['label']}（{len(labels)} 张）"
    return await _enqueue(db, user, session_id, "set_template", {
        "message": message,
        "template": template,
        "asset_labels": labels,
        "set_mode": body.get("mode") if body.get("mode") in ("editable", "layered") else "ai",
        "client_request_id": body.get("client_request_id"),
    })


@router.post("/sessions/{session_id}/split-image", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def split_image(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """AI 拆图：选中一张 AI 图，拆成『背景层 + 主体层(透明)』，叠回原位 → 可分层导出。"""
    body = await request.json()
    source = body.get("source_asset")
    if not source:
        raise HTTPException(status_code=422, detail="请先选择要拆分的图片")
    return await _enqueue(db, user, session_id, "split_image", {
        "message": "✂️ 拆成可编辑图层（背景 / 主体 / 文字）",
        "source_asset": source,
        "client_request_id": body.get("client_request_id"),
    })


@router.post("/sessions/{session_id}/region-edit", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def region_edit(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """画布局部编辑：用户已显式圈选区域并确认消耗，跳过计划审批直接执行。"""
    import base64

    from fastapi import HTTPException

    from app.config import tool_cost
    from app.services import credit_service

    payload = await request.json()
    session = await _owned_session(db, user, session_id)
    source_asset = payload.get("source_asset")
    prompt = (payload.get("prompt") or "").strip()
    mask_b64 = payload.get("mask_b64") or ""
    if not source_asset or not prompt:
        raise HTTPException(status_code=422, detail="缺少 source_asset 或 prompt")

    # 幂等
    request_id = payload.get("client_request_id")
    if request_id:
        from sqlalchemy import select

        existing = (
            await db.execute(
                select(Job).where(Job.session_id == session_id, Job.client_request_id == request_id)
            )
        ).scalars().first()
        if existing:
            return {"job_id": existing.id, "deduplicated": True}

    # 蒙版落盘（透明区域 = 重绘范围）
    mask_key = None
    if mask_b64:
        try:
            raw = base64.b64decode(mask_b64.split(",")[-1])
            mask_key = _write_mask(session_id, raw)
        except Exception:
            raise HTTPException(status_code=422, detail="蒙版数据无效")

    job = Job(
        session_id=session_id,
        user_id=user.id,
        kind="region_edit",
        client_request_id=request_id,
        input={"message": prompt, "source_asset": source_asset, "mask_key": mask_key},
    )
    db.add(job)
    await db.flush()

    # 用户显式操作：直接预扣（操作面板已展示消耗），余额不足 402
    cost = tool_cost("edit_image")
    try:
        # QA P2：memo 会在前端账单页直出，必须是中文人话而非后端行话
        await credit_service.apply(db, user.id, -cost, "reserve", job_id=job.id, memo=f"局部编辑 {source_asset}")
    except credit_service.InsufficientCredits as exc:
        await db.rollback()
        raise HTTPException(
            status_code=402,
            detail=f"积分不足：需要 {exc.required}，当前余额 {exc.balance}。请先充值。",
        )
    job.credits_reserved = cost

    # 用户消息落库（历史可见）
    message_text = f"🖌 局部修改：{prompt}"
    row = await db.get(SessionMessages, session_id)
    user_msg = {"role": "user", "content": message_text, "timestamp": datetime.now(timezone.utc).isoformat()}
    if row is None:
        db.add(SessionMessages(session_id=session_id, payload=[user_msg]))
    else:
        row.payload = list(row.payload or []) + [user_msg]
    if session.name in ("Untitled", "", None):
        session.name = message_text[:40]

    await db.commit()
    job_service.start_job(job.id)
    return {"job_id": job.id}


@router.post("/sessions/{session_id}/run-skill", dependencies=[Depends(rate_limit("chat", 20, 60))])
async def run_skill(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _enqueue(db, user, session_id, "skill", await request.json())
