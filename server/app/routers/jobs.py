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
    }


@router.get("/jobs/{job_id}/status")
async def job_status(job_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    job = await _owned_job(db, user, job_id)
    return {"status": job.status}


@router.post("/jobs/{job_id}/approve")
async def approve_job(job_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    job = await _owned_job(db, user, job_id)
    if job.status != "awaiting_approval":
        raise HTTPException(status_code=409, detail=f"Job is {job.status}, not awaiting approval")
    if not job_service.resolve_approval(job_id, approved=True):
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
