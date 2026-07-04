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
# (所属表, DDL)：按表分组，表尚未建时跳过该条（首启 create_all 之前就有连接进来）
_LIGHTWEIGHT_MIGRATIONS = (
    ("reference_docs", "ALTER TABLE reference_docs ADD COLUMN sha256 VARCHAR(64)"),
    # 去重查询按 (session_id, sha256) 命中；IF NOT EXISTS 天然幂等，补列后建索引。
    ("reference_docs", "CREATE INDEX IF NOT EXISTS ix_reference_docs_sha256 ON reference_docs (sha256)"),
    # 管理后台：角色与封禁。旧行 role 取默认 'user'。
    ("users", "ALTER TABLE users ADD COLUMN role VARCHAR(16) DEFAULT 'user'"),
    ("users", "ALTER TABLE users ADD COLUMN disabled_at DATETIME"),
    # 每日文档配额覆盖（管理台可调）
    ("users", "ALTER TABLE users ADD COLUMN doc_daily_limit INTEGER"),
    # 四层合成：资产层叠序（刷新后仍按层堆叠）
    ("assets", "ALTER TABLE assets ADD COLUMN z_index INTEGER"),
    # 智能拆解：语义角色 + 人类可读名（供 PSD 语义命名/分组，刷新后导出仍可用）
    ("assets", "ALTER TABLE assets ADD COLUMN split_role VARCHAR(16)"),
    ("assets", "ALTER TABLE assets ADD COLUMN split_label VARCHAR(64)"),
    # 手动布局持久化：用户拖拽/缩放后回写的画布显示尺寸（坐标复用已有 canvas_x/y）
    ("assets", "ALTER TABLE assets ADD COLUMN canvas_w INTEGER"),
    ("assets", "ALTER TABLE assets ADD COLUMN canvas_h INTEGER"),
)


@event.listens_for(engine.sync_engine, "connect")
def _apply_lightweight_migrations(dbapi_conn, _record):
    cur = dbapi_conn.cursor()
    try:
        # 注意：aiosqlite 适配的游标 execute() 不返回自身，须 execute 后另行 fetchone。
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        existing = {row[0] for row in cur.fetchall()}
        for table, ddl in _LIGHTWEIGHT_MIGRATIONS:
            if table not in existing:
                continue
            try:
                cur.execute(ddl)
            except Exception as exc:  # noqa: BLE001 — SQLite 不暴露具体异常类型
                if "duplicate column" not in str(exc).lower():
                    raise
    finally:
        cur.close()
