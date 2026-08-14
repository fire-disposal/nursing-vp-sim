"""MVP-P 社区获得性肺炎（mvpp-1）— 复用 infection 轴，纯数据新病例。

发热 + 咳嗽 + 肺部湿啰音（轴驱动 crackles）+ 白细胞升高 + 低氧倾向；
抗生素抑制感染轴进展。
"""

from modules.simulations import engine as e
from modules.simulations.case import get_case
from modules.simulations.engine import SUCCESS, new_session


def _last_breath(s):
    return s.readings["breath"][-1]


def test_pneumonia_case_registered_with_specialty_surface():
    case = get_case("mvpp-1")
    assert "breath" in case.surface.assessments
    assert "consciousness" in case.surface.assessments
    assert "ANTIBIOTIC" in case.surface.drugs
    assert "OXYGEN" in case.surface.drugs
    assert "SALBUTAMOL" in case.surface.drugs
    assert case.start_clock == "14:30"


def test_pneumonia_early_breath_clear_then_crackles():
    s = new_session("mvpp-1")
    e.apply_action(s, "ASSESS", "breath")  # sev 0.20 → 轴 crackles 0.24 < 0.45
    assert _last_breath(s).sound == "clear"
    e.apply_action(s, "WAIT", None)  # 推进至恶化（sev ~0.75+）
    e.apply_action(s, "ASSESS", "breath")
    b = _last_breath(s)
    assert b.sound == "crackles"
    assert b.abnormal is True
    assert e._has_abnormal_evidence(s)


def test_pneumonia_fever_and_leukocytosis():
    s = new_session("mvpp-1")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ASSESS", "vitals")
    v = s.readings["vitals"][-1]
    assert v.temp >= 38.0  # temp_axis_gain 2.2 发热
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", "cbc")
    e.apply_action(s, "VIEW", "cbc")
    assert s.records[0].result["wbc"] >= 11.0  # 白细胞升高（wbc_axis_gain 14）
    assert s.records[0].result["abnormal"] is True


def _state_after_ticks(drug, dose=None):
    """Control-compare at the same elapsed time: with/without antibiotic."""
    s = new_session("mvpp-1")
    if drug:
        e.apply_action(s, "GIVE", drug, dose)
    while s.current_time < 12:  # 两侧都跨过 6 与 12 两次病程 tick
        e.apply_action(s, "ASSESS", "vitals")
    return s


def test_antibiotic_slows_infection_progression():
    with_drug = _state_after_ticks("ANTIBIOTIC", "2")
    control = _state_after_ticks(None)
    sev_with = with_drug.hidden.values["infection"]
    sev_control = control.hidden.values["infection"]
    assert sev_with < sev_control


def test_pneumonia_good_path_report():
    s = new_session("mvpp-1")
    for action, target in [
        ("ASSESS", "vitals"),
        ("ORDER", "cbc"),
        ("MONITOR", "vitals"),
        ("WAIT", None),
        ("VIEW", "cbc"),
        ("REPORT", "doctor"),
    ]:
        ok, _ = e.apply_action(s, action, target)
        assert ok, (action, target)
    assert s.case_status == SUCCESS
    assert s.delayed_success is False


def test_pneumonia_failure_by_neglect():
    s = new_session("mvpp-1")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    assert s.case_status == "FAILURE"


def test_pneumonia_new_case_listed_in_case_command():
    s = new_session()
    e.apply_action(s, "CASE", None)
    assert "mvpp-1" in s.public_log[-1].text
