from fastapi import Depends
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


# M1 单用户：所有请求归属 dev 用户。M2 换成 JWT 解析。
async def get_current_user(db: AsyncSession = Depends(get_db)) -> User:
    return await get_or_create_dev_user(db)
