"""Stream endpoint pre-validation: errors must be proper HTTP responses, not mid-stream crashes.

Regression for: RuntimeError("Caught handled exception, but response already started")
when HTTPException (400/429/404) was raised inside the SSE generator after streaming began.
"""

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
