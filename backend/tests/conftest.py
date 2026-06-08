import os

os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"
os.environ["SKIP_SEED"] = "1"
os.environ["SKIP_MIGRATION"] = "1"

TEST_DB_URL = os.environ.get(
    "TEST_DB_URL",
    "postgresql://postgres:postgres@localhost:5432/nursing_test",
)

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.database import Base, get_db
from core.security import hash_password
from models import Case, User


@pytest.fixture
def engine():
    eng = create_engine(TEST_DB_URL.replace("postgresql://", "postgresql+psycopg://", 1))
    Base.metadata.drop_all(bind=eng)
    Base.metadata.create_all(bind=eng)

    with eng.connect() as conn:
        conn.execute(Base.metadata.tables["schools"].insert().values([{"name": "\u9ed8\u8ba4\u5b66\u6821"}]))
        conn.execute(
            Base.metadata.tables["roles"].insert().values(
                [
                    {"name": "teacher", "display_name": "\u6559\u5e08", "is_system": True, "school_id": 1},
                    {"name": "student", "display_name": "\u5b66\u751f", "is_system": True, "school_id": 1},
                ]
            )
        )
        conn.execute(
            Base.metadata.tables["role_permissions"].insert().values(
                [{"role_id": 1, "permission": p} for p in [
                    "teacher_access", "user_manage", "case_manage", "score_review",
                    "llm_monitor", "api_manage", "prompt_manage", "grade_class_manage",
                    "stats_view", "feedback_review", "questionnaire_manage", "export_data",
                ]]
                + [{"role_id": 2, "permission": p} for p in ["training_access", "qa_access"]]
            )
        )
        conn.commit()

    yield eng
    Base.metadata.drop_all(bind=eng)
    eng.dispose()


@pytest.fixture
def db_session(engine):
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client(engine, db_session):
    from main import app

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    # Skip real lifespan — manually set up all app.state mocks
    @asynccontextmanager
    async def _empty_lifespan(_app):
        yield

    app.router.lifespan_context = _empty_lifespan

    rate_limiter = MagicMock()
    rate_limiter.is_allowed = AsyncMock(return_value=True)
    rate_limiter.reset_key = AsyncMock()
    app.state.rate_limiter = rate_limiter

    mock_pm_template = MagicMock()
    mock_pm_template.render = MagicMock(return_value="mock system prompt")
    mock_pm = MagicMock()
    mock_pm.get = AsyncMock(return_value=mock_pm_template)
    app.state.prompt_manager = mock_pm

    mock_router = MagicMock()
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

    from infrastructure.cache import EmotionCache, InitiativeCache
    app.state.emotion_cache = EmotionCache()
    app.state.initiative_cache = InitiativeCache()

    from routers.training.base import set_training_infra
    set_training_infra(app.state.httpx_client, app.state.llm_router, app.state.prompt_manager, app.state.log_worker)

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def teacher(client, db_session):
    from models import Role
    teacher_role = db_session.query(Role).filter(Role.name == "teacher").first()
    user = User(
        username="teacher1", password_hash=hash_password("teacher123"),
        role_id=teacher_role.id, school_id=1, display_name="\u5f20\u8001\u5e08",
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
        username="student1", password_hash=hash_password("student123"),
        role_id=student_role.id, school_id=1, display_name="\u674e\u660e", student_id="20240001",
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
        school_id=1,
        case_data={
            "name": "\u6d4b\u8bd5\u75c5\u4f8b-\u9ad8\u8840\u538b",
            "time_limit": 20,
            "patient_info": {"name": "\u738b\u5927\u7237", "age": 65, "gender": "\u7537"},
            "chief_complaint": "\u5934\u6655\u3001\u5934\u75db\u4e00\u5468",
            "opening_line": "\u533b\u751f\u4f60\u597d\uff0c\u6211\u6700\u8fd1\u8001\u662f\u5934\u6655...",
            "present_illness": "\u8fd1\u4e00\u5468\u53cd\u590d\u5934\u6655\u5934\u75db",
            "required_inquiries": ["\u8840\u538b\u503c", "\u5438\u70df\u53f2"],
            "scoring_criteria": {
                "\u6c9f\u901a\u6280\u80fd": {"max": 42, "description": "", "items": []},
                "\u75c5\u53f2\u91c7\u96c6": {"max": 15, "description": "", "items": []},
            },
        },
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(case)
    return case
