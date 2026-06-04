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

    def test_get_llm_stats_with_data(self, client, teacher, db_session):
        """有 LLM 调用记录时应正确聚合统计"""
        from models import LLMCallLog

        now = datetime.now(UTC)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        logs = [
            LLMCallLog(
                user_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=500,
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                token_estimated=0,
                estimated_cost=0.002,
                created_at=today,
            ),
            LLMCallLog(
                user_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=300,
                prompt_tokens=200,
                completion_tokens=80,
                total_tokens=280,
                token_estimated=0,
                estimated_cost=0.003,
                created_at=today,
            ),
            LLMCallLog(
                user_id=1,
                purpose="scoring",
                model="deepseek-chat",
                provider_name="deepseek",
                status="failed",
                latency_ms=1000,
                prompt_tokens=500,
                completion_tokens=0,
                total_tokens=500,
                token_estimated=1,
                estimated_cost=0.001,
                created_at=today,
            ),
            # 7天前的旧记录
            LLMCallLog(
                user_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=400,
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                token_estimated=0,
                estimated_cost=0.002,
                created_at=today - timedelta(days=5),
            ),
        ]
        for log in logs:
            db_session.add(log)
        db_session.commit()

        _, token = teacher
        resp = client.get("/api/admin/llm-stats", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()

        today_stats = data["today"]
        assert today_stats["count"] == 3
        assert today_stats["success_rate"] == round(2 / 3 * 100, 1)
        assert today_stats["total_cost"] == round(0.002 + 0.003 + 0.001, 4)

        week_stats = data["week"]
        assert week_stats["count"] == 4

        by_purpose = {p["purpose"]: p["count"] for p in data["by_purpose"]}
        assert by_purpose.get("patient_chat") == 3  # 2 today + 1 five days ago
        assert by_purpose.get("scoring") == 1

        assert len(data["daily"]) >= 1

    def test_get_llm_stats_no_cost_config(self, client, teacher, db_session):
        """estimated_cost 为 0 时也能正常返回（不应因 falsy 而变成 null）"""
        from models import LLMCallLog

        now = datetime.now(UTC)
        today = now.replace(hour=0, minute=0, second=0, microsecond=0)

        log = LLMCallLog(
            user_id=1,
            purpose="patient_chat",
            model="deepseek-chat",
            provider_name="deepseek",
            status="success",
            latency_ms=500,
            prompt_tokens=100,
            completion_tokens=50,
            total_tokens=150,
            token_estimated=0,
            estimated_cost=0.0,
            created_at=today,
        )
        db_session.add(log)
        db_session.commit()

        _, token = teacher
        resp = client.get("/api/admin/llm-stats", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["today"]["total_cost"] == 0

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

    def test_get_llm_logs_with_data(self, client, teacher, db_session, test_case):
        from core.security import hash_password
        from models import LLMCallLog, TrainingRecord
        from models import User as UserModel

        student = UserModel(
            username="logtest",
            password_hash=hash_password("123"),
            role="student",
            display_name="测试学生",
        )
        db_session.add(student)
        db_session.commit()
        db_session.refresh(student)

        record = TrainingRecord(user_id=student.id, case_id=test_case.id, status="completed")
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        now = datetime.now(UTC)
        logs = [
            LLMCallLog(
                user_id=student.id,
                record_id=record.id,
                case_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=500,
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                token_estimated=0,
                estimated_cost=0.002,
                created_at=now,
            ),
            LLMCallLog(
                user_id=student.id,
                record_id=record.id,
                case_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=300,
                prompt_tokens=200,
                completion_tokens=80,
                total_tokens=280,
                token_estimated=0,
                estimated_cost=0.003,
                created_at=now,
            ),
            LLMCallLog(
                user_id=student.id,
                purpose="scoring",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=200,
                prompt_tokens=300,
                completion_tokens=100,
                total_tokens=400,
                token_estimated=0,
                estimated_cost=0.001,
                created_at=now,
            ),
        ]
        for log in logs:
            db_session.add(log)
        db_session.commit()

        _, token = teacher
        resp = client.get("/api/admin/llm-logs", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 2  # 1 aggregated patient_chat + 1 scoring

    def test_get_llm_logs_aggregation(self, client, teacher, db_session, test_case):
        """聚合模式下 patient_chat 应合并为一条训练级记录"""
        from core.security import hash_password
        from models import LLMCallLog, TrainingRecord
        from models import User as UserModel

        student = UserModel(
            username="aggtest",
            password_hash=hash_password("123"),
            role="student",
            display_name="聚合测试",
        )
        db_session.add(student)
        db_session.commit()
        db_session.refresh(student)

        record = TrainingRecord(user_id=student.id, case_id=test_case.id, status="completed")
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        now = datetime.now(UTC)
        logs = [
            LLMCallLog(
                user_id=student.id,
                record_id=record.id,
                case_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=100,
                prompt_tokens=50,
                completion_tokens=25,
                total_tokens=75,
                token_estimated=0,
                estimated_cost=0.001,
                created_at=now,
            ),
            LLMCallLog(
                user_id=student.id,
                record_id=record.id,
                case_id=1,
                purpose="patient_chat",
                model="deepseek-chat",
                provider_name="deepseek",
                status="success",
                latency_ms=200,
                prompt_tokens=100,
                completion_tokens=50,
                total_tokens=150,
                token_estimated=0,
                estimated_cost=0.002,
                created_at=now,
            ),
        ]
        for log in logs:
            db_session.add(log)
        db_session.commit()

        _, token = teacher
        resp = client.get("/api/admin/llm-logs", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        items = data["items"]
        agg_items = [i for i in items if i.get("is_aggregated")]
        assert len(agg_items) == 1
        agg = agg_items[0]
        assert agg["call_count"] == 2
        assert agg["purpose"] == "patient_chat"
        # 聚合费用应为 0.001 + 0.002 = 0.003
        assert agg["estimated_cost"] == round(0.001 + 0.002, 6)

    def test_get_llm_logs_estimated_cost_zero(self, client, teacher, db_session, test_case):
        """estimated_cost 为 0 的聚合行不应因 falsy 而变成 None"""
        from core.security import hash_password
        from models import LLMCallLog, TrainingRecord
        from models import User as UserModel

        student = UserModel(
            username="zerocost",
            password_hash=hash_password("123"),
            role="student",
            display_name="零费用",
        )
        db_session.add(student)
        db_session.commit()
        db_session.refresh(student)

        record = TrainingRecord(user_id=student.id, case_id=test_case.id, status="completed")
        db_session.add(record)
        db_session.commit()
        db_session.refresh(record)

        now = datetime.now(UTC)
        log = LLMCallLog(
            user_id=student.id,
            record_id=record.id,
            case_id=1,
            purpose="patient_chat",
            model="deepseek-chat",
            provider_name="deepseek",
            status="success",
            latency_ms=100,
            prompt_tokens=50,
            completion_tokens=25,
            total_tokens=75,
            token_estimated=0,
            estimated_cost=0.0,
            created_at=now,
        )
        db_session.add(log)
        db_session.commit()

        _, token = teacher
        resp = client.get("/api/admin/llm-logs", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        items = data["items"]
        agg_items = [i for i in items if i.get("is_aggregated")]
        assert len(agg_items) == 1
        assert agg_items[0]["estimated_cost"] == 0.0  # 不应为 None

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
        from models import User

        u = User(
            username="editme",
            password_hash=hash_password("123"),
            role="student",
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
        from models import User

        u = User(
            username="deleteme",
            password_hash=hash_password("123"),
            role="student",
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
        from models import User

        db_session.add(
            User(
                username="zhangsan",
                password_hash=hash_password("123"),
                role="student",
                display_name="张三",
                student_id="202401",
            )
        )
        db_session.add(
            User(
                username="lisi",
                password_hash=hash_password("123"),
                role="teacher",
                display_name="李四",
                student_id="202402",
            )
        )
        db_session.add(
            User(
                username="wangwu",
                password_hash=hash_password("123"),
                role="student",
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
        resp = client.get("/api/admin/users/99999/detail", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 404

    def test_get_detail_teacher_not_student(self, client, teacher):
        user, token = teacher
        resp = client.get(f"/api/admin/users/{user.id}/detail", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 404

    def test_get_detail_forbidden_for_student(self, client, student):
        user, token = student
        resp = client.get(f"/api/admin/users/{user.id}/detail", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 403

    def test_get_detail_empty(self, client, teacher, db_session):
        from core.security import hash_password
        from models import User

        s = User(
            username="emptystudent",
            password_hash=hash_password("123"),
            role="student",
            display_name="空学生",
            student_id="S000",
        )
        db_session.add(s)
        db_session.commit()

        _, token = teacher
        resp = client.get(f"/api/admin/users/{s.id}/detail", headers={"Authorization": f"Bearer {token}"})
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
        from models import Score, TrainingRecord, User

        s = User(
            username="activestudent",
            password_hash=hash_password("123"),
            role="student",
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
        resp = client.get(f"/api/admin/users/{s.id}/detail", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["display_name"] == "学霸"
        assert data["total_sessions"] == 3
        assert data["total_minutes"] >= 60
        assert data["avg_score"] is not None
        assert len(data["recent_records"]) == 3
        assert len(data["daily"]) > 0
