"""MVP-B §12.4 — good / delay outcomes, evidence rule, post-end rejection."""

from modules.simulations import engine as e
from modules.simulations.engine import ACTIVE, FAILURE, SUCCESS, new_session


def _good_path():
    """MVP-B §13 scenario 1 — assessment, CBC, valid report."""
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "drain")
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "MONITOR", "vitals")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "VIEW_CBC", None)
    e.apply_action(s, "REPORT", "doctor")
    return s


def test_good_outcome_with_evidence_and_report():
    s = _good_path()
    assert s.case_status == SUCCESS
    assert s.hidden.reported_to_doctor
    assert s.case_ended_at is not None


def test_blind_report_without_evidence_rejected():
    s = new_session()
    ok, msgs = e.apply_action(s, "REPORT", "doctor")
    assert not ok
    assert s.case_status == ACTIVE
    assert s.current_time == 0  # rejected -> no time consumed
    assert not s.hidden.reported_to_doctor
    assert any("异常证据" in m.text for m in msgs)


def test_report_requires_revealed_evidence():
    # A CBC that returns normal is not enough on its own.
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW_CBC", None)
    assert s.records[0].result["abnormal"] is False
    ok, _ = e.apply_action(s, "REPORT", "doctor")
    assert not ok
    assert s.case_status == ACTIVE


def test_delay_outcome_on_ignoring():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # reaches deterioration at 48
    assert s.case_status == ACTIVE
    e.apply_action(s, "WAIT", None)  # reaches failure at 90
    assert s.case_status == FAILURE
    assert s.case_ended_at == 90


def test_clinical_actions_rejected_after_end():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    assert s.case_status == FAILURE
    ok, msgs = e.apply_action(s, "ASSESS", "drain")
    assert not ok
    assert any("已结束" in m.text for m in msgs)
    # Non-clinical commands still allowed.
    ok, _ = e.apply_action(s, "STATUS", None)
    assert ok


def test_summary_contains_key_metrics():
    s = _good_path()
    audit = [m for m in s.public_log if m.kind == "AUDIT"]
    assert audit
    text = audit[-1].text
    assert "CBC 次数 1" in text
    assert "¥35" in text
    assert "分钟" in text
