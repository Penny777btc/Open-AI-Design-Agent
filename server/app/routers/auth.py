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
from app.services import credit_service, mail
from app.services.rate_limit import rate_limit

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


@router.post("/auth/register", dependencies=[Depends(rate_limit("register", 5, 3600))])
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


@router.post("/auth/login", dependencies=[Depends(rate_limit("login", 10, 900))])
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


class ResetRequest(BaseModel):
    email: str


class ResetConfirm(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


@router.post("/auth/request-reset", dependencies=[Depends(rate_limit("reset", 3, 3600))])
async def request_reset(body: ResetRequest, db: AsyncSession = Depends(get_db)):
    """密码找回（审计 L2）：签发 1 小时有效的重置 token 并邮件发送。"""
    user = (
        await db.execute(select(User).where(User.email == body.email.strip().lower()))
    ).scalar_one_or_none()
    # 无论邮箱是否存在都返回成功（防枚举）
    if user is not None and user.password_hash:
        token = jwt.encode(
            {"sub": user.id, "purpose": "reset", "exp": datetime.now(timezone.utc) + timedelta(hours=1)},
            settings.jwt_secret, algorithm="HS256",
        )
        link = f"{settings.public_base_url}/reset?token={token}"
        try:
            await mail.send(
                user.email, "Picsmith 密码重置",
                f"<p>点击链接重置密码（1 小时内有效）：</p><p><a href='{link}'>{link}</a></p>"
                "<p>如果不是你本人操作，请忽略此邮件。</p>",
            )
        except mail.MailNotConfigured:
            raise HTTPException(status_code=503, detail="邮件服务尚未开通，请联系支持找回密码")
    return {"ok": True}


@router.post("/auth/reset")
async def reset_password(body: ResetConfirm, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(body.token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("purpose") != "reset":
            raise jwt.PyJWTError()
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="重置链接无效或已过期")
    user = await db.get(User, payload["sub"])
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    user.password_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()
    await db.commit()
    return {"token": make_token(user.id), "user": _user_out(user)}


@router.post("/auth/send-verification")
async def send_verification(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """邮箱验证（审计 L3 软验证）：Resend 配置后启用。"""
    if user.email_verified_at:
        return {"ok": True, "already_verified": True}
    token = jwt.encode(
        {"sub": user.id, "purpose": "verify", "exp": datetime.now(timezone.utc) + timedelta(days=3)},
        settings.jwt_secret, algorithm="HS256",
    )
    link = f"{settings.public_base_url}/api/v1/auth/verify?token={token}"
    try:
        await mail.send(
            user.email, "验证你的 Picsmith 邮箱",
            f"<p>点击链接完成验证：</p><p><a href='{link}'>{link}</a></p>",
        )
    except mail.MailNotConfigured:
        raise HTTPException(status_code=503, detail="邮件服务尚未开通")
    return {"ok": True}


@router.get("/auth/verify")
async def verify_email(token: str, db: AsyncSession = Depends(get_db)):
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("purpose") != "verify":
            raise jwt.PyJWTError()
    except jwt.PyJWTError:
        raise HTTPException(status_code=400, detail="验证链接无效或已过期")
    user = await db.get(User, payload["sub"])
    if user is not None and not user.email_verified_at:
        user.email_verified_at = datetime.now(timezone.utc)
        await db.commit()
    return {"ok": True, "message": "邮箱验证成功"}


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
