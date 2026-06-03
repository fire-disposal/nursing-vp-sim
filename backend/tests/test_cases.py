"""Case management tests: CRUD operations."""

from unittest.mock import AsyncMock, MagicMock, patch


class TestStudentCases:
    def test_get_cases(self, client, student, test_case):
        _, token = student
        resp = client.get("/api/cases", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert data["total"] >= 1
        assert "patient_summary" in data["items"][0]

    def test_get_case_detail(self, client, student, test_case):
        _, token = student
        resp = client.get(f"/api/cases/{test_case.id}", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["name"] == test_case.name


class TestManageCases:
    def test_get_manage_list(self, client, teacher, test_case):
        _, token = teacher
        resp = client.get("/api/cases/manage/list", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "items" in data
        assert "training_count" in data["items"][0]

    def test_delete_case_with_records(self, client, teacher, student, test_case):
        _, teacher_token = teacher
        _, student_token = student

        # Student trains on this case, creating a record
        client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {student_token}"},
        )

        resp = client.delete(
            f"/api/cases/{test_case.id}",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 400  # Can't delete with training records

    def test_manage_list_route_ordering(self, client, teacher):
        """Ensure /manage/list is not captured by /{case_id}."""
        _, token = teacher
        resp = client.get("/api/cases/manage/list", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert "items" in resp.json()


class TestGenerateCase:
    def test_generate_requires_teacher(self, client, student):
        _, token = student
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": "高血压患者"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403

    def test_generate_requires_description(self, client, teacher):
        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": ""},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 422

    def test_generate_reference_cases_not_found(self, client, teacher):
        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "reference", "description": "测试", "reference_case_ids": [999]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    @patch("routers.cases.call_llm_json", new_callable=AsyncMock)
    @patch("routers.cases.get_prompt_manager")
    def test_generate_quick_mode_success(self, mock_pm_get, mock_call_llm, client, teacher):
        mock_tmpl = MagicMock()
        mock_tmpl.render.return_value = "system prompt content"
        mock_pm = AsyncMock()
        mock_pm.get.return_value = mock_tmpl
        mock_pm_get.return_value = mock_pm

        mock_call_llm.return_value = {
            "name": "测试生成病例",
            "difficulty": 1,
            "time_limit": 20,
            "patient_info": {"name": "张先生", "age": 55, "gender": "男"},
            "chief_complaint": "头晕3天",
            "opening_line": "护士，我最近总头晕",
            "present_illness": "3天前无明显诱因头晕",
            "past_history": "高血压5年",
            "medication_history": "硝苯地平 30mg qd",
            "allergy_history": "无",
            "family_history": "父亲高血压",
            "social_history": "吸烟20年",
            "communication_style": "友善自然，略带焦虑",
            "hidden_info": ["未规律服药"],
            "hidden_info_rules": [],
            "required_inquiries": ["血压值"],
            "scoring_criteria": {},
        }

        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": "高血压患者"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["case_data"]["name"] == "测试生成病例"
        assert data["case_data"]["patient_info"]["name"] == "张先生"
        assert data["field"] is None

    @patch("routers.cases.call_llm_json", new_callable=AsyncMock)
    @patch("routers.cases.get_prompt_manager")
    def test_generate_field_mode(self, mock_pm_get, mock_call_llm, client, teacher):
        mock_tmpl = MagicMock()
        mock_tmpl.render.return_value = "system prompt content"
        mock_pm = AsyncMock()
        mock_pm.get.return_value = mock_tmpl
        mock_pm_get.return_value = mock_pm

        mock_call_llm.return_value = {
            "field_value": ["吸烟史", "饮酒史", "运动习惯"],
        }

        _, token = teacher
        resp = client.post(
            "/api/cases/generate",
            json={
                "mode": "quick",
                "description": "高血压患者",
                "field": "required_inquiries",
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["field"] == "required_inquiries"
        assert len(data["field_value"]) == 3
