"""QA tests — session CRUD only (LLM call tests rely on conftest mock)."""

from fastapi import status


class TestQAMultiTurn:
    def test_create_session_and_ask(self, client, student):
        resp = client.post(
            "/api/qa/sessions",
            json={"question": "如何进行护理评估？"},
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["answer"] == "mock response"
        assert data["session_id"] > 0

    def test_list_sessions(self, client, student):
        client.post("/api/qa/sessions", json={"question": "问题1"}, headers={"Authorization": f"Bearer {student[1]}"})
        client.post("/api/qa/sessions", json={"question": "问题2"}, headers={"Authorization": f"Bearer {student[1]}"})
        resp = client.get("/api/qa/sessions", headers={"Authorization": f"Bearer {student[1]}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_get_session_messages(self, client, student):
        create_resp = client.post(
            "/api/qa/sessions",
            json={"question": "测试问题"},
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        sid = create_resp.json()["session_id"]
        resp = client.get(f"/api/qa/sessions/{sid}/messages", headers={"Authorization": f"Bearer {student[1]}"})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["role"] == "user"

    def test_delete_session(self, client, student, db_session):
        from models import QASession

        create_resp = client.post(
            "/api/qa/sessions",
            json={"question": "待删除"},
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        sid = create_resp.json()["session_id"]
        resp = client.delete(f"/api/qa/sessions/{sid}", headers={"Authorization": f"Bearer {student[1]}"})
        assert resp.status_code == 200
        assert db_session.query(QASession).filter(QASession.id == sid).count() == 0

    def test_cannot_access_other_users_session(self, client, student, teacher, db_session):
        from models import QARecord, QASession

        session = QASession(user_id=teacher[0].id, title="教师会话")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        db_session.add(QARecord(session_id=session.id, user_id=teacher[0].id, role="user", content="问题"))
        db_session.commit()
        resp = client.get(f"/api/qa/sessions/{session.id}/messages", headers={"Authorization": f"Bearer {student[1]}"})
        assert resp.status_code == 404

    def test_student_cannot_view_all_history(self, client, student):
        resp = client.get("/api/qa/history/all", headers={"Authorization": f"Bearer {student[1]}"})
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_teacher_views_all_history(self, client, teacher, db_session):
        from models import QARecord, QASession

        session = QASession(user_id=teacher[0].id, title="测试")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        db_session.add(QARecord(session_id=session.id, user_id=teacher[0].id, role="user", content="问题"))
        db_session.commit()
        resp = client.get("/api/qa/history/all", headers={"Authorization": f"Bearer {teacher[1]}"})
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

    def test_empty_question_rejected(self, client, student):
        resp = client.post("/api/qa/sessions", json={"question": ""}, headers={"Authorization": f"Bearer {student[1]}"})
        assert resp.status_code == 422
