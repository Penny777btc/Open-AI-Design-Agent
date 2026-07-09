"""品牌套件（对标 Lovart Brand Kit）：每用户一份持久化的品牌规范，激活后由 planner
在生成时自动注入，让整套设计的配色/字体/调性统一。仅暴露给资源所有者。"""

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import BrandKit

router = APIRouter()

_HEX = __import__("re").compile(r"^#[0-9a-fA-F]{6}$")


def _serialize(bk: BrandKit | None) -> dict:
    if bk is None:
        return {"exists": False, "active": False}
    return {
        "exists": True,
        "name": bk.name,
        "primary_color": bk.primary_color,
        "accent_colors": bk.accent_colors or [],
        "font_hint": bk.font_hint,
        "slogan": bk.slogan,
        "logo_asset_label": bk.logo_asset_label,
        "active": bool(bk.active),
    }


def _clean_hex(v) -> str | None:
    v = (str(v or "")).strip()
    return v if _HEX.match(v) else None


@router.get("/brand-kit")
async def get_brand_kit(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    bk = (await db.execute(select(BrandKit).where(BrandKit.user_id == user.id))).scalars().first()
    return _serialize(bk)


@router.put("/brand-kit")
async def put_brand_kit(request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    """upsert 当前用户品牌套件。颜色做 #RRGGBB 校验，辅助色上限 5、文案裁剪长度。"""
    body = await request.json()
    bk = (await db.execute(select(BrandKit).where(BrandKit.user_id == user.id))).scalars().first()
    if bk is None:
        bk = BrandKit(user_id=user.id)
        db.add(bk)
    bk.name = (str(body.get("name") or "")).strip()[:80] or None
    bk.primary_color = _clean_hex(body.get("primary_color"))
    accents = body.get("accent_colors") or []
    bk.accent_colors = [c for c in (_clean_hex(x) for x in accents[:5]) if c] or None
    bk.font_hint = (str(body.get("font_hint") or "")).strip()[:80] or None
    bk.slogan = (str(body.get("slogan") or "")).strip()[:160] or None
    bk.logo_asset_label = (str(body.get("logo_asset_label") or "")).strip()[:64] or None
    bk.active = bool(body.get("active"))
    await db.commit()
    return _serialize(bk)


async def load_active_brand(db: AsyncSession, user_id: str) -> dict | None:
    """供 job_service 在生成前取「已激活」的品牌规范（未激活/不存在返回 None，不注入）。"""
    bk = (await db.execute(
        select(BrandKit).where(BrandKit.user_id == user_id, BrandKit.active.is_(True)))
    ).scalars().first()
    if bk is None:
        return None
    return {
        "name": bk.name, "primary_color": bk.primary_color,
        "accent_colors": bk.accent_colors or [], "font_hint": bk.font_hint,
        "slogan": bk.slogan, "logo_asset_label": bk.logo_asset_label,
    }
