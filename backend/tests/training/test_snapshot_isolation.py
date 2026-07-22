"""快照隔离集成测试：训练开始后修改 case_data 不影响会话/评分/回顾"""

from copy import deepcopy

from models import TrainingRecord

ORIGINAL_CASE_DATA = {
    "patient_info": {"name": "张大妈", "age": 62, "gender": "女"},
    "chief_complaint": "胸闷三天",
    "opening_line": "医生你好，我胸口闷得慌...",
    "present_illness": "胸闷三天，活动后加重",
    "required_inquiries": ["胸闷持续时间", "既往心脏病史"],
    "capabilities": {"nursing_record": True},
    "personality": {"health_literacy": "normal", "verbosity": "normal"},
}

MODIFIED_CASE_DATA = {
    "patient_info": {"name": "李大爷", "age": 70, "gender": "男"},
    "chief_complaint": "头痛一周",
    "opening_line": "你好，我头疼...",
    "present_illness": "头痛一周，伴恶心",
    "required_inquiries": ["头痛部位"],
    "capabilities": {},
}


class TestCaseSnapshotIsolation:
    def test_detail_uses_snapshot_after_case_modified(self, client, student, test_case, db_session):
        """训练回顾使用快照数据，不受后续 case_data 修改影响"""
        _user, token = student

        test_case.case_data = deepcopy(ORIGINAL_CASE_DATA)
        test_case.is_open = True
        db_session.commit()

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        record_id = resp.json()["record_id"]

        test_case.case_data = deepcopy(MODIFIED_CASE_DATA)
        db_session.commit()

        detail_resp = client.get(
            f"/api/training/records/{record_id}",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert detail_resp.status_code == 200, detail_resp.text
        detail = detail_resp.json()

        assert detail["patient_name"] == "张大妈"
        assert detail["patient_age"] == 62
        assert detail["chief_complaint"] == "胸闷三天"
        assert detail["case_data"]["patient_info"]["name"] == "张大妈"

    def test_case_data_snapshot_unchanged_after_modify(self, client, student, test_case, db_session):
        """修改 case_data 后，record.case_snapshot 保持不变"""
        _user, token = student

        test_case.case_data = deepcopy(ORIGINAL_CASE_DATA)
        test_case.is_open = True
        db_session.commit()

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        record_id = resp.json()["record_id"]

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        original_snapshot = deepcopy(record.case_snapshot)
        assert original_snapshot is not None

        test_case.case_data = deepcopy(MODIFIED_CASE_DATA)
        db_session.commit()

        db_session.refresh(record)
        assert record.case_snapshot == original_snapshot
        assert record.case_snapshot["patient_info"]["name"] == "张大妈"
        assert record.case_snapshot["capabilities"] == {"nursing_record": True}


class TestRubricSnapshot:
    def test_nursing_record_enabled_stores_full_rubric(self, client, student, test_case, db_session):
        """[DISABLED] nursing_record 评分维度已禁用，rubric_snapshot 不再含护理维度"""
        _user, token = student

        case_data = deepcopy(ORIGINAL_CASE_DATA)
        case_data["capabilities"] = {"nursing_record": True}
        test_case.case_data = case_data
        test_case.is_open = True
        db_session.commit()

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        record_id = resp.json()["record_id"]

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        assert record.rubric_snapshot is not None
        assert record.case_snapshot is not None

        dims = record.rubric_snapshot.get("dimensions", [])
        dim_ids = [d["id"] for d in dims]
        assert "nursing_record" not in dim_ids, "nursing_record 维度已禁用，不应出现在 rubric_snapshot 中"
        assert record.rubric_snapshot.get("raw_max") == 57

    def test_nursing_record_disabled_stores_base_rubric(self, client, student, test_case, db_session):
        """未开启 nursing_record 时，rubric_snapshot 不含护理维度"""
        _user, token = student

        case_data = deepcopy(ORIGINAL_CASE_DATA)
        case_data["capabilities"] = {"nursing_record": False}
        test_case.case_data = case_data
        test_case.is_open = True
        db_session.commit()

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        record_id = resp.json()["record_id"]

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        dims = record.rubric_snapshot.get("dimensions", [])
        dim_ids = [d["id"] for d in dims]
        assert "nursing_record" not in dim_ids
        assert record.rubric_snapshot.get("raw_max") == 57

    def test_capabilities_removed_snapshot_unchanged(self, client, student, test_case, db_session):
        """修改 case 能力后，已有 snapshot 不受影响"""
        _user, token = student

        case_data = deepcopy(ORIGINAL_CASE_DATA)
        case_data["capabilities"] = {"nursing_record": True}
        test_case.case_data = case_data
        test_case.is_open = True
        db_session.commit()

        resp = client.post(
            "/api/training/start",
            json={"case_id": test_case.id},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200, resp.text
        record_id = resp.json()["record_id"]

        record = db_session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        original_rubric = deepcopy(record.rubric_snapshot)

        test_case.case_data["capabilities"] = {}
        db_session.commit()

        db_session.refresh(record)
        assert record.rubric_snapshot == original_rubric
        assert record.case_snapshot["capabilities"] == {"nursing_record": True}
