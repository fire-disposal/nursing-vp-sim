import os
import warnings

warnings.filterwarnings("ignore", message=".*httpx.*starlette.*deprecated.*")
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"
# 防 SessionLocal 间接查询（如 ProfileRouter 的 DB 刷新）落到 .env 的真实开发库
os.environ["DATABASE_URL"] = os.environ.get("TEST_DB_URL", "postgresql://postgres:postgres@localhost:5432/nursing_test")
os.environ["SKIP_SEED"] = "1"
# TESTING=1 是 verify_schema() 唯一的 create_all 逃生舱（见 core/database.py）；
# 生产启动只校验 alembic head，不建表也不迁移。
os.environ["TESTING"] = "1"


import pytest


@pytest.fixture
def pg_session():
    """PG 会话夹具（savepoint 隔离）——本仓**始终面向 PostgreSQL**，不做跨库降级。

    用法：模块里先 `Base.metadata.create_all(engine, tables=[...])`（幂等），再用本夹具。
    用例内部的 `commit()` 只会释放 savepoint，外层事务在 teardown 回滚 → 对库零残留，
    因此既不需要 SQLite 替身，也不需要互相踩数据的清理逻辑。
    """
    from sqlalchemy.orm import Session

    from core.database import engine

    with engine.connect() as conn:
        outer = conn.begin()
        session = Session(bind=conn, join_transaction_mode="create_savepoint")
        try:
            yield session
        finally:
            session.close()
            outer.rollback()
