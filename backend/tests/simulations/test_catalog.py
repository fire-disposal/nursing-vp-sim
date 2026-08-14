"""服务器驱动契约 — 行动目录 / 开局简报 / 目标清单 / 教练提示 / 床旁状态。

前端行动面板、简报卡、目标清单、提示条全部消费这些快照字段；前端不复制规则。
所有字段只由「玩家已知」信息派生，隐藏严重度绝不出现。
"""

from modules.simulations import engine as e
from modules.simulations.catalog import build_action_catalog
from modules.simulations.engine import new_session


def _entry(cat, group, aid):
    return next(a for a in cat[group] if a["id"] == aid)


def test_catalog_initial_state_all_enabled():
    s = new_session()
    cat = build_action_catalog(s)
    assert cat["assess"], "评估目录必须非空"
    assert all(a["enabled"] for a in cat["assess"])
    assert all(a["enabled"] for a in cat["order"])
    assert all(a["enabled"] for a in cat["give"])
    # 开局：监护可开、报告因无异常证据而禁用并解释原因
    assert _entry(cat, "manage", "monitor")["enabled"] is True
    report = _entry(cat, "manage", "report")
    assert report["enabled"] is False
    assert "异常证据" in report["disabled_reason"]


def test_catalog_shows_cost_and_duration():
    s = new_session()
    cat = build_action_catalog(s)
    cbc = _entry(cat, "order", "CBC")
    assert cbc["cost"] == 35
    assert cbc["cost_label"] == "35检查点"
    assert cbc["turnaround"] == 15
    fluids = _entry(cat, "give", "FLUIDS")
    assert fluids["unit"] == "ml"
    assert fluids["default_dose"] == 500
    assert fluids["max_dose"] == 1500
    vitals = _entry(cat, "assess", "vitals")
    assert vitals["duration"] == 2


def test_catalog_gates_reflect_state():
    s = new_session()
    # 监护开启后 → 置灰并说明原因
    e.apply_action(s, "MONITOR", "vitals")
    cat = build_action_catalog(s)
    monitor = _entry(cat, "manage", "monitor")
    assert monitor["enabled"] is False
    assert "已开启" in monitor["disabled_reason"]
    # 同项检查 pending → 拒绝重复申请
    e.apply_action(s, "ORDER", "cbc")
    cat2 = build_action_catalog(s)
    cbc = _entry(cat2, "order", "CBC")
    assert cbc["enabled"] is False
    assert "进行中" in cbc["disabled_reason"]


def test_catalog_report_enabled_with_evidence():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # 恶化 → 已知异常证据
    cat = build_action_catalog(s)
    report = _entry(cat, "manage", "report")
    assert report["enabled"] is True
    assert report["disabled_reason"] is None


def test_catalog_talk_disabled_when_comatose():
    s = new_session("mvpd-1")
    s.hidden.physio["conscious"] = 0.2  # 昏迷档（conscious < 0.3）
    cat = build_action_catalog(s)
    patient = _entry(cat, "talk", "patient")
    assert patient["enabled"] is False
    assert "昏迷" in patient["disabled_reason"]


def test_catalog_disables_everything_after_end():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    assert s.case_status == "FAILURE"
    cat = build_action_catalog(s)
    for group in ("assess", "order", "give"):
        assert all(not a["enabled"] for a in cat[group])
    for aid in ("monitor", "consult", "diag", "report", "wait"):
        assert _entry(cat, "manage", aid)["enabled"] is False, aid
    assert _entry(cat, "manage", "hint")["enabled"] is True  # 提示永远可用


def test_catalog_respects_case_surface():
    s = new_session("mvpa-1")  # 哮喘病例
    cat = build_action_catalog(s)
    drug_ids = {a["id"] for a in cat["give"]}
    assert drug_ids == {"SALBUTAMOL", "OXYGEN", "STEROID", "FLUIDS"}
    assert _entry(cat, "give", "STEROID")["default_dose"] == 40


def test_snapshot_new_contract_fields():
    from modules.simulations.service import build_snapshot

    s = new_session("mvpa-1")
    snap = build_snapshot(1, s)
    # 开局简报
    assert snap["brief"]["patient"]
    assert snap["brief"]["task"]
    assert snap["brief"]["goal"]
    assert snap["brief"]["opening_hint"]
    assert snap["brief"]["resources"]["diag"] == 400
    # 目标清单
    assert snap["objectives"]["assessed"] is False
    assert snap["objectives"]["monitoring"] is False
    assert snap["objectives"]["timely"] is None
    # 教练提示
    assert snap["hint"]["level"] >= 1
    assert snap["hint"]["text"]
    # 床旁状态（只含已知信息）
    assert snap["patient"]["consciousness_label"] == "清醒"
    assert snap["patient"]["latest_vitals"]
    assert "hr" in snap["patient"]["latest_vitals"]
    # 行动目录
    assert snap["actions"]["assess"]
    # 不泄露隐藏状态
    assert "hidden" not in snap
    assert "severity" not in str(snap["actions"])
    assert "severity" not in str(snap["objectives"])
    assert "severity" not in str(snap["hint"])


def test_snapshot_objectives_track_progress():
    from modules.simulations.service import build_snapshot

    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "MONITOR", "vitals")
    snap = build_snapshot(1, s)
    assert snap["objectives"]["assessed"] is True
    assert snap["objectives"]["monitoring"] is True
    assert snap["objectives"]["treated"] is False


def test_snapshot_via_api_contains_contract():
    """端到端：HTTP 层快照携带新一代契约字段且不泄露 hidden。"""
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

    db = _FakeSession()

    def _override_db():
        yield db

    client = TestClient(app)
    client.app.dependency_overrides[get_db] = _override_db
    client.app.dependency_overrides[get_current_user] = lambda: _FakeUser()
    r = client.post("/api/simulations/sessions", json={"case_id": "mvpp-1"})
    assert r.status_code == 200
    snap = r.json()["snapshot"]
    assert snap["brief"]["patient"]
    assert snap["objectives"]["assessed"] is False
    assert snap["actions"]["assess"]
    assert "hidden" not in snap
