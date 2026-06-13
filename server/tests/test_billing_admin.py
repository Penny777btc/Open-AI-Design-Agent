"""积分充值后台测试：套餐 CRUD、兑换码生成/核销/防重、手动补单。"""

import bcrypt
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Order, Package, RedeemCode, User
from app.routers.auth import make_token

SUDO_PWD = "Admin-Sudo-2026"
_HASH = bcrypt.hashpw(SUDO_PWD.encode(), bcrypt.gensalt()).decode()


async def _user(email: str, role: str = "user") -> tuple[str, dict]:
    async with SessionLocal() as db:
        u = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if u is None:
            u = User(email=email, role=role)
            db.add(u)
        else:
            u.role = role
        u.password_hash = _HASH if role == "admin" else None
        await db.commit()
        uid = u.id
    return uid, {"Authorization": f"Bearer {make_token(uid)}"}


def _sudo(h: dict) -> dict:
    return {**h, "X-Sudo-Password": SUDO_PWD}


@pytest.mark.asyncio
async def test_packages_seeded_and_public_list(client):
    """启动 seed 灌入默认三档，公开接口可读。"""
    resp = await client.get("/api/v1/billing/packages")
    assert resp.status_code == 200
    pkgs = resp.json()["packages"]
    assert len(pkgs) >= 3
    assert {p["id"] for p in pkgs} >= {"starter", "maker", "studio"}
    assert all("credits" in p and "amount_cents" in p for p in pkgs)


@pytest.mark.asyncio
async def test_package_crud(client):
    _, admin_h = await _user("admin@test.local", role="admin")
    r = await client.post("/api/v1/admin/packages", headers=_sudo(admin_h), json={
        "slug": "promo", "label": "Promo", "credits": 3000, "amount_cents": 1990, "sort_order": 9,
    })
    assert r.status_code == 200
    pid = r.json()["id"]
    r = await client.patch(f"/api/v1/admin/packages/{pid}", headers=_sudo(admin_h), json={"amount_cents": 1490})
    assert r.status_code == 200 and r.json()["amount_cents"] == 1490
    assert (await client.delete(f"/api/v1/admin/packages/{pid}", headers=_sudo(admin_h))).status_code == 200
    pub = (await client.get("/api/v1/billing/packages")).json()["packages"]
    assert "promo" not in {p["id"] for p in pub}


@pytest.mark.asyncio
async def test_redeem_code_generate_and_consume(client):
    _, admin_h = await _user("admin@test.local", role="admin")
    uid, user_h = await _user("redeemer@test.local")
    r = await client.post("/api/v1/admin/redeem-codes", headers=_sudo(admin_h),
                          json={"count": 3, "credits": 500, "batch": "launch"})
    assert r.status_code == 200
    codes = r.json()["codes"]
    assert len(codes) == 3 and all(c.startswith("PIC-") for c in codes)
    r = await client.post("/api/v1/billing/redeem", headers=user_h, json={"code": codes[0]})
    assert r.status_code == 200 and r.json()["credits"] == 500 and r.json()["balance"] == 500
    # 重复核销 → 409
    assert (await client.post("/api/v1/billing/redeem", headers=user_h, json={"code": codes[0]})).status_code == 409
    # 不存在码 → 404
    assert (await client.post("/api/v1/billing/redeem", headers=user_h, json={"code": "PIC-NO-SUCH-CODE"})).status_code == 404


@pytest.mark.asyncio
async def test_redeem_disabled_code_rejected(client):
    _, admin_h = await _user("admin@test.local", role="admin")
    uid, user_h = await _user("u2@test.local")
    r = await client.post("/api/v1/admin/redeem-codes", headers=_sudo(admin_h), json={"count": 1, "credits": 100})
    code = r.json()["codes"][0]
    async with SessionLocal() as db:
        rc = (await db.execute(select(RedeemCode).where(RedeemCode.code == code))).scalar_one()
        cid = rc.id
    assert (await client.post(f"/api/v1/admin/redeem-codes/{cid}/disable", headers=_sudo(admin_h))).status_code == 200
    assert (await client.post("/api/v1/billing/redeem", headers=user_h, json={"code": code})).status_code == 410


@pytest.mark.asyncio
async def test_mark_order_paid_credits_and_idempotent(client):
    _, admin_h = await _user("admin@test.local", role="admin")
    uid, _ = await _user("buyer@test.local")
    async with SessionLocal() as db:
        order = Order(user_id=uid, provider="manual", amount_cents=3900, currency="usd", credits=5000, status="pending")
        db.add(order)
        await db.commit()
        oid = order.id
    r = await client.post(f"/api/v1/admin/orders/{oid}/mark-paid", headers=_sudo(admin_h))
    assert r.status_code == 200 and r.json()["status"] == "paid"
    from app.services import credit_service
    async with SessionLocal() as db:
        assert await credit_service.get_balance(db, uid) == 5000
    r2 = await client.post(f"/api/v1/admin/orders/{oid}/mark-paid", headers=_sudo(admin_h))
    assert r2.json().get("idempotent") is True
    async with SessionLocal() as db:
        assert await credit_service.get_balance(db, uid) == 5000


@pytest.mark.asyncio
async def test_redeem_generation_requires_sudo(client):
    """生成兑换码等于发钱，必须 sudo。"""
    from app.config import settings
    old = settings.auth_mode
    settings.auth_mode = "jwt"
    try:
        _, admin_h = await _user("admin@test.local", role="admin")
        r = await client.post("/api/v1/admin/redeem-codes", headers=admin_h, json={"count": 1, "credits": 100})
        assert r.status_code == 403
    finally:
        settings.auth_mode = old
