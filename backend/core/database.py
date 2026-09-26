"""Database engine, session factory, and lifecycle.

**Pool**: QueuePool (10+10), 30s timeout, 3600s recycle, pre-ping enabled.
**Session options**: ``statement_timeout=120000`` (2 min), ``lock_timeout=3000`` (3 s).
**Streaming transactions**: sessions MUST close before the request ends.
  ``SessionLocal`` sessions are not async-safe; streaming endpoints open a
  fresh ``SessionLocal`` per pipeline step and close it immediately.
  ``StreamingResponse`` must never hold an open DB session past yield.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import QueuePool

from core.config import DATABASE_URL

log = logging.getLogger(__name__)

_URL = DATABASE_URL
if _URL.startswith("postgresql://") and "+" not in _URL.split("://")[0]:
    _URL = _URL.replace("postgresql://", "postgresql+psycopg://", 1)

# 会话时区显式固定为上海：库里的墙钟语义、运维面板的"今天/最老一条"、
# 以及 cast/format 出来的文本都与产品受众一致，不依赖宿主机或 compose 的 TZ
# （2026-09-26 时区对齐，见 docs/ops/timezone-alignment.md）。
_SESSION_OPTIONS = "-c statement_timeout=120000 -c lock_timeout=3000 -c timezone=Asia/Shanghai"


engine = create_engine(
    _URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=10,
    pool_timeout=30,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"connect_timeout": 10, "options": _SESSION_OPTIONS},
)
_SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def SessionLocal():
    """Return a synchronous SQLAlchemy session (engine-pooled)."""
    return _SessionLocal()


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@asynccontextmanager
async def db_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


class SchemaNotReadyError(RuntimeError):
    """Database schema is missing or not at the expected Alembic head."""


def verify_schema() -> None:
    """Assert the database schema is at the single expected Alembic head.

    Startup **never migrates**. Production releases run ``alembic upgrade head``
    as an explicit deploy step after the new image is available and before
    services start (see ``.github/workflows/deploy.yml``, ``deploy/rollback.sh``
    and ``docs/09-operations.md``). Verifying here instead of upgrading means a
    missing/stale schema fails fast and loudly, and multiple workers never race
    for a migration lock.

    ``create_all`` is only reachable with ``TESTING=1`` (set by
    ``backend/tests/conftest.py``); it is never a production fallback.
    """
    import os

    if os.getenv("TESTING") == "1":
        import models  # noqa: F401

        Base.metadata.create_all(bind=engine)
        log.info("TESTING=1：schema 由 create_all 提供，跳过 head 校验")
        return

    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    alembic_ini = Path(__file__).resolve().parent.parent / "alembic.ini"
    if not alembic_ini.exists():
        raise SchemaNotReadyError(
            f"alembic.ini 不存在（{alembic_ini}），无法校验数据库 schema。"
            "应用启动不会建表：生产发布必须先执行 `alembic upgrade head`。"
        )

    heads = ScriptDirectory.from_config(Config(alembic_ini)).get_heads()
    if len(heads) != 1:
        raise SchemaNotReadyError(
            f"Alembic 迁移链有 {len(heads)} 个 head: {heads}。先执行 `alembic merge heads` 合并，再发布。"
        )
    expected = heads[0]

    try:
        with engine.connect() as conn:
            current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    except Exception as e:
        raise SchemaNotReadyError(
            "数据库 schema 未初始化（读不到 alembic_version 表）。"
            "应用启动不会自动迁移：请先执行 `alembic upgrade head`。"
        ) from e

    if current != expected:
        raise SchemaNotReadyError(
            f"数据库 schema 未对齐：当前 {current or '(空)'}，期望 {expected}。"
            "应用启动不会自动迁移：请先执行 `alembic upgrade head`"
            "（部署流水线已内建该步骤）。"
        )

    log.info("数据库 schema 校验通过: head=%s", expected)
