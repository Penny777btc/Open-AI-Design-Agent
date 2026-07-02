"""保持前端两步上传契约（get_upload_url → upload-binary）的本地实现。

M2 换 R2 时：get_upload_url 改为返回 R2 预签名表单，upload-binary 改为转发，
前端无需再改（public_url 字段两种实现都返回）。
"""

import hashlib
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, select

from app.deps import get_current_user
from app.models import UploadedFile
from app.services import storage
from app.services.rate_limit import rate_limit

router = APIRouter()

# 每用户本地盘总配额：M1 单机存储，没有配额任何登录用户都能把磁盘灌满拖垮全站。
# M2 换 R2 后改成按计费档位的配额，这里只是兜底。
STORAGE_QUOTA_BYTES = 500 * 1024 * 1024


async def _enforce_storage_quota(db, user_id: str, incoming_size: int) -> None:
    """已用量 + 本次 > 配额则 413。读用量与写记录分两段，避免长时间持写锁（SQLite 单写者）。"""
    used = (
        await db.execute(
            select(func.coalesce(func.sum(UploadedFile.size), 0)).where(UploadedFile.user_id == user_id)
        )
    ).scalar_one()
    if used + incoming_size > STORAGE_QUOTA_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"存储空间不足（每账号上限 {STORAGE_QUOTA_BYTES // (1024 * 1024)}MB），请删除部分文件后重试",
        )


@router.get("/get_upload_url")
async def get_upload_url(filename: str = "file", user=Depends(get_current_user)):
    key = f"uploads/{user.id}/{uuid.uuid4().hex[:12]}/{filename}"
    return {
        "url": "/api/v1/upload-binary",  # 前端会把它放进 x-proxy-target-url，本地实现忽略
        "fields": {"key": key},
        "public_url": storage.public_url(key),
    }


ALLOWED_EXT = {"png", "jpg", "jpeg", "webp", "gif", "avif", "mp4", "webm", "mov", "mp3", "wav", "ogg", "m4a"}


@router.post(
    "/sessions/{session_id}/reference-docs",
    # 每份文档解析触发 2 次昂贵的 Gemini 视觉调用，双层窗口卡住批量刷量：
    # 每小时 5 份挡住短时连刷，每天 20 份挡住整天慢速囤刷。按账号而非 IP。
    dependencies=[
        Depends(rate_limit("doc", 5, 3600, by="user")),
        Depends(rate_limit("doc-day", 20, 86400, by="user", override_attr="doc_daily_limit")),
    ],
)
async def upload_reference_doc(session_id: str, request: Request, user=Depends(get_current_user)):
    """上传参考文档（PDF/DOCX）：秒存秒回 job_id，解析作为异步任务推进度。

    视觉理解耗时 1-3 分钟，同步等待会被代理超时切断且毫无反馈——
    复用任务事件流，进度像生图一样在聊天区实时可见。
    """
    from datetime import datetime, timezone

    from app.db import SessionLocal
    from app.models import DesignSession, Job, ReferenceDoc, SessionMessages
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

    # 内容指纹：同一 session 传过相同文档就直接复用，省两次视觉调用
    sha256 = hashlib.sha256(data).hexdigest()

    async with SessionLocal() as db:
        session = await db.get(DesignSession, session_id)
        if session is None or session.user_id != user.id or session.deleted_at is not None:
            raise HTTPException(status_code=404, detail="Session not found")

        # 去重：命中同一文档则不落盘、不建 Job，按契约直接告知前端。
        # 查两处——ReferenceDoc.sha256 是解析完成后的成品；Job.input.sha256 覆盖
        # 「解析仍在进行/排队」的窗口（解析慢，期间重复上传不能漏判）。
        # 失败/取消的 Job 不算，允许换个时机重试。
        dup_doc = (
            await db.execute(
                select(ReferenceDoc.id).where(
                    ReferenceDoc.session_id == session_id, ReferenceDoc.sha256 == sha256
                )
            )
        ).first()
        dup_job = (
            await db.execute(
                select(Job.id).where(
                    Job.session_id == session_id,
                    Job.kind == "doc_parse",
                    Job.input["sha256"].as_string() == sha256,
                    Job.status.not_in(("failed", "cancelled", "rejected")),
                )
            )
        ).first()
        if dup_doc is not None or dup_job is not None:
            return {"job_id": None, "filename": filename, "duplicate": True}

        # 文档文件也占用户配额：解析前先卡，避免落盘后才发现超限
        await _enforce_storage_quota(db, user.id, len(data))

    doc_key = f"docs/{session_id}/{uuid.uuid4().hex[:12]}.{ext}"
    storage.save_bytes(doc_key, data)

    # 回执语言跟随站点语言设置（前端 LanguageContext 透传）
    lang = "en" if form.get("lang") == "en" else "zh"

    async with SessionLocal() as db:
        # 用户消息落库（刷新/跨页可见上传动作）
        user_msg = {
            "role": "user",
            "content": (
                f"📄 上传参考文档「{filename}」" if lang == "zh" else f"📄 Uploaded reference document \"{filename}\""
            ),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        row = await db.get(SessionMessages, session_id)
        if row is None:
            db.add(SessionMessages(session_id=session_id, payload=[user_msg]))
        else:
            row.payload = list(row.payload or []) + [user_msg]
        session = await db.get(DesignSession, session_id)
        if session is not None and session.name in ("Untitled", "", None):
            session.name = f"📄 {filename}"[:40]

        # 文档文件计入配额账：与媒体共用 UploadedFile 表
        db.add(UploadedFile(
            user_id=user.id, storage_key=doc_key, filename=filename[:255],
            mime=getattr(file, "content_type", None), size=len(data),
        ))

        job = Job(
            session_id=session_id, user_id=user.id, kind="doc_parse",
            # sha256 透传给 ingest，由它写到 ReferenceDoc.sha256 上供后续去重
            input={"filename": filename, "doc_key": doc_key, "sha256": sha256, "lang": lang},
        )
        db.add(job)
        await db.commit()

    job_service.start_job(job.id)
    return {"job_id": job.id, "filename": filename}


@router.post(
    "/upload-binary",
    # 媒体上传无业务节流，会被脚本灌满本地盘——每账号每小时 60 次兜底
    dependencies=[Depends(rate_limit("upload", 60, 3600, by="user"))],
)
async def upload_binary(request: Request, user=Depends(get_current_user)):
    from app.db import SessionLocal

    form = await request.form()
    key = str(form.get("key") or "")
    file = form.get("file")
    if not key or file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Missing key or file in form data")
    # 越权防护：key 必须落在该用户命名空间（防客户端提交任意 key 覆盖他人资产/写入公开目录）
    if not key.startswith(f"uploads/{user.id}/"):
        raise HTTPException(status_code=403, detail="非法的上传路径")

    # 类型闸（审计补充）：非媒体文件会以 broken image 形态破坏画布渲染
    ext = str(key).rsplit(".", 1)[-1].lower() if "." in str(key) else ""
    mime = (getattr(file, "content_type", "") or "").split(";")[0]
    mime_ok = mime.startswith(("image/", "video/", "audio/"))
    if ext not in ALLOWED_EXT or not mime_ok:
        raise HTTPException(status_code=415, detail=f"不支持的文件类型（.{ext or '?'}），仅支持图片/视频/音频")

    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")

    # 配额检查与落库分两段短事务：先读已用量（超限直接 413，不落盘），
    # 再写文件、写记录——SQLite 单写者，写库前不持有长事务
    async with SessionLocal() as db:
        await _enforce_storage_quota(db, user.id, len(data))

    storage.save_bytes(str(key), data)

    async with SessionLocal() as db:
        db.add(UploadedFile(
            user_id=user.id, storage_key=str(key),
            filename=getattr(file, "filename", str(key))[:255],
            mime=mime or None, size=len(data),
        ))
        await db.commit()
    return {"status": "success"}
