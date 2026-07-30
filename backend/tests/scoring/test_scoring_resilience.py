"""Scoring resilience tests: D5 auto-retry, D6 settlement sweep, 1.7 queue full rollback."""

import asyncio
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, cast

from models import Case, Message, Score, TrainingRecord, User

if TYPE_CHECKING:
    from infra.llm.client import LLMClient


def _make_record(db_session, scoring_status):
    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    if not case:
        case = Case(name="__seed_test_case__", training_type="history_taking", difficulty=1, case_data={})
        db_session.add(case)
        db_session.flush()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="in_progress",
        scoring_status=scoring_status,
    )
    db_session.add(rec)
    db_session.flush()
    return rec


# ── D5: Auto-retry ──────────────────────────────────────────────


def test_run_scoring_background_retries_once_and_succeeds(db_session, monkeypatch):
    """evaluate_training fails once, succeeds on retry → completed."""
    import core.database
    from modules.training.router import scoring as scoring_mod

    rec = _make_record(db_session, scoring_status="pending")
    db_session.add(Message(record_id=rec.id, role="student", content="主诉是什么？"))
    db_session.flush()

    call_count = [0]

    async def _fake_evaluate(record_id, case_data, db, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            raise RuntimeError("LLM connection reset")

    monkeypatch.setattr(core.database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(scoring_mod, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    monkeypatch.setattr(scoring_mod, "evaluate_training", _fake_evaluate)
    monkeypatch.setattr(scoring_mod, "SCORING_RETRY_DELAY_SECONDS", 0)

    asyncio.run(scoring_mod._run_scoring_background(rec.id, {}, llm_client=cast("LLMClient", None)))

    assert call_count[0] == 2

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.scoring_status == "completed"


def test_run_scoring_background_no_retry_on_timeout(db_session, monkeypatch):
    """TimeoutError → no retry, fail immediately."""
    import core.database
    from modules.training.router import scoring as scoring_mod

    rec = _make_record(db_session, scoring_status="pending")
    db_session.add(Message(record_id=rec.id, role="student", content="主诉是什么？"))
    db_session.flush()

    call_count = [0]

    async def _fake_evaluate(record_id, case_data, db, **kwargs):
        call_count[0] += 1
        raise TimeoutError("scoring timed out")

    monkeypatch.setattr(core.database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(scoring_mod, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    monkeypatch.setattr(scoring_mod, "evaluate_training", _fake_evaluate)
    monkeypatch.setattr(scoring_mod, "SCORING_RETRY_DELAY_SECONDS", 0)

    asyncio.run(scoring_mod._run_scoring_background(rec.id, {}, llm_client=cast("LLMClient", None)))

    assert call_count[0] == 1  # No retry

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.scoring_status == "failed"


def test_run_scoring_background_retry_exhausted_fails(db_session, monkeypatch):
    """Two consecutive non-timeout failures → fail after retry exhausted."""
    import core.database
    from modules.training.router import scoring as scoring_mod

    rec = _make_record(db_session, scoring_status="pending")
    db_session.add(Message(record_id=rec.id, role="student", content="主诉是什么？"))
    db_session.flush()

    call_count = [0]

    async def _fake_evaluate(record_id, case_data, db, **kwargs):
        call_count[0] += 1
        raise RuntimeError("LLM persistent error")

    monkeypatch.setattr(core.database, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(scoring_mod, "SessionLocal", lambda: db_session)
    monkeypatch.setattr(db_session, "close", lambda: None)
    monkeypatch.setattr(scoring_mod, "evaluate_training", _fake_evaluate)
    monkeypatch.setattr(scoring_mod, "SCORING_RETRY_DELAY_SECONDS", 0)

    asyncio.run(scoring_mod._run_scoring_background(rec.id, {}, llm_client=cast("LLMClient", None)))

    assert call_count[0] == 2  # Original + 1 retry = 2 attempts

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.scoring_status == "failed"


# ── D6: Settlement sweep ────────────────────────────────────────


def test_sweep_stale_scoring_records_marks_old(db_session):
    """scoring_status='processing' + end_time 15 min ago → marked failed."""
    from modules.training.session.settlement import STALE_SCORING_SWEEP_MINUTES, _sweep_stale_scoring_records

    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    old = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="processing",
        end_time=datetime.now(UTC) - timedelta(minutes=STALE_SCORING_SWEEP_MINUTES + 5),
    )
    db_session.add(old)
    db_session.flush()
    db_session.add(Message(record_id=old.id, role="student", content="主诉是什么？"))
    db_session.flush()

    count = _sweep_stale_scoring_records(db_session)
    assert count == 1

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == old.id).first()
    assert updated.scoring_status == "failed"
    assert updated.scoring_error == "评分超时，已自动标记失败，可手动重试"


def test_sweep_stale_scoring_records_ignores_recent(db_session):
    """scoring_status='processing' + end_time 5 min ago → untouched."""
    from modules.training.session.settlement import STALE_SCORING_SWEEP_MINUTES, _sweep_stale_scoring_records

    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    recent = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="processing",
        end_time=datetime.now(UTC) - timedelta(minutes=STALE_SCORING_SWEEP_MINUTES - 5),
    )
    db_session.add(recent)
    db_session.flush()

    count = _sweep_stale_scoring_records(db_session)
    assert count == 0

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == recent.id).first()
    assert updated.scoring_status == "processing"


def test_sweep_stale_scoring_records_handles_null_end_time(db_session):
    """Records with NULL end_time are ignored (safety)."""
    from modules.training.session.settlement import _sweep_stale_scoring_records

    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    null_end = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="in_progress",
        scoring_status="pending",
        end_time=None,
    )
    db_session.add(null_end)
    db_session.flush()

    count = _sweep_stale_scoring_records(db_session)
    assert count == 0


def test_sweep_stale_scoring_records_marks_pending_too(db_session):
    """scoring_status='pending' + stale end_time → also swept."""
    from modules.training.session.settlement import STALE_SCORING_SWEEP_MINUTES, _sweep_stale_scoring_records

    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="pending",
        end_time=datetime.now(UTC) - timedelta(minutes=STALE_SCORING_SWEEP_MINUTES + 5),
    )
    db_session.add(rec)
    db_session.flush()
    db_session.add(Message(record_id=rec.id, role="student", content="主诉是什么？"))
    db_session.flush()

    count = _sweep_stale_scoring_records(db_session)
    assert count == 1

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.scoring_status == "failed"


def test_sweep_stale_scoring_records_discards_no_student_records(db_session):
    """Stale scoring record with no student turn is marked with error, not failed."""
    from modules.training.session.settlement import STALE_SCORING_SWEEP_MINUTES, _sweep_stale_scoring_records

    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status="completed",
        scoring_status="processing",
        end_time=datetime.now(UTC) - timedelta(minutes=STALE_SCORING_SWEEP_MINUTES + 5),
    )
    db_session.add(rec)
    db_session.flush()

    count = _sweep_stale_scoring_records(db_session)
    assert count == 1

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.scoring_status is None
    assert updated.scoring_error == "no_student_messages"

def test_end_training_discards_no_student_messages(client, db_session):
    """End training with no student messages returns discarded and never queues scoring."""
    from core.security import hash_password
    from models import Role

    case = db_session.query(Case).filter(Case.name == "__seed_test_case__").first()
    student_role = db_session.query(Role).filter(Role.name == "student").first()
    user = User(
        username="empty_end_user",
        password_hash=hash_password("test123"),
        role_id=student_role.id,
        display_name="Empty End User",
    )
    db_session.add(user)
    db_session.flush()

    rec = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        training_type="history_taking",
        status="in_progress",
        scoring_status=None,
    )
    db_session.add(rec)
    db_session.commit()

    resp = client.post("/api/auth/login", json={"username": "empty_end_user", "password": "test123"})
    assert resp.status_code == 200, resp.text
    token = resp.json()["access_token"]

    resp = client.post(
        f"/api/training/{rec.id}/end",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["record_status"] == "discarded"
    assert body["scoring_status"] is None
    assert body["terminal_reason"] == "no_student_messages"

    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.status == "discarded"
    assert updated.scoring_status is None
    assert updated.scoring_error == "no_student_messages"


# ── 1.7: Queue full rollback ────────────────────────────────────



