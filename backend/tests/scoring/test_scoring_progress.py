"""Tests for ScoringProgressTracker (in-memory dict)."""

import pytest

from infra.scoring_progress import ScoringProgressTracker
from models import Case, TrainingRecord, User


@pytest.fixture
def test_case(db_session):
    case = Case(
        name="测试病例",
        description="测试",
        case_data={"name": "测试"},
    )
    db_session.add(case)
    db_session.commit()
    db_session.refresh(case)
    return case


@pytest.fixture
def test_training_record(db_session, test_case):
    user = User(
        username="test-user-sp",
        password_hash="x",
        role_id=1,
        display_name="Test",
    )
    db_session.add(user)
    db_session.flush()
    record = TrainingRecord(
        user_id=user.id,
        case_id=test_case.id,
        status="in_progress",
    )
    db_session.add(record)
    db_session.commit()
    # reload to get the actual id
    db_session.refresh(record)
    return record


class TestScoringProgressTracker:
    def test_lifecycle(self, db_session, test_training_record):
        rid = test_training_record.id
        t = ScoringProgressTracker()
        t.start(rid)
        entry = t.get(rid)
        assert entry is not None
        assert entry["stage"] == "loading"
        assert entry["percent"] == 0

        t.update(rid, "scoring", 30, "正在评分")
        entry = t.get(rid)
        assert entry["stage"] == "scoring"
        assert entry["percent"] == 30
        assert entry["message"] == "正在评分"

    def test_update_overwrites(self, db_session, test_training_record):
        rid = test_training_record.id
        t = ScoringProgressTracker()
        t.start(rid)
        t.update(rid, "scoring", 50, "中期")
        t.update(rid, "feedback", 75, "后期")
        entry = t.get(rid)
        assert entry["stage"] == "feedback"
        assert entry["percent"] == 75

    def test_unknown_record_returns_none(self, db_session):
        t = ScoringProgressTracker()
        assert t.get(999) is None

    def test_get_progress_alias(self, db_session, test_training_record):
        rid = test_training_record.id
        t = ScoringProgressTracker()
        t.set(rid, "scoring", 50, "test")
        assert t.get_progress(rid) == t.get(rid)

    def test_multiple_records_independent(self, db_session, test_case):
        t = ScoringProgressTracker()
        user = User(
            username="test-user-multi",
            password_hash="x",
            role_id=1,
            display_name="Test",
        )
        db_session.add(user)
        db_session.flush()
        r1 = TrainingRecord(user_id=user.id, case_id=test_case.id, status="in_progress")
        r2 = TrainingRecord(user_id=user.id, case_id=test_case.id, status="in_progress")
        db_session.add_all([r1, r2])
        db_session.commit()
        db_session.refresh(r1)
        db_session.refresh(r2)

        t.start(r1.id)
        t.start(r2.id)
        t.update(r1.id, "scoring", 30, "record 1")
        t.update(r2.id, "feedback", 70, "record 2")
        assert t.get(r1.id)["stage"] == "scoring"
        assert t.get(r2.id)["stage"] == "feedback"
