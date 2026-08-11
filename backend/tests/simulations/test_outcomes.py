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
    e.apply_action(s, "VIEW", "cbc")
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
    e.apply_action(s, "VIEW", "cbc")
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
    assert "检查 1 次" in text
    assert "¥35" in text
    assert "剩余预算" in text
    assert "分钟" in text


def test_success_ends_with_discharge():
    s = _good_path()
    assert s.case_status == SUCCESS
    assert any("予以出院" in m.text for m in s.public_log)
    audit = [m for m in s.public_log if m.kind == "AUDIT"][-1].text
    assert "患者顺利出院" in audit


def test_failure_verdict_explains_delay():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    audit = [m for m in s.public_log if m.kind == "AUDIT"][-1].text
    assert "延误/漏诊" in audit
    assert "判定：" in audit


def test_timely_verdict():
    s = _good_path()
    audit = [m for m in s.public_log if m.kind == "AUDIT"][-1].text
    assert "判定：及时" in audit


def test_diag_records_and_flows_to_report_and_audit():
    s = new_session()
    ok, msgs = e.apply_action(s, "DIAG", "疑诊隐匿性出血")
    assert ok
    assert s.diagnosis == "疑诊隐匿性出血"
    assert any("已记录" in m.text for m in msgs)
    # Completes a good path (using existing evidence helpers) then checks audit.
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ASSESS", "pain")
    e.apply_action(s, "REPORT", "doctor")
    audit = [m for m in s.public_log if m.kind == "AUDIT"][-1].text
    assert "你的诊断：疑诊隐匿性出血" in audit


def test_status_shows_diagnosis_and_checklist():
    s = new_session()
    e.apply_action(s, "STATUS", None)
    text = s.public_log[-1].text
    assert "你的诊断：未记录" in text
    assert "目标清单" in text
    assert "异常证据 未获取" in text
    e.apply_action(s, "DIAG", "疑诊出血")
    e.apply_action(s, "STATUS", None)
    assert "你的诊断：疑诊出血" in s.public_log[-1].text
