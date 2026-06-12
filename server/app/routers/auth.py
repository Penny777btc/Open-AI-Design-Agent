import re
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.deps import get_current_user, get_db
from app.models import User
from app.services import credit_service

router = APIRouter()

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Credentials(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    name: str | None = None


def make_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.jwt_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def _user_out(user: User, balance: int | None = None) -> dict:
    out = {"id": user.id, "email": user.email, "name": user.name, "locale": user.locale}
    if balance is not None:
        out["balance"] = balance
    return out


@router.post("/auth/register")
async def register(body: Credentials, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Invalid email address")
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="该邮箱已注册，请直接登录")

    user = User(
        email=email,
        name=body.name or email.split("@")[0],
        password_hash=bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode(),
    )
    db.add(user)
    await db.flush()
    balance = await credit_service.apply(
        db, user.id, settings.signup_grant_credits, "grant", memo="signup grant"
    )
    await db.commit()
    return {"token": make_token(user.id), "user": _user_out(user, balance)}


@router.post("/auth/login")
async def login(body: Credentials, db: AsyncSession = Depends(get_db)):
    email = body.email.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None or not user.password_hash or not bcrypt.checkpw(
        body.password.encode(), user.password_hash.encode()
    ):
        raise HTTPException(status_code=401, detail="邮箱或密码不正确")
    balance = await credit_service.get_balance(db, user.id)
    return {"token": make_token(user.id), "user": _user_out(user, balance)}


@router.get("/auth/me")
async def me(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    balance = await credit_service.get_balance(db, user.id)
    return _user_out(user, balance)


@router.post("/auth/google")
async def google_oauth(request: Request, db: AsyncSession = Depends(get_db)):
    """Google OAuth code 换 token。需配置 GOOGLE_CLIENT_ID/SECRET 后启用。"""
    if not settings.google_client_id:
        raise HTTPException(status_code=503, detail="Google 登录尚未配置")
    body = await request.json()
    code, redirect_uri = body.get("code"), body.get("redirect_uri")
    if not code:
        raise HTTPException(status_code=422, detail="Missing code")

    import httpx

    async with httpx.AsyncClient(timeout=15.0) as client:
        token_resp = await client.post("https://oauth2.googleapis.com/token", data={
            "code": code,
            "client_id": settings.google_client_id,
            "client_secret": settings.google_client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        })
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]
        info_resp = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info_resp.raise_for_status()
        info = info_resp.json()

    email = info["email"].lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        user = User(email=email, name=info.get("name"), google_id=info.get("id"))
        db.add(user)
        await db.flush()
        await credit_service.apply(db, user.id, settings.signup_grant_credits, "grant", memo="signup grant")
    elif not user.google_id:
        user.google_id = info.get("id")
    await db.commit()
    balance = await credit_service.get_balance(db, user.id)
    return {"token": make_token(user.id), "user": _user_out(user, balance)}
