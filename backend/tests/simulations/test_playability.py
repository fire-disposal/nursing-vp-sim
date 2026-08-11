"""Playability breadth: trend feedback, delayed-success nuance, audit detail."""

from modules.simulations import engine as e
from modules.simulations.engine import SUCCESS, new_session


def test_vitals_trend_shown_on_reassessment():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")  # 0->2, HR 84
    e.apply_action(s, "ASSESS", "drain")   # 2->5
    e.apply_action(s, "ASSESS", "vitals")  # 5->7, tick at 6 -> HR 87
    trend = [m for m in s.public_log if m.kind == "ASSESSMENT" and "较上次" in m.text]
    assert trend, "second vitals assessment must compare with the previous one"
    assert "HR 84→87" in trend[-1].text
    assert "↑3" in trend[-1].text


def test_drain_trend_shown_on_reassessment():
    s = new_session()
    e.apply_action(s, "ASSESS", "drain")  # 0->3, 67 ml
    e.apply_action(s, "ASSESS", "drain")  # 3->6, tick -> 77 ml
    trend = [m for m in s.public_log if m.kind == "ASSESSMENT" and "较上次" in m.text]
    assert trend
    assert "67→77" in trend[-1].text


def test_cbc_delta_shown_on_second_view():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW_CBC", None)
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW_CBC", None)
    second_view = [m for m in s.public_log if m.kind == "LAB" and "较上次" in m.text]
    assert second_view
    assert "123.4→91.0" in second_view[-1].text
    assert "↓32.4" in second_view[-1].text


def test_delayed_success_outcome():
    # Report after deterioration is still a success, but flagged as late.
    s = new_session()
    e.apply_action(s, "WAIT", None)  # to 48, deterioration, severity 0.60
    assert s.deteriorated
    e.apply_action(s, "REPORT", "doctor")
    assert s.case_status == SUCCESS
    assert s.delayed_success is True
    assert any(m.kind == "WARNING" and "偏晚" in m.text for m in s.public_log)


def test_early_success_not_flagged_delayed():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "drain")
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "MONITOR", "vitals")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "VIEW_CBC", None)
    e.apply_action(s, "REPORT", "doctor")
    assert s.case_status == SUCCESS
    assert s.delayed_success is False
    assert not any("偏晚" in m.text for m in s.public_log)


def test_audit_summary_reports_cbc_interval_and_hb_delta():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")       # sampled 3
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW_CBC", None)
    e.apply_action(s, "ORDER", "cbc")       # sampled 21
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW_CBC", None)
    e.apply_action(s, "REPORT", "doctor")   # valid evidence: abnormal Hb
    audit = [m for m in s.public_log if m.kind == "AUDIT"]
    assert audit
    text = audit[-1].text
    assert "两次 CBC 采样间隔 18 分钟" in text
    assert "Hb 变化 -32.4 g/L" in text
