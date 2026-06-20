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
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    import os
    import sys

    import models  # noqa: F401

    if os.getenv("SKIP_MIGRATION"):
        Base.metadata.create_all(bind=engine)
        log.info("数据库迁移跳过 (SKIP_MIGRATION=1)，使用 create_all")
        return

    from alembic import command
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import text

    alembic_ini = Path(__file__).resolve().parent.parent / "alembic.ini"
    if not alembic_ini.exists():
        log.warning("alembic.ini 不存在，跳过迁移，使用 create_all")
        Base.metadata.create_all(bind=engine)
        return

    alembic_cfg = Config(alembic_ini)

    script = ScriptDirectory.from_config(alembic_cfg)
    heads = script.get_heads()
    if len(heads) > 1:
        log.error(
            "Alembic 存在 %d 个 head: %s。请先执行 alembic merge heads 合并。",
            len(heads), heads,
        )
        sys.exit(1)

    try:
        command.upgrade(alembic_cfg, "head")
    except Exception as e:
        msg = str(e)
        if "No such revision" in msg or "Can't locate revision" in msg:
            with engine.connect() as conn:
                try:
                    db_rev = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
                except Exception:
                    db_rev = "?"
            log.error(
                "数据库当前版本 %s 在当前分支的迁移链中不存在。\n"
                "常见原因：切分支后目标分支的迁移 hash 与当前 DB 版本不一致。\n"
                "修复步骤：\n"
                "  1. 切回原分支，执行: alembic downgrade -1 (重复直到与目标分支有共同祖先)\n"
                "  2. 切回本分支，执行: alembic stamp <祖先版本>; alembic upgrade head\n"
                "  3. 或直接在 psql 中手动修改 alembic_version 表对齐版本号\n"
                "原始错误: %s",
                db_rev, e,
            )
            sys.exit(1)
        raise

    head = script.get_current_head()
    with engine.connect() as conn:
        current = conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
    log.info("数据库迁移完成: %s (head=%s)", current, head)
