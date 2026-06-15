from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Asset, DesignSession, SessionMessages

router = APIRouter()


@router.get("/sessions")
async def list_sessions(
    # 分页参数：防止重度用户会话数无限增长拖慢页面。
    # 默认值 limit=200/offset=0 保证现有前端不改动也能正常工作（历史行为兼容）。
    # limit 上限 500 防止恶意大值一次拉爆数据库。
    limit: int = Query(default=200, ge=1, le=500, description="每页最多返回条数"),
    offset: int = Query(default=0, ge=0, description="跳过前 N 条（用于翻页）"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    rows = (
        await db.execute(
            select(DesignSession, func.count(Asset.id))
            .outerjoin(Asset, Asset.session_id == DesignSession.id)
            .where(DesignSession.user_id == user.id, DesignSession.deleted_at.is_(None))
            .group_by(DesignSession.id)
            .order_by(DesignSession.updated_at.desc())
            # 服务端分页：先 offset 再 limit，顺序不能反（SQLAlchemy 会正确生成 LIMIT/OFFSET）
            .offset(offset)
            .limit(limit)
        )
    ).all()

    # 缩略图随列表一次性带回（消除前端「每个会话再发一次 assets 请求」的 N+1 瀑布）。
    # 单条查询取这批会话的图片资产，按会话分组、每组保留前 4 张。
    session_ids = [s.id for s, _ in rows]
    thumbs: dict[str, list[dict]] = {sid: [] for sid in session_ids}
    if session_ids:
        asset_rows = (
            await db.execute(
                select(Asset.session_id, Asset.url, Asset.kind)
                .where(Asset.session_id.in_(session_ids), Asset.kind == "image")
                .order_by(Asset.created_at)
            )
        ).all()
        for sid, url, kind in asset_rows:
            bucket = thumbs.get(sid)
            if bucket is not None and len(bucket) < 4:
                bucket.append({"url": url, "kind": kind})

    # 响应仍是纯数组，不包 envelope，前端直接 .map 不受影响
    return [
        {
            "id": s.id, "name": s.name, "asset_count": count,
            "timestamp": s.created_at.isoformat(), "thumbnails": thumbs.get(s.id, []),
        }
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
