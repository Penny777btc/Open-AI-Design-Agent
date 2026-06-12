"""保持前端两步上传契约（get_upload_url → upload-binary）的本地实现。

M2 换 R2 时：get_upload_url 改为返回 R2 预签名表单，upload-binary 改为转发，
前端无需再改（public_url 字段两种实现都返回）。
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request

from app.deps import get_current_user
from app.services import storage

router = APIRouter()


@router.get("/get_upload_url")
async def get_upload_url(filename: str = "file", user=Depends(get_current_user)):
    key = f"uploads/{user.id}/{uuid.uuid4().hex[:12]}/{filename}"
    return {
        "url": "/api/v1/upload-binary",  # 前端会把它放进 x-proxy-target-url，本地实现忽略
        "fields": {"key": key},
        "public_url": storage.public_url(key),
    }


ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"}


@router.post("/sessions/{session_id}/reference-docs")
async def upload_reference_doc(session_id: str, request: Request, user=Depends(get_current_user)):
    """上传参考文档（PDF/DOCX）：解析文字进规划上下文，内嵌图片登画布。"""
    from datetime import datetime, timezone

    from sqlalchemy import func, select

    from app.db import SessionLocal
    from app.models import Asset, DesignSession, ReferenceDoc, SessionMessages
    from app.services import doc_parser
    from app.services.placement import PlacementPlanner, display_size

    form = await request.form()
    file = form.get("file")
    if file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Missing file")
    filename = getattr(file, "filename", "document")
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("pdf", "docx", "doc"):
        raise HTTPException(status_code=415, detail="仅支持 PDF / Word（.docx）文档")
    data = await file.read()
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="文档过大（上限 20MB）")

    try:
        parsed = doc_parser.parse(filename, data)
    except Exception:
        raise HTTPException(status_code=422, detail="文档解析失败，请确认文件未加密且格式正确")
    if not parsed.text.strip() and not parsed.images:
        raise HTTPException(status_code=422, detail="未能从文档中提取到内容（可能是扫描件，暂不支持 OCR）")

    async with SessionLocal() as db:
        session = await db.get(DesignSession, session_id)
        if session is None or session.user_id != user.id or session.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Session not found")

        db.add(ReferenceDoc(
            session_id=session_id, user_id=user.id, filename=filename[:255],
            extracted_text=parsed.text, image_count=len(parsed.images),
        ))

        # 提取图按现有内容排布登上画布
        existing = (
            await db.execute(select(Asset).where(Asset.session_id == session_id))
        ).scalars().all()
        nodes = [
            {"x": a.canvas_x, "y": a.canvas_y, "h": display_size(a.width, a.height)[1]}
            for a in existing if a.canvas_x is not None
        ]
        planner = PlacementPlanner(nodes)
        labels = []
        count = len(existing)
        for idx, (img_bytes, mime) in enumerate(parsed.images):
            from PIL import Image
            from io import BytesIO

            try:
                with Image.open(BytesIO(img_bytes)) as im:
                    width, height = im.size
            except Exception:
                continue
            img_ext = mime.split("/")[-1]
            key = f"assets/{session_id}/doc_{uuid.uuid4().hex[:10]}.{img_ext}"
            storage.save_bytes(key, img_bytes)
            count += 1
            label = f"asset_{count}"
            cx, cy = planner.next(width, height)
            db.add(Asset(
                session_id=session_id, user_id=user.id, asset_label=label,
                url=storage.public_url(key), storage_key=key, kind="image", mime=mime,
                width=width, height=height, source_tool="doc_extract",
                prompt=f"来自文档 {filename}", canvas_x=cx, canvas_y=cy,
            ))
            labels.append(label)

        # 历史留痕：上下文对用户可见
        note = f"📄 已解析参考文档「{filename}」：提取 {len(parsed.text)} 字"
        if labels:
            note += f"，{len(labels)} 张图片已添加到画布（{', '.join(labels)}）"
        note += "。后续设计将参考该文档内容。"
        row = await db.get(SessionMessages, session_id)
        msg = {"role": "assistant", "content": note, "timestamp": datetime.now(timezone.utc).isoformat()}
        if row is None:
            db.add(SessionMessages(session_id=session_id, payload=[msg]))
        else:
            row.payload = list(row.payload or []) + [msg]
        await db.commit()

    return {
        "filename": filename,
        "text_chars": len(parsed.text),
        "images_extracted": len(labels),
        "asset_labels": labels,
        "note": note,
    }


@router.post("/upload-binary")
async def upload_binary(request: Request, user=Depends(get_current_user)):
    form = await request.form()
    key = form.get("key")
    file = form.get("file")
    if not key or file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Missing key or file in form data")

    # 类型闸（审计补充）：非媒体文件会以 broken image 形态破坏画布渲染
    ext = str(key).rsplit(".", 1)[-1].lower() if "." in str(key) else ""
    mime = (getattr(file, "content_type", "") or "").split(";")[0]
    mime_ok = mime.startswith(("image/", "video/", "audio/"))
    if ext not in ALLOWED_EXT or not mime_ok:
        raise HTTPException(status_code=415, detail=f"不支持的文件类型（.{ext or '?'}），仅支持图片/视频/音频")

    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")
    storage.save_bytes(str(key), data)
    return {"status": "success"}
