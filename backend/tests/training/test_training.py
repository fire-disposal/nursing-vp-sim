"""Training flow tests: start, messages, end with scoring (mocked LLM)."""

from unittest.mock import AsyncMock, patch


class TestStartTraining:
    def test_start_as_student(self, client, student, test_case):
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["record_id"]
        assert "greeting" in data

    def test_start_as_teacher_is_test(self, client, teacher, test_case, db_session):
        _, token = teacher
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        record_id = resp.json()["record_id"]
        from models import TrainingRecord

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        assert record.is_test is True

    def test_start_case_not_found(self, client, student):
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": 9999},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_start_unauthenticated(self, client, test_case):
        resp = client.post("/api/training/start", json={"case_id": test_case.id})
        assert resp.status_code == 401

    def test_start_reports_pending_questionnaires_zero(self, client, student, test_case):
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "pending_questionnaires" in data
        assert data["pending_questionnaires"] == 0

    def test_start_reports_required_questionnaire_count(self, client, student, test_case, db_session):
        from models import CaseQuestionnaire, QuestionnaireTemplate

        template = QuestionnaireTemplate(
            title="训练前问卷",
            type="pre_training",
            description="",
            is_active=True,
        )
        db_session.add(template)
        db_session.commit()

        optional_template = QuestionnaireTemplate(
            title="可选问卷",
            type="post_training",
            description="",
            is_active=True,
        )
        db_session.add(optional_template)
        db_session.commit()

        db_session.add(CaseQuestionnaire(case_id=test_case.id, template_id=template.id, is_required=True))
        db_session.add(
            CaseQuestionnaire(
                case_id=test_case.id,
                template_id=optional_template.id,
                is_required=False,
            )
        )
        db_session.commit()

        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["pending_questionnaires"] == 1

    def test_student_session_and_detail_redact_case_ground_truth(self, client, student, test_case, db_session):
        case_data = dict(test_case.case_data)
        case_data.update(
            {
                "patient_info": {
                    "name": "王大爷",
                    "age": 65,
                    "gender": "男",
                    "medication_history": "不应公开",
                },
                "personality": {"health_literacy": "low", "verbosity": "terse"},
                "required_inquiries": ["吸烟史"],
                "exam_anchors": {
                    "vital_signs": {
                        "heart_rate": "112",
                        "blood_pressure": "180/110",
                    }
                },
                "deep_background": "仅患者模型可见",
            }
        )
        test_case.case_data = case_data
        db_session.commit()

        _, token = student
        headers = {"Authorization": f"Bearer {token}"}
        start = client.post("/api/training/start", json={"case_id": test_case.id}, headers=headers)
        assert start.status_code == 200
        session = start.json()["session"]
        assert session["patient_info"] == {"name": "王大爷", "age": 65, "gender": "男"}
        assert session["scene"]["vitals"] == {}
        for hidden_key in ("case_data", "exam_anchors", "personality"):
            assert hidden_key not in session

        detail = client.get(f"/api/training/records/{start.json()['record_id']}", headers=headers)
        assert detail.status_code == 200
        payload = detail.json()
        assert payload["patient_info"] == {"name": "王大爷", "age": 65, "gender": "男"}
        assert payload["scene"]["vitals"] == {}
        for hidden_key in ("case_data", "exam_anchors", "personality", "profile_info"):
            assert hidden_key not in payload

    def test_start_session_contains_countdown_anchor(self, client, student, test_case):
        """start 响应 session 必须携带 start_time —— 前端倒计时唯一锚点。

        回归：session 曾缺失 start_time，而前端将 session 直接缓存为
        detail（TrainingSelect.setQueryData → TrainingEntry staleTime=5min），
        倒计时静默降级为 --:--（线上反馈 id=30）。
        """
        _, token = student
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post("/api/training/start", json={"case_id": test_case.id}, headers=headers)
        assert resp.status_code == 200
        session = resp.json()["session"]
        assert session["start_time"], "session.start_time 缺失 → 前端倒计时锚点为空"
        assert session["time_limit"] > 0

        # 前端用同一缓存键消费 session 与 detail，两者时间锚点必须一致
        detail = client.get(f"/api/training/records/{resp.json()['record_id']}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["start_time"] == session["start_time"]

    def test_start_session_mode_defaults_guided(
        self, client, student, teacher, test_case, test_class, test_student_in_class, db_session
    ):
        """直接开始训练默认 guided 模式；作业配置的 behavior.mode 透传。"""
        from datetime import UTC, datetime, timedelta

        from models import Assignment

        _, token = student
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post("/api/training/start", json={"case_id": test_case.id}, headers=headers)
        assert resp.status_code == 200
        session = resp.json()["session"]
        assert session["mode"] == "guided"

        detail = client.get(f"/api/training/records/{resp.json()['record_id']}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["mode"] == "guided"

        # 作业 behavior.mode=assessment 应透传到 session 与 detail
        # （先放弃直开记录，满足单进行中互斥）
        first_id = resp.json()["record_id"]
        ab = client.put(f"/api/training/records/{first_id}/abandon", headers=headers)
        assert ab.status_code == 200

        now = datetime.now(UTC)
        assignment = Assignment(
            title="考核作业",
            class_id=test_class.id,
            case_id=test_case.id,
            teacher_id=teacher[0].id,
            behavior={"mode": "assessment"},
            start_time=now,
            end_time=now + timedelta(days=1),
        )
        db_session.add(assignment)
        db_session.commit()

        resp = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=headers,
        )
        assert resp.status_code == 200
        session = resp.json()["session"]
        assert session["mode"] == "assessment"
        detail = client.get(f"/api/training/records/{resp.json()['record_id']}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["mode"] == "assessment"

    def test_invalid_mode_in_db_falls_back_to_guided(
        self, client, student, teacher, test_case, test_class, test_student_in_class, db_session
    ):
        """库内非法 behavior.mode（绕过 API 校验写入）读取端回退 guided。"""
        from datetime import UTC, datetime, timedelta

        from models import Assignment

        _, token = student
        headers = {"Authorization": f"Bearer {token}"}

        now = datetime.now(UTC)
        assignment = Assignment(
            title="脏模式作业",
            class_id=test_class.id,
            case_id=test_case.id,
            teacher_id=teacher[0].id,
            behavior={"mode": "exam"},
            start_time=now,
            end_time=now + timedelta(days=1),
        )
        db_session.add(assignment)
        db_session.commit()

        resp = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["session"]["mode"] == "guided"

        detail = client.get(f"/api/training/records/{resp.json()['record_id']}", headers=headers)
        assert detail.status_code == 200
        assert detail.json()["mode"] == "guided"


class TestBlindBox:
    def test_start_returns_redacted_session(self, client, student, test_case, db_session):
        """盲盒 start：随机开放病例、mode=blind_box、无 assignment、session 脱敏、中性问候。"""
        from models import Case

        _, token = student
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post("/api/training/start-blind-box", headers=headers)
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["case_name"] == "盲盒训练"
        assert "盲盒" not in data["greeting"]
        session = data["session"]
        assert session["mode"] == "blind_box"
        assert session["from_assignment"] is False
        assert session["case_title"] == ""
        assert session["chief_complaint"] == ""
        assert session["patient_name"] == "患者"
        assert session["patient_age"] == 0
        assert session["patient_gender"] == ""
        assert session["patient_info"]["name"] == "患者"
        open_ids = {c.id for c in db_session.query(Case).filter(Case.is_open == True).all()}
        assert session["case_id"] in open_ids

    def test_detail_redacted_while_in_progress_revealed_after_end(self, client, student, test_case, db_session):
        """盲盒 detail 进行中脱敏，训练结束后揭示便于复盘。"""
        from core.statuses import TrainingStatus
        from models import TrainingRecord

        _, token = student
        headers = {"Authorization": f"Bearer {token}"}
        resp = client.post("/api/training/start-blind-box", headers=headers)
        assert resp.status_code == 200, resp.text
        rid = resp.json()["record_id"]

        detail = client.get(f"/api/training/records/{rid}", headers=headers)
        assert detail.status_code == 200
        d = detail.json()
        assert d["case_name"] == "盲盒训练"
        assert d["patient_name"] == "患者"
        assert d["patient_age"] == 0
        assert d["case_title"] == ""
        assert d["chief_complaint"] == ""
        # 盲盒不显示引导内容：必问清单清空
        assert d["required_inquiries"] == []

        # 结束后（status 离开 in_progress）揭示病例便于复盘
        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == rid).first()
        record.status = TrainingStatus.COMPLETED
        db_session.commit()
        detail2 = client.get(f"/api/training/records/{rid}", headers=headers)
        d2 = detail2.json()
        assert d2["case_name"] != "盲盒训练"
        assert d2["patient_name"] != ""
        assert d2["mode"] == "blind_box"

    def test_no_open_cases_returns_400(self, client, student, db_session):
        """无开放病例时盲盒返回 400（关闭操作在同一测试事务内，teardown 回滚）。"""
        from models import Case

        db_session.query(Case).update({Case.is_open: False})
        _, token = student
        resp = client.post("/api/training/start-blind-box", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 400


class TestHiddenCaseAssignment:
    def test_assignment_hide_case_info_redacts_until_end(
        self, client, student, teacher, test_case, test_class, test_student_in_class, db_session
    ):
        """作业配 hide_case_info：session/detail 脱敏、中性问候、mode 仍 guided、结束后揭示。"""
        from datetime import UTC, datetime, timedelta

        from core.statuses import TrainingStatus
        from models import Assignment, TrainingRecord

        _, token = student
        headers = {"Authorization": f"Bearer {token}"}
        now = datetime.now(UTC)
        assignment = Assignment(
            title="隐藏病例作业",
            class_id=test_class.id,
            case_id=test_case.id,
            teacher_id=teacher[0].id,
            behavior={"hide_case_info": True},
            start_time=now,
            end_time=now + timedelta(days=1),
        )
        db_session.add(assignment)
        db_session.commit()

        resp = client.post(
            f"/api/training/start-from-assignment?assignment_id={assignment.id}",
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["case_name"] == "隐藏病例练习"
        assert "盲盒" not in data["greeting"]
        session = data["session"]
        assert session["hide_case_info"] is True
        assert session["patient_name"] == "患者"
        assert session["patient_age"] == 0
        assert session["case_title"] == ""
        # 作业隐藏是独立开关，不是盲盒 mode
        assert session["mode"] == "guided"

        rid = data["record_id"]
        detail = client.get(f"/api/training/records/{rid}", headers=headers)
        assert detail.status_code == 200
        d = detail.json()
        assert d["hide_case_info"] is True
        assert d["patient_name"] == "患者"
        assert d["patient_age"] == 0
        # 作业隐藏仅隐藏病例信息，引导（必问清单）保留
        assert d["required_inquiries"] != []

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == rid).first()
        record.status = TrainingStatus.COMPLETED
        db_session.commit()
        detail2 = client.get(f"/api/training/records/{rid}", headers=headers)
        d2 = detail2.json()
        assert d2["hide_case_info"] is False
        assert d2["patient_name"] != ""


class TestEndTraining:
    def test_end_training_as_owner(self, client, student, test_case, db_session):
        _user, token = student
        # Start training
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        record_id = resp.json()["record_id"]

        # D4: insert enough messages to meet AUTO_SCORE threshold
        from models import Message

        long_msg = "x" * 100  # 3 * 100 = 300 chars >= 200 threshold
        for _ in range(3):
            db_session.add(Message(record_id=record_id, role="student", content=long_msg))
        db_session.commit()

        # Mock the scoring service (imported inside function body)
        with patch("modules.training.router.scoring.evaluate_training", new_callable=AsyncMock) as mock_eval:
            from models import Score

            mock_eval.return_value = Score(
                id=1,
                record_id=record_id,
                total_score=45.0,
                detail_scores={"沟通技能": {"score": 35, "max": 42}},
                strengths=["态度好"],
                weaknesses=["问诊不全"],
            )

            resp2 = client.post(
                f"/api/training/{record_id}/end",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp2.status_code == 200
            data = resp2.json()
            # 异步评分：立即返回 scoring_status，不再同步返回 total_score
            assert data["scoring_status"] == "pending"
            assert data["record_id"] == record_id
            assert "训练已结束" in data["message"]

    def test_end_other_user_training(self, client, student, test_case, db_session):
        from core.security import hash_password
        from models import Role, User

        _, token = student
        # Start as student1
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        record_id = resp.json()["record_id"]

        # Create another student
        student_role = db_session.query(Role).filter(Role.name == "student").first()
        other = User(
            username="other_student",
            password_hash=hash_password("123"),
            role_id=student_role.id,
            display_name="Other",
        )
        db_session.add(other)
        db_session.commit()
        resp_other = client.post("/api/auth/login", json={"username": "other_student", "password": "123"})
        other_token = resp_other.json()["access_token"]

        resp3 = client.post(
            f"/api/training/{record_id}/end",
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp3.status_code == 403

    def test_end_already_completed(self, client, student, test_case):
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        record_id = resp.json()["record_id"]

        with patch("modules.training.router.scoring.evaluate_training", new_callable=AsyncMock) as mock_eval:
            from models import Score

            mock_eval.return_value = Score(
                record_id=record_id,
                total_score=40.0,
            )
            client.post(
                f"/api/training/{record_id}/end",
                headers={"Authorization": f"Bearer {token}"},
            )
            # Second time — now returns 409 due to _try_acquire_scoring check
            resp2 = client.post(
                f"/api/training/{record_id}/end",
                headers={"Authorization": f"Bearer {token}"},
            )
            assert resp2.status_code == 400


class TestRecords:
    def test_student_sees_only_own(self, client, student, test_case, db_session):
        from core.security import hash_password
        from models import Role, User

        _user, token = student
        # Start + complete one training for student1
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        record_id = resp.json()["record_id"]

        with patch("modules.training.router.scoring.evaluate_training", new_callable=AsyncMock) as m:
            from models import Score

            m.return_value = Score(id=1, record_id=record_id, total_score=42.0)
            client.post(
                f"/api/training/{record_id}/end",
                headers={"Authorization": f"Bearer {token}"},
            )

        # Create another student with their own record
        student_role = db_session.query(Role).filter(Role.name == "student").first()
        other = User(
            username="s2",
            password_hash=hash_password("123"),
            role_id=student_role.id,
            display_name="S2",
        )
        db_session.add(other)
        db_session.commit()

        resp_other = client.post("/api/auth/login", json={"username": "s2", "password": "123"})
        other_token = resp_other.json()["access_token"]

        client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {other_token}"},
        )

        # Student1 should only see 1 record
        records_resp = client.get(
            "/api/training/records",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert records_resp.status_code == 200
        assert len(records_resp.json()["items"]) == 1

    def test_teacher_sees_all(self, client, teacher, student, test_case):
        _user_t, teacher_token = teacher
        _user_s, student_token = student

        # Student starts training
        client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {student_token}"},
        )

        records_resp = client.get(
            "/api/training/records",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert records_resp.status_code == 200
        assert len(records_resp.json()["items"]) >= 1

    def test_filter_by_status(self, client, teacher, student, test_case):
        _, teacher_token = teacher
        _, student_token = student

        client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {student_token}"},
        )

        resp = client.get(
            "/api/training/records?status=in_progress",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert all(r["status"] == "in_progress" for r in resp.json()["items"])

    def test_delete_record_as_teacher(self, client, teacher, student, test_case):
        _, teacher_token = teacher
        _, student_token = student

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        record_id = resp.json()["record_id"]

        del_resp = client.delete(
            f"/api/training/records/{record_id}",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert del_resp.status_code == 200

    def test_delete_record_as_owner(self, client, student, test_case):
        _, token = student
        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        record_id = resp.json()["record_id"]

        del_resp = client.delete(
            f"/api/training/records/{record_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert del_resp.status_code == 200

    def test_delete_nonexistent_record(self, client, teacher):
        _, token = teacher
        resp = client.delete(
            "/api/training/records/99999",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404


class TestScoreReview:
    def test_get_review_requires_teacher(self, client, student, test_case, db_session):
        _, token = student
        resp = client.get(
            "/api/training/records/99999/review",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_submit_review_requires_teacher(self, client, student, test_case, db_session):
        _, token = student
        resp = client.post(
            "/api/training/records/99999/review",
            json={"comment": "test"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403


import pytest

pytestmark = pytest.mark.integration
