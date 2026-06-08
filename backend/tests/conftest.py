import os

os.environ["SECRET_KEY"] = "test-secret-key-for-testing-only"
os.environ["DEEPSEEK_API_KEY"] = "sk-test-placeholder"
os.environ["SKIP_SEED"] = "1"
os.environ["SKIP_MIGRATION"] = "1"

TEST_DB_URL = os.environ.get(
    "TEST_DB_URL",
    "postgresql://postgres:postgres@localhost:5432/nursing_test",
)

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
    """PostgreSQL test database. Set TEST_DB_URL to override default."""
    eng = create_engine(TEST_DB_URL.replace("postgresql://", "postgresql+psycopg://", 1))

    Base.metadata.drop_all(bind=eng)
    Base.metadata.create_all(bind=eng)

    with eng.connect() as conn:
        conn.execute(
            Base.metadata.tables["schools"]
            .insert()
            .values([{"name": "默认学校"}])
        )
        conn.execute(
            Base.metadata.tables["roles"]
            .insert()
            .values(
                [
                    {"name": "teacher", "display_name": "教师", "is_system": True, "school_id": 1},
                    {"name": "student", "display_name": "学生", "is_system": True, "school_id": 1},
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
                        "prompt_manage",
                        "grade_class_manage",
                        "stats_view",
                        "feedback_review",
                        "questionnaire_manage",
                        "export_data",
                    ]
                ]
                + [
                    {"role_id": 2, "permission": p}
                    for p in [
                        "training_access",
                        "qa_access",
                    ]
                ]
            )
        )
        conn.commit()

    yield eng
    Base.metadata.drop_all(bind=eng)
    eng.dispose()


@pytest.fixture
def db_session(engine):
    """Fresh DB session."""
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture
def client(engine, db_session):
    """FastAPI TestClient with overridden DB dependency."""
    from main import app

    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

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
    app.state.log_worker = MagicMock()

    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# ── convenience fixtures ──


@pytest.fixture
def teacher(client, db_session):
    """Create a teacher user and return (user, token)."""
    from models import Role
    teacher_role = db_session.query(Role).filter(Role.name == "teacher").first()
    user = User(
        username="teacher1",
        password_hash=hash_password("teacher123"),
        role_id=teacher_role.id,
        school_id=1,
        display_name="张老师",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    resp = client.post("/api/auth/login", json={"username": "teacher1", "password": "teacher123"})
    return user, resp.json()["access_token"]


@pytest.fixture
def student(client, db_session):
    """Create a student user and return (user, token)."""
    from models import Role
    student_role = db_session.query(Role).filter(Role.name == "student").first()
    user = User(
        username="student1",
        password_hash=hash_password("student123"),
        role_id=student_role.id,
        school_id=1,
        display_name="李明",
        student_id="20240001",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)

    resp = client.post("/api/auth/login", json={"username": "student1", "password": "student123"})
    return user, resp.json()["access_token"]


@pytest.fixture
def test_case(db_session):
    """Create a test case and return it."""
    case = Case(
        name="测试病例-高血压",
        description="高血压病史采集练习",
        school_id=1,
        case_data={
            "name": "测试病例-高血压",
            "time_limit": 20,
            "patient_info": {"name": "王大爷", "age": 65, "gender": "男"},
            "chief_complaint": "头晕、头痛一周",
            "opening_line": "医生你好，我最近老是头晕...",
            "present_illness": "近一周反复头晕头痛",
            "past_history": "否认",
            "medication_history": "无",
            "allergy_history": "无",
            "family_history": "父亲有高血压",
            "social_history": "吸烟30年",
            "communication_style": "患者性格温和",
            "hidden_info": ["有吸烟史"],
            "required_inquiries": ["血压值", "吸烟史"],
            "scoring_criteria": {
                "沟通技能": {"max": 42, "description": "", "items": []},
                "病史采集": {"max": 15, "description": "", "items": []},
            },
        },
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(case)
    return case
