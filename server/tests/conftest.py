"""上传加固相关测试的最小夹具：隔离的临时 SQLite + 临时存储 + mock provider。

必须在导入 app 之前设置环境变量——config.settings 是模块级单例，引擎在导入时
就按 database_url 绑定；晚设置则无效。故这里在任何 app.* 导入之前改 os.environ。

用 httpx.ASGITransport + AsyncClient 而非 TestClient：把 lifespan、所有请求、
以及测试里的直查库全部跑在同一个事件循环上。async 引擎的连接是循环亲和的，
TestClient 会为不同请求切换循环，导致「刚建的 session 下一请求读不到」的假象。
"""

import os
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

_TMP = Path(tempfile.mkdtemp(prefix="picsmith-test-"))
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{_TMP / 'test.db'}"
os.environ["STORAGE_DIR"] = str(_TMP / "storage")
os.environ["PROVIDER_MODE"] = "mock"
os.environ["AUTH_MODE"] = "dev"  # 无 token 回落到 dev 用户，省去登录流程
os.environ["ENVIRONMENT"] = "development"

import httpx  # noqa: E402

from app.main import app  # noqa: E402
from app.services import rate_limit  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limit_buckets():
    """限流桶是进程级全局，测试间必须清零，否则跨用例互相污染计数。"""
    rate_limit._buckets.clear()
    yield
    rate_limit._buckets.clear()


@pytest.fixture(autouse=True)
def _no_background_and_no_lock(monkeypatch):
    """禁掉后台解析与单进程文件锁：测试只校验 HTTP 行为与库状态。

    start_job 留 pending Job（去重的 Job 路径才稳定可断言）；进程锁是部署期防呆，
    与单测无关，且函数级反复进出 lifespan 会因 flock 同 inode 二次失败而误报。
    """
    from app.services import job_service

    monkeypatch.setattr(job_service, "start_job", lambda jid: None)
    monkeypatch.setattr("app.main._acquire_single_process_lock", lambda: None)
    yield


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    # lifespan 由 ASGITransport 在 with 块内触发：跑 create_all + 轻量迁移
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
            yield c


def make_pdf_bytes(marker: str = "x") -> bytes:
    """最小合法 PDF 字节。内容随 marker 变化，便于造出不同 sha256。"""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n"
        b"%% marker:" + marker.encode() + b"\n"
        b"trailer<</Root 1 0 R>>\n%%EOF\n"
    )


async def new_session(client: httpx.AsyncClient) -> str:
    """走 HTTP 建 session：与后续请求共用同一连接/事件循环。"""
    r = await client.post("/api/v1/creative-agent/sessions")
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]
