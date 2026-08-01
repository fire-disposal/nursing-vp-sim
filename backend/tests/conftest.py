import os
import warnings

warnings.filterwarnings("ignore", message=".*httpx.*starlette.*deprecated.*")
os.environ["JWT_SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"
os.environ["SKIP_SEED"] = "1"
os.environ["SKIP_MIGRATION"] = "1"
os.environ["TESTING"] = "1"

TEST_DB_URL = os.environ.get(
    "TEST_DB_URL",
    "postgresql://postgres:postgres@localhost:5432/nursing_test",
)
os.environ["DATABASE_URL"] = TEST_DB_URL

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from core.database import Base, SessionLocal
from core.security import hash_password
from models import Case, User


@pytest.fixture(scope="session")
def engine():
    """Session-scoped: create schema once, seed static data, drop at end.

    PostgreSQL 不可达时跳过所有依赖测试（日常 pytest -m 'not integration'
    不经过这里；误跑全量时也不会因缺库而失败）。
    """
    # Windows 上 loopback 未监听端口是静默丢包而非 ECONNREFUSED，
    # 无超时会导致探测挂死，显式设 3s 连接超时。
    eng = create_engine(
        TEST_DB_URL.replace("postgresql://", "postgresql+psycopg://", 1),
        connect_args={"connect_timeout": 3},
    )
    try:
        with eng.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:
        eng.dispose()
        pytest.skip(f"PostgreSQL 不可用（{TEST_DB_URL}）：{exc}")
    Base.metadata.create_all(bind=eng)

    with eng.connect() as conn:
        if conn.execute(text("SELECT COUNT(*) FROM roles")).scalar() == 0:
            conn.execute(
                Base.metadata.tables["roles"]
                .insert()
                .values(
                    [
                        {"name": "teacher", "display_name": "教师", "is_system": True},
                        {"name": "student", "display_name": "学生", "is_system": True},
                    ]
                )
            )
            conn.execute(
                Base.metadata.tables["role_permissions"]
                .insert()
                .values(
                    [
                        {"role_id": 1, "permission": p}
                        for p in [
                            "teacher_access",
                            "user_manage",
                            "case_manage",
                            "score_review",
                            "llm_monitor",
                            "api_manage",
                            "assignment_manage",
                            "grade_class_manage",
                            "stats_view",
                            "feedback_review",
                            "questionnaire_manage",
                            "export_data",
                        ]
                    ]
                    + [{"role_id": 2, "permission": p} for p in ["training_access", "qa_access"]]
                    + [{"role_id": 1, "permission": "training_access"}]
                )
            )
            conn.commit()

    yield eng
    # DROP SCHEMA CASCADE：metadata 未声明 users.class_id → classes 的 FK
    # （alembic 迁移遗留约束），drop_all 的依赖排序不覆盖它，会报
    # DependentObjectsStillExist。测试库可整体重建，无需关心顺序。
    with eng.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    eng.dispose()


@pytest.fixture
def db_session(engine):
    """Function-scoped: connection-level transaction, rollback on teardown.

    Sets ``_test_connection`` ContextVar so ALL ``SessionLocal()`` calls
    (including those outside Depends injection) are bound to this
    connection and rolled back together.
    """
    import core.database as db_module

    connection = engine.connect()
    transaction = connection.begin()
    # Reset all sequences so auto-increment IDs start from 1 each test
    connection.execute(
        text("""
        DO $$
        DECLARE r RECORD;
        BEGIN
            FOR r IN SELECT c.relname FROM pg_class c
                     JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.relkind = 'S' AND n.nspname = 'public'
            LOOP
                EXECUTE 'ALTER SEQUENCE ' || quote_ident(r.relname) || ' RESTART WITH 1';
            END LOOP;
        END $$;
    """)
    )
    token = db_module._test_connection.set(connection)

    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == "__seed_test_user__").first()
        if not user:
            from core.security import hash_password

            user = User(
                username="__seed_test_user__",
                display_name="Seed Test User",
                password_hash=hash_password("testpass"),
                role_id=1,
            )
            session.add(user)
            session.flush()

        case = session.query(Case).filter(Case.name == "__seed_test_case__").first()
        if not case:
            case = Case(
                name="__seed_test_case__",
                description="Seed test case for unit tests",
                case_data={},
            )
            session.add(case)
            session.flush()

        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        db_module._test_connection.reset(token)


@pytest.fixture
def client(engine):
    from main import app

    # Skip real lifespan — manually set up all app.state mocks
    @asynccontextmanager
    async def _empty_lifespan(_app):
        yield

    app.router.lifespan_context = _empty_lifespan

    rate_limiter = MagicMock()
    rate_limiter.is_allowed = AsyncMock(return_value=True)
    rate_limiter.reset_key = AsyncMock()
    app.state.rate_limiter = rate_limiter

    mock_router = MagicMock()
    mock_router.load_from_db = AsyncMock()
    mock_router.select = MagicMock(return_value=MagicMock(model="test-model"))
    mock_router.get_decrypted_key = MagicMock(return_value="sk-test")
    mock_router.report_result = AsyncMock()
    app.state.llm_router = mock_router

    app.state.httpx_client = MagicMock()

    mock_log_worker = MagicMock()
    mock_log_worker.enqueue = MagicMock()
    mock_log_worker.start = AsyncMock()
    mock_log_worker.stop = AsyncMock()
    app.state.log_worker = mock_log_worker

    mock_llm_client = MagicMock()
    mock_llm_client.call = AsyncMock(return_value="mock response")
    mock_llm_client.call_json = AsyncMock(return_value={"score": 85})
    mock_llm_client.stream = MagicMock()
    app.state.llm_client = mock_llm_client

    mock_tq = MagicMock()
    mock_tq.enqueue = AsyncMock()
    mock_tq.start = AsyncMock()
    mock_tq.stop = AsyncMock()
    app.state.task_queue = mock_tq

    from modules.training.session.cache import EmotionCache, InitiativeCache

    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()

    from infra.bootstrap import set_training_infra

    set_training_infra(app.state.httpx_client, app.state.llm_router, app.state.log_worker)

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def teacher(client, db_session):
    from models import Role

    teacher_role = db_session.query(Role).filter(Role.name == "teacher").first()
    user = User(
        username="teacher1",
        password_hash=hash_password("teacher123"),
        role_id=teacher_role.id,
        display_name="\u5f20\u8001\u5e08",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    resp = client.post("/api/auth/login", json={"username": "teacher1", "password": "teacher123"})
    return user, resp.json()["access_token"]


@pytest.fixture
def student(client, db_session):
    from models import Role

    student_role = db_session.query(Role).filter(Role.name == "student").first()
    user = User(
        username="student1",
        password_hash=hash_password("student123"),
        role_id=student_role.id,
        display_name="\u674e\u660e",
        student_id="20240001",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    resp = client.post("/api/auth/login", json={"username": "student1", "password": "student123"})
    return user, resp.json()["access_token"]


@pytest.fixture
def test_case(db_session):
    case = Case(
        name="\u6d4b\u8bd5\u75c5\u4f8b-\u9ad8\u8840\u538b",
        description="\u9ad8\u8840\u538b\u75c5\u53f2\u91c7\u96c6\u7ec3\u4e60",
        is_open=True,
        case_data={
            "name": "\u6d4b\u8bd5\u75c5\u4f8b-\u9ad8\u8840\u538b",
            "time_limit": 20,
            "patient_info": {"name": "\u738b\u5927\u7237", "age": 65, "gender": "\u7537"},
            "chief_complaint": "\u5934\u6655\u3001\u5934\u75db\u4e00\u5468",
            "opening_line": "\u533b\u751f\u4f60\u597d\uff0c\u6211\u6700\u8fd1\u8001\u662f\u5934\u6655...",
            "present_illness": "\u8fd1\u4e00\u5468\u53cd\u590d\u5934\u6655\u5934\u75db",
            "required_inquiries": ["\u8840\u538b\u503c", "\u5438\u70df\u53f2"],
        },
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(case)
    return case


@pytest.fixture
def test_grade(db_session):
    from models import Grade

    grade = Grade(name="2024级")
    db_session.add(grade)
    db_session.commit()
    db_session.refresh(grade)
    return grade


@pytest.fixture
def test_class(db_session, test_grade):
    from models import Class

    cls = Class(name="护理1班", grade_id=test_grade.id)
    db_session.add(cls)
    db_session.commit()
    db_session.refresh(cls)
    return cls


@pytest.fixture
def test_student_in_class(db_session, student, test_class):
    from models import UserClass

    user_class = UserClass(user_id=student[0].id, class_id=test_class.id)
    db_session.add(user_class)
    db_session.commit()
    return student
