import asyncio
import logging
from contextlib import asynccontextmanager

from sqlalchemy import create_engine
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
    pool_timeout=30,
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
    command.upgrade(alembic_cfg, "head")

    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    script = ScriptDirectory.from_config(alembic_cfg)
    head = script.get_current_head()
    with engine.connect() as conn:
        current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    log.info("数据库迁移完成: %s (head=%s)", current, head)
