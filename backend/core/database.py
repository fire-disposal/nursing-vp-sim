import asyncio
import logging
from contextlib import asynccontextmanager
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import QueuePool

from core.config import DATABASE_URL

log = logging.getLogger(__name__)

_URL = DATABASE_URL
if _URL.startswith("postgresql://") and "+" not in _URL.split("://")[0]:
    _URL = _URL.replace("postgresql://", "postgresql+psycopg://", 1)

engine = create_engine(
    _URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"connect_timeout": 10, "options": "-c statement_timeout=30000"},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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
    session = await asyncio.to_thread(SessionLocal)
    try:
        yield session
    finally:
        await asyncio.to_thread(session.close)


def init_db() -> None:
    import os

    import models  # noqa: F401

    if os.environ.get("SKIP_MIGRATION"):
        Base.metadata.create_all(bind=engine)
        log.info("数据库迁移跳过 (SKIP_MIGRATION=1)，使用 create_all")
        return

    from alembic import command
    from alembic.config import Config

    alembic_ini = os.path.join(os.path.dirname(os.path.dirname(__file__)), "alembic.ini")
    if not os.path.isfile(alembic_ini):
        log.warning("alembic.ini 不存在，跳过迁移，使用 create_all")
        Base.metadata.create_all(bind=engine)
        return

    alembic_cfg = Config(alembic_ini)
    try:
        command.upgrade(alembic_cfg, "head")
        log.debug("数据库迁移完成")
    except Exception as e:
        log.warning("迁移失败: %s", e)
        from alembic.script import ScriptDirectory
        from sqlalchemy import inspect

        insp = inspect(engine)
        existing = insp.get_table_names()
        script = ScriptDirectory.from_config(alembic_cfg)
        head = script.get_current_head()
        if head is None:
            log.warning("No migration head found, skipping stamp")
            if not existing:
                Base.metadata.create_all(bind=engine)
            return

        if existing:
            log.info("检测到现有表 (%d)，stamp head: %s", len(existing), head)
            command.stamp(alembic_cfg, head)
        else:
            log.info("全新数据库，create_all + stamp: %s", head)
            Base.metadata.create_all(bind=engine)
            command.stamp(alembic_cfg, head)
