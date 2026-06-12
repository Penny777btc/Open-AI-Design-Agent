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
    """上传参考文档（PDF/DOCX）：秒存秒回 job_id，解析作为异步任务推进度。

    视觉理解耗时 1-3 分钟，同步等待会被代理超时切断且毫无反馈——
    复用任务事件流，进度像生图一样在聊天区实时可见。
    """
    from datetime import datetime, timezone

    from app.db import SessionLocal
    from app.models import DesignSession, Job, SessionMessages
    from app.services import job_service

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

    doc_key = f"docs/{session_id}/{uuid.uuid4().hex[:12]}.{ext}"
    storage.save_bytes(doc_key, data)

    async with SessionLocal() as db:
        session = await db.get(DesignSession, session_id)
        if session is None or session.user_id != user.id or session.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Session not found")

        # 用户消息落库（刷新/跨页可见上传动作）
        user_msg = {
            "role": "user",
            "content": f"📄 上传参考文档「{filename}」",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        row = await db.get(SessionMessages, session_id)
        if row is None:
            db.add(SessionMessages(session_id=session_id, payload=[user_msg]))
        else:
            row.payload = list(row.payload or []) + [user_msg]
        if session.name in ("Untitled", "", None):
            session.name = f"📄 {filename}"[:40]

        job = Job(
            session_id=session_id, user_id=user.id, kind="doc_parse",
            input={"filename": filename, "doc_key": doc_key},
        )
        db.add(job)
        await db.commit()

    job_service.start_job(job.id)
    return {"job_id": job.id, "filename": filename}


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
