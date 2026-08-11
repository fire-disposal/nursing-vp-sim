"""Physiology engine: multi-axis hidden values + per-case resolution."""

from modules.simulations import engine as e
from modules.simulations.case import CASES, case_of
from modules.simulations.engine import new_session


def test_hidden_state_is_multi_axis_values():
    s = new_session()
    assert s.hidden.values == {"bleeding": 0.12}
    assert case_of(s) is CASES["mvpb-1"]


def test_physiology_produces_observations_from_values():
    s = new_session()
    case = case_of(s)
    v = case.physiology.vitals(s.hidden.values)
    assert v["hr"] == 84
    assert case.physiology.drain(s.hidden.values) == 67
    assert case.physiology.vitals_abnormal(v) is False


def test_progression_writes_axis_value():
    s = new_session()
    e.apply_action(s, "ASSESS", "drain")
    e.apply_action(s, "ASSESS", "drain")  # spans the tick at minute 6
    assert s.hidden.values["bleeding"] == 0.18


def test_lab_materializes_from_values_snapshot():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")     # sampled at minute 3, bleeding 0.12
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW", "cbc")
    assert s.records[0].result["hb"] == 123.4  # reflects sampled values, not return time


def test_extra_axis_is_ignored_by_bleeding_physiology():
    s = new_session()
    s.hidden.values["infection"] = 0.5  # a second axis coexists without breaking anything
    e.apply_action(s, "ASSESS", "vitals")
    assert s.vitals[-1].hr == 84  # bleeding axis unchanged
