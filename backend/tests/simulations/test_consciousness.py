"""意识评估目标（/assess consciousness）— 全病例通用的描述性读数。

三档描述（清醒/嗜睡/昏迷）来自 physiology.consciousness 阈值映射，
与 /status 展示、对话可用性判定共用同一来源；不暴露底层数值。
"""

from modules.simulations import engine as e
from modules.simulations.case import CASES, get_case
from modules.simulations.engine import new_session


def test_consciousness_baseline_seeded_at_handover():
    s = new_session()
    assert s.readings["consciousness"], "交班必须种入意识基线"
    assert s.readings["consciousness"][-1].state == "alert"
    assert s.readings["consciousness"][-1].abnormal is False


def test_assess_consciousness_records_three_tier_state():
    s = new_session("mvpd-1")
    ok, _ = e.apply_action(s, "ASSESS", "consciousness")
    assert ok is True
    r = s.readings["consciousness"][-1]
    assert r.state in ("alert", "lethargic", "comatose")
    assert s.action_log[-1].action_type == "ASSESS"


def test_all_cases_expose_consciousness_assessment():
    for cid in CASES:
        assert "consciousness" in get_case(cid).surface.assessments, cid


def test_consciousness_turns_abnormal_with_severity():
    s = new_session("mvpd-1")  # conscious_axis_gain 0.4：高严重度下意识下降
    e.apply_action(s, "WAIT", None)  # 恶化（sev ~0.79 → conscious ~0.58）
    ok, _ = e.apply_action(s, "ASSESS", "consciousness")
    assert ok
    r = s.readings["consciousness"][-1]
    assert r.abnormal is True
    assert r.state == "lethargic"


def test_consciousness_description_and_trend():
    s = new_session("mvpd-1")
    e.apply_action(s, "ASSESS", "consciousness")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ASSESS", "consciousness")
    msgs = [m.text for m in s.public_log if m.kind == "ASSESSMENT" and "意识" in m.text]
    assert msgs
    assert any("较上次" in m for m in msgs)  # 状态变化有趋势反馈


def test_consciousness_roundtrip():
    from modules.simulations.service import build_snapshot
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session("mvpd-1")
    e.apply_action(s, "ASSESS", "consciousness")
    restored = state_from_dict(state_to_dict(s))
    assert restored.readings["consciousness"][-1].state == s.readings["consciousness"][-1].state
    snap = build_snapshot(1, restored)
    assert snap["patient"]["consciousness"] == "alert"
