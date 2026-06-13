"""计费：套餐 / Stripe Checkout / Webhook 入账（幂等）/ 流水查询。

Stripe 未配置（无 STRIPE_SECRET_KEY）时 checkout 返回 503，前端展示「支付通道开通中」。
不引入 Stripe SDK：Checkout 用 REST，webhook 签名手动校验（HMAC-SHA256）。
"""

import hashlib
import hmac
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_current_user, get_db
from app.models import CreditLedger, Order, Package, RedeemCode
from app.services import credit_service

router = APIRouter()

# 表为空时灌入的默认档位（首启 seed 用）。运营后续在管理后台增删改。
DEFAULT_PACKAGES = [
    {"slug": "starter", "credits": 1000, "amount_cents": 990, "label": "Starter Pack", "sort_order": 1},
    {"slug": "maker", "credits": 5000, "amount_cents": 3900, "label": "Maker Pack", "sort_order": 2},
    {"slug": "studio", "credits": 12000, "amount_cents": 7900, "label": "Studio Pack", "sort_order": 3},
]


async def seed_packages_if_empty(db: AsyncSession) -> None:
    """首次启动灌入默认套餐；已有数据则不动（管理员的改动是事实来源）。"""
    exists = (await db.execute(select(Package.id).limit(1))).first()
    if exists:
        return
    for p in DEFAULT_PACKAGES:
        db.add(Package(slug=p["slug"], label=p["label"], credits=p["credits"],
                       amount_cents=p["amount_cents"], currency="usd",
                       type="one_time", sort_order=p["sort_order"]))
    await db.commit()


def _pkg_out(p: Package) -> dict:
    # id 仍用 slug：前端与 Stripe 引用的稳定标识，套餐改价不影响历史引用
    return {"id": p.slug, "credits": p.credits, "amount_cents": p.amount_cents,
            "currency": p.currency, "label": p.label, "type": p.type,
            "billing_period": p.billing_period}


@router.get("/billing/packages")
async def packages(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Package).where(Package.active.is_(True)).order_by(Package.sort_order, Package.created_at)
    )).scalars().all()
    return {"packages": [_pkg_out(p) for p in rows], "payments_enabled": bool(settings.stripe_secret_key)}


@router.get("/billing/ledger")
async def ledger(limit: int = 30, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    rows = (
        await db.execute(
            select(CreditLedger)
            .where(CreditLedger.user_id == user.id)
            .order_by(CreditLedger.id.desc())
            .limit(min(limit, 100))
        )
    ).scalars().all()
    return [
        {
            "delta": r.delta, "kind": r.kind, "balance_after": r.balance_after,
            "memo": r.memo, "created_at": r.created_at.isoformat(),
        }
        for r in rows
    ]


@router.post("/billing/checkout")
async def checkout(request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    if not settings.stripe_secret_key:
        raise HTTPException(status_code=503, detail="支付通道开通中，敬请期待")
    body = await request.json()
    pkg = (await db.execute(
        select(Package).where(Package.slug == body.get("package_id"), Package.active.is_(True))
    )).scalars().first()
    if pkg is None:
        raise HTTPException(status_code=422, detail="Unknown package")

    order = Order(
        user_id=user.id, provider="stripe", amount_cents=pkg.amount_cents,
        currency=pkg.currency, credits=pkg.credits, status="pending",
    )
    db.add(order)
    await db.flush()

    origin = request.headers.get("origin") or settings.public_base_url
    form = {
        "mode": "payment",
        "success_url": f"{origin}/billing?paid=1",
        "cancel_url": f"{origin}/billing?canceled=1",
        "client_reference_id": order.id,
        "customer_email": user.email,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": pkg.currency,
        "line_items[0][price_data][unit_amount]": str(pkg.amount_cents),
        "line_items[0][price_data][product_data][name]": f"Picsmith {pkg.label} · {pkg.credits} credits",
        "metadata[order_id]": order.id,
        "metadata[user_id]": user.id,
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.post(
            "https://api.stripe.com/v1/checkout/sessions",
            data=form,
            auth=(settings.stripe_secret_key, ""),
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Stripe error: {resp.text[:160]}")
    session = resp.json()
    order.provider_session_id = session["id"]
    await db.commit()
    return {"checkout_url": session["url"]}


@router.post("/billing/redeem")
async def redeem_code(request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """核销兑换码：原子认领防并发重复，成功即向积分账本写一条 grant 流水。"""
    from datetime import datetime, timezone

    from sqlalchemy import update

    code = (await request.json()).get("code", "").strip().upper()
    if not code:
        raise HTTPException(status_code=400, detail="请输入兑换码")

    rc = (await db.execute(select(RedeemCode).where(RedeemCode.code == code))).scalars().first()
    if rc is None:
        raise HTTPException(status_code=404, detail="兑换码不存在")
    if rc.status == "redeemed":
        raise HTTPException(status_code=409, detail="该兑换码已被使用")
    if rc.status == "disabled":
        raise HTTPException(status_code=410, detail="该兑换码已失效")
    if rc.expires_at is not None and rc.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="该兑换码已过期")

    # 原子认领：只有把 active 改成 redeemed 的那一方算成功，杜绝同码并发双发
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(RedeemCode)
        .where(RedeemCode.id == rc.id, RedeemCode.status == "active")
        .values(status="redeemed", redeemed_by=user.id, redeemed_at=now)
    )
    if result.rowcount != 1:
        await db.rollback()
        raise HTTPException(status_code=409, detail="该兑换码已被使用")

    new_balance = await credit_service.apply(
        db, user.id, rc.credits, "grant", memo=f"兑换码 {code}", enforce=False,
    )
    await db.commit()
    return {"ok": True, "credits": rc.credits, "balance": new_balance}


def _verify_stripe_signature(payload: bytes, header: str) -> bool:
    try:
        parts = dict(item.split("=", 1) for item in header.split(","))
        timestamp, signature = parts["t"], parts["v1"]
    except Exception:
        return False
    if abs(time.time() - int(timestamp)) > 300:
        return False
    signed = f"{timestamp}.{payload.decode()}".encode()
    expected = hmac.new(settings.stripe_webhook_secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


@router.post("/billing/webhook")
async def stripe_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    # 审计 R1：webhook secret 是强制项——缺失时拒绝一切回调，杜绝伪造入账
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook secret not configured")
    payload = await request.body()
    if not _verify_stripe_signature(payload, request.headers.get("stripe-signature", "")):
        raise HTTPException(status_code=400, detail="Invalid signature")
    import json

    event = json.loads(payload)
    if event.get("type") != "checkout.session.completed":
        return {"received": True}

    session = event["data"]["object"]
    order_id = (session.get("metadata") or {}).get("order_id")
    order = await db.get(Order, order_id) if order_id else None
    if order is None:
        order = (
            await db.execute(select(Order).where(Order.provider_session_id == session.get("id")))
        ).scalars().first()
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status == "paid":
        return {"received": True, "idempotent": True}  # 重放保护

    from datetime import datetime, timezone

    order.status = "paid"
    order.paid_at = datetime.now(timezone.utc)
    await credit_service.apply(
        db, order.user_id, order.credits, "purchase",
        order_id=order.id, memo=f"purchase {order.credits} credits", enforce=False,
    )
    await db.commit()
    return {"received": True}
