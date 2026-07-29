"""Stream endpoint pre-validation: errors must be proper HTTP responses, not mid-stream crashes.

Regression for: RuntimeError("Caught handled exception, but response already started")
when HTTPException (400/429/404) was raised inside the SSE generator after streaming began.
"""

from datetime import timedelta
from unittest.mock import AsyncMock


def _start_training(client, token, case_id):
    resp = client.post(
        "/api/training/start",
        json={"case_id": case_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200
    return resp.json()["record_id"]


class TestChatStreamPreValidation:
    def test_stream_finished_training_returns_400(self, client, student, test_case, db_session):
        _, token = student
        record_id = _start_training(client, token, test_case.id)

        from models import TrainingRecord

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        record.status = "completed"
        db_session.commit()

        resp = client.post(
            f"/api/chat/{record_id}/message/stream",
            json={"content": "你好"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400
        assert resp.json()["detail"] == "训练已结束"

    def test_stream_rate_limited_returns_429(self, client, student, test_case):
        _, token = student
        record_id = _start_training(client, token, test_case.id)

        client.app.state.rate_limiter.is_allowed = AsyncMock(return_value=False)

        resp = client.post(
            f"/api/chat/{record_id}/message/stream",
            json={"content": "你好"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 429

    def test_stream_record_not_found_returns_404(self, client, student):
        _, token = student
        resp = client.post(
            "/api/chat/99999/message/stream",
            json={"content": "你好"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404



class TestCorrectLastMessageStream:
    def test_correction_replaces_last_pair_after_reply_succeeds(self, client, student, test_case, db_session, monkeypatch):
        from contexts.training.pipeline import STATE_DONE_PAYLOAD
        from contexts.training.pipeline.middleware.persister import _persist_correction
        from models import Message, TrainingRecord

        _, token = student
        record_id = _start_training(client, token, test_case.id)
        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).one()
        old_student = Message(record_id=record_id, role="student", content="旧问题")
        old_patient = Message(record_id=record_id, role="patient", content="旧回答")
        db_session.add_all([old_student, old_patient])
        db_session.commit()

        async def fake_stream_pipeline(ctx, _pipe):
            ctx.llm_reply = "新回答"
            _persist_correction(ctx)
            yield 'data: {"content": "新回答"}\n\n'
            yield f'data: {{"done": true, "id": {ctx.state[STATE_DONE_PAYLOAD]["patient_id"]}, "student_id": {ctx.state[STATE_DONE_PAYLOAD]["student_id"]}, "patient_id": {ctx.state[STATE_DONE_PAYLOAD]["patient_id"]}, "corrections_used": 1, "corrections_remaining": 2}}\n\n'

        monkeypatch.setattr("contexts.training.router.chat.get_pipeline", lambda training_type=None: ([], None))
        monkeypatch.setattr("contexts.training.router.chat.stream_pipeline", fake_stream_pipeline)

        resp = client.post(
            f"/api/chat/{record_id}/message/correct-last/stream",
            json={"content": "新问题"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        body = resp.text
        assert '"student_id"' in body
        assert '"corrections_remaining": 2' in body

        db_session.expire_all()
        messages = (
            db_session.query(Message)
            .filter(Message.record_id == record_id)
            .order_by(Message.created_at.asc(), Message.id.asc())
            .all()
        )
        assert [(m.role, m.content) for m in messages[-2:]] == [("student", "新问题"), ("patient", "新回答")]
        assert all(m.content not in {"旧问题", "旧回答"} for m in messages)
        updated = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).one()
        assert updated.runtime_state["message_correction"]["used"] == 1

    def test_correction_rejects_tool_mutation_after_target(self, client, student, test_case, db_session):
        from models import Message, TrainingToolRequest

        _, token = student
        record_id = _start_training(client, token, test_case.id)
        old_student = Message(record_id=record_id, role="student", content="旧问题")
        old_patient = Message(record_id=record_id, role="patient", content="旧回答")
        db_session.add_all([old_student, old_patient])
        db_session.flush()
        db_session.add(
            TrainingToolRequest(
                record_id=record_id,
                request_id="after-message-mutation",
                tool_name="physical_exam",
                action="measure",
                response={"ok": True, "data": {}},
                created_at=old_student.created_at + timedelta(seconds=1),
            )
        )
        db_session.commit()

        resp = client.post(
            f"/api/chat/{record_id}/message/correct-last/stream",
            json={"content": "新问题"},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 400
        assert resp.json()["detail"] == "上一轮之后已有工具操作，不能再修正该发言"

    def test_record_detail_reports_correction_eligibility(self, client, student, test_case, db_session):
        from models import Message

        _, token = student
        record_id = _start_training(client, token, test_case.id)
        student_msg = Message(record_id=record_id, role="student", content="问题")
        patient_msg = Message(record_id=record_id, role="patient", content="回答")
        db_session.add_all([student_msg, patient_msg])
        db_session.commit()

        resp = client.get(
            f"/api/training/records/{record_id}",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 200
        correction = resp.json()["message_correction"]
        assert correction["used"] == 0
        assert correction["remaining"] == 3
        assert correction["eligible_last_message_id"] == student_msg.id
