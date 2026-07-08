"""Triage submit tests — queue-full rollback (W3.1)."""

from infrastructure.queue import QueueFullError
from models import TrainingRecord


class TestSubmitTriage:
    def test_submit_queue_full_returns_503_and_keeps_in_progress(
        self, client, student, test_case, db_session
    ):
        _, token = student
        # Create an in-progress training record owned by the student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        record_id = resp.json()["record_id"]

        # Force the task queue to reject enqueues with QueueFullError
        client.app.state.task_queue.enqueue.side_effect = QueueFullError()

        resp2 = client.post(
            f"/api/training/api/triage/{record_id}/submit",
            json={"mews_score": 3, "category": "yellow", "department": "内科"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 503

        db_session.expire_all()
        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        assert record.status == "in_progress"
        assert record.scoring_status is None

    def test_submit_success_returns_200(self, client, student, test_case):
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        record_id = resp.json()["record_id"]

        resp2 = client.post(
            f"/api/training/api/triage/{record_id}/submit",
            json={"mews_score": 3, "category": "yellow", "department": "内科"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp2.status_code == 200
