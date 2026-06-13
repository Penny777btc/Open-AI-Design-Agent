"""管理后台安全模型测试：404 伪装、积分流水+审计、封禁即时生效。"""

import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AdminAuditLog, CreditLedger, User
from app.routers.auth import make_token

# client 夹具来自 conftest（带 lifespan：建表 + 轻量迁移）


async def _make_user(email: str, role: str = "user") -> tuple[str, dict]:
    """直接造用户并签发真 JWT——绕过注册流程，只测管理面。"""
    async with SessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            user = User(email=email, role=role)
            db.add(user)
        else:
            user.role = role
            user.disabled_at = None
        await db.commit()
        uid = user.id
    return uid, {"Authorization": f"Bearer {make_token(uid)}"}


@pytest.mark.asyncio
async def test_non_admin_gets_404_mask(client):
    _, headers = await _make_user("user1@test.local")
    resp = await client.get("/api/v1/admin/metrics", headers=headers)
    # 404 而非 403：不向探测者暴露管理接口的存在
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_admin_adjust_credits_writes_ledger_and_audit(client):
    admin_id, admin_h = await _make_user("admin@test.local", role="admin")
    target_id, _ = await _make_user("victim@test.local")

    resp = await client.post(
        f"/api/v1/admin/users/{target_id}/credits",
        headers=admin_h, json={"delta": 50, "memo": "客服补偿：生成失败争议"},
    )
    assert resp.status_code == 200
    assert resp.json()["balance"] == 50

    async with SessionLocal() as db:
        row = (await db.execute(
            select(CreditLedger).where(CreditLedger.user_id == target_id, CreditLedger.kind == "adjust")
        )).scalar_one()
        assert row.delta == 50 and "admin@test.local" in (row.memo or "")
        log = (await db.execute(
            select(AdminAuditLog).where(
                AdminAuditLog.admin_id == admin_id, AdminAuditLog.action == "adjust_credits"
            )
        )).scalars().first()
        assert log is not None and log.target_user_id == target_id


@pytest.mark.asyncio
async def test_ban_takes_effect_immediately_and_unban_restores(client):
    _, admin_h = await _make_user("admin@test.local", role="admin")
    target_id, target_h = await _make_user("banme@test.local")

    # 封禁前：持 token 正常访问
    assert (await client.get("/api/v1/auth/me", headers=target_h)).status_code == 200

    resp = await client.post(f"/api/v1/admin/users/{target_id}/ban", headers=admin_h)
    assert resp.status_code == 200
    # 已有 token 立即失效（鉴权层拦截，无需等过期）
    assert (await client.get("/api/v1/auth/me", headers=target_h)).status_code == 403

    resp = await client.post(f"/api/v1/admin/users/{target_id}/unban", headers=admin_h)
    assert resp.status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=target_h)).status_code == 200


@pytest.mark.asyncio
async def test_admin_cannot_ban_self_or_admin(client):
    admin_id, admin_h = await _make_user("admin@test.local", role="admin")
    admin2_id, _ = await _make_user("admin2@test.local", role="admin")

    assert (await client.post(f"/api/v1/admin/users/{admin_id}/ban", headers=admin_h)).status_code == 400
    assert (await client.post(f"/api/v1/admin/users/{admin2_id}/ban", headers=admin_h)).status_code == 400
