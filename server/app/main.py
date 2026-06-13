import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import Base, engine
from app.routers import assets, auth, billing, chat, jobs, misc, sessions, uploads
from app.services.job_service import mark_stale_jobs_failed

logging.basicConfig(level=logging.INFO)


def _acquire_single_process_lock():
    """独占文件锁：任务引擎的审批事件和 SQLite 都只支持单进程。

    uvicorn --workers 2 或平台自动扩容会让第二个进程在这里立刻失败，
    而不是上线后审批随机 410、数据库随机锁死。M4 迁 Postgres + 事件表驱动后移除。
    """
    import fcntl

    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    lock_file = open(settings.storage_dir / ".picsmith.lock", "w")
    try:
        fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        raise RuntimeError(
            "检测到另一个后端进程已在运行。本服务当前架构（进程内任务引擎 + SQLite）"
            "只支持单进程部署，请勿使用 --workers>1 或多实例扩容。"
        )
    return lock_file  # 持有引用防止 GC 释放锁


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.config import validate_production_config

    if errors := validate_production_config():
        raise RuntimeError("生产配置不安全，拒绝启动：\n- " + "\n- ".join(errors))
    app.state.process_lock = _acquire_single_process_lock()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    await mark_stale_jobs_failed()
    yield


app = FastAPI(title="Design Agent API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PREFIX = "/api/v1/creative-agent"
for router_module in (sessions, chat, jobs, assets):
    app.include_router(router_module.router, prefix=PREFIX)
app.include_router(misc.router, prefix=PREFIX)
app.include_router(misc.router, prefix="/api/v1")  # /api/v1/account/balance 兼容路径
app.include_router(uploads.router, prefix="/api/v1")
app.include_router(auth.router, prefix="/api/v1")
app.include_router(billing.router, prefix="/api/v1")

settings.storage_dir.mkdir(parents=True, exist_ok=True)
app.mount("/files", StaticFiles(directory=settings.storage_dir), name="files")


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "provider_mode": settings.provider_mode}
