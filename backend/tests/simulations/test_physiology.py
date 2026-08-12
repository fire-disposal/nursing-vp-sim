"""Physiology engine: multi-axis hidden values + per-case compartment resolution."""

from modules.simulations import engine as e
from modules.simulations.case import CASES, case_of
from modules.simulations.engine import new_session


def test_hidden_state_is_multi_axis_values():
    s = new_session()
    assert s.hidden.values == {"bleeding": 0.12}
    assert case_of(s) is CASES["mvpb-1"]


def test_initial_physio_seeded_from_start_severity():
    s = new_session()
    # Fast compartments start at the bleeding-driven target; slow ones at rest.
    assert round(s.hidden.physio["vol"], 4) == round(1 - 0.35 * 0.12, 4)
    assert s.hidden.physio["svr"] == 1.0
    assert s.hidden.physio["lactate"] == 0.8
    assert s.hidden.physio["hb"] == 123.4


def test_physiology_produces_observations_from_compartments():
    s = new_session()
    case = case_of(s)
    v = case.physiology.vitals(s.hidden.values, s.hidden.physio)
    assert v["hr"] == 84
    assert case.physiology.drain(s.hidden.values) == 67
    assert case.physiology.vitals_abnormal(v) is False


def test_progression_writes_axis_value_and_advances_compartments():
    s = new_session()
    e.apply_action(s, "ASSESS", "drain")
    e.apply_action(s, "ASSESS", "drain")  # spans the tick at minute 6
    assert s.hidden.values["bleeding"] == 0.18
    # Volume fell with the worsened bleeding; lactate still at rest (vol above threshold).
    assert s.hidden.physio["vol"] < new_session().hidden.physio["vol"]
    assert s.hidden.physio["lactate"] == 0.8


def test_lab_materializes_from_values_snapshot():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")  # sampled at minute 3, bleeding 0.12
    e.apply_action(s, "WAIT", "cbc")
    e.apply_action(s, "VIEW", "cbc")
    assert s.records[0].result["hb"] == 123.4  # reflects sampled values, not return time


def test_coupling_is_per_case_not_global():
    # The kernel is universal; a case declares its axis coupling table.
    # The bleeding case declares no fever/vasodilation coupling, so an
    # injected infection axis is a no-op there — coupling is case data.
    s = new_session()
    s.hidden.values["infection"] = 0.5
    case = case_of(s)
    v = case.physiology.vitals(s.hidden.values, s.hidden.physio)
    assert v["hr"] == 84  # bleeding coupling has hr_axis_gain 0
    # The infection case couples infection → fever + tachycardia.
    s_inf = new_session("mvpi-1")
    v_inf = case_of(s_inf).physiology.vitals(s_inf.hidden.values, s_inf.hidden.physio)
    assert v_inf["temp"] > 37.0  # temp_axis_gain drives fever
    assert v_inf["hr"] > 78  # hr_axis_gain drives tachycardia


def test_lactate_accumulates_under_hypoperfusion_and_clears_with_volume():
    # Emergent behavior a flat formula cannot produce: lactate integrates
    # perfusion deficit over time and clears once volume is restored.
    case = case_of(new_session())
    values = {"bleeding": 0.6}
    physio = case.physiology.initial(values)
    for _ in range(5):
        physio = case.physiology.step(values, physio, {"fluid_support": 0, "transfused": False}, 6)
    assert physio["lactate"] > 2.0  # ABG-abnormal under sustained hypoperfusion
    # Fluids restore volume; lactate returns toward baseline.
    values_fluids = dict(values)
    physio_after = case.physiology.step(
        values_fluids,
        physio,
        {"fluid_support": 2, "transfused": False},
        6,
    )
    assert physio_after["lactate"] < physio["lactate"]


def test_late_abg_shows_elevated_lactate_early_abg_normal():
    # The ABG reflects the compartment state at sampling: normal at handover,
    # rising after sustained hypoperfusion — a time-dependent trend, not a
    # fixed severity formula.
    s = new_session()
    e.apply_action(s, "ORDER", "abg")  # sampled @3, severity 0.12, lactate at rest
    e.apply_action(s, "WAIT", None)  # to LAB_READY @13
    e.apply_action(s, "VIEW", "abg")
    early = s.records[0].result
    assert early["lactate"] < 1.0
    e.apply_action(s, "WAIT", None)  # to deterioration @48
    e.apply_action(s, "ORDER", "abg")  # sampled @51, severity 0.66
    e.apply_action(s, "WAIT", None)  # ready @61
    e.apply_action(s, "VIEW", "abg")
    late = s.records[1].result
    assert late["lactate"] > early["lactate"]


def test_transfusion_raises_hb_compartment_and_survives_snapshot():
    # Transfusion acts on the hb compartment (fast boost), and a CBC sampled
    # while transfused is not clamped by the ongoing-bleeding monotonic rule.
    case = case_of(new_session())
    values = {"bleeding": 0.3}
    physio = case.physiology.initial(values)
    boosted = case.physiology.step(values, physio, {"fluid_support": 0, "transfused": True}, 6)
    assert boosted["hb"] > physio["hb"]
    # Engine-level: transfusion raises hb immediately, and the monotonic
    # clamp (no rise while bleeding) is skipped when transfused.
    s = new_session()
    e.apply_action(s, "GIVE", "TRANSFUSE")  # hb 123.4 -> 148.4
    e.apply_action(s, "ORDER", "cbc")  # sampled @8, sev 0.18, transfused boost held
    e.apply_action(s, "WAIT", "cbc")
    e.apply_action(s, "VIEW", "cbc")
    hb = s.records[0].result["hb"]
    assert hb == round(145 - 180 * 0.162 + 25.0, 1)  # sev@6 = 0.12+0.06*0.7 (slowed), no clamp


def test_state_roundtrip_and_old_session_migration():
    from modules.simulations.service import build_snapshot
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session()
    e.apply_action(s, "ASSESS", "drain")
    raw = state_to_dict(s)
    restored = state_from_dict(raw)
    assert restored.hidden.physio == s.hidden.physio
    assert build_snapshot(1, restored) == build_snapshot(1, s)

    # Pre-compartment sessions (no physio key) migrate to the baseline state.
    legacy = {k: v for k, v in raw.items() if k != "hidden"}
    legacy["hidden"] = {k: v for k, v in raw["hidden"].items() if k != "physio"}
    migrated = state_from_dict(legacy)
    assert migrated.hidden.physio == new_session().hidden.physio
