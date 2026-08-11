"""End-to-end HTTP flow for /api/simulations using a fake session + user.

No real DB: the service's ``add/flush/get`` surface is faked, so this tests the
router -> service -> engine -> serialization -> schema contract without a
database, matching the project's pure/mocked testing philosophy.
"""

from fastapi.testclient import TestClient

from core.database import get_db
from core.security import get_current_user
from main import app


class _FakeUser:
    id = 1


class _FakeSession:
    def __init__(self):
        self.rows = {}
        self._next = 1

    def add(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = self._next
            self._next += 1
        self.rows[obj.id] = obj

    def flush(self):
        pass

    def commit(self):
        pass

    def rollback(self):
        pass

    def get(self, model, pk):
        return self.rows.get(pk)


_shared_db = _FakeSession()


def _override_db():
    yield _shared_db


def _override_user():
    return _FakeUser()


_client = TestClient(app)
_client.app.dependency_overrides[get_db] = _override_db
_client.app.dependency_overrides[get_current_user] = _override_user


def _create():
    r = _client.post("/api/simulations/sessions")
    assert r.status_code == 200
    return r.json()


def _act(sid, atype, target=None):
    return _client.post(
        f"/api/simulations/sessions/{sid}/actions",
        json={"action": {"type": atype, "target": target}},
    ).json()


def test_good_path_via_api():
    created = _create()
    sid = created["session_id"]
    # Initial snapshot must not leak hidden severity.
    assert "hidden" not in created["snapshot"]
    assert created["snapshot"]["case_status"] == "ACTIVE"

    for atype, target in [
        ("ASSESS", "vitals"),
        ("ASSESS", "drain"),
        ("ORDER", "cbc"),
        ("MONITOR", "vitals"),
        ("WAIT", None),
        ("VIEW", "cbc"),
        ("REPORT", "doctor"),
    ]:
        r = _act(sid, atype, target)
        assert r["accepted"] is True, r

    assert r["case_ended"] is True
    assert r["snapshot"]["case_status"] == "SUCCESS"
    assert r["snapshot"]["cbc_count"] == 1
    assert r["snapshot"]["diag_spent"] == 35
    assert any(m["kind"] == "AUDIT" for m in r["snapshot"]["messages"])


def test_unrevealed_cbc_not_exposed_by_api():
    created = _create()
    sid = created["session_id"]
    _act(sid, "ORDER", "cbc")
    _act(sid, "WAIT_CBC", None)
    snap = _act(sid, "STATUS", None)["snapshot"]
    assert snap["unrevealed_lab_count"] == 1
    assert snap["lab_records"] == []
    assert not any("Hb" in m["text"] for m in snap["messages"])


def test_repeat_pending_rejected_without_extra_charge():
    created = _create()
    sid = created["session_id"]
    _act(sid, "ORDER", "cbc")
    r = _act(sid, "ORDER", "cbc")
    assert r["accepted"] is False
    assert r["snapshot"]["cbc_count"] == 1
    assert r["snapshot"]["diag_spent"] == 35
    assert any("拒绝" in m["text"] for m in r["messages"])


def test_delay_outcome_via_api():
    created = _create()
    sid = created["session_id"]
    _act(sid, "WAIT", None)
    r = _act(sid, "WAIT", None)
    assert r["case_ended"] is True
    assert r["snapshot"]["case_status"] == "FAILURE"
    # Post-end clinical action rejected.
    r2 = _act(sid, "ASSESS", "drain")
    assert r2["accepted"] is False


def test_refresh_consistency_via_get():
    created = _create()
    sid = created["session_id"]
    _act(sid, "ASSESS", "vitals")
    r = _client.get(f"/api/simulations/sessions/{sid}")
    assert r.status_code == 200
    snap = r.json()
    assert snap["case_status"] == "ACTIVE"
    assert len(snap["vitals"]) == 2  # handover baseline + one assessment
    assert snap["current_time"] == 2


def test_foreign_session_rejected():
    created = _create()
    other = _client.get(f"/api/simulations/sessions/{created['session_id'] + 999}")
    assert other.status_code == 404


class _FakeLLM:
    def __init__(self, response="评估：已知信息有限；建议：复查 CBC 并监测尿量与生命体征。"):
        self.response = response
        self.calls = []

    async def call(self, messages, **kwargs):
        self.calls.append(messages)
        return self.response


class _BoomLLM:
    async def call(self, messages, **kwargs):
        raise RuntimeError("llm down")


def test_consult_via_api_returns_advice():
    llm = _FakeLLM()
    _client.app.state.llm_client = llm
    created = _create()
    r = _act(created["session_id"], "CONSULT", None)
    assert r["accepted"] is True
    assert r["snapshot"]["diag_spent"] == 120
    assert any("专家建议" in m["text"] for m in r["snapshot"]["messages"])
    assert llm.calls, "consult must actually call the LLM"


def test_consult_refunds_when_llm_fails():
    _client.app.state.llm_client = _BoomLLM()
    created = _create()
    r = _act(created["session_id"], "CONSULT", None)
    assert r["accepted"] is True
    assert r["snapshot"]["diag_spent"] == 0
    assert any("不扣检查点" in m["text"] for m in r["snapshot"]["messages"])


def test_consult_refunds_when_llm_unavailable():
    _client.app.state.llm_client = None
    created = _create()
    r = _act(created["session_id"], "CONSULT", None)
    assert r["accepted"] is True
    assert r["snapshot"]["diag_spent"] == 0
    assert any("服务未就绪" in m["text"] for m in r["snapshot"]["messages"])
