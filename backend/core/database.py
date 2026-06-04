import logging
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import QueuePool

from core.config import DATABASE_URL

log = logging.getLogger(__name__)

engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
    connect_args={"connect_timeout": 10, "options": "-c statement_timeout=30000"},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def _log_connection():
    parsed = urlparse(DATABASE_URL)
    safe_url = f"{parsed.scheme}://{parsed.username}:***@{parsed.hostname}:{parsed.port}{parsed.path}"
    log.info("数据库连接: %s", safe_url)
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            if parsed.scheme.startswith("postgres"):
                result = conn.execute(text("SELECT current_database(), version()"))
                row = result.fetchone()
                db_name = row[0]
                pg_ver = row[1].split(",")[0] if row[1] else "unknown"
                log.info("数据库连接成功 → %s (PostgreSQL %s)", db_name, pg_ver)
            else:
                raise RuntimeError(f"不支持的数据库类型: {parsed.scheme}。只支持 PostgreSQL。")
    except Exception as e:
        log.exception("数据库连接失败: %s: %s", type(e).__name__, e)
        raise


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
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
        log.info("数据库迁移完成")
    except Exception:
        from alembic.script import ScriptDirectory

        log.warning("迁移失败，尝试 stamp head（可能已是目标版本）")
        try:
            script = ScriptDirectory.from_config(alembic_cfg)
            head = script.get_current_head()
            command.stamp(alembic_cfg, head)
            log.info("数据库版本已标记为最新: %s", head)
        except Exception:
            log.exception("stamp 也失败，回退到 create_all")
            Base.metadata.create_all(bind=engine)
