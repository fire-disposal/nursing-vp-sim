"""Admin API tests: user management, stats, role-based access control, LLM monitoring."""

from datetime import UTC, datetime, timedelta


class TestLLMStats:
    def test_get_llm_stats_empty(self, client, teacher):
        """空数据时也应返回合法的 stats 结构"""
        _, token = teacher
        resp = client.get("/api/admin/llm-stats", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "today" in data
        assert "week" in data
        assert "by_purpose" in data
        assert "daily" in data
        assert data["today"]["count"] == 0
        assert data["today"]["total_cost"] == 0
        assert data["daily"] == []

    def test_llm_stats_student_forbidden(self, client, student):
        _, token = student
        resp = client.get("/api/admin/llm-stats", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_llm_stats_unauthenticated(self, client):
        resp = client.get("/api/admin/llm-stats")
        assert resp.status_code == 401


class TestLLMLogs:
    def test_get_llm_logs_empty(self, client, teacher):
        _, token = teacher
        resp = client.get("/api/admin/llm-logs", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_llm_logs_student_forbidden(self, client, student):
        _, token = student
        resp = client.get("/api/admin/llm-logs", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_llm_logs_unauthenticated(self, client):
        resp = client.get("/api/admin/llm-logs")
        assert resp.status_code == 401


class TestAdminStats:
    def test_get_stats(self, client, teacher, student):
        _, token = teacher
        resp = client.get("/api/admin/stats", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "total_students" in data
        assert "total_records" in data
        assert "average_score" in data

    def test_stats_student_forbidden(self, client, student):
        _, token = student
        resp = client.get("/api/admin/stats", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_stats_unauthenticated(self, client):
        resp = client.get("/api/admin/stats")
        assert resp.status_code == 401


class TestUserManagement:
    def test_get_users_as_teacher(self, client, teacher):
        _, token = teacher
        resp = client.get("/api/admin/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert isinstance(resp.json(), dict)
        assert "items" in resp.json()
        assert "total" in resp.json()

    def test_get_users_as_student_forbidden(self, client, student):
        _, token = student
        resp = client.get("/api/admin/users", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_update_user(self, client, teacher, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        u = User(
            username="editme",
            password_hash=hash_password("123"),
            role_id=student_role.id,
            display_name="旧名字",
        )
        db_session.add(u)
        db_session.commit()

        _, token = teacher
        resp = client.put(
            f"/api/admin/users/{u.id}",
            json={"display_name": "新名字"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] == "新名字"

    def test_delete_user(self, client, teacher, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        u = User(
            username="deleteme",
            password_hash=hash_password("123"),
            role_id=student_role.id,
            display_name="待删除",
        )
        db_session.add(u)
        db_session.commit()
        uid = u.id

        _, token = teacher
        resp = client.delete(
            f"/api/admin/users/{uid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

    def test_get_users_search(self, client, teacher, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        teacher_role = db_session.query(Role).filter(Role.name == "teacher").first()

        db_session.add(
            User(
                username="zhangsan",
                password_hash=hash_password("123"),
                role_id=student_role.id,
                display_name="张三",
                student_id="202401",
            )
        )
        db_session.add(
            User(
                username="lisi",
                password_hash=hash_password("123"),
                role_id=teacher_role.id,
                display_name="李四",
                student_id="202402",
            )
        )
        db_session.add(
            User(
                username="wangwu",
                password_hash=hash_password("123"),
                role_id=student_role.id,
                display_name="王五",
                student_id="202403",
            )
        )
        db_session.commit()

        _, token = teacher
        resp = client.get("/api/admin/users?search=zhang", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["total"] == 1
        assert resp.json()["items"][0]["username"] == "zhangsan"

        resp2 = client.get("/api/admin/users?role=student", headers={"Authorization": f"Bearer {token}"})
        assert resp2.status_code == 200
        assert resp2.json()["total"] == 2  # zhangsan, wangwu + existing student fixture

        resp3 = client.get("/api/admin/users?search=李&role=teacher", headers={"Authorization": f"Bearer {token}"})
        assert resp3.status_code == 200
        assert resp3.json()["total"] == 1
        assert resp3.json()["items"][0]["display_name"] == "李四"


class TestStudentDetail:
    def test_get_detail_not_found(self, client, teacher):
        _, token = teacher
        resp = client.get("/api/admin/users/99999", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 404

    def test_get_detail_forbidden_for_student(self, client, student):
        user, token = student
        resp = client.get(f"/api/admin/users/{user.id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_get_detail_empty(self, client, teacher, db_session):
        from core.security import hash_password
        from models import Role, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        s = User(
            username="emptystudent",
            password_hash=hash_password("123"),
            role_id=student_role.id,
            display_name="空学生",
            student_id="S000",
        )
        db_session.add(s)
        db_session.commit()

        _, token = teacher
        resp = client.get(f"/api/admin/users/{s.id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["display_name"] == "空学生"
        assert data["student_id"] == "S000"
        assert data["total_sessions"] == 0
        assert data["total_minutes"] == 0
        assert data["avg_score"] is None
        assert data["daily"] == []

    def test_get_detail_with_records(self, client, teacher, db_session, test_case):
        from datetime import datetime

        from core.security import hash_password
        from models import Role, Score, TrainingRecord, User

        student_role = db_session.query(Role).filter(Role.name == "student").first()
        s = User(
            username="activestudent",
            password_hash=hash_password("123"),
            role_id=student_role.id,
            display_name="学霸",
            student_id="TOP001",
        )
        db_session.add(s)
        db_session.commit()

        now = datetime.now(UTC)
        for i in range(3):
            r = TrainingRecord(
                user_id=s.id,
                case_id=test_case.id,
                status="completed",
                start_time=now - timedelta(days=i),
                end_time=now - timedelta(days=i, minutes=-20),
            )
            db_session.add(r)
            db_session.flush()
            db_session.add(Score(record_id=r.id, total_score=80 + i * 5, detail_scores={}, rubric_version="v2"))
        db_session.commit()

        _, token = teacher
        resp = client.get(f"/api/admin/users/{s.id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["display_name"] == "学霸"
        assert data["total_sessions"] == 3
        assert data["total_minutes"] >= 60
        assert data["avg_score"] is not None
        assert len(data["recent_records"]) == 3
        assert len(data["daily"]) > 0
