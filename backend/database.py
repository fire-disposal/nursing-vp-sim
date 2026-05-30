import logging
import traceback
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool

from config import DATABASE_URL

logger = logging.getLogger("nursing.db")

engine = create_engine(
    DATABASE_URL,
    poolclass=QueuePool,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    import models  # noqa: F401

    try:
        from alembic.config import Config
        from alembic import command
        import os
        alembic_ini = os.path.join(os.path.dirname(__file__), "alembic.ini")
        if not os.path.isfile(alembic_ini):
            logger.warning("alembic.ini 不存在，跳过迁移，使用 create_all")
            Base.metadata.create_all(bind=engine)
            return
        alembic_cfg = Config(alembic_ini)
        command.upgrade(alembic_cfg, "head")
        logger.info("数据库迁移完成")
    except Exception as e:
        logger.error("=" * 60)
        logger.error("数据库迁移失败！错误详情：")
        logger.error("  %s: %s", type(e).__name__, e)
        logger.error("完整堆栈：")
        for line in traceback.format_exc().strip().split("\n"):
            logger.error("  %s", line)
        logger.error("=" * 60)
        logger.warning("回退到 create_all（表结构可能不完整，请修复后重启）")

        try:
            Base.metadata.create_all(bind=engine)
            # 标记所有迁移为已应用，避免下次启动重复执行
            from alembic.config import Config as _Config
            from alembic import command as _command
            _command.stamp(_Config(alembic_ini), "head")
            logger.info("已标记迁移版本为 head")
        except Exception as e2:
            logger.error("create_all 或 stamp 也失败: %s", e2)

