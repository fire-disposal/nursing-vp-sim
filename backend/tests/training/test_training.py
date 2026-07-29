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
        for hidden_key in ("case_data", "required_inquiries", "exam_anchors", "personality"):
            assert hidden_key not in session

        detail = client.get(f"/api/training/records/{start.json()['record_id']}", headers=headers)
        assert detail.status_code == 200
        payload = detail.json()
        assert payload["patient_info"] == {"name": "王大爷", "age": 65, "gender": "男"}
        assert payload["scene"]["vitals"] == {}
        for hidden_key in ("case_data", "required_inquiries", "exam_anchors", "personality", "profile_info"):
            assert hidden_key not in payload


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
