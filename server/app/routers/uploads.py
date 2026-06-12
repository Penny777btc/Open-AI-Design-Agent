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


@router.post("/upload-binary")
async def upload_binary(request: Request, user=Depends(get_current_user)):
    form = await request.form()
    key = form.get("key")
    file = form.get("file")
    if not key or file is None or not hasattr(file, "read"):
        raise HTTPException(status_code=400, detail="Missing key or file in form data")
    data = await file.read()
    if len(data) > 50 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large (max 50MB)")
    storage.save_bytes(str(key), data)
    return {"status": "success"}
