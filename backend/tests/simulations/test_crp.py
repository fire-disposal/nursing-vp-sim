"""C 反应蛋白（CRP）— 感染病例快速升高、非感染病例近静息的新实验室检查。"""

from modules.simulations import engine as e
from modules.simulations.engine import new_session


def _crp_after(session, order_minute):
    """Order CRP, wait for it, view it."""
    e.apply_action(session, "ORDER", "crp")
    e.apply_action(session, "WAIT", "crp")
    e.apply_action(session, "VIEW", "crp")
    return session.records[-1].result


def test_crp_abnormal_for_infection_cases():
    for cid in ("mvpi-1", "mvpp-1"):
        s = new_session(cid)  # crp_axis_gain 40/45：sev 0.2 → 13/14 mg/L
        result = _crp_after(s, 3)
        assert result["crp"] >= 10.0
        assert result["abnormal"] is True


def test_crp_normal_for_bleeding_case():
    s = new_session("mvpb-1")  # crp_axis_gain 0 → 静息 5 mg/L
    result = _crp_after(s, 3)
    assert result["crp"] == 5.0
    assert result["abnormal"] is False


def test_crp_rises_with_infection_severity():
    s = new_session("mvpi-1")
    e.apply_action(s, "WAIT", None)  # 推进至恶化
    late = _crp_after(s, s.current_time)
    early_s = new_session("mvpi-1")
    early = _crp_after(early_s, 3)
    assert late["crp"] > early["crp"]


def test_crp_result_text_and_formatter():
    s = new_session("mvpi-1")
    _crp_after(s, 3)
    msgs = [m.text for m in s.public_log if m.kind == "LAB" and "C反应蛋白" in m.text]
    assert msgs
    assert "mg/L" in msgs[-1]


def test_crp_listed_in_help_and_lab_options():
    s = new_session()
    e.apply_action(s, "HELP", "order")
    assert "C反应蛋白(CRP)" in s.public_log[-1].text
