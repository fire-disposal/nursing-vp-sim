from unittest.mock import patch, AsyncMock
from fastapi import status


class TestQAMultiTurn:
    def test_create_session_and_ask(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm, \
             patch("routers.qa.check_qa_limit"):
            mock_llm.return_value = "护理评估应包括生命体征测量。"
            resp = client.post("/api/qa/sessions",
                json={"question": "如何进行护理评估？"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["answer"] == "护理评估应包括生命体征测量。"
            assert data["session_id"] > 0

    def test_list_sessions(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm, \
             patch("routers.qa.check_qa_limit"):
            mock_llm.return_value = "回答A。"
            client.post("/api/qa/sessions",
                json={"question": "问题1"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            mock_llm.return_value = "回答B。"
            client.post("/api/qa/sessions",
                json={"question": "问题2"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
        resp = client.get("/api/qa/sessions",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2

    def test_get_session_messages(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm, \
             patch("routers.qa.check_qa_limit"):
            mock_llm.return_value = "回答。"
            create_resp = client.post("/api/qa/sessions",
                json={"question": "测试问题"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            sid = create_resp.json()["session_id"]
        resp = client.get(f"/api/qa/sessions/{sid}/messages",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["role"] == "user"
        assert data[0]["content"] == "测试问题"
        assert data[1]["role"] == "assistant"

    def test_delete_session(self, client, student, db_session):
        from models import QASession, QARecord
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm, \
             patch("routers.qa.check_qa_limit"):
            mock_llm.return_value = "回答。"
            create_resp = client.post("/api/qa/sessions",
                json={"question": "待删除"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            sid = create_resp.json()["session_id"]
        resp = client.delete(f"/api/qa/sessions/{sid}",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 200
        assert db_session.query(QASession).filter(QASession.id == sid).count() == 0
        assert db_session.query(QARecord).filter(QARecord.session_id == sid).count() == 0

    def test_cannot_access_other_users_session(self, client, student, teacher, db_session):
        from models import QASession, QARecord
        session = QASession(user_id=teacher[0].id, title="教师会话")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        msg = QARecord(session_id=session.id, user_id=teacher[0].id, role="user", content="问题")
        db_session.add(msg)
        db_session.commit()
        resp = client.get(f"/api/qa/sessions/{session.id}/messages",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 404

    def test_student_cannot_view_all_history(self, client, student):
        resp = client.get("/api/qa/history/all",
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == status.HTTP_403_FORBIDDEN

    def test_teacher_views_all_history(self, client, teacher, db_session):
        from models import QASession, QARecord
        session = QASession(user_id=teacher[0].id, title="测试")
        db_session.add(session)
        db_session.commit()
        db_session.refresh(session)
        msg = QARecord(session_id=session.id, user_id=teacher[0].id, role="user", content="问题")
        db_session.add(msg)
        db_session.commit()
        resp = client.get("/api/qa/history/all",
            headers={"Authorization": f"Bearer {teacher[1]}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    def test_multi_turn_context(self, client, student, db_session):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm, \
             patch("routers.qa.check_qa_limit"):
            mock_llm.return_value = "回答1。"
            create_resp = client.post("/api/qa/sessions",
                json={"question": "怎么测血压？"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            sid = create_resp.json()["session_id"]
            mock_llm.return_value = "回答2。"
            ask_resp = client.post(f"/api/qa/sessions/{sid}/ask",
                json={"question": "有哪些注意事项？"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            assert ask_resp.status_code == 200
            call_args = mock_llm.call_args_list[-1]
            messages = call_args[0][0]
            user_contents = [m["content"] for m in messages if m["role"] == "user"]
            assert "怎么测血压？" in user_contents
            assert "有哪些注意事项？" in user_contents

    def test_llm_failure_returns_500(self, client, student):
        with patch("routers.qa.call_llm", new_callable=AsyncMock) as mock_llm:
            mock_llm.side_effect = RuntimeError("模拟LLM故障")
            resp = client.post("/api/qa/sessions",
                json={"question": "测试问题"},
                headers={"Authorization": f"Bearer {student[1]}"},
            )
            assert resp.status_code == 500

    def test_empty_question_rejected(self, client, student):
        resp = client.post("/api/qa/sessions",
            json={"question": ""},
            headers={"Authorization": f"Bearer {student[1]}"},
        )
        assert resp.status_code == 422
