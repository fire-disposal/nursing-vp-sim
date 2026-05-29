import logging
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import QueuePool

from config import DATABASE_URL

logger = logging.getLogger("alembic")

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
        if os.path.isfile(alembic_ini):
            alembic_cfg = Config(alembic_ini)
            command.upgrade(alembic_cfg, "head")
            return
    except Exception as e:
        logger.warning("Alembic 迁移失败，回退到 create_all: %s", e)

    Base.metadata.create_all(bind=engine)
