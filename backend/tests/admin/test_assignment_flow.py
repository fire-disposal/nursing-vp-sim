"""Integration tests for assignment management — full teacher→student flow."""

from datetime import UTC, datetime, timedelta


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


class TestAssignmentFlow:
    """End-to-end: teacher creates assignment → student sees → starts → completes."""

    def test_create_and_list(self, client, teacher, test_case, test_class, db_session):
        _, token = teacher
        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {"physical_exam": True},
            "behavior": {"time_limit_minutes": 20},
            "class_id": test_class.id,
            "title": "肺炎病史采集练习",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(token))
        assert resp.status_code == 200, f"Create failed: {resp.text}"
        data = resp.json()
        assert data["title"] == "肺炎病史采集练习"
        assert data["case_id"] == test_case.id
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
        resp = client.post(f"/api/assignments/{assignment_id}/export", headers=_auth_headers(token))
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        assert assignment_id

    def test_student_sees_assignment(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        _, teacher_token = teacher
        _, student_token = student
        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {},
            "behavior": {"time_limit_minutes": 20},
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

    def test_student_starts_assignment(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        _, teacher_token = teacher
        _, student_token = student
        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {"emotion": True},
            "behavior": {"time_limit_minutes": 20},
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
        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {},
            "behavior": {"time_limit_minutes": 20},
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

    def test_delete_after_started_fails(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        _, teacher_token = teacher
        _, student_token = student
        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {},
            "behavior": {"time_limit_minutes": 20},
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
        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {},
            "behavior": {"time_limit_minutes": 20},
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

    def test_best_record_highest_score_with_attempt_count(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        """D3: 同一学生同一作业多条记录时，取最高分记录，附带 attempt_count。"""
        from models import Score, TrainingRecord

        _, teacher_token = teacher
        student_user, _ = student

        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {},
            "behavior": {"time_limit_minutes": 20},
            "class_id": test_class.id,
            "title": "最高分测试",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        r1 = TrainingRecord(
            user_id=student_user.id,
            case_id=test_case.id,
            assignment_id=assignment_id,
            status="completed",
            scoring_status="completed",
            start_time=now - timedelta(hours=2),
            end_time=now - timedelta(hours=1),
        )
        r2 = TrainingRecord(
            user_id=student_user.id,
            case_id=test_case.id,
            assignment_id=assignment_id,
            status="completed",
            scoring_status="completed",
            start_time=now - timedelta(hours=1),
            end_time=now,
        )
        db_session.add_all([r1, r2])
        db_session.commit()

        s1 = Score(record_id=r1.id, total_score=70.0)
        s2 = Score(record_id=r2.id, total_score=90.0)
        db_session.add_all([s1, s2])
        db_session.commit()

        resp = client.get(f"/api/assignments/{assignment_id}", headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        detail = resp.json()

        students = [s for s in detail["students"] if s["user_id"] == student_user.id]
        assert len(students) == 1
        s = students[0]
        assert s["score_total"] == 90.0, f"Expected best score 90, got {s['score_total']}"
        assert s["attempt_count"] == 2, f"Expected attempt_count 2, got {s['attempt_count']}"
        assert detail["completed_count"] == 1
        assert detail["scored_count"] == 1

    def test_best_record_fallback_no_scored_records(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        """D3: 无已评分记录时取最新（start_time 最新）记录。"""
        from models import TrainingRecord

        _, teacher_token = teacher
        student_user, _ = student

        now = datetime.now(UTC)
        payload = {
            "case_id": test_case.id,
            "features": {},
            "behavior": {"time_limit_minutes": 20},
            "class_id": test_class.id,
            "title": "无评分测试",
            "start_time": now.isoformat(),
            "end_time": (now + timedelta(days=7)).isoformat(),
        }
        resp = client.post("/api/assignments", json=payload, headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        assignment_id = resp.json()["id"]

        r_old = TrainingRecord(
            user_id=student_user.id,
            case_id=test_case.id,
            assignment_id=assignment_id,
            status="completed",
            scoring_status="pending",
            start_time=now - timedelta(hours=2),
            end_time=now - timedelta(hours=1),
        )
        r_new = TrainingRecord(
            user_id=student_user.id,
            case_id=test_case.id,
            assignment_id=assignment_id,
            status="in_progress",
            scoring_status=None,
            start_time=now - timedelta(minutes=30),
            end_time=None,
        )
        db_session.add_all([r_old, r_new])
        db_session.commit()

        resp = client.get(f"/api/assignments/{assignment_id}", headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        detail = resp.json()

        students = [s for s in detail["students"] if s["user_id"] == student_user.id]
        assert len(students) == 1
        s = students[0]
        assert s["record_id"] == r_new.id, f"Expected latest record {r_new.id}, got {s['record_id']}"
        assert s["status"] == "in_progress"
        assert s["score_total"] is None
        assert s["attempt_count"] == 2
        assert detail["completed_count"] == 1
        assert detail["scored_count"] == 0

    def test_is_closed_blocks_student_start(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        """D21: 关闭的作业学生无法开始训练。"""
        _, teacher_token = teacher
        _, student_token = student
        now = datetime.now(UTC)
        resp = client.post(
            "/api/assignments",
            json={
                "case_id": test_case.id,
                "features": {},
                "behavior": {"time_limit_minutes": 20},
                "class_id": test_class.id,
                "title": "关闭测试作业",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(days=7)).isoformat(),
            },
            headers=_auth_headers(teacher_token),
        )
        assignment_id = resp.json()["id"]

        client.put(
            f"/api/assignments/{assignment_id}",
            json={"is_closed": True},
            headers=_auth_headers(teacher_token),
        )

        resp2 = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment_id}",
            headers=_auth_headers(student_token),
        )
        assert resp2.status_code == 400
        assert "关闭" in resp2.json()["detail"]

    def test_update_practice_rejected_after_records(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        """D22: 已有学生开始练习时禁止更换病例或班级。"""
        _, teacher_token = teacher
        _, student_token = student
        from models import Case

        case2 = Case(
            name="守卫测试病例2",
            description="",
            training_type="history_taking",
            difficulty=1,
            is_open=True,
            case_data={},
        )
        db_session.add(case2)
        db_session.commit()

        now = datetime.now(UTC)
        resp = client.post(
            "/api/assignments",
            json={
                "case_id": test_case.id,
                "features": {},
                "behavior": {"time_limit_minutes": 20},
                "class_id": test_class.id,
                "title": "守卫测试作业",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(days=7)).isoformat(),
            },
            headers=_auth_headers(teacher_token),
        )
        assignment_id = resp.json()["id"]

        client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment_id}",
            headers=_auth_headers(student_token),
        )

        resp = client.put(
            f"/api/assignments/{assignment_id}",
            json={"case_id": case2.id},
            headers=_auth_headers(teacher_token),
        )
        assert resp.status_code == 400
        assert "不能更换" in resp.json()["detail"]

        resp = client.put(
            f"/api/assignments/{assignment_id}",
            json={"title": "新标题"},
            headers=_auth_headers(teacher_token),
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "新标题"

    def test_assignment_stats_calculation(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        """D23: 作业统计 avg/max/min/completion_rate 正确计算。"""
        from models import Score, TrainingRecord

        _, teacher_token = teacher
        student_user, _ = student

        now = datetime.now(UTC)
        resp = client.post(
            "/api/assignments",
            json={
                "case_id": test_case.id,
                "features": {},
                "behavior": {"time_limit_minutes": 20},
                "class_id": test_class.id,
                "title": "统计测试作业",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(days=7)).isoformat(),
            },
            headers=_auth_headers(teacher_token),
        )
        assignment_id = resp.json()["id"]

        r = TrainingRecord(
            user_id=student_user.id,
            case_id=test_case.id,
            assignment_id=assignment_id,
            status="completed",
            scoring_status="completed",
            start_time=now - timedelta(hours=2),
            end_time=now - timedelta(hours=1),
        )
        db_session.add(r)
        db_session.commit()

        s = Score(record_id=r.id, total_score=85.5)
        db_session.add(s)
        db_session.commit()

        resp = client.get(f"/api/assignments/{assignment_id}", headers=_auth_headers(teacher_token))
        assert resp.status_code == 200
        detail = resp.json()
        assert detail["avg_score"] == 85.5
        assert detail["max_score"] == 85.5
        assert detail["min_score"] == 85.5
        assert detail["completion_rate"] > 0

    def test_closed_assignment_shows_in_student_list(
        self, client, teacher, student, test_case, test_class, test_student_in_class, db_session
    ):
        """D21: 关闭的作业在学生列表中标记为 closed。"""
        _, teacher_token = teacher
        _, student_token = student
        now = datetime.now(UTC)
        resp = client.post(
            "/api/assignments",
            json={
                "case_id": test_case.id,
                "features": {},
                "behavior": {"time_limit_minutes": 20},
                "class_id": test_class.id,
                "title": "关闭列表测试作业",
                "start_time": now.isoformat(),
                "end_time": (now + timedelta(days=7)).isoformat(),
            },
            headers=_auth_headers(teacher_token),
        )
        assignment_id = resp.json()["id"]

        client.put(
            f"/api/assignments/{assignment_id}",
            json={"is_closed": True},
            headers=_auth_headers(teacher_token),
        )

        resp = client.get("/api/students/assignments", headers=_auth_headers(student_token))
        assert resp.status_code == 200
        items = resp.json()
        student_item = next(a for a in items if a["id"] == assignment_id)
        assert student_item["status"] == "closed"
