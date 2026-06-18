import pytest

TEMPLATES_URL = "/api/questionnaires/templates"


class TestTemplateCRUD:
    def test_create_template(self, client, teacher):
        _, token = teacher
        resp = client.post(
            TEMPLATES_URL,
            json={
                "title": "病史采集知识前测",
                "type": "pre",
                "description": "测试学生病史采集基础知识",
                "questions": [
                    {
                        "content": "我会运用护理程序框架进行病史采集",
                        "question_type": "likert_5",
                        "required": True,
                        "sort_order": 0,
                    },
                    {
                        "content": "病史采集的核心内容包括哪些",
                        "question_type": "multiple_choice",
                        "required": True,
                        "sort_order": 1,
                        "options": ["主诉", "现病史", "既往史", "心理评估"],
                    },
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "病史采集知识前测"
        assert data["type"] == "pre"
        assert data["question_count"] == 2
        assert len(data["questions"]) == 2
        assert data["questions"][0]["content"] == "我会运用护理程序框架进行病史采集"
        assert data["questions"][0]["question_type"] == "likert_5"
        assert data["questions"][1]["question_type"] == "multiple_choice"
        assert data["questions"][1]["options"] == ["主诉", "现病史", "既往史", "心理评估"]

    def test_create_template_without_questions(self, client, teacher):
        _, token = teacher
        resp = client.post(
            TEMPLATES_URL,
            json={"title": "简版问卷", "type": "post", "questions": []},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["question_count"] == 0

    def test_list_templates(self, client, teacher):
        _, token = teacher
        for i in range(3):
            client.post(
                TEMPLATES_URL,
                json={"title": f"问卷{i}", "type": "pre" if i % 2 == 0 else "post"},
                headers={"Authorization": f"Bearer {token}"},
            )
        resp = client.get(
            TEMPLATES_URL,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 3
        assert len(data["items"]) >= 3

    def test_list_templates_filter_by_type(self, client, teacher):
        _, token = teacher
        client.post(
            TEMPLATES_URL,
            json={"title": "前测问卷", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        client.post(
            TEMPLATES_URL,
            json={"title": "后测问卷", "type": "post"},
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = client.get(
            f"{TEMPLATES_URL}?type=pre",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        items = resp.json()["items"]
        assert all(i["type"] == "pre" for i in items)

    def test_get_template(self, client, teacher):
        _, token = teacher
        create_resp = client.post(
            TEMPLATES_URL,
            json={"title": "获取测试", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        tid = create_resp.json()["id"]
        resp = client.get(
            f"{TEMPLATES_URL}/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["title"] == "获取测试"

    def test_get_template_not_found(self, client, teacher):
        _, token = teacher
        resp = client.get(
            f"{TEMPLATES_URL}/99999",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 404

    def test_update_template(self, client, teacher):
        _, token = teacher
        create_resp = client.post(
            TEMPLATES_URL,
            json={"title": "旧标题", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        tid = create_resp.json()["id"]
        resp = client.put(
            f"{TEMPLATES_URL}/{tid}",
            json={"title": "新标题", "is_active": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "新标题"
        assert data["is_active"] is False

    def test_delete_template(self, client, teacher):
        _, token = teacher
        create_resp = client.post(
            TEMPLATES_URL,
            json={"title": "待删除", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        tid = create_resp.json()["id"]
        resp = client.delete(
            f"{TEMPLATES_URL}/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        get_resp = client.get(
            f"{TEMPLATES_URL}/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert get_resp.status_code == 404

    def test_student_cannot_create_template(self, client, student):
        _, token = student
        resp = client.post(
            TEMPLATES_URL,
            json={"title": "非法创建", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403


class TestQuestionManagement:
    @pytest.fixture
    def template(self, client, teacher):
        _, token = teacher
        resp = client.post(
            TEMPLATES_URL,
            json={"title": "题目管理测试", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        return resp.json()["id"], token

    def test_add_question(self, client, template):
        tid, token = template
        resp = client.post(
            f"{TEMPLATES_URL}/{tid}/questions",
            json={
                "content": "新增题目",
                "question_type": "short_text",
                "required": False,
                "sort_order": 0,
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "新增题目"
        assert resp.json()["question_type"] == "short_text"
        assert resp.json()["required"] is False

    def test_update_question(self, client, template):
        tid, token = template
        add_resp = client.post(
            f"{TEMPLATES_URL}/{tid}/questions",
            json={"content": "旧题", "question_type": "likert_5"},
            headers={"Authorization": f"Bearer {token}"},
        )
        qid = add_resp.json()["id"]
        resp = client.put(
            f"{TEMPLATES_URL}/{tid}/questions/{qid}",
            json={"content": "新题内容", "required": False},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["content"] == "新题内容"
        assert resp.json()["required"] is False

    def test_delete_question(self, client, template):
        tid, token = template
        add_resp = client.post(
            f"{TEMPLATES_URL}/{tid}/questions",
            json={"content": "待删题", "question_type": "short_text"},
            headers={"Authorization": f"Bearer {token}"},
        )
        qid = add_resp.json()["id"]
        resp = client.delete(
            f"{TEMPLATES_URL}/{tid}/questions/{qid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200


class TestCaseAssignment:
    @pytest.fixture
    def setup(self, client, teacher, test_case):
        _, token = teacher
        resp = client.post(
            TEMPLATES_URL,
            json={"title": "病例关联测试", "type": "pre"},
            headers={"Authorization": f"Bearer {token}"},
        )
        return resp.json()["id"], test_case.id, token

    def test_assign_cases(self, client, setup):
        tid, cid, token = setup
        resp = client.put(
            f"{TEMPLATES_URL}/{tid}/case-assignments",
            json={"case_ids": [cid], "is_required": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

        get_resp = client.get(
            f"{TEMPLATES_URL}/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert cid in get_resp.json()["case_ids"]

    def test_reassign_cases_overwrites(self, client, setup):
        tid, cid, token = setup
        client.put(
            f"{TEMPLATES_URL}/{tid}/case-assignments",
            json={"case_ids": [cid]},
            headers={"Authorization": f"Bearer {token}"},
        )
        client.put(
            f"{TEMPLATES_URL}/{tid}/case-assignments",
            json={"case_ids": [], "trigger_event": "before_training"},
            headers={"Authorization": f"Bearer {token}"},
        )
        get_resp = client.get(
            f"{TEMPLATES_URL}/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert get_resp.json()["case_ids"] == []


class TestStudentCheckAndSubmit:
    @pytest.fixture
    def assigned_template(self, client, teacher, test_case):
        _, token = teacher
        resp = client.post(
            TEMPLATES_URL,
            json={
                "title": "学生自测问卷",
                "type": "pre",
                "questions": [
                    {"content": "Likert题", "question_type": "likert_5", "sort_order": 0},
                    {
                        "content": "选择题",
                        "question_type": "multiple_choice",
                        "sort_order": 1,
                        "options": ["A", "B", "C"],
                    },
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        tid = resp.json()["id"]
        client.put(
            f"{TEMPLATES_URL}/{tid}/case-assignments",
            json={"case_ids": [test_case.id], "is_required": True},
            headers={"Authorization": f"Bearer {token}"},
        )
        return tid, test_case.id

    def test_check_pending_questionnaire(self, client, student, assigned_template):
        tid, cid = assigned_template
        _, token = student
        resp = client.get(
            f"/api/questionnaires/check?case_id={cid}&trigger=before_training",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["has_pending"] is True
        assert data["template_id"] == tid
        assert data["is_required"] is True
        assert data["template"] is not None
        assert data["trigger_event"] == "before_training"

    def test_check_no_match(self, client, student, test_case):
        _, token = student
        resp = client.get(
            f"/api/questionnaires/check?case_id={test_case.id}&trigger=before_training",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["has_pending"] is False

    def _get_question_ids(self, client, token, tid, cid):
        check_resp = client.get(
            f"/api/questionnaires/check?case_id={cid}&trigger=before_training",
            headers={"Authorization": f"Bearer {token}"},
        )
        questions = check_resp.json()["template"]["questions"]
        return questions[0]["id"], questions[1]["id"]

    def test_submit_questionnaire(self, client, student, assigned_template):
        tid, cid = assigned_template
        _, token = student
        q1_id, q2_id = self._get_question_ids(client, token, tid, cid)

        resp = client.post(
            "/api/questionnaires/responses",
            json={
                "template_id": tid,
                "case_id": cid,
                "answers": [
                    {"question_id": q1_id, "answer_value": "5"},
                    {"question_id": q2_id, "answer_value": "A"},
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "completed"
        assert len(data["answers"]) == 2

    def test_after_submit_no_longer_pending(self, client, student, assigned_template):
        tid, cid = assigned_template
        _, token = student
        q1_id, q2_id = self._get_question_ids(client, token, tid, cid)
        client.post(
            "/api/questionnaires/responses",
            json={
                "template_id": tid,
                "case_id": cid,
                "answers": [
                    {"question_id": q1_id, "answer_value": "5"},
                    {"question_id": q2_id, "answer_value": "A"},
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        check_resp = client.get(
            f"/api/questionnaires/check?case_id={cid}&trigger=before_training",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert check_resp.json()["has_pending"] is False

    def test_my_responses(self, client, student, assigned_template):
        tid, cid = assigned_template
        _, token = student
        q1_id, q2_id = self._get_question_ids(client, token, tid, cid)
        client.post(
            "/api/questionnaires/responses",
            json={
                "template_id": tid,
                "case_id": cid,
                "answers": [
                    {"question_id": q1_id, "answer_value": "5"},
                    {"question_id": q2_id, "answer_value": "A"},
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        resp = client.get(
            "/api/questionnaires/my-responses",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

    def test_resubmit_replaces_answers(self, client, student, assigned_template):
        tid, cid = assigned_template
        _, token = student
        q1_id, q2_id = self._get_question_ids(client, token, tid, cid)
        client.post(
            "/api/questionnaires/responses",
            json={
                "template_id": tid,
                "case_id": cid,
                "answers": [
                    {"question_id": q1_id, "answer_value": "1"},
                    {"question_id": q2_id, "answer_value": "B"},
                ],
            },
            headers={"Authorization": f"Bearer {token}"},
        )
        my_resp = client.get(
            "/api/questionnaires/my-responses",
            headers={"Authorization": f"Bearer {token}"},
        )
        answers = my_resp.json()["items"][0]["answers"]
        a1 = next(a for a in answers if a["question_id"] == q1_id)
        assert a1["answer_value"] == "1"


class TestTeacherResponseView:
    @pytest.fixture
    def template_with_response(self, client, teacher, student, test_case):
        _, teacher_token = teacher
        _, student_token = student
        resp = client.post(
            TEMPLATES_URL,
            json={
                "title": "统计测试问卷",
                "type": "pre",
                "questions": [
                    {"content": "Likert题", "question_type": "likert_5", "sort_order": 0},
                    {"content": "选择题", "question_type": "multiple_choice", "sort_order": 1, "options": ["X", "Y"]},
                    {"content": "文本题", "question_type": "short_text", "sort_order": 2},
                ],
            },
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        tid = resp.json()["id"]
        questions = resp.json()["questions"]
        client.put(
            f"{TEMPLATES_URL}/{tid}/case-assignments",
            json={"case_ids": [test_case.id], "is_required": True},
            headers={"Authorization": f"Bearer {teacher_token}"},
        )
        client.post(
            "/api/questionnaires/responses",
            json={
                "template_id": tid,
                "case_id": test_case.id,
                "answers": [
                    {"question_id": questions[0]["id"], "answer_value": "4"},
                    {"question_id": questions[1]["id"], "answer_value": "X"},
                    {"question_id": questions[2]["id"], "answer_value": "测试回复"},
                ],
            },
            headers={"Authorization": f"Bearer {student_token}"},
        )
        return tid, teacher_token

    def test_list_responses(self, client, template_with_response):
        tid, token = template_with_response
        resp = client.get(
            f"/api/questionnaires/responses/{tid}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1

    def test_response_stats(self, client, template_with_response):
        tid, token = template_with_response
        resp = client.get(
            f"/api/questionnaires/responses/{tid}/stats",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_completed"] >= 1
        assert len(data["questions"]) == 3
        likert_q = next(q for q in data["questions"] if q["question_type"] == "likert_5")
        assert likert_q["avg_likert"] == 4.0
        choice_q = next(q for q in data["questions"] if q["question_type"] == "multiple_choice")
        assert "X" in choice_q["choice_distribution"]
        text_q = next(q for q in data["questions"] if q["question_type"] == "short_text")
        assert "测试回复" in text_q["text_answers"]

    def test_export_csv(self, client, template_with_response):
        tid, token = template_with_response
        resp = client.get(
            f"/api/questionnaires/responses/{tid}/export",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert "text/csv" in resp.headers.get("content-type", "")
        assert "李明" in resp.text
        assert "测试回复" in resp.text
