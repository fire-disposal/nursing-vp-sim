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


@pytest.fixture(scope="session", autouse=True)
def _schema_matches_models():
    """把测试库 schema 重建为与模型一致（drop + create），消掉一类环境陷阱。

    `create_all` 只建**缺失的表**，不会给既有表补列 —— 于是"模型加了列、库里还没有"
    会让用例报 `UndefinedColumn`，而这类假失败会诱使每个测试模块各自写
    `ALTER TABLE … ADD COLUMN IF NOT EXISTS` 绕过（2026-09-26 加登录锁定两列时，
    两个测试模块各自补了一次）。测试库归测试所有（`pg_session` 的 savepoint 隔离本就
    以"库可被整体收拾"为前提），因此一次性重建是更省事的做法。

    守卫：库名必须含 `test`。`TEST_DB_URL` 若被误指向开发/生产库，宁可用例直接停，
    也不静默删库。
    """
    from sqlalchemy.engine import make_url

    import models  # noqa: F401  —— 注册全部表到 Base.metadata
    from core.database import Base, engine

    db_name = (make_url(str(engine.url)).database or "").lower()
    if "test" not in db_name:
        pytest.exit(f"拒绝重建非测试库的 schema: {db_name!r}（TEST_DB_URL 必须指向测试库）", returncode=1)
    with engine.begin() as conn:
        Base.metadata.drop_all(conn)
    Base.metadata.create_all(engine)


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
