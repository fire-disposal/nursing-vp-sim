"""状态机守卫测试：已有 Score 的记录不得被标 failed。"""

import pytest

from contexts.training.router.scoring import _resolve_terminal_status
from models import Case, Score, TrainingRecord


@pytest.fixture
def record_with_score(db_session):
    case = Case(name="测试病例", training_type="history_taking", difficulty=1, case_data={})
    db_session.add(case)
    db_session.flush()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="processing",
    )
    db_session.add(rec)
    db_session.flush()
    score = Score(
        record_id=rec.id,
        total_score=80,
        detail_scores={},
        strengths=["a"],
        weaknesses=["b"],
        missed_content=["c"],
        suggestions="d",
        rubric_version="v1",
        prompt_version=0,
        score_scale=100,
    )
    db_session.add(score)
    db_session.flush()
    return rec


def test_resolve_terminal_status_completed_when_score_exists(db_session, record_with_score):
    status = _resolve_terminal_status(db_session, record_with_score.id, intended="failed")
    assert status == "completed"


def test_resolve_terminal_status_keeps_failed_when_no_score(db_session):
    case = Case(name="无分病例", training_type="history_taking", difficulty=1, case_data={})
    db_session.add(case)
    db_session.flush()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="processing",
    )
    db_session.add(rec)
    db_session.flush()
    status = _resolve_terminal_status(db_session, rec.id, intended="failed")
    assert status == "failed"


def test_handle_scoring_failure_corrects_to_completed_when_score_exists(db_session, record_with_score, monkeypatch):
    import core.database

    monkeypatch.setattr(core.database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    from contexts.training.router import scoring as scoring_mod

    scoring_mod._handle_scoring_failure(record_with_score.id, "评分超时")

    db_session.expire_all()
    rec = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_with_score.id).first()
    assert rec.scoring_status == "completed"
    assert rec.scoring_error is None


def test_recovery_marks_completed_when_score_exists(db_session, record_with_score, monkeypatch):
    import core.database

    monkeypatch.setattr(core.database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    from main import _recover_stuck_scoring_records

    _recover_stuck_scoring_records()

    db_session.expire_all()
    rec = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_with_score.id).first()
    assert rec.scoring_status == "completed"
