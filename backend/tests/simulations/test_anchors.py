"""Anchor regression — the playability timing contract the compartment
engine must preserve. These are the teaching anchors: if any of them drifts,
the case's difficulty curve breaks even when every value test still passes."""

from modules.simulations import engine as e
from modules.simulations.engine import ACTIVE, FAILURE, SUCCESS, new_session


def _good_path():
    s = new_session()
    for action, target in [
        ("ASSESS", "vitals"),
        ("ASSESS", "drain"),
        ("ORDER", "cbc"),
        ("MONITOR", "vitals"),
        ("WAIT", None),
        ("VIEW", "cbc"),
        ("REPORT", "doctor"),
    ]:
        ok, _ = e.apply_action(s, action, target)
        assert ok, (action, target)
    return s


def test_deterioration_anchor_is_minute_48():
    s = new_session()
    e.apply_action(s, "WAIT", None)
    assert s.current_time == 48
    assert s.deteriorated
    assert s.case_status == ACTIVE


def test_failure_anchor_is_minute_90():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # 48, deterioration
    e.apply_action(s, "WAIT", None)  # 90, failure
    assert s.current_time == 90
    assert s.case_status == FAILURE


def test_monitor_alert_anchor_is_minute_24():
    s = new_session()
    e.apply_action(s, "MONITOR", "vitals")  # 0->2
    e.apply_action(s, "WAIT", None)  # stops at the alert @24
    assert s.current_time == 24
    assert s.monitor_alert_fired
    assert any(m.kind == "MONITOR" for m in s.public_log)


def test_good_path_finishes_before_deterioration():
    s = _good_path()
    assert s.case_status == SUCCESS
    assert s.case_ended_at < 48
    assert not s.delayed_success


def test_fluids_and_transfusion_delay_deterioration():
    def deteriorate_minute(first_action):
        s = new_session()
        e.apply_action(s, first_action[0], first_action[1])
        e.apply_action(s, "WAIT", None)
        return s.current_time

    base = deteriorate_minute(("ASSESS", "vitals"))
    fluids = deteriorate_minute(("GIVE", "FLUIDS"))
    transfuse = deteriorate_minute(("GIVE", "TRANSFUSE"))
    assert fluids > base
    assert transfuse > base


def test_vitals_abnormal_when_mid_severity_crossed():
    # At severity 0.34+ the vitals must read abnormal — the alert narrative
    # and the /report evidence rule both depend on it.
    s = new_session()
    e.apply_action(s, "WAIT", None)  # to 48, severity 0.60
    e.apply_action(s, "ASSESS", "vitals")
    assert s.vitals[-1].abnormal is True
