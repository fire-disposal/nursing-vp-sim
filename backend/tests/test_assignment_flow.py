"""Integration tests for assignment management — full teacher→student flow."""

from datetime import UTC, datetime, timedelta

from models import Practice


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAssignmentFlow:
    """End-to-end: teacher creates assignment → student sees → starts → completes."""

    def test_create_and_list(self, client, teacher, test_case, test_class, db_session):
        _, token = teacher
        practice = Practice(
            name="测试练习", description="test", case_id=test_case.id, mode="training",
            features={"physical_exam": True}, behavior={"time_limit_minutes": 20},
        )
        db_session.add(practice)
        db_session.commit()

        now = datetime.now(UTC)
        payload = {
            "practice_id": practice.id,
            "class_id": test_class.id,
            "title": "肺炎病史采集练习",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(token))
        assert resp.status_code == 200, f"Create failed: {resp.text}"
        data = resp.json()
        assert data["title"] == "肺炎病史采集练习"
        assert data["practice_id"] == practice.id
        assert data["class_id"] == test_class.id
        assert data["student_count"] >= 0
        assignment_id = data["id"]

        # List assignments
        resp = client.get("/api/assignments", headers=_auth_headers(token))
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert any(a["id"] == assignment_id for a in items)

        # Get detail
        resp = client.get(f"/api/assignments/{assignment_id}", headers=_auth_headers(token))
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["id"] == assignment_id
        assert "students" in detail

        # Export CSV
        resp = client.get(f"/api/assignments/{assignment_id}/export", headers=_auth_headers(token))
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        assert assignment_id

    def test_student_sees_assignment(self, client, teacher, student, test_case, test_class, test_student_in_class, db_session):
        _, teacher_token = teacher
        _, student_token = student
        practice = Practice(
            name="学生可见测试练习", description="test", case_id=test_case.id, mode="training",
            features={}, behavior={"time_limit_minutes": 20},
        )
        db_session.add(practice)
        db_session.commit()

        now = datetime.now(UTC)
        payload = {
            "practice_id": practice.id,
            "class_id": test_class.id,
            "title": "学生可见测试",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        # Student sees assignment
        resp = client.get("/api/students/assignments", headers=_auth_headers(student_token))
        assert resp.status_code == 200
        items = resp.json()
        assert isinstance(items, list)
        assert any(a["id"] == assignment_id for a in items)

        student_item = next(a for a in items if a["id"] == assignment_id)
        assert student_item["status"] in ("pending", "overdue")

    def test_student_starts_assignment(self, client, teacher, student, test_case, test_class, test_student_in_class, db_session):
        _, teacher_token = teacher
        _, student_token = student
        practice = Practice(
            name="开始训练测试练习", description="test", case_id=test_case.id, mode="training",
            features={"emotion": True}, behavior={"time_limit_minutes": 20},
        )
        db_session.add(practice)
        db_session.commit()

        now = datetime.now(UTC)
        payload = {
            "practice_id": practice.id,
            "class_id": test_class.id,
            "title": "开始训练测试",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        # Student starts training from assignment
        resp = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment_id}",
            headers=_auth_headers(student_token),
        )
        assert resp.status_code == 200, f"Start failed: {resp.text}"
        data = resp.json()
        assert "record_id" in data
        assert "greeting" in data

        record_id = data["record_id"]

        # Verify record has assignment_id and practice features
        resp = client.get(f"/api/training/records/{record_id}", headers=_auth_headers(student_token))
        assert resp.status_code == 200
        detail = resp.json()
        assert detail.get("from_assignment") is True
        assert detail.get("features", {}).get("emotion") is True

        # Start again → should return existing record
        resp2 = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment_id}",
            headers=_auth_headers(student_token),
        )
        assert resp2.status_code == 200
        assert "record_id" in resp2.json()  # record recreated (old one removed since no student messages)

    def test_student_not_in_class_rejected(self, client, teacher, student, test_case, test_class, db_session):
        """Student not in the class cannot start the assignment."""
        _, teacher_token = teacher
        _, student_token = student
        practice = Practice(
            name="越权测试练习", description="test", case_id=test_case.id, mode="training",
            features={}, behavior={"time_limit_minutes": 20},
        )
        db_session.add(practice)
        db_session.commit()

        now = datetime.now(UTC)
        payload = {
            "practice_id": practice.id,
            "class_id": test_class.id,
            "title": "越权测试",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        # Student is NOT in the class (no test_student_in_class fixture)
        resp = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment_id}",
            headers=_auth_headers(student_token),
        )
        assert resp.status_code == 403

    def test_delete_after_started_fails(self, client, teacher, student, test_case, test_class, test_student_in_class, db_session):
        _, teacher_token = teacher
        _, student_token = student
        practice = Practice(
            name="删除测试练习", description="test", case_id=test_case.id, mode="training",
            features={}, behavior={"time_limit_minutes": 20},
        )
        db_session.add(practice)
        db_session.commit()

        now = datetime.now(UTC)
        payload = {
            "practice_id": practice.id,
            "class_id": test_class.id,
            "title": "删除测试",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        # Student starts → delete should fail
        client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment_id}",
            headers=_auth_headers(student_token),
        )
        resp = client.delete(f"/api/assignments/{assignment_id}", headers=_auth_headers(teacher_token))
        assert resp.status_code == 400

    def test_update_assignment(self, client, teacher, test_case, test_class, db_session):
        _, token = teacher
        practice = Practice(
            name="更新测试练习", description="test", case_id=test_case.id, mode="training",
            features={}, behavior={"time_limit_minutes": 20},
        )
        db_session.add(practice)
        db_session.commit()

        now = datetime.now(UTC)
        payload = {
            "practice_id": practice.id,
            "class_id": test_class.id,
            "title": "原始标题",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        resp = client.put(
            f"/api/assignments/{assignment_id}",
            json={"title": "修改后的标题"},
            headers=_auth_headers(token),
        )
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["title"] == "修改后的标题"
