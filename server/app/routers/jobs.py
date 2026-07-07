from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Job, JobEvent
from app.services import job_service

router = APIRouter()


async def _owned_job(db: AsyncSession, user, job_id: str) -> Job:
    job = await db.get(Job, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/jobs/{job_id}/events")
async def job_events(job_id: str, since: int = 0, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    job = await _owned_job(db, user, job_id)
    rows = (
        await db.execute(
            select(JobEvent).where(JobEvent.job_id == job_id, JobEvent.id > since).order_by(JobEvent.id)
        )
    ).scalars().all()
    return {
        "events": [
            {"id": str(ev.id), "job_id": job_id, "type": ev.type, "payload": ev.payload} for ev in rows
        ],
        "cursor": rows[-1].id if rows else since,
        "done": job.status in Job.TERMINAL,
        "approved": job.approved,
        # 前端失速保护需要区分「等待用户批准」和「真失速」：待批准期没有新事件是正常的，
        # 不该触发 6 分钟死气超时（否则批准后没人消费事件，结果永远进不了聊天流）
        "status": job.status,
    }


@router.get("/jobs/{job_id}/status")
async def job_status(job_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    job = await _owned_job(db, user, job_id)
    return {"status": job.status}


@router.post("/jobs/{job_id}/approve")
async def approve_job(job_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    from app.config import node_cost
    from app.services import credit_service

    job = await _owned_job(db, user, job_id)
    if job.status != "awaiting_approval":
        raise HTTPException(status_code=409, detail=f"Job is {job.status}, not awaiting approval")

    # 审计 L4：原子抢占状态，双击/并发只有一个请求能进入预扣
    from sqlalchemy import update

    claimed = await db.execute(
        update(Job)
        .where(Job.id == job_id, Job.status == "awaiting_approval")
        .values(status="approving")
    )
    await db.commit()
    if claimed.rowcount == 0:
        raise HTTPException(status_code=409, detail="该计划已在处理中")

    async def revert_claim():
        await db.execute(
            update(Job).where(Job.id == job_id, Job.status == "approving").values(status="awaiting_approval")
        )
        await db.commit()

    # 整单预扣：余额不足直接拒绝（402），状态还原以便充值后重试
    total = sum(node_cost(n) for n in (job.plan or {}).get("nodes", []))
    if total > 0:
        try:
            await credit_service.apply(
                db, user.id, -total, "reserve", job_id=job_id, memo=f"reserve {total} for plan"
            )
        except credit_service.InsufficientCredits as exc:
            await revert_claim()
            raise HTTPException(
                status_code=402,
                detail=f"积分不足：需要 {exc.required}，当前余额 {exc.balance}。请先充值。",
            )
        job.credits_reserved = total
        await db.commit()

    if not job_service.resolve_approval(job_id, approved=True):
        # 运行时丢失：退预扣并还原状态
        if total > 0:
            await credit_service.apply(db, user.id, total, "refund", job_id=job_id, memo="runtime lost", enforce=False)
            await db.commit()
        await revert_claim()
        raise HTTPException(status_code=410, detail="Job runtime lost (server restarted); please retry the request")
    return {"ok": True}


@router.post("/jobs/{job_id}/reject")
async def reject_job(job_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_job(db, user, job_id)
    job_service.resolve_approval(job_id, approved=False)
    return {"ok": True}


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_job(db, user, job_id)
    job_service.cancel_job(job_id)
    return {"ok": True}


@router.get("/sessions/{session_id}/jobs")
async def session_jobs(session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    rows = (
        await db.execute(
            select(Job).where(Job.session_id == session_id, Job.user_id == user.id).order_by(Job.created_at.desc()).limit(20)
        )
    ).scalars().all()
    return [{"id": j.id, "status": j.status, "created_at": j.created_at.isoformat()} for j in rows]
