"""Settlement timeout auto-finalization, stale-by-activity query, and the chat guard."""

from datetime import UTC, datetime, timedelta

from models import Case, Message, TrainingRecord
from modules.training.session.settlement import _find_expired_records, _settle_expired_records


def _make_case(db_session) -> Case:
    case = Case(name="__settle_timeout_case__", training_type="history_taking", difficulty=1, case_data={})
    db_session.add(case)
    db_session.flush()
    return case


def _make_record(db_session, *, case, start_offset_minutes, time_limit=20, **kw) -> TrainingRecord:
    rec = TrainingRecord(
        user_id=1,
        case_id=case.id,
        training_type="history_taking",
        status=kw.pop("status", "in_progress"),
        time_limit=time_limit,
        start_time=datetime.now(UTC) - timedelta(minutes=start_offset_minutes),
        **kw,
    )
    db_session.add(rec)
    db_session.flush()
    return rec


def test_find_expired_records_only_deadline_past(db_session):
    case = _make_case(db_session)
    _make_record(db_session, case=case, start_offset_minutes=10)  # not expired
    expired = _make_record(db_session, case=case, start_offset_minutes=22)  # past deadline + grace
    _make_record(db_session, case=case, start_offset_minutes=22, status="completed")  # already ended

    found = _find_expired_records(db_session)
    assert [r.id for r in found] == [expired.id]


def test_settle_expired_finalizes_and_returns_pending(db_session):
    case = _make_case(db_session)
    rec = _make_record(db_session, case=case, start_offset_minutes=22)
    db_session.add(Message(record_id=rec.id, role="student", content="你好"))
    db_session.flush()

    pending = _settle_expired_records(db_session)

    assert [rid for rid, _ in pending] == [rec.id]
    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.status == "completed"
    assert updated.scoring_status == "pending"


def test_settle_expired_discards_when_no_student_messages(db_session):
    case = _make_case(db_session)
    rec = _make_record(db_session, case=case, start_offset_minutes=22)

    pending = _settle_expired_records(db_session)

    assert pending == []
    db_session.expire_all()
    updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == rec.id).first()
    assert updated.status == "discarded"
    assert updated.scoring_status is None


def test_settle_expired_is_idempotent(db_session):
    case = _make_case(db_session)
    rec = _make_record(db_session, case=case, start_offset_minutes=22)
    db_session.add(Message(record_id=rec.id, role="student", content="你好"))
    db_session.flush()

    first = _settle_expired_records(db_session)
    second = _settle_expired_records(db_session)

    assert len(first) == 1
    assert second == []


def test_chat_rejects_when_training_expired(client, student, test_case, db_session):
    """The chat guard must reject messages once the wall-clock deadline passed."""
    _, student_token = student
    rec = TrainingRecord(
        user_id=student[0].id,
        case_id=test_case.id,
        training_type="history_taking",
        status="in_progress",
        time_limit=20,
        start_time=datetime.now(UTC) - timedelta(minutes=21),
    )
    db_session.add(rec)
    db_session.commit()

    resp = client.post(
        f"/api/chat/{rec.id}/message",
        json={"content": "你好"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert resp.status_code == 400
    assert "训练时间已到" in resp.json()["detail"]


import pytest

pytestmark = pytest.mark.integration
