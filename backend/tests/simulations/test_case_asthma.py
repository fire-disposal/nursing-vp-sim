"""MVP-A 支气管哮喘急性发作（mvpa-1）— 新 airway 轴 + 内核扩展。

喘息是「疾病本身」：未给药即闻及（airway_wheeze_gain）；沙丁胺醇缓解
喘息并改善 RR/SpO2（salbutamol_relief）；激素（STEROID）抑制轴进展；
氧气提升 SpO2。整条生理链路可测试、确定性、不泄露隐藏数值。
"""

from modules.simulations import engine as e
from modules.simulations.case import case_of, get_case
from modules.simulations.engine import SUCCESS, new_session


def _last_breath(s):
    return s.readings["breath"][-1]


def test_asthma_case_registered_with_airway_surface():
    case = get_case("mvpa-1")
    assert case.course.axis == "airway"
    assert "breath" in case.surface.assessments
    assert "consciousness" in case.surface.assessments
    assert "SALBUTAMOL" in case.surface.drugs
    assert "STEROID" in case.surface.drugs
    assert case.start_clock == "01:30"


def test_wheeze_present_at_baseline_without_drug():
    """哮喘模式下喘息是疾病表现：起始即可闻及，无需先给沙丁胺醇。"""
    s = new_session("mvpa-1")
    e.apply_action(s, "ASSESS", "breath")
    b = _last_breath(s)
    assert b.sound == "wheeze"
    assert b.abnormal is True
    assert e._has_abnormal_evidence(s)


def test_salbutamol_relieves_wheeze():
    s = new_session("mvpa-1")
    e.apply_action(s, "GIVE", "SALBUTAMOL", "2")  # 1 unit plasma
    e.apply_action(s, "ASSESS", "breath")
    assert _last_breath(s).sound == "clear"


def _vitals_after_dose(drug, dose):
    """Control-compare vitals at the same severity with/without a drug."""
    s = new_session("mvpa-1")
    if drug:
        e.apply_action(s, "GIVE", drug, dose)
    for _ in range(3):
        e.apply_action(s, "ASSESS", "vitals")  # spans exactly one tick
    v = case_of(s).physiology.vitals(s.hidden.values, s.hidden.physio)
    return v, s


def test_salbutamol_improves_rr_and_spo2_at_same_severity():
    with_drug, _ = _vitals_after_dose("SALBUTAMOL", "2")
    control, _ = _vitals_after_dose(None, None)
    assert with_drug["rr"] < control["rr"]
    assert with_drug["spo2"] > control["spo2"]


def test_oxygen_raises_spo2():
    with_drug, _ = _vitals_after_dose("OXYGEN", "5")
    control, _ = _vitals_after_dose(None, None)
    assert with_drug["spo2"] > control["spo2"]


def test_hypoxia_tracks_severity():
    s = new_session("mvpa-1")
    early = case_of(s).physiology.vitals(s.hidden.values, s.hidden.physio)["spo2"]
    e.apply_action(s, "WAIT", None)  # 恶化 → 重度低氧
    late = case_of(s).physiology.vitals(s.hidden.values, s.hidden.physio)["spo2"]
    assert late < early
    assert late <= 92  # 异常线


def _state_after_ticks(drug, dose=None):
    """Control-compare at the same elapsed time: with/without drug."""
    s = new_session("mvpa-1")
    if drug:
        e.apply_action(s, "GIVE", drug, dose)
    while s.current_time < 12:  # 两侧都跨过 6 与 12 两次病程 tick
        e.apply_action(s, "ASSESS", "vitals")
    return s


def test_steroid_slows_airway_progression():
    with_drug = _state_after_ticks("STEROID", "40")
    control = _state_after_ticks(None)
    assert with_drug.hidden.values["airway"] < control.hidden.values["airway"]


def test_asthma_good_path_treatment_and_report():
    s = new_session("mvpa-1")
    for action, target in [
        ("ASSESS", "breath"),  # 喘息证据
        ("GIVE", "SALBUTAMOL"),
        ("GIVE", "OXYGEN"),
        ("MONITOR", "vitals"),
        ("REPORT", "doctor"),
    ]:
        ok, _ = e.apply_action(s, action, target)
        assert ok, (action, target)
    assert s.case_status == SUCCESS


def test_asthma_failure_by_neglect():
    s = new_session("mvpa-1")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "WAIT", None)
    assert s.case_status == "FAILURE"


def test_asthma_snapshot_patient_and_brief():
    from modules.simulations.service import build_snapshot

    s = new_session("mvpa-1")
    snap = build_snapshot(1, s)
    assert "哮喘" in snap["brief"]["patient"]
    assert snap["patient"]["latest_vitals"]["rr"] > 16  # 起始即呼吸急促
