"""会话详情 HTTP 冒烟：GET /api/training/records/{id} 必须返回 resolved manifest。

真实 FastAPI 路由（含序列化与 schema 校验）+ 假 session：断言前端消费的四个投影字段
（activities[].availability / artifacts / completion / actions）来自服务端解析，
并随护理评估 draft→submitted 的持久化状态翻转（docs/15 §四）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from main import app
from models import NursingRecord, TrainingRecord

if TYPE_CHECKING:
    from fastapi import FastAPI

CASE_DATA = {
    "name": "冒烟病例",
    "patient_info": {"name": "王建国", "age": 68, "gender": "男"},
    "chief_complaint": "喘不上气",
    "activities": {
        "physical_exam": {"config": {"vital_signs": {"temperature": "37.2-37.8"}}},
        "nursing_record": {"config": True},
    },
}


class _StubQuery:
    """最小查询替身：只回答 get_record_detail 会问的问题。"""

    def __init__(self, value):
        self._value = value

    def options(self, *_a, **_k):
        return self

    def filter(self, *_a, **_k):
        return self

    def join(self, *_a, **_k):
        return self

    def outerjoin(self, *_a, **_k):
        return self

    def order_by(self, *_a, **_k):
        return self

    def load_only(self, *_a, **_k):
        return self

    def with_for_update(self):
        return self

    def first(self):
        return self._value if not isinstance(self._value, list) else (self._value[0] if self._value else None)

    def all(self):
        return self._value if isinstance(self._value, list) else []

    def scalar(self):
        return self._value if not isinstance(self._value, (list, dict)) else 0

    def count(self):
        return 0


class _StubSession:
    def __init__(self, record, nursing: NursingRecord | None):
        self.record = record
        self.nursing = nursing
        self.added: list = []
        self.commits = 0

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        pass

    def refresh(self, _obj):
        pass

    def execute(self, _statement, _params=None):
        # revision 条件自增：返回非 None 表示推进成功
        return type("_Result", (), {"scalar": staticmethod(lambda: 1)})()

    def query(self, model):
        name = getattr(model, "__name__", None) or getattr(model, "key", "")
        if name == "TrainingRecord" or "TrainingRecord" in str(name):
            return _StubQuery(self.record)
        if name == "NursingRecord":
            return _StubQuery(self.nursing)
        if name == "TrainingAction":
            return _StubQuery(None)
        return _StubQuery(None)


def _record(nursing: NursingRecord | None):
    record = TrainingRecord(
        id=5,
        user_id=1,
        case_id=9,
        status="in_progress",
        revision=3,
        case_snapshot=CASE_DATA,
        practice_snapshot={"features": {}},
        runtime_state={},
        time_limit=30,
        start_time=datetime.now(UTC),
        is_test=False,
    )
    record.messages = []
    record.score = None
    record.case = None
    record.user = None
    return record, _StubSession(record, nursing)


def _client(nursing: NursingRecord | None):
    record, db = _record(nursing)

    def _override_db():
        yield db

    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    return TestClient(cast("FastAPI", app)), record


class _FakeUser:
    id = 1
    display_name = "测试学生"

    def has_permission(self, _permission: str) -> bool:
        return False


def _fetch(record_id: int = 5):
    for nursing in (None, _nursing(submitted_at=None), _nursing(submitted_at=datetime.now(UTC))):
        client, _record_obj = _client(nursing)
        try:
            response = client.get(f"/api/training/records/{record_id}")
        finally:
            app.dependency_overrides.clear()
        yield response


def _nursing(*, submitted_at: datetime | None) -> NursingRecord:
    return NursingRecord(
        id=11,
        record_id=5,
        user_id=1,
        sheet_data={"subjective": "喘不上气三天"},
        status="submitted" if submitted_at else "draft",
        submitted_at=submitted_at,
        updated_at=datetime.now(UTC),
    )


def test_detail_returns_resolved_manifest():
    responses = list(_fetch())
    for response in responses:
        assert response.status_code == 200, response.text

    manifest = responses[0].json()["manifest"]
    assert manifest["schema"] == "workflow-manifest"
    assert manifest["projection"] == "session"
    activities = {item["id"]: item for item in manifest["activities"]}
    assert activities["physical_exam"]["availability"]["state"] == "available"
    assert activities["nursing_record"]["availability"]["state"] == "available"
    assert activities["quiz"]["availability"] == {"state": "unavailable", "reason_code": "case_not_configured"}


def test_detail_manifest_tracks_artifact_lifecycle():
    empty, draft, submitted = (response.json()["manifest"] for response in _fetch())

    assert empty["artifacts"]["nursing_record"]["state"] == "empty"
    assert draft["artifacts"]["nursing_record"]["state"] == "draft"
    assert submitted["artifacts"]["nursing_record"]["state"] == "submitted"

    assert empty["completion"]["eligible"] is False
    assert draft["completion"]["eligible"] is False
    assert submitted["completion"]["eligible"] is True
    assert submitted["completion"]["blockers"] == []
    assert submitted["actions"] == [{"id": "complete_session", "label": "结束训练", "enabled": True}]

    blocker = draft["completion"]["blockers"][0]
    assert blocker["code"] == "ARTIFACT_NOT_SUBMITTED"
    assert blocker["target"] == {"type": "artifact", "id": "nursing_record"}
    assert draft["actions"][0]["enabled"] is False


def test_detail_features_are_activity_flags():
    features = next(iter(_fetch())).json()["features"]
    assert features["physical_exam"] is True
    assert features["nursing_record"] is True
    assert features["quiz"] is False
    assert features["emotion"] is True


def test_tool_command_endpoint_still_dispatches_to_activity_binding():
    """旧 HTTP 工具面 = transport adapter：旧请求 → Activity command → ACTIVITY_BINDINGS。"""
    client, _record_obj = _client(_nursing(submitted_at=None))
    try:
        response = client.post(
            "/api/training/5/tools",
            json={
                "cmd": "physical_exam.measure",
                "params": {"op_type": "temp"},
                "idem_key": "smoke-1",
                "revision": None,
            },
        )
        disabled = client.post(
            "/api/training/5/tools",
            json={"cmd": "quiz.load", "params": {}, "idem_key": "smoke-2", "revision": None},
        )
        unknown = client.post(
            "/api/training/5/tools",
            json={"cmd": "telepathy.measure", "params": {}, "idem_key": "smoke-3", "revision": None},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["ok"] is True
    assert payload["data"]["op_type"] == "temp"
    assert payload["data"]["result"]["value"]
    assert float(payload["scene"]["vitals"]["temp"]) == float(payload["data"]["result"]["value"])

    # 病例未声明 quiz → 服务端可用性闸门拒绝（不再读 case.tools / capability）
    assert disabled.status_code == 400
    assert "未启用" in disabled.json()["detail"]
    assert unknown.status_code == 400
    assert "未知训练工具" in unknown.json()["detail"]
