import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.db import Base, engine
from app.routers import admin, assets, auth, billing, brand, chat, jobs, misc, sessions, uploads
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
    await _bootstrap_admins()
    await _seed_packages()
    await mark_stale_jobs_failed()
    yield


async def _seed_packages():
    from app.db import SessionLocal
    from app.routers.billing import seed_packages_if_empty

    async with SessionLocal() as db:
        await seed_packages_if_empty(db)


async def _bootstrap_admins():
    """ADMIN_EMAILS/SUPPORT_EMAILS 引导角色；从名单移除的降回 user（权限随环境变量收放）。

    同一邮箱同时出现在两个名单时取 admin（先写 support 再写 admin 覆盖）。
    """
    from sqlalchemy import update

    from app.db import SessionLocal
    from app.models import User

    admins = [e.strip().lower() for e in settings.admin_emails.split(",") if e.strip()]
    support = [e.strip().lower() for e in settings.support_emails.split(",") if e.strip()]
    async with SessionLocal() as db:
        if support:
            await db.execute(update(User).where(User.email.in_(support)).values(role="support"))
        if admins:
            await db.execute(update(User).where(User.email.in_(admins)).values(role="admin"))
        await db.execute(
            update(User).where(
                User.role.in_(("admin", "support")), User.email.not_in(admins + support)
            ).values(role="user")
        )
        await db.commit()


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
app.include_router(admin.router, prefix="/api/v1")
app.include_router(brand.router, prefix=PREFIX)  # 品牌套件（对标 Lovart Brand Kit）

settings.storage_dir.mkdir(parents=True, exist_ok=True)


@app.get("/files/docs/{path:path}", include_in_schema=False)
async def _block_public_docs(path: str):
    # 上传的参考文档含专有资料（品名/卖点/定价），仅服务端解析、前端从不直取 →
    # 不经公开静态挂载暴露（防 UUID 泄漏后被任意人拉取）。此路由先于 /files 挂载匹配。
    from fastapi import HTTPException

    raise HTTPException(status_code=403, detail="forbidden")


app.mount("/files", StaticFiles(directory=settings.storage_dir), name="files")


@app.get("/healthz")
async def healthz():
    return {"status": "ok", "provider_mode": settings.provider_mode}
