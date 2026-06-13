"""上传加固验证：文档/媒体限流、文档去重、存储配额。

全部 async，与 conftest 的 AsyncClient 共享同一事件循环——直查库与 HTTP 请求
落在同一连接谱系上，避免 async 引擎跨循环的可见性假象。
"""

import io
import uuid

import pytest
from sqlalchemy import func, select

from app.db import SessionLocal
from app.deps import get_or_create_dev_user
from app.models import Job, UploadedFile
from tests.conftest import make_pdf_bytes, new_session

pytestmark = pytest.mark.asyncio


def _doc_files(data: bytes, name: str = "ref.pdf"):
    return {"file": (name, io.BytesIO(data), "application/pdf")}


async def _count_doc_jobs(session_id: str) -> int:
    async with SessionLocal() as db:
        return (
            await db.execute(
                select(func.count())
                .select_from(Job)
                .where(Job.session_id == session_id, Job.kind == "doc_parse")
            )
        ).scalar_one()


# ---- A1: 文档上传双层限流（每小时 5 份）----

async def test_doc_upload_rate_limit_blocks_sixth(client):
    sid = await new_session(client)
    for i in range(5):  # 前 5 次放行（内容各异，避免命中去重）
        r = await client.post(
            f"/api/v1/sessions/{sid}/reference-docs",
            files=_doc_files(make_pdf_bytes(f"a{i}"), f"f{i}.pdf"),
        )
        assert r.status_code == 200, (i, r.text)
    r6 = await client.post(  # 第 6 次撞每小时窗口 → 429
        f"/api/v1/sessions/{sid}/reference-docs",
        files=_doc_files(make_pdf_bytes("a6"), "f6.pdf"),
    )
    assert r6.status_code == 429, r6.text
    assert "后再试" in r6.json()["detail"]


# ---- A2: 媒体上传限流（每小时 60 次）----

async def test_upload_binary_rate_limit_blocks_61st(client):
    base = f"uploads/{uuid.uuid4().hex[:8]}"
    for i in range(60):
        r = await client.post(
            "/api/v1/upload-binary",
            data={"key": f"{base}/{i}.png"},
            files={"file": (f"{i}.png", io.BytesIO(b"\x89PNG\r\n" + bytes([i])), "image/png")},
        )
        assert r.status_code == 200, (i, r.text)
    r61 = await client.post(
        "/api/v1/upload-binary",
        data={"key": f"{base}/61.png"},
        files={"file": ("61.png", io.BytesIO(b"\x89PNG\r\n61"), "image/png")},
    )
    assert r61.status_code == 429, r61.text


# ---- A3: 文档去重 ----

async def test_duplicate_doc_returns_duplicate_and_single_job(client):
    sid = await new_session(client)
    data = make_pdf_bytes("dup")

    r1 = await client.post(
        f"/api/v1/sessions/{sid}/reference-docs",
        files=_doc_files(data, "same.pdf"),
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["job_id"] is not None

    r2 = await client.post(
        f"/api/v1/sessions/{sid}/reference-docs",
        files=_doc_files(data, "same-again.pdf"),
    )
    assert r2.status_code == 200, r2.text
    # 响应契约：job_id 为 null、duplicate 为 true、回显文件名
    assert r2.json() == {"job_id": None, "filename": "same-again.pdf", "duplicate": True}

    # 只创建了一个解析 Job
    assert await _count_doc_jobs(sid) == 1


# ---- A2: 存储配额（500MB）----

async def test_storage_quota_blocks_over_limit(client):
    async with SessionLocal() as db:
        uid = (await get_or_create_dev_user(db)).id
        # 已用接近上限：500MB 减 10 字节
        db.add(UploadedFile(
            user_id=uid, storage_key=f"seed/{uuid.uuid4().hex}",
            filename="seed.bin", mime="image/png", size=500 * 1024 * 1024 - 10,
        ))
        await db.commit()

    # 再传 1KB 就超限 → 413
    r = await client.post(
        "/api/v1/upload-binary",
        data={"key": f"uploads/{uuid.uuid4().hex[:8]}/big.png"},
        files={"file": ("big.png", io.BytesIO(b"\x89PNG\r\n" + b"x" * 1024), "image/png")},
    )
    assert r.status_code == 413, r.text
    assert "存储空间不足" in r.json()["detail"]
