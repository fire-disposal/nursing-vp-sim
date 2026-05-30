"""QA API tests: ask, history, delete, admin history."""
from unittest.mock import patch, AsyncMock
import pytest


class TestQA:
    @patch("routers.qa.call_llm", new_callable=AsyncMock)
    def test_ask_persists_record(self, mock_call_llm, client, student, db_session):
        """POST /ask saves QARecord to DB and returns answer."""
        from models import QARecord

        mock_call_llm.return_value = "测量血压需注意..."
        _, token = student

        resp = client.post(
            "/api/qa/ask",
            json={"question": "如何测量血压？"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["answer"] == "测量血压需注意..."

        records = db_session.query(QARecord).filter(
            QARecord.user_id == student[0].id
        ).all()
        assert len(records) == 1
        assert records[0].question == "如何测量血压？"

    def test_history_user_isolation(self, client, student, teacher, db_session):
        """GET /history returns only current user's records."""
        from models import QARecord

        stu_user, stu_token = student
        teacher_user, _ = teacher

        db_session.add_all([
            QARecord(user_id=stu_user.id, question="我的问题", answer="A1"),
            QARecord(user_id=teacher_user.id, question="别人的问题", answer="A2"),
        ])
        db_session.commit()

        resp = client.get("/api/qa/history", headers={"Authorization": f"Bearer {stu_token}"})
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["question"] == "我的问题"

    def test_delete_others_record_returns_404(self, client, student, teacher, db_session):
        """DELETE returns 404 when trying to delete another user's record."""
        from models import QARecord

        _, stu_token = student
        teacher_user, _ = teacher

        r = QARecord(user_id=teacher_user.id, question="Q", answer="A")
        db_session.add(r)
        db_session.commit()

        resp = client.delete(f"/api/qa/history/{r.id}", headers={"Authorization": f"Bearer {stu_token}"})
        assert resp.status_code == 404

    def test_student_cannot_view_all_history(self, client, student):
        """GET /history/all rejects non-teacher."""
        _, token = student
        resp = client.get("/api/qa/history/all", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_teacher_views_all_history(self, client, teacher, student, db_session):
        """GET /history/all returns all users' records with user info."""
        from models import QARecord

        teacher_user, teacher_token = teacher
        stu_user, _ = student

        db_session.add_all([
            QARecord(user_id=teacher_user.id, question="TQ", answer="TA"),
            QARecord(user_id=stu_user.id, question="SQ", answer="SA"),
        ])
        db_session.commit()

        resp = client.get("/api/qa/history/all", headers={"Authorization": f"Bearer {teacher_token}"})
        data = resp.json()
        assert data["total"] == 2
        assert data["items"][0]["username"] == stu_user.username
