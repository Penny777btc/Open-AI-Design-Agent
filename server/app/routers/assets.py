from fastapi import APIRouter, Depends, Query, Request
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
        "z_index": asset.z_index,
        "split_role": asset.split_role,
        "split_label": asset.split_label,
    }


@router.get("/sessions/{session_id}/assets")
async def list_assets(
    session_id: str,
    # 分页参数：单会话资产理论上可达几百张，默认 500 保持现有前端零改动，
    # 上限同样 500 防止恶意请求一次拉取过多文件元数据。
    limit: int = Query(default=500, ge=1, le=500, description="每页最多返回条数"),
    offset: int = Query(default=0, ge=0, description="跳过前 N 条（用于翻页）"),
    db: AsyncSession = Depends(get_db),
    user=Depends(get_current_user),
):
    await _owned_session(db, user, session_id)
    rows = (
        await db.execute(
            select(Asset)
            .where(Asset.session_id == session_id)
            # 保持原有按创建时间升序排列，新图追加在末尾，画布重建时顺序一致
            .order_by(Asset.created_at)
            .offset(offset)
            .limit(limit)
        )
    ).scalars().all()
    # 响应仍是纯数组，不包 envelope，前端直接 .map 不受影响
    return [_serialize(a) for a in rows]


@router.post("/sessions/{session_id}/assets")
async def register_asset(session_id: str, request: Request, db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    await _owned_session(db, user, session_id)
    body = await request.json()
    # URL 扩展名校验：阻止非媒体资源注册为画布资产
    from fastapi import HTTPException

    url = str(body.get("url", ""))
    # SSRF 防护（注册期，纵深）：外部 URL（非本站）必须解析到公网，拒绝内网/回环/云元数据地址
    from app.config import settings as _cfg

    if url.startswith(("http://", "https://")) and not url.startswith(_cfg.public_base_url):
        from app.services.security import assert_public_url

        try:
            assert_public_url(url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=f"不允许的资产 URL：{exc}")
    ext = url.split("?")[0].rsplit(".", 1)[-1].lower() if "." in url.split("?")[0] else ""
    allowed = {"png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"}
    if ext and ext not in allowed:
        raise HTTPException(status_code=415, detail=f"不支持的资产类型（.{ext}）")
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
