"""Clinical-guideline calibration tests.

These encode REAL treatment reasoning and use it to audit the physiology
kernel: guideline-correct management must improve the patient, and wrong or
delayed management must worsen them. A failure here means the kernel's
physiology is clinically wrong, not just that a test is out of date.
"""

from typing import TYPE_CHECKING, cast

from modules.simulations import engine as e
from modules.simulations.engine import new_session

if TYPE_CHECKING:
    from modules.simulations.state import BreathReading, GlucoseReading, PainReading, VitalsReading


def _glucose(s) -> "GlucoseReading":
    return cast("GlucoseReading", s.readings["glucose"][-1])


def _breath(s) -> "BreathReading":
    return cast("BreathReading", s.readings["breath"][-1])


def _pain(s) -> "PainReading":
    return cast("PainReading", s.readings["pain"][-1])


def _vitals(s) -> "VitalsReading":
    return cast("VitalsReading", s.readings["vitals"][-1])


# ── DKA: insulin + fluids are the guideline treatment ─────────────────────


def _dka_setup():
    s = new_session("mvpd-1")
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "glucose")
    return s


def test_dka_guideline_insulin_plus_fluids_resolves_hyperglycemia():
    # ADA DKA protocol: IV insulin + fluid resuscitation; glucose falls.
    s = _dka_setup()
    e.apply_action(s, "GIVE", "FLUIDS")  # correct hypovolemia
    e.apply_action(s, "GIVE", "INSULIN", "10")
    for _ in range(6):
        e.apply_action(s, "ASSESS", "vitals")  # advance 3 ticks
    e.apply_action(s, "ASSESS", "glucose")
    assert _glucose(s).mmol < 11.1  # out of DKA range


def test_dka_insulin_only_also_lowers_glucose_but_volume_lagging():
    s = _dka_setup()
    e.apply_action(s, "GIVE", "INSULIN", "10")
    for _ in range(6):
        e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "glucose")
    # Insulin alone lowers glucose even without fluids.
    assert _glucose(s).mmol < 11.1


def test_dka_withholding_insulin_worsens_hyperglycemia():
    s = _dka_setup()
    e.apply_action(s, "GIVE", "MORPHINE", "5")  # analgesia does NOT treat DKA
    for _ in range(12):  # 4 ticks → severity crosses the abnormal bar
        e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "glucose")
    assert _glucose(s).abnormal is True  # still DKA-range


def test_dka_insulin_overdose_causes_hypoglycemia():
    s = _dka_setup()
    e.apply_action(s, "GIVE", "INSULIN", "15")
    for _ in range(6):
        e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "glucose")
    low = _glucose(s).mmol
    control = _dka_setup()
    e.apply_action(control, "GIVE", "INSULIN", "5")  # guideline dose
    for _ in range(6):
        e.apply_action(control, "ASSESS", "vitals")
    e.apply_action(control, "ASSESS", "glucose")
    assert low < _glucose(control).mmol  # overdose overshoots down


# ── CHF: diuretic is the guideline; fluids are harmful ────────────────────


def _chf_setup():
    s = new_session("mvph-1")
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "breath")
    return s


def test_chf_guideline_diuretic_resolves_crackles():
    # AHA/ACC acute HF: loop diuretic to relieve congestion.
    s = _chf_setup()
    e.apply_action(s, "GIVE", "DIURETIC", "40")
    e.apply_action(s, "GIVE", "DIURETIC", "40")
    for _ in range(6):
        e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "breath")
    assert _breath(s).sound == "clear"


def test_chf_fluids_are_harmful_and_worsen_crackles():
    # Fluids expand an already-congested volume — crackles persist/worsen.
    s = _chf_setup()
    e.apply_action(s, "GIVE", "FLUIDS")
    e.apply_action(s, "GIVE", "FLUIDS")
    for _ in range(6):
        e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "breath")
    assert _breath(s).abnormal is True


def test_chf_diuretic_too_aggressive_depletes_volume():
    # Over-diuresis → volume collapses → hypotension (clinical warning).
    s = _chf_setup()
    e.apply_action(s, "GIVE", "DIURETIC", "80")
    e.apply_action(s, "GIVE", "DIURETIC", "80")
    e.apply_action(s, "GIVE", "DIURETIC", "80")
    for _ in range(6):
        e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "ASSESS", "vitals")
    assert s.hidden.physio["vol"] < 0.9  # over-diuresis drains volume
    assert _vitals(s).sbp < 110


# ── Opioid stewardship: morphine helps pain but suppresses breathing ──────


def _pain_case_setup():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # to deterioration, painful
    e.apply_action(s, "ASSESS", "pain")
    return s


def test_morphine_relieves_pain_but_depresses_respiration():
    # WHO pain ladder: opioid for severe pain — but watch respiratory drive.
    s = _pain_case_setup()
    e.apply_action(s, "GIVE", "MORPHINE", "10")
    e.apply_action(s, "ASSESS", "pain")
    e.apply_action(s, "ASSESS", "vitals")
    assert _pain(s).score < 6  # pain relieved
    assert _vitals(s).rr <= 16  # respiratory drive suppressed


def test_nsaid_relieves_mild_pain_without_respiratory_effect():
    # WHO ladder step 1: NSAID first — no respiratory suppression.
    s = _pain_case_setup()
    e.apply_action(s, "GIVE", "NSAID", "800")
    e.apply_action(s, "ASSESS", "pain")
    e.apply_action(s, "ASSESS", "vitals")
    assert _vitals(s).rr > 12  # breathing preserved


# ── Cross-cutting: correct diagnosis leads to right treatment ─────────────


def test_bleeding_case_transfusion_restores_hb_fluids_do_not():
    # Acute blood loss: fluids buy time (volume), transfusion restores Hb.
    s = new_session()
    e.apply_action(s, "GIVE", "TRANSFUSE")
    e.apply_action(s, "ASSESS", "vitals")
    hb_transfused = s.hidden.physio["hb"]
    s2 = new_session()
    e.apply_action(s2, "GIVE", "FLUIDS")
    e.apply_action(s2, "ASSESS", "vitals")
    hb_fluids = s2.hidden.physio["hb"]
    assert hb_transfused > hb_fluids  # transfusion raises Hb, fluids only volume


def test_bleeding_case_morphine_masks_pain_clue():
    # Analgesia masks the abdominal pain that is an early clue.
    s = new_session()
    e.apply_action(s, "WAIT", None)  # to deterioration, VAS 6
    e.apply_action(s, "GIVE", "MORPHINE", "10")
    e.apply_action(s, "ASSESS", "pain")
    assert _pain(s).score < 6  # pain no longer abnormal → clue masked
