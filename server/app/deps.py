import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import SessionLocal
from app.models import CreditLedger, User


async def get_db():
    async with SessionLocal() as db:
        yield db


async def get_or_create_dev_user(db: AsyncSession) -> User:
    user = (
        await db.execute(select(User).where(User.email == settings.dev_user_email))
    ).scalar_one_or_none()
    if user is None:
        try:
            user = User(email=settings.dev_user_email, name="Dev")
            db.add(user)
            await db.flush()
            db.add(
                CreditLedger(
                    user_id=user.id,
                    delta=settings.signup_grant_credits,
                    kind="grant",
                    balance_after=settings.signup_grant_credits,
                    memo="signup grant",
                )
            )
            await db.commit()
        except IntegrityError:
            # 并行请求同时初始化（如首页三个并发 fetch）：输掉竞态的一方改读已有记录
            await db.rollback()
            user = (
                await db.execute(select(User).where(User.email == settings.dev_user_email))
            ).scalar_one()
    return user


async def get_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
    """JWT 鉴权；AUTH_MODE=dev 时无 token 回落到 dev 用户（本地调试）。"""
    auth = request.headers.get("Authorization", "")
    token = auth.removeprefix("Bearer ").strip()
    if token:
        try:
            payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
            user = await db.get(User, payload.get("sub", ""))
        except jwt.PyJWTError:
            user = None
        if user is not None:
            # 封禁在鉴权层统一生效：被禁账号即便持有效 token 也立即失效
            if user.disabled_at is not None:
                raise HTTPException(status_code=403, detail="账号已被停用，如有疑问请联系 support@picsmith.app")
            return user
    if settings.auth_mode == "dev":
        return await get_or_create_dev_user(db)
    raise HTTPException(status_code=401, detail="Not authenticated")


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    """管理台只读门卫：admin 可全权、support 只读。其余角色一律 404，不暴露接口存在。"""
    if user.role not in ("admin", "support"):
        raise HTTPException(status_code=404, detail="Not Found")
    return user


async def get_sudo_admin(request: Request, user: User = Depends(get_current_user)) -> User:
    """敏感变更门卫（调积分/封禁/下架/退款）：admin 角色 + 当场重验密码。

    防御目标是「token 被盗」：盗 token 者拿不到密码就改不了任何东西。
    密码经 X-Sudo-Password 头传递（HTTPS 下与登录表单等价），并限速防爆破。
    AUTH_MODE=dev 且账号无密码时放行（本地调试唯一豁免）。
    """
    import bcrypt

    from app.services.rate_limit import _check

    if user.role != "admin":
        raise HTTPException(status_code=404, detail="Not Found")
    if settings.auth_mode == "dev" and not user.password_hash:
        return user
    _check(f"sudo:{user.id}", 10, 300, detail="密码验证尝试过于频繁，请 5 分钟后再试")
    password = request.headers.get("X-Sudo-Password", "")
    if not password or not user.password_hash or not bcrypt.checkpw(
        password.encode(), user.password_hash.encode()
    ):
        raise HTTPException(status_code=403, detail="敏感操作需要重新验证密码")
    return user
