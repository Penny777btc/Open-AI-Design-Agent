from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Asset
from app.routers.sessions import _owned_session
from app.services.job_service import _label_lock

router = APIRouter()


def _serialize(asset: Asset) -> dict:
    return {
        "asset_label": asset.asset_label,
        "url": asset.url,
        "kind": asset.kind,
        "model": asset.model,
        "prompt": asset.prompt,
        "source_tool": asset.source_tool,
        "canvas_x": asset.canvas_x,
        "canvas_y": asset.canvas_y,
    }


@router.get("/sessions/{session_id}/assets")
async def list_assets(session_id: str, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_session(db, user, session_id)
    rows = (
        await db.execute(select(Asset).where(Asset.session_id == session_id).order_by(Asset.created_at))
    ).scalars().all()
    return [_serialize(a) for a in rows]


@router.post("/sessions/{session_id}/assets")
async def register_asset(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_session(db, user, session_id)
    body = await request.json()
    async with _label_lock(session_id):
        count = (
            await db.execute(select(func.count()).select_from(Asset).where(Asset.session_id == session_id))
        ).scalar_one()
        asset = Asset(
            session_id=session_id,
            user_id=user.id,
            asset_label=f"asset_{count + 1}",
            url=body.get("url", ""),
            kind=body.get("kind", "image"),
            source_tool=body.get("source_tool", "upload"),
        )
        db.add(asset)
        await db.commit()
    return _serialize(asset)
