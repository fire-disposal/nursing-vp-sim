"""教练提示（coach hints）— 确定性、单调升级、不泄露隐藏病程的引导契约。

L1 开篇评估 → L2 监护/检查方向 → L3 已有证据准备报告 → L4 已报告/结局。
提示由纯函数计算（无 LLM、无随机），同一状态永远产出同一提示。
"""

from modules.simulations import engine as e
from modules.simulations.coach import OPENING_HINT, coach_hint
from modules.simulations.engine import new_session


def test_opening_hint_seeded_at_session_start():
    s = new_session()
    assert s.hint_level >= 1
    hints = [m for m in s.public_log if m.kind == "HINT"]
    assert hints, "开局必须有一条教练提示"
    assert "基线" in hints[0].text


def test_opening_hint_constant_matches_l1():
    assert "基线" in OPENING_HINT
    assert coach_hint(new_session())[0] == 1


def test_hint_escalates_after_first_assessment():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    assert s.hint_level >= 2
    hints = [m.text for m in s.public_log if m.kind == "HINT"]
    assert any(("监护" in t or "检查" in t) for t in hints), hints


def test_hint_reaches_report_stage_with_evidence():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # 恶化阈值触发 → 已知异常证据
    assert s.hint_level >= 3
    hints = [m.text for m in s.public_log if m.kind == "HINT"]
    assert any("报告" in t for t in hints), hints


def test_hint_reaches_settlement_stage_after_report():
    s = new_session()
    e.apply_action(s, "ASSESS", "drain")
    e.apply_action(s, "WAIT", None)  # 恶化 → 异常证据
    e.apply_action(s, "REPORT", "doctor")
    assert s.case_status == "SUCCESS"
    assert s.hint_level >= 4
    hints = [m.text for m in s.public_log if m.kind == "HINT"]
    assert any("已向医生报告" in t for t in hints), hints


def test_hint_level_is_monotonic():
    s = new_session()
    levels = [s.hint_level]
    for action, target in [("ASSESS", "vitals"), ("STATUS", None), ("MONITOR", "vitals"), ("STATUS", None)]:
        e.apply_action(s, action, target)
        levels.append(s.hint_level)
    assert levels == sorted(levels), f"hint_level must never decrease: {levels}"


def test_hint_command_returns_current_hint_without_time():
    s = new_session()
    start = s.current_time
    ok, _ = e.apply_action(s, "HINT", None)
    assert ok is True
    assert s.public_log[-1].kind == "HINT"
    assert s.current_time == start  # 提示不消耗时间
    assert s.action_log[-1].action_type == "HINT"


def test_hint_never_leaks_hidden_severity():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    assert s.case_status == "FAILURE"
    hints = [m.text for m in s.public_log if m.kind == "HINT"]
    assert hints
    assert all("严重度" not in t and "0." not in t for t in hints), hints


def test_hint_works_after_case_end():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    assert s.case_status == "FAILURE"
    ok, _ = e.apply_action(s, "HINT", None)  # HINT 属于非临床命令，结局后仍可用
    assert ok is True
    assert "病例已结束" in s.public_log[-1].text
