from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Asset, DesignSession, SessionMessages

router = APIRouter()


@router.get("/sessions")
async def list_sessions(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    rows = (
        await db.execute(
            select(DesignSession, func.count(Asset.id))
            .outerjoin(Asset, Asset.session_id == DesignSession.id)
            .where(DesignSession.user_id == user.id, DesignSession.deleted_at.is_(None))
            .group_by(DesignSession.id)
            .order_by(DesignSession.updated_at.desc())
        )
    ).all()
    return [
        {"id": s.id, "name": s.name, "asset_count": count, "timestamp": s.created_at.isoformat()}
        for s, count in rows
    ]


@router.post("/sessions")
async def create_session(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    session = DesignSession(user_id=user.id, name="Untitled")
    db.add(session)
    await db.commit()
    return {"id": session.id}


async def _owned_session(db: AsyncSession, user, session_id: str) -> DesignSession:
    session = await db.get(DesignSession, session_id)
    if session is None or session.user_id != user.id or session.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.patch("/sessions/{session_id}")
async def rename_session(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    session = await _owned_session(db, user, session_id)
    body = await request.json()
    if name := body.get("name"):
        session.name = str(name)[:255]
    await db.commit()
    return {"id": session.id, "name": session.name}


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    from datetime import datetime, timezone

    from app.models import Job
    from app.services import job_service

    session = await _owned_session(db, user, session_id)
    session.deleted_at = datetime.now(timezone.utc)
    # 审计 L5：取消该会话所有进行中的任务（未执行节点会自动退积分）
    active = (
        await db.execute(
            select(Job.id).where(
                Job.session_id == session_id,
                Job.status.in_(["pending", "planning", "awaiting_approval", "approving", "running"]),
            )
        )
    ).scalars().all()
    for job_id in active:
        job_service.cancel_job(job_id)
    await db.commit()
    return {"ok": True}


@router.post("/sessions/{session_id}/restore")
async def restore_session(session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """撤销删除（软删除恢复，配合前端 toast 的 Undo）。"""
    session = await db.get(DesignSession, session_id)
    if session is None or session.user_id != user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    session.deleted_at = None
    await db.commit()
    return {"ok": True}


@router.get("/sessions/{session_id}/messages")
async def get_messages(session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_session(db, user, session_id)
    row = await db.get(SessionMessages, session_id)
    return row.payload if row else []


@router.patch("/sessions/{session_id}/messages")
async def save_messages(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_session(db, user, session_id)
    body = await request.json()
    messages = body.get("messages") or []
    row = await db.get(SessionMessages, session_id)
    if row is None:
        db.add(SessionMessages(session_id=session_id, payload=messages))
    else:
        row.payload = messages
    await db.commit()
    return {"ok": True}
