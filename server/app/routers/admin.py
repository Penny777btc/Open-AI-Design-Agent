"""管理员后台 API：用户/积分/封禁/订单/指标/审计日志。

安全模型：
- 入口统一挂 get_current_admin，非 admin 一律 404（不暴露存在）
- admin 角色只能由部署者经 ADMIN_EMAILS 环境变量授予，无自助升级接口
- 一切积分变更走 credit_ledger 流水（kind=adjust），余额铁律不破
- 全部写操作落 AdminAuditLog，谁动了谁必须可追溯
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_admin, get_db
from app.models import AdminAuditLog, Asset, CreditLedger, Job, Order, UploadedFile, User
from app.services import credit_service

router = APIRouter(prefix="/admin", dependencies=[Depends(get_current_admin)])


def _user_row(u: User, balance: int | None = None) -> dict:
    return {
        "id": u.id, "email": u.email, "name": u.name, "role": u.role,
        "email_verified": u.email_verified_at is not None,
        "disabled_at": u.disabled_at.isoformat() if u.disabled_at else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
        **({"balance": balance} if balance is not None else {}),
    }


@router.get("/metrics")
async def metrics(db: AsyncSession = Depends(get_db)):
    """核心经营指标。单条聚合查询逐个跑：SQLite 下都是毫秒级，可读性优先。"""
    now = datetime.now(timezone.utc)
    day_ago, week_ago = now - timedelta(days=1), now - timedelta(days=7)

    async def count(stmt) -> int:
        return (await db.execute(stmt)).scalar_one() or 0

    jobs_24h = dict(
        (await db.execute(
            select(Job.status, func.count()).where(Job.created_at >= day_ago).group_by(Job.status)
        )).all()
    )
    return {
        "users_total": await count(select(func.count()).select_from(User)),
        "users_new_7d": await count(select(func.count()).select_from(User).where(User.created_at >= week_ago)),
        "assets_total": await count(select(func.count()).select_from(Asset)),
        "jobs_24h": jobs_24h,
        # 消耗 = settle/reserve 净扣减绝对值；只统计负向流水避免把退款算成消耗
        "credits_consumed_24h": -(await count(
            select(func.coalesce(func.sum(CreditLedger.delta), 0)).where(
                CreditLedger.created_at >= day_ago, CreditLedger.delta < 0
            )
        )),
        "revenue_cents_total": await count(
            select(func.coalesce(func.sum(Order.amount_cents), 0)).where(Order.status == "paid")
        ),
        "orders_paid_total": await count(select(func.count()).select_from(Order).where(Order.status == "paid")),
        "storage_bytes_total": await count(select(func.coalesce(func.sum(UploadedFile.size), 0))),
    }


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    query: str = "",
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    stmt = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
    if query.strip():
        like = f"%{query.strip()}%"
        stmt = stmt.where(User.email.like(like) | User.name.like(like) | (User.id == query.strip()))
    users = (await db.execute(stmt)).scalars().all()
    rows = []
    for u in users:
        rows.append(_user_row(u, await credit_service.get_balance(db, u.id)))
    return rows


@router.get("/users/{user_id}")
async def user_detail(user_id: str, db: AsyncSession = Depends(get_db)):
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    balance = await credit_service.get_balance(db, user_id)
    ledger = (await db.execute(
        select(CreditLedger).where(CreditLedger.user_id == user_id)
        .order_by(CreditLedger.id.desc()).limit(30)
    )).scalars().all()
    jobs = (await db.execute(
        select(Job).where(Job.user_id == user_id).order_by(Job.created_at.desc()).limit(20)
    )).scalars().all()
    orders = (await db.execute(
        select(Order).where(Order.user_id == user_id).order_by(Order.created_at.desc()).limit(20)
    )).scalars().all()
    storage = (await db.execute(
        select(func.coalesce(func.sum(UploadedFile.size), 0)).where(UploadedFile.user_id == user_id)
    )).scalar_one()
    return {
        **_user_row(u, balance),
        "storage_bytes": storage,
        "ledger": [
            {"id": l.id, "delta": l.delta, "kind": l.kind, "balance_after": l.balance_after,
             "memo": l.memo, "job_id": l.job_id, "created_at": l.created_at.isoformat()}
            for l in ledger
        ],
        "jobs": [
            {"id": j.id, "kind": j.kind, "status": j.status, "created_at": j.created_at.isoformat()}
            for j in jobs
        ],
        "orders": [
            {"id": o.id, "amount_cents": o.amount_cents, "credits": o.credits,
             "status": o.status, "created_at": o.created_at.isoformat()}
            for o in orders
        ],
    }


class CreditAdjust(BaseModel):
    delta: int = Field(..., ge=-100_000, le=100_000)
    memo: str = Field(..., min_length=2, max_length=200)  # 强制写原因——审计的最低要求


@router.post("/users/{user_id}/credits")
async def adjust_credits(
    user_id: str, body: CreditAdjust,
    db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_admin),
):
    if body.delta == 0:
        raise HTTPException(status_code=400, detail="delta 不能为 0")
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    # 扣减不强制余额非负：客服纠错场景可能需要把错误入账扣回去
    new_balance = await credit_service.apply(
        db, user_id, body.delta, "adjust",
        memo=f"[admin {admin.email}] {body.memo}", enforce=False,
    )
    db.add(AdminAuditLog(
        admin_id=admin.id, action="adjust_credits", target_user_id=user_id,
        detail=f"delta={body.delta} memo={body.memo}",
    ))
    await db.commit()
    return {"ok": True, "balance": new_balance}


@router.post("/users/{user_id}/ban")
async def ban_user(
    user_id: str, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_admin)
):
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if u.id == admin.id:
        raise HTTPException(status_code=400, detail="不能封禁自己")
    if u.role == "admin":
        raise HTTPException(status_code=400, detail="不能封禁管理员（先在 ADMIN_EMAILS 中移除）")
    u.disabled_at = datetime.now(timezone.utc)
    db.add(AdminAuditLog(admin_id=admin.id, action="ban", target_user_id=user_id))
    await db.commit()
    return {"ok": True, "disabled_at": u.disabled_at.isoformat()}


@router.post("/users/{user_id}/unban")
async def unban_user(
    user_id: str, db: AsyncSession = Depends(get_db), admin: User = Depends(get_current_admin)
):
    u = await db.get(User, user_id)
    if u is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    u.disabled_at = None
    db.add(AdminAuditLog(admin_id=admin.id, action="unban", target_user_id=user_id))
    await db.commit()
    return {"ok": True}


@router.get("/orders")
async def list_orders(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    rows = (await db.execute(
        select(Order, User.email).join(User, User.id == Order.user_id)
        .order_by(Order.created_at.desc()).limit(limit).offset(offset)
    )).all()
    return [
        {"id": o.id, "user_email": email, "amount_cents": o.amount_cents, "currency": o.currency,
         "credits": o.credits, "status": o.status, "provider": o.provider,
         "paid_at": o.paid_at.isoformat() if o.paid_at else None,
         "created_at": o.created_at.isoformat()}
        for o, email in rows
    ]


@router.get("/assets/recent")
async def recent_assets(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(60, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """内容巡查：最近生成的图片（带归属用户与提示词）。"""
    rows = (await db.execute(
        select(Asset, User.email).join(User, User.id == Asset.user_id)
        .where(Asset.kind == "image")
        .order_by(Asset.created_at.desc()).limit(limit).offset(offset)
    )).all()
    return [
        {"id": a.id, "url": a.url, "user_email": email, "prompt": (a.prompt or "")[:200],
         "source_tool": a.source_tool, "session_id": a.session_id,
         "created_at": a.created_at.isoformat()}
        for a, email in rows
    ]


@router.get("/audit-logs")
async def audit_logs(
    db: AsyncSession = Depends(get_db),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
):
    rows = (await db.execute(
        select(AdminAuditLog, User.email).join(User, User.id == AdminAuditLog.admin_id)
        .order_by(AdminAuditLog.id.desc()).limit(limit).offset(offset)
    )).all()
    return [
        {"id": log.id, "admin_email": email, "action": log.action,
         "target_user_id": log.target_user_id, "detail": log.detail,
         "created_at": log.created_at.isoformat()}
        for log, email in rows
    ]
