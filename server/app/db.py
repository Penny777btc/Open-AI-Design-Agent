from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# SQLite 阶段的临时迁移：create_all 只建新表、不会给已有表补列，
# 而 dev.db 里的 reference_docs 是在 sha256 列加入之前建的。
# 这里用建表后才能补列的幂等 ALTER；「duplicate column」说明已补过，静默跳过。
# 挂在 connect 事件上而非 main.lifespan，是为了不改动 main.py 也能覆盖所有入口
# （含测试直连引擎）；同步 DDL 在 SQLite 上开销可忽略。
# M4 迁 Postgres 时改用 Alembic，删掉这段。
_LIGHTWEIGHT_MIGRATIONS = (
    "ALTER TABLE reference_docs ADD COLUMN sha256 VARCHAR(64)",
    # 去重查询按 (session_id, sha256) 命中；IF NOT EXISTS 天然幂等，补列后建索引。
    "CREATE INDEX IF NOT EXISTS ix_reference_docs_sha256 ON reference_docs (sha256)",
)


@event.listens_for(engine.sync_engine, "connect")
def _apply_lightweight_migrations(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    try:
        # 表可能尚未建（首次启动 create_all 之前就有连接进来）——
        # 没有该表时 ALTER 会报错，一并归入静默跳过，下次连接 create_all 之后再补。
        # 注意：aiosqlite 适配的游标 execute() 不返回自身，须 execute 后另行 fetchone。
        cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='reference_docs'"
        )
        if not cur.fetchone():
            return
        for ddl in _LIGHTWEIGHT_MIGRATIONS:
            try:
                cur.execute(ddl)
            except Exception as exc:  # noqa: BLE001 — SQLite 不暴露具体异常类型
                if "duplicate column" not in str(exc).lower():
                    raise
    finally:
        cur.close()
