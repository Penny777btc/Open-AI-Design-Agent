from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.deps import get_current_user, get_db
from app.models import Asset
from app.routers.sessions import _owned_session
from app.services.job_service import _label_lock, _next_asset_label

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
        "canvas_w": asset.canvas_w,
        "canvas_h": asset.canvas_h,
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


@router.patch("/sessions/{session_id}/assets/layout")
async def update_layout(
    session_id: str, request: Request,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
):
    """手动布局持久化：用户在画布拖拽/缩放素材后，前端防抖回写最终位置与尺寸。

    body: {"moves": [{"asset_label": "asset_3", "x": 120, "y": 340, "w": 266, "h": 400}, ...]}
    w/h 可省略（只挪位置）。刷新后 loadAssets 按 canvas_x/y/w/h 重建 → 布局不再回跳。
    """
    await _owned_session(db, user, session_id)
    body = await request.json()
    moves = body.get("moves") or []
    if not isinstance(moves, list):
        return {"updated": 0}

    def _i(v):
        try:
            return int(round(float(v)))
        except (TypeError, ValueError):
            return None

    updated = 0
    for m in moves[:200]:  # 上限护栏：单会话资产远小于此
        if not isinstance(m, dict):
            continue
        label = m.get("asset_label")
        x, y = _i(m.get("x")), _i(m.get("y"))
        if not label or x is None or y is None:
            continue
        asset = (
            await db.execute(select(Asset).where(
                Asset.session_id == session_id, Asset.asset_label == label))
        ).scalars().first()
        if not asset:
            continue
        asset.canvas_x, asset.canvas_y = x, y
        w, h = _i(m.get("w")), _i(m.get("h"))
        if w and h and w > 0 and h > 0:
            asset.canvas_w, asset.canvas_h = w, h
        updated += 1
    if updated:
        await db.commit()
    return {"updated": updated}


@router.post("/sessions/{session_id}/assets/delete")
async def delete_assets(
    session_id: str, request: Request,
    db: AsyncSession = Depends(get_db), user=Depends(get_current_user),
):
    """批量删除资产（用户画布删除的持久化）。body: {"labels": ["asset_3", ...]}

    why：删除原本只清前端画布状态，刷新后资产重同步全部复活。硬删行（存储文件保留，
    避免误删后无法恢复文件；行删除后前端 undo 窗口已过，属用户确认过的操作）。
    """
    await _owned_session(db, user, session_id)
    body = await request.json()
    labels = [l for l in (body.get("labels") or []) if isinstance(l, str)][:200]
    if not labels:
        return {"deleted": 0}
    from sqlalchemy import delete as sa_delete
    res = await db.execute(sa_delete(Asset).where(
        Asset.session_id == session_id, Asset.asset_label.in_(labels)))
    await db.commit()
    return {"deleted": res.rowcount}


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
        asset = Asset(
            session_id=session_id,
            user_id=user.id,
            # max+1 而非 count+1：admin 硬删资产后 count 回退，count+1 会撞上仍存活的旧 label
            asset_label=await _next_asset_label(session_id, db),
            url=body.get("url", ""),
            kind=body.get("kind", "image"),
            source_tool=body.get("source_tool", "upload"),
        )
        db.add(asset)
        await db.commit()
    return _serialize(asset)
