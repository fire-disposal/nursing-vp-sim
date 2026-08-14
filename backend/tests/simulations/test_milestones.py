"""患者台词里程碑（PATIENT_LINE）— 严重度跨过病例阈值时患者发出症状台词。

每个阈值只触发一次；非打断事件；患者昏迷时台词替换为家属观察，保持一致性。
"""

from modules.simulations import engine as e
from modules.simulations.engine import new_session
from modules.simulations.state import ScheduledEvent


def test_milestone_fires_once_at_threshold():
    s = new_session("mvpb-1")  # 阈值 0.30 / 0.50 / 0.75
    e.apply_action(s, "WAIT", None)  # 推进至恶化（sev 0.60），跨过 0.30 与 0.50
    lines = [m for m in s.public_log if m.kind == "PATIENT"]
    assert lines, "跨过阈值必须出现患者台词"
    assert s.fired_milestones == sorted(s.fired_milestones)
    texts = [m.text for m in lines]
    assert any("头晕" in t for t in texts)  # 0.30 档台词
    assert sum(1 for t in texts if "头晕" in t) == 1  # 每档只触发一次


def test_milestone_not_fired_below_threshold():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")  # sev 仍 0.12 < 0.30
    assert not any(m.kind == "PATIENT" for m in s.public_log)
    assert s.fired_milestones == []


def test_milestone_does_not_interrupt_wait():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # 一路到恶化打断；台词是顺带结算的
    # 台词存在但等待停在恶化事件而非台词
    assert any(m.kind == "PATIENT" for m in s.public_log)
    assert s.current_time == 48  # SPONTANEOUS_DETERIORATION 打断点
    assert any(m.kind == "CRITICAL" for m in s.public_log)


def test_milestone_state_roundtrips():
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session("mvpd-1")
    e.apply_action(s, "WAIT", None)  # 跨过 0.45 / 0.60
    raw = state_to_dict(s)
    restored = state_from_dict(raw)
    assert restored.fired_milestones == s.fired_milestones
    assert [m.text for m in restored.public_log if m.kind == "PATIENT"] == [
        m.text for m in s.public_log if m.kind == "PATIENT"
    ]


def test_comatose_patient_line_replaced():
    """昏迷者无法说话——台词替换为家属观察（与对话可用性判定一致）。"""
    from modules.simulations.engine import _on_patient_line

    s = new_session("mvpd-1")
    s.hidden.values["glucose"] = 0.9  # conscious_axis_gain 0.4 → conscious < 0.3
    assert e.case_of(s).physiology.consciousness(s.hidden.values, s.hidden.physio) < 0.3
    ev = ScheduledEvent(0, 1, 999, "PATIENT_LINE-1", "PATIENT_LINE", {"text": "（患者干渴地说）水…我想喝水…"})
    messages: list = []
    _on_patient_line(s, ev, messages)
    assert "呼之不应" in messages[0].text
