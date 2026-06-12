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
            if user is not None:
                return user
        except jwt.PyJWTError:
            pass
    if settings.auth_mode == "dev":
        return await get_or_create_dev_user(db)
    raise HTTPException(status_code=401, detail="Not authenticated")
