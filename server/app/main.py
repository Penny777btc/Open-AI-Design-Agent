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


@asynccontextmanager
async def lifespan(app: FastAPI):
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
