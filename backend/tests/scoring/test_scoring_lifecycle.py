"""状态机守卫测试：已有 Score 的记录不得被标 failed。"""

import pytest

from models import Case, Message, Score, TrainingRecord
from modules.training.router.scoring import _resolve_terminal_status


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

    from modules.training.router import scoring as scoring_mod

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


def _make_record(db_session, scoring_status):
    case = Case(name="入口守卫病例", training_type="history_taking", difficulty=1, case_data={})
    db_session.add(case)
    db_session.flush()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status=scoring_status,
    )
    db_session.add(rec)
    db_session.flush()
    db_session.add(Message(record_id=rec.id, role="student", content="主诉是什么？"))
    db_session.flush()
    return rec


def _run_background_with_mocked_evaluate(db_session, monkeypatch, rec):
    """驱动 _run_scoring_background，mock 掉真实评分，返回 evaluate 是否被调用。"""
    import asyncio

    import core.database
    from modules.training.router import scoring as scoring_mod

    monkeypatch.setattr(core.database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(scoring_mod, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)

    called = {}

    async def _fake_evaluate(record_id, case_data, db, **kwargs):
        called["record_id"] = record_id

    monkeypatch.setattr(scoring_mod, "evaluate_training", _fake_evaluate)

    asyncio.run(scoring_mod._run_scoring_background(rec.id, {}, llm_client=None))
    db_session.expire_all()
    return called


def test_run_scoring_background_claims_pending_and_scores(db_session, monkeypatch):
    """回归守卫 BUG：'pending'（acquire 后的真实状态）应被认领为 processing 并执行评分。"""
    rec = _make_record(db_session, scoring_status="pending")

    called = _run_background_with_mocked_evaluate(db_session, monkeypatch, rec)

    assert called.get("record_id") == rec.id
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.scoring_status == "completed"


def test_run_scoring_background_claims_null_settlement_path(db_session, monkeypatch):
    """settlement 自动结算路径 scoring_status 为 NULL，也应被认领执行。"""
    rec = _make_record(db_session, scoring_status=None)

    called = _run_background_with_mocked_evaluate(db_session, monkeypatch, rec)

    assert called.get("record_id") == rec.id


def test_run_scoring_background_skips_completed(db_session, monkeypatch):
    """已完成的记录不得被重复评分（非可执行态跳过）。"""
    rec = _make_record(db_session, scoring_status="completed")

    called = _run_background_with_mocked_evaluate(db_session, monkeypatch, rec)

    assert "record_id" not in called


pytestmark = pytest.mark.integration
