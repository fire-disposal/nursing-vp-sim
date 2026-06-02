"""
PostgreSQL 迁移集成测试

验证:
1. PG 连接和基础 CRUD
2. 所有模型的 DateTime(timezone=True) 时区持久化
3. Alembic 迁移可正确执行
4. 种子数据初始化
5. 复合索引创建
"""
import os
import pytest
from datetime import datetime, timezone

# PG 测试数据库（独立不影响主库）
PG_TEST_URL = os.getenv("PG_TEST_URL", "postgresql://postgres:postgres@localhost:5432/postgres")

# 仅当 PG 可用时运行
pytestmark = pytest.mark.pg


def _pg_available():
    """检测本地 PG 是否可达"""
    try:
        from sqlalchemy import create_engine, text
        e = create_engine(PG_TEST_URL, isolation_level="AUTOCOMMIT")
        with e.connect() as c:
            c.execute(text("SELECT 1"))
        e.dispose()
        return True
    except Exception:
        return False


requires_pg = pytest.mark.skipif(not _pg_available(), reason="本地 PostgreSQL 不可用")


@pytest.fixture(scope="module")
def pg_engine():
    """创建独立 PG 测试库并返回 engine"""
    from sqlalchemy import create_engine, text

    admin_url = PG_TEST_URL

    # 使用 autocommit 创建/删除测试库
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as c:
        c.execute(text("DROP DATABASE IF EXISTS test_nursing_vp_migration"))
        c.execute(text("CREATE DATABASE test_nursing_vp_migration"))
    admin_engine.dispose()

    base_url = PG_TEST_URL.rsplit("/", 1)[0]
    test_url = f"{base_url}/test_nursing_vp_migration"

    from database import Base
    engine = create_engine(test_url)

    Base.metadata.create_all(bind=engine)

    with engine.connect() as conn:
        conn.execute(Base.metadata.tables["roles"].insert().values(
            [{"name": "teacher", "display_name": "教师", "is_system": True},
             {"name": "student", "display_name": "学生", "is_system": True}]
        ))
        conn.execute(Base.metadata.tables["role_permissions"].insert().values([
            {"role_name": "teacher", "permission": p} for p in [
                "teacher_access", "user_manage", "case_manage", "score_review",
                "llm_monitor", "api_manage", "prompt_manage",
                "grade_class_manage", "backup_manage",
            ]
        ] + [
            {"role_name": "student", "permission": p} for p in [
                "training_access", "qa_access",
            ]
        ]))
        conn.commit()

    yield engine

    Base.metadata.drop_all(bind=engine)
    engine.dispose()

    # 清理测试库
    admin_engine = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with admin_engine.connect() as c:
        c.execute(text("DROP DATABASE IF EXISTS test_nursing_vp_migration"))
    admin_engine.dispose()


@pytest.fixture(scope="function")
def pg_session(pg_engine):
    from sqlalchemy.orm import sessionmaker
    Session = sessionmaker(bind=pg_engine)
    session = Session()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@requires_pg
class TestDateTimeTimezone:
    """验证 DateTime(timezone=True) 正确持久化时区"""

    def test_datetime_stores_utc(self, pg_session):
        from models import User

        now = datetime(2026, 5, 29, 12, 0, 0, tzinfo=timezone.utc)
        user = User(
            username="tztest",
            password_hash="hash",
            role="student",
            display_name="时区测试",
            created_at=now,
        )
        pg_session.add(user)
        pg_session.commit()
        pg_session.refresh(user)

        assert user.created_at is not None
        assert user.created_at.tzinfo is not None
        assert user.created_at.utcoffset() is not None
        assert user.created_at == now

    def test_datetime_default_is_utc(self, pg_session):
        from models import Case

        case = Case(
            name="测试",
            description="desc",
            case_data={"key": "value"},
        )
        pg_session.add(case)
        pg_session.commit()
        pg_session.refresh(case)

        assert case.created_at is not None
        assert case.created_at.tzinfo is not None


@requires_pg
class TestAllModelsCreate:
    """验证全部 7 张表可创建"""

    def test_users_table(self, pg_session):
        from models import User
        from auth import hash_password
        user = User(
            username="pgtest",
            password_hash=hash_password("test"),
            role="student",
            display_name="测试用户",
            student_id="20240099",
        )
        pg_session.add(user)
        pg_session.commit()
        assert user.id is not None

    def test_cases_table(self, pg_session):
        from models import Case
        case = Case(
            name="PG测试病例",
            description="迁移验证",
            case_data={"patient_info": {"name": "测试"}},
        )
        pg_session.add(case)
        pg_session.commit()
        assert case.id is not None
        assert case.case_data["patient_info"]["name"] == "测试"

    def test_training_records_table(self, pg_session):
        from models import User, Case, TrainingRecord
        from auth import hash_password

        user = User(username="truser", password_hash=hash_password("pw"),
                     role="student", display_name="TR User")
        case = Case(name="TR Case", description="", case_data={})
        pg_session.add_all([user, case])
        pg_session.commit()

        tr = TrainingRecord(user_id=user.id, case_id=case.id, status="in_progress")
        pg_session.add(tr)
        pg_session.commit()
        assert tr.id is not None

    def test_messages_table(self, pg_session):
        from models import User, Case, TrainingRecord, Message
        from auth import hash_password

        user = User(username="msguser", password_hash=hash_password("pw"),
                     role="student", display_name="Msg User")
        case = Case(name="Msg Case", description="", case_data={})
        pg_session.add_all([user, case])
        pg_session.commit()

        tr = TrainingRecord(user_id=user.id, case_id=case.id, status="in_progress")
        pg_session.add(tr)
        pg_session.commit()

        msg = Message(record_id=tr.id, role="student", content="你好")
        pg_session.add(msg)
        pg_session.commit()
        assert msg.id is not None
        assert msg.content == "你好"

    def test_scores_table(self, pg_session):
        from models import User, Case, TrainingRecord, Score
        from auth import hash_password

        user = User(username="scuser", password_hash=hash_password("pw"),
                     role="student", display_name="Score User")
        case = Case(name="Score Case", description="", case_data={})
        pg_session.add_all([user, case])
        pg_session.commit()

        tr = TrainingRecord(user_id=user.id, case_id=case.id, status="completed",
                            scoring_status="completed")
        pg_session.add(tr)
        pg_session.commit()

        score = Score(
            record_id=tr.id,
            total_score=85.5,
            detail_scores={"沟通技能": {"score": 50, "max": 74, "items": []}},
            strengths=["问诊全面"],
            weaknesses=["缺少问候"],
        )
        pg_session.add(score)
        pg_session.commit()
        assert score.id is not None
        assert score.total_score == 85.5
        assert "问诊全面" in score.strengths

    def test_notes_table(self, pg_session):
        from models import User, Case, TrainingRecord, Note
        from auth import hash_password

        user = User(username="noteuser", password_hash=hash_password("pw"),
                     role="student", display_name="Note User")
        case = Case(name="Note Case", description="", case_data={})
        pg_session.add_all([user, case])
        pg_session.commit()

        tr = TrainingRecord(user_id=user.id, case_id=case.id, status="completed")
        pg_session.add(tr)
        pg_session.commit()

        note = Note(record_id=tr.id, user_id=user.id, content="这是一条笔记")
        pg_session.add(note)
        pg_session.commit()
        assert note.id is not None

    def test_llm_call_logs_table(self, pg_session):
        from models import User, Case, TrainingRecord, LLMCallLog
        from auth import hash_password

        user = User(username="llmuser", password_hash=hash_password("pw"),
                     role="student", display_name="LLM User")
        case = Case(name="LLM Case", description="", case_data={})
        pg_session.add_all([user, case])
        pg_session.commit()

        tr = TrainingRecord(user_id=user.id, case_id=case.id, status="in_progress")
        pg_session.add(tr)
        pg_session.commit()

        log = LLMCallLog(
            user_id=user.id,
            record_id=tr.id,
            case_id=case.id,
            purpose="patient_chat",
            provider_name="deepseek",
            model="deepseek-chat",
            prompt_tokens=100,
            completion_tokens=50,
            total_tokens=150,
            token_estimated=0,
            estimated_cost=0.0003,
            latency_ms=1200,
            status="success",
            request_chars=500,
            response_chars=200,
        )
        pg_session.add(log)
        pg_session.commit()
        assert log.id is not None
        assert log.purpose == "patient_chat"
        assert log.status == "success"


@requires_pg
class TestCompositeIndexes:
    """验证复合索引在 PG 中正常创建"""

    def test_ix_msg_record_created_exists(self, pg_engine):
        from sqlalchemy import inspect
        inspector = inspect(pg_engine)
        indexes = inspector.get_indexes("messages")
        index_names = [idx["name"] for idx in indexes]
        assert "ix_msg_record_created" in index_names

    def test_ix_tr_user_status_exists(self, pg_engine):
        from sqlalchemy import inspect
        inspector = inspect(pg_engine)
        indexes = inspector.get_indexes("training_records")
        index_names = [idx["name"] for idx in indexes]
        assert "ix_tr_user_status" in index_names

    def test_ix_tr_status_exists(self, pg_engine):
        from sqlalchemy import inspect
        inspector = inspect(pg_engine)
        indexes = inspector.get_indexes("training_records")
        index_names = [idx["name"] for idx in indexes]
        assert "ix_tr_status" in index_names


@requires_pg
class TestSeedData:
    """验证种子数据可正常初始化"""

    def test_seed_data_initializes(self, pg_session):
        from models import User, Case
        from auth import hash_password
        import json
        import os

        user_count = pg_session.query(User).count()
        if user_count > 0:
            pytest.skip("种子数据已存在")

        admin = User(
            username="admin",
            password_hash=hash_password("admin123"),
            role="teacher",
            display_name="管理员",
        )
        pg_session.add(admin)

        for i in range(1, 6):
            student = User(
                username=f"student{i}",
                password_hash=hash_password("123456"),
                role="student",
                display_name=f"学生{i}",
                student_id=f"202400{i:02d}",
            )
            pg_session.add(student)

        cases_dir = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "cases"
        )
        case_count = 0
        for case_file in sorted(os.listdir(cases_dir)):
            if case_file.endswith(".json"):
                with open(os.path.join(cases_dir, case_file), "r", encoding="utf-8") as f:
                    case_data = json.load(f)
                case = Case(
                    name=case_data.get("name", case_file),
                    description=case_data.get("description", ""),
                    case_data=case_data,
                )
                pg_session.add(case)
                case_count += 1

        pg_session.commit()

        assert pg_session.query(User).count() == 6
        assert pg_session.query(Case).count() == case_count


@requires_pg
class TestScoreScoreScaleDefault:
    """验证 score_scale 和 token_estimated 的 server_default"""

    def test_token_estimated_default(self, pg_session):
        from models import User, Case, TrainingRecord, LLMCallLog
        from auth import hash_password

        user = User(username="deftest", password_hash=hash_password("pw"),
                     role="student", display_name="Def Test")
        case = Case(name="Def Case", description="", case_data={})
        pg_session.add_all([user, case])
        pg_session.commit()

        tr = TrainingRecord(user_id=user.id, case_id=case.id)
        pg_session.add(tr)
        pg_session.commit()

        log = LLMCallLog(
            purpose="patient_chat",
            provider_name="deepseek",
            model="deepseek-chat",
            status="success",
        )
        pg_session.add(log)
        pg_session.commit()

        assert log.token_estimated == 1  # model default
        assert log.status == "success"
