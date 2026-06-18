"""Case management tests — basic CRUD only (LLM generation tests rely on live API)."""


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
        client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {student_token}"},
        )
        resp = client.delete(
            f"/api/cases/{test_case.id}",
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        assert resp.status_code == 400

    def test_manage_list_route_ordering(self, client, teacher):
        _, token = teacher
        resp = client.get("/api/cases/manage/list", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert "items" in resp.json()


class TestGenerateCase:
    def test_generate_requires_teacher(self, client, student):
        _, token = student
        resp = client.post(
            "/api/cases/generate",
            json={"mode": "quick", "description": "\u9ad8\u8840\u538b\u60a3\u8005"},
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
            json={"mode": "reference", "description": "\u6d4b\u8bd5", "reference_case_ids": [999]},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404
