"""QA API tests: ask, history, delete, admin history."""
from unittest.mock import patch, AsyncMock
import pytest


class TestQAAsk:
    @patch("routers.qa.call_llm", new_callable=AsyncMock)
    def test_ask_persists_record(self, mock_call_llm, client, student, db_session):
        """POST /ask should save a QARecord after successful LLM response."""
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
        assert records[0].answer == "测量血压需注意..."

    def test_ask_empty_question_returns_400(self, client, student):
        _, token = student

        resp = client.post(
            "/api/qa/ask",
            json={"question": "   "},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 400


class TestQAHistory:
    def test_history_returns_own_records(self, client, student, db_session):
        """GET /history should only return current user's records."""
        from models import QARecord

        user, token = student
        r1 = QARecord(user_id=user.id, question="Q1", answer="A1")
        r2 = QARecord(user_id=user.id, question="Q2", answer="A2")
        db_session.add_all([r1, r2])
        db_session.commit()

        resp = client.get(
            "/api/qa/history",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        assert data["items"][0]["question"] == "Q2"  # DESC order

    def test_history_respects_pagination(self, client, student, db_session):
        from models import QARecord

        user, token = student
        recs = [QARecord(user_id=user.id, question=f"Q{i}", answer=f"A{i}") for i in range(15)]
        db_session.add_all(recs)
        db_session.commit()

        resp = client.get(
            "/api/qa/history?limit=5&offset=0",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["items"]) == 5
        assert data["total"] == 15

    def test_history_excludes_other_users(self, client, student, teacher, db_session):
        from models import QARecord

        stu_user, stu_token = student
        teacher_user, _ = teacher

        r1 = QARecord(user_id=stu_user.id, question="My Q", answer="A")
        r2 = QARecord(user_id=teacher_user.id, question="Their Q", answer="A")
        db_session.add_all([r1, r2])
        db_session.commit()

        resp = client.get(
            "/api/qa/history",
            headers={"Authorization": f"Bearer {stu_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["question"] == "My Q"


class TestQADelete:
    def test_delete_own_record(self, client, student, db_session):
        from models import QARecord

        user, token = student
        r = QARecord(user_id=user.id, question="Q", answer="A")
        db_session.add(r)
        db_session.commit()

        resp = client.delete(
            f"/api/qa/history/{r.id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["detail"] == "删除成功"

    def test_delete_others_record_returns_404(self, client, student, teacher, db_session):
        from models import QARecord

        stu_user, stu_token = student
        teacher_user, _ = teacher

        r = QARecord(user_id=teacher_user.id, question="Q", answer="A")
        db_session.add(r)
        db_session.commit()

        resp = client.delete(
            f"/api/qa/history/{r.id}",
            headers={"Authorization": f"Bearer {stu_token}"},
        )
        assert resp.status_code == 404

    def test_delete_nonexistent_returns_404(self, client, student):
        _, token = student

        resp = client.delete(
            "/api/qa/history/99999",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404


class TestQAAdminHistory:
    def test_teacher_can_view_all(self, client, teacher, student, db_session):
        from models import QARecord

        teacher_user, teacher_token = teacher
        stu_user, _ = student

        r1 = QARecord(user_id=teacher_user.id, question="T Q", answer="T A")
        r2 = QARecord(user_id=stu_user.id, question="S Q", answer="S A")
        db_session.add_all([r1, r2])
        db_session.commit()

        resp = client.get(
            "/api/qa/history/all",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    def test_student_cannot_view_all(self, client, student):
        _, token = student

        resp = client.get(
            "/api/qa/history/all",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403
