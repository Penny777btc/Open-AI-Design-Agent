"""管理后台安全模型测试：404 伪装、sudo 重验、角色分级、流水+审计、封禁、下架。"""

import bcrypt
import pytest
from sqlalchemy import select

from app.db import SessionLocal
from app.models import AdminAuditLog, Asset, CreditLedger, DesignSession, User
from app.routers.auth import make_token

# client 夹具来自 conftest（带 lifespan：建表 + 轻量迁移）

SUDO_PWD = "Admin-Sudo-2026"
_HASH = bcrypt.hashpw(SUDO_PWD.encode(), bcrypt.gensalt()).decode()


async def _make_user(email: str, role: str = "user", with_password: bool = False) -> tuple[str, dict]:
    """直接造用户并签发真 JWT——绕过注册流程，只测管理面。"""
    async with SessionLocal() as db:
        user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            user = User(email=email, role=role)
            db.add(user)
        else:
            user.role = role
            user.disabled_at = None
        # sudo 校验依赖密码哈希；无密码账号在 jwt 模式下做不了敏感操作
        user.password_hash = _HASH if with_password else None
        await db.commit()
        uid = user.id
    return uid, {"Authorization": f"Bearer {make_token(uid)}"}


def _sudo(headers: dict) -> dict:
    return {**headers, "X-Sudo-Password": SUDO_PWD}


@pytest.mark.asyncio
async def test_non_admin_gets_404_mask(client):
    _, headers = await _make_user("user1@test.local")
    resp = await client.get("/api/v1/admin/metrics", headers=headers)
    # 404 而非 403：不向探测者暴露管理接口的存在
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_support_is_read_only(client):
    _, sup_h = await _make_user("support@test.local", role="support", with_password=True)
    target_id, _ = await _make_user("someone@test.local")

    assert (await client.get("/api/v1/admin/metrics", headers=sup_h)).status_code == 200
    # 变更操作即便带对密码也 404：support 没有变更面
    resp = await client.post(
        f"/api/v1/admin/users/{target_id}/credits",
        headers=_sudo(sup_h), json={"delta": 10, "memo": "support 越权尝试"},
    )
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_sudo_required_for_mutations(client):
    """jwt 模式下：敏感操作必须当场重验密码——防 token 被盗。"""
    import app.deps as deps_mod

    # conftest 是 dev 模式（无密码豁免）；这里临时切 jwt 验证完整链路
    from app.config import settings
    old_mode = settings.auth_mode
    settings.auth_mode = "jwt"
    try:
        _, admin_h = await _make_user("admin@test.local", role="admin", with_password=True)
        target_id, _ = await _make_user("victim2@test.local")

        # 不带密码 → 403
        r1 = await client.post(
            f"/api/v1/admin/users/{target_id}/credits",
            headers=admin_h, json={"delta": 10, "memo": "无 sudo 头"},
        )
        assert r1.status_code == 403
        # 带错密码 → 403
        r2 = await client.post(
            f"/api/v1/admin/users/{target_id}/credits",
            headers={**admin_h, "X-Sudo-Password": "wrong"}, json={"delta": 10, "memo": "错密码"},
        )
        assert r2.status_code == 403
        # 带对密码 → 200
        r3 = await client.post(
            f"/api/v1/admin/users/{target_id}/credits",
            headers=_sudo(admin_h), json={"delta": 10, "memo": "客服补偿"},
        )
        assert r3.status_code == 200 and r3.json()["balance"] == 10
    finally:
        settings.auth_mode = old_mode


@pytest.mark.asyncio
async def test_admin_adjust_credits_writes_ledger_and_audit(client):
    admin_id, admin_h = await _make_user("admin@test.local", role="admin", with_password=True)
    target_id, _ = await _make_user("victim@test.local")

    resp = await client.post(
        f"/api/v1/admin/users/{target_id}/credits",
        headers=_sudo(admin_h), json={"delta": 50, "memo": "客服补偿：生成失败争议"},
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
                AdminAuditLog.admin_id == admin_id,
                AdminAuditLog.action == "adjust_credits",
                AdminAuditLog.target_user_id == target_id,  # 同 admin 在别的用例也有调账记录
            )
        )).scalars().first()
        assert log is not None and "delta=50" in (log.detail or "")


@pytest.mark.asyncio
async def test_ban_takes_effect_immediately_and_unban_restores(client):
    _, admin_h = await _make_user("admin@test.local", role="admin", with_password=True)
    target_id, target_h = await _make_user("banme@test.local")

    # 封禁前：持 token 正常访问
    assert (await client.get("/api/v1/auth/me", headers=target_h)).status_code == 200

    resp = await client.post(f"/api/v1/admin/users/{target_id}/ban", headers=_sudo(admin_h))
    assert resp.status_code == 200
    # 已有 token 立即失效（鉴权层拦截，无需等过期）
    assert (await client.get("/api/v1/auth/me", headers=target_h)).status_code == 403

    resp = await client.post(f"/api/v1/admin/users/{target_id}/unban", headers=_sudo(admin_h))
    assert resp.status_code == 200
    assert (await client.get("/api/v1/auth/me", headers=target_h)).status_code == 200


@pytest.mark.asyncio
async def test_admin_cannot_ban_self_or_admin(client):
    admin_id, admin_h = await _make_user("admin@test.local", role="admin", with_password=True)
    admin2_id, _ = await _make_user("admin2@test.local", role="admin")

    assert (await client.post(f"/api/v1/admin/users/{admin_id}/ban", headers=_sudo(admin_h))).status_code == 400
    assert (await client.post(f"/api/v1/admin/users/{admin2_id}/ban", headers=_sudo(admin_h))).status_code == 400


@pytest.mark.asyncio
async def test_takedown_asset_removes_row_and_audits(client):
    admin_id, admin_h = await _make_user("admin@test.local", role="admin", with_password=True)
    target_id, _ = await _make_user("creator@test.local")
    async with SessionLocal() as db:
        sess = DesignSession(user_id=target_id, name="t")
        db.add(sess)
        await db.flush()
        asset = Asset(
            session_id=sess.id, user_id=target_id, asset_label="asset_1",
            url="http://x/files/a.png", storage_key="assets/x/a.png", kind="image",
        )
        db.add(asset)
        await db.commit()
        asset_id = asset.id

    resp = await client.delete(f"/api/v1/admin/assets/{asset_id}", headers=_sudo(admin_h))
    assert resp.status_code == 200
    async with SessionLocal() as db:
        assert await db.get(Asset, asset_id) is None
        log = (await db.execute(
            select(AdminAuditLog).where(AdminAuditLog.action == "takedown_asset")
        )).scalars().first()
        assert log is not None and log.target_user_id == target_id


@pytest.mark.asyncio
async def test_quota_override_and_timeseries_shape(client):
    _, admin_h = await _make_user("admin@test.local", role="admin", with_password=True)
    target_id, _ = await _make_user("bigclient@test.local")

    resp = await client.patch(
        f"/api/v1/admin/users/{target_id}/quota",
        headers=_sudo(admin_h), json={"doc_daily_limit": 100},
    )
    assert resp.status_code == 200 and resp.json()["doc_daily_limit"] == 100

    ts = await client.get("/api/v1/admin/metrics/timeseries?days=7", headers=admin_h)
    assert ts.status_code == 200
    days = ts.json()
    assert len(days) == 7 and {"date", "signups", "credits_consumed", "revenue_cents"} <= set(days[0])
