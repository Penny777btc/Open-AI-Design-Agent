from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Job, SessionMessages
from app.routers.sessions import _owned_session
from app.services import job_service

router = APIRouter()


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


@router.post("/sessions/{session_id}/chat")
async def chat(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _enqueue(db, user, session_id, "chat", await request.json())


@router.post("/sessions/{session_id}/run-skill")
async def run_skill(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await _enqueue(db, user, session_id, "skill", await request.json())
