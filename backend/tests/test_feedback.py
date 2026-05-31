"""Feedback API tests."""
import pytest


class TestFeedback:
    def test_submit_feedback_success(self, client, student, db_session):
        """POST /api/feedback creates a Feedback record and returns id + created_at."""
        from models import Feedback

        _, token = student

        resp = client.post(
            "/api/feedback",
            json={"rating": 4, "tag": "bug", "content": "页面加载慢"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "id" in data
        assert "created_at" in data

        records = db_session.query(Feedback).all()
        assert len(records) == 1
        assert records[0].rating == 4
        assert records[0].tag == "bug"
        assert records[0].content == "页面加载慢"

    def test_submit_feedback_unauthorized(self, client):
        """POST /api/feedback without token returns 401."""
        resp = client.post(
            "/api/feedback",
            json={"rating": 4, "tag": "bug"},
        )
        assert resp.status_code == 401

    def test_admin_list_feedback(self, client, teacher, student, db_session):
        """GET /api/admin/feedback returns paginated list with user info."""
        from models import Feedback

        teacher_user, teacher_token = teacher
        stu_user, _ = student

        db_session.add_all([
            Feedback(user_id=stu_user.id, rating=5, tag="feature", content="好用的系统"),
            Feedback(user_id=teacher_user.id, rating=3, tag="bug", content="有个问题"),
        ])
        db_session.commit()

        resp = client.get(
            "/api/admin/feedback",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        assert data["limit"] == 20
        assert data["offset"] == 0
        assert data["items"][0]["user_name"] == "张老师"

    def test_admin_list_feedback_filter_by_tag(self, client, teacher, student, db_session):
        """GET /api/admin/feedback?tag=bug filters by tag."""
        from models import Feedback

        teacher_user, teacher_token = teacher
        stu_user, _ = student

        db_session.add_all([
            Feedback(user_id=stu_user.id, rating=5, tag="feature"),
            Feedback(user_id=teacher_user.id, rating=3, tag="bug"),
        ])
        db_session.commit()

        resp = client.get(
            "/api/admin/feedback?tag=bug",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 1
        assert data["items"][0]["tag"] == "bug"

    def test_admin_list_feedback_pagination(self, client, teacher, student, db_session):
        """GET /api/admin/feedback supports offset + limit pagination."""
        from models import Feedback

        teacher_user, teacher_token = teacher
        stu_user, _ = student

        for i in range(5):
            db_session.add(Feedback(user_id=stu_user.id, rating=4, tag="other"))
        db_session.commit()

        resp = client.get(
            "/api/admin/feedback?offset=2&limit=2",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 5
        assert len(data["items"]) == 2
        assert data["offset"] == 2
        assert data["limit"] == 2

    def test_non_teacher_cannot_list(self, client, student, db_session):
        """GET /api/admin/feedback with student token returns 403."""
        from models import Feedback

        stu_user, stu_token = student
        db_session.add(Feedback(user_id=stu_user.id, rating=4, tag="bug"))
        db_session.commit()

        resp = client.get(
            "/api/admin/feedback",
            headers={"Authorization": f"Bearer {stu_token}"},
        )
        assert resp.status_code == 403
