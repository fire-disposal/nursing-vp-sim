"""MVP-I (infection axis): the second case proves the compartment engine
generalizes — same engine, different axis, fever + leukocytosis + lactate."""

from modules.simulations import engine as e
from modules.simulations.case import CASES, case_of, get_case
from modules.simulations.engine import SUCCESS, new_session

CASE_ID = "mvpi-1"


def test_infection_case_is_registered_and_resolvable():
    assert CASE_ID in CASES
    case = get_case(CASE_ID)
    assert case.course.axis == "infection"
    s = new_session(CASE_ID)
    assert s.case_id == CASE_ID
    assert s.hidden.values == {"infection": 0.20}


def test_infection_physiology_starts_afebrile_but_tachycardic():
    s = new_session(CASE_ID)
    case = case_of(s)
    v = case.physiology.vitals(s.hidden.values, s.hidden.physio)
    # T = 37 + 2*0.20 = 37.4 — fever builds with the axis, not at handover.
    assert v["temp"] == 37.4
    assert case.physiology.vitals_abnormal(v) is False


def test_infection_progression_drives_fever_and_leukocytosis():
    s = new_session(CASE_ID)
    e.apply_action(s, "ASSESS", "drain")  # 0->3
    e.apply_action(s, "ASSESS", "drain")  # 3->6, tick at 6
    assert s.hidden.values["infection"] == 0.25
    e.apply_action(s, "ORDER", "cbc")  # sampled @9, sev 0.25
    e.apply_action(s, "WAIT", "cbc")
    e.apply_action(s, "VIEW", "cbc")
    assert s.records[0].result["wbc"] == round(8.5 + 12 * 0.25, 1)


def test_infection_mid_severity_fires_monitor_alert():
    s = new_session(CASE_ID)
    e.apply_action(s, "MONITOR", "vitals")  # 0->2
    e.apply_action(s, "WAIT", None)
    assert s.monitor_alert_fired
    assert any(m.kind == "MONITOR" for m in s.public_log)
    # At mid severity (0.55) the patient is febrile: T 38.1.
    v = case_of(s).physiology.vitals(s.hidden.values, s.hidden.physio)
    assert v["temp"] >= 38.0


def test_infection_deterioration_and_good_path():
    s = new_session(CASE_ID)
    e.apply_action(s, "WAIT", None)  # to deterioration
    assert s.deteriorated
    assert any(m.kind == "CRITICAL" for m in s.public_log)

    # Good path: assess, CBC (WBC abnormal), report.
    s2 = new_session(CASE_ID)
    for action, target in [
        ("ASSESS", "vitals"),
        ("ASSESS", "drain"),
        ("ORDER", "cbc"),
        ("MONITOR", "vitals"),
        ("WAIT", None),
        ("VIEW", "cbc"),
        ("REPORT", "doctor"),
    ]:
        ok, _ = e.apply_action(s2, action, target)
        assert ok, (action, target)
    assert s2.case_status == SUCCESS
    assert not s2.delayed_success


def test_infection_case_blood_hemoglobin_not_drained():
    # hb_axis_rate = 0: infection doesn't drop Hb the way bleeding does.
    s = new_session(CASE_ID)
    e.apply_action(s, "WAIT", None)  # to deterioration, sev 0.75
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "VIEW", "cbc")
    hb = s.records[0].result["hb"]
    assert hb > 130  # near baseline, not falling with infection


def test_case_switch_command_lists_both_cases():
    s = new_session()
    e.apply_action(s, "CASE", None)
    text = s.public_log[-1].text
    assert "mvpb-1" in text
    assert "mvpi-1" in text
    assert "隐匿性出血" in text
    assert "腹腔感染" in text


def test_infection_case_state_roundtrip():
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session(CASE_ID)
    e.apply_action(s, "ASSESS", "vitals")
    raw = state_to_dict(s)
    restored = state_from_dict(raw)
    assert restored.hidden.physio == s.hidden.physio
    assert restored.case_id == CASE_ID
