"""DKA (mvpd-1) and CHF (mvph-1): the universal kernel serves new medical
cases from coupling tables alone — no engine changes for a new disease."""

from typing import TYPE_CHECKING, cast

from modules.simulations import engine as e
from modules.simulations.case import case_of, get_case
from modules.simulations.engine import SUCCESS, new_session

if TYPE_CHECKING:
    from modules.simulations.state import BreathReading, GlucoseReading


def _last_glucose(s) -> "GlucoseReading":
    return cast("GlucoseReading", s.readings["glucose"][-1])


def _last_breath(s) -> "BreathReading":
    return cast("BreathReading", s.readings["breath"][-1])


def test_dka_case_registered_with_glucose_assessment():
    s = new_session("mvpd-1")
    case = case_of(s)
    assert "glucose" in case.surface.assessments
    assert "INSULIN" in case.surface.drugs
    e.apply_action(s, "ASSESS", "glucose")
    assert s.readings["glucose"]
    # At start severity 0.25, glucose = 5.5 + 12*0.25 = 8.5 — still normal.
    assert _last_glucose(s).mmol == 8.5


def test_dka_progression_raises_glucose_and_triggers_evidence():
    s = new_session("mvpd-1")
    e.apply_action(s, "WAIT", None)  # to mid severity ~0.55, glucose ~12.1
    e.apply_action(s, "ASSESS", "glucose")
    g = _last_glucose(s)
    assert g.abnormal is True
    assert g.mmol > 11.1
    assert e._has_abnormal_evidence(s)


def _glucose_after_dose(drug, dose):
    """Control-compare glucose at the same severity with/without a drug.

    Three vitals assessments advance exactly one tick (minute 6) in both arms,
    so the disease severity matches; only the drug differs.
    """
    s = new_session("mvpd-1")
    if drug:
        e.apply_action(s, "GIVE", drug, dose)
    for _ in range(3):
        e.apply_action(s, "ASSESS", "vitals")  # spans the tick at 6
    e.apply_action(s, "ASSESS", "glucose")
    return s


def test_insulin_lowers_glucose():
    with_drug = _glucose_after_dose("INSULIN", "10")
    control = _glucose_after_dose(None, None)
    assert with_drug.readings["glucose"][-1].mmol < control.readings["glucose"][-1].mmol


def test_dextrose_raises_glucose():
    with_drug = _glucose_after_dose("GLUCOSE", "50")
    control = _glucose_after_dose(None, None)
    assert with_drug.readings["glucose"][-1].mmol > control.readings["glucose"][-1].mmol


def test_chf_case_crackles_on_breath_assessment():
    s = new_session("mvph-1")
    case = case_of(s)
    assert "breath" in case.surface.assessments
    assert "DIURETIC" in case.surface.drugs
    # Volume overload at start (vol_axis_rate negative → vol rises).
    e.apply_action(s, "WAIT", None)  # to mid severity, vol high
    e.apply_action(s, "ASSESS", "breath")
    b = _last_breath(s)
    assert b.abnormal is True
    assert b.sound == "crackles"  # pulmonary edema
    assert e._has_abnormal_evidence(s)


def test_diuretic_relieves_chf_crackles():
    s = new_session("mvph-1")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "GIVE", "DIURETIC", "80")  # max dose drains volume below crackle bar
    e.apply_action(s, "ASSESS", "breath")
    assert _last_breath(s).sound == "clear"


def test_chf_breath_absent_drug_returns_clear_early():
    s = new_session("mvph-1")
    e.apply_action(s, "ASSESS", "breath")  # vol ~1.09 at start 0.30
    assert _last_breath(s).sound == "crackles"


def test_new_cases_listed_in_case_command():
    s = new_session()
    e.apply_action(s, "CASE", None)
    text = s.public_log[-1].text
    for cid in ("mvpd-1", "mvph-1"):
        assert cid in text


def test_dka_good_path_report():
    s = new_session("mvpd-1")
    for action, target in [
        ("ASSESS", "vitals"),
        ("ASSESS", "glucose"),
        ("ORDER", "cbc"),
        ("MONITOR", "vitals"),
        ("WAIT", None),  # to CBC ready
        ("WAIT", None),  # to glucose abnormal (mid severity)
        ("VIEW", "cbc"),
        ("REPORT", "doctor"),
    ]:
        ok, _ = e.apply_action(s, action, target)
        assert ok, (action, target)
    assert s.case_status == SUCCESS


def test_insulin_and_dextrose_stocked_only_in_dka():
    dka = get_case("mvpd-1")
    chf = get_case("mvph-1")
    assert "INSULIN" in dka.surface.drugs
    assert "GLUCOSE" in dka.surface.drugs
    assert "INSULIN" not in chf.surface.drugs
    assert "GLUCOSE" not in chf.surface.drugs
    # CHF stocks diuretic; the bleeding case does not stock metabolic drugs.
    assert "DIURETIC" in chf.surface.drugs
    assert "INSULIN" not in get_case("mvpb-1").surface.drugs
    assert "GLUCOSE" not in get_case("mvpb-1").surface.drugs


def test_meds_snapshot_readings_roundtrip():
    from modules.simulations.service import build_snapshot
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session("mvph-1")
    e.apply_action(s, "ASSESS", "breath")
    raw = state_to_dict(s)
    restored = state_from_dict(raw)
    assert _last_breath(restored).sound == _last_breath(s).sound
    snap = build_snapshot(1, restored)
    assert snap["readings"]["breath"]


# ── 分片化时间：病例各有起始时间片，模拟分钟映射到各自墙钟 ──────────────


def test_each_case_has_its_own_start_clock():
    from modules.simulations.case import clock_text, get_case

    assert get_case("mvpb-1").start_clock == "08:30"  # 早班
    assert get_case("mvpd-1").start_clock == "22:00"  # 急诊夜班
    assert get_case("mvph-1").start_clock == "02:00"  # ICU 凌晨
    # Same game minute lands on different wall clocks per case.
    assert clock_text(60, "08:30") == "09:30"
    assert clock_text(60, "22:00") == "23:00"
    assert clock_text(60, "02:00") == "03:00"


def test_snapshot_clock_and_lab_due_use_case_clock():
    from modules.simulations.service import build_snapshot

    s = new_session("mvpd-1")  # 急诊夜班 22:00
    e.apply_action(s, "ASSESS", "vitals")  # minute 2
    snap = build_snapshot(1, s)
    assert snap["clock"] == "22:02"
    # Order a lab and verify its due clock uses the night-shift start.
    e.apply_action(s, "ORDER", "cbc")  # sampled @5, due @20 → 22:20
    snap2 = build_snapshot(1, s)
    pending = snap2["pending"][0]
    assert pending["due_clock"] == "22:20"
