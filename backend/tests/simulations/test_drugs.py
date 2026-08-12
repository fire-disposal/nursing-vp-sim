"""Pharmacokinetics, adverse reactions, consciousness and the case-declared
command surface — the anti-"answer machine" layer.

Spamming morphine is a real mistake with observable consequences: respiratory
depression (RR/SpO2 fall), sedation (consciousness drops), and eventually a
drug-adverse event. Consciousness also gates dialogue. The command surface
declares which drugs each case stocks, so a specialty is data, not code.
"""

from modules.simulations import engine as e
from modules.simulations.case import DRUGS, active_meds, get_case
from modules.simulations.engine import new_session

MORPHINE_OVERDOSE_MG = DRUGS["MORPHINE"].toxicity_threshold


def test_meds_state_tracks_plasma_and_decays_by_half_life():
    s = new_session()
    e.apply_action(s, "GIVE", "MORPHINE")  # 5mg = 1 unit plasma
    med = active_meds(s.hidden.physio)["MORPHINE"]
    assert med["plasma"] == 1.0
    assert med["cumulative"] == 5.0
    assert med["doses"] == 1
    # Half-life 90min: after 90 minutes plasma halves.
    e.apply_action(s, "WAIT", None)  # to deterioration at 48
    e.apply_action(s, "WAIT", None)  # to failure at 90
    med = active_meds(s.hidden.physio)["MORPHINE"]
    assert med["plasma"] < 0.7  # decayed well below 1.0
    assert med["cumulative"] == 5.0  # cumulative persists for overdose math


def test_spamming_morphine_causes_respiratory_depression():
    s = new_session()
    e.apply_action(s, "GIVE", "MORPHINE", "15")  # 3 units plasma
    e.apply_action(s, "GIVE", "MORPHINE", "15")  # 6 units
    e.apply_action(s, "ASSESS", "vitals")
    v = s.vitals[-1]
    assert v.rr <= 10  # respiratory drive crushed
    assert v.spo2 <= 92  # hypoxemia follows
    assert v.abnormal is True


def test_morphine_overdose_fires_drug_adverse_event():
    s = new_session()
    # Cumulative 40mg is the toxicity threshold.
    while active_meds(s.hidden.physio).get("MORPHINE", {}).get("cumulative", 0) < MORPHINE_OVERDOSE_MG:
        ok, _ = e.apply_action(s, "GIVE", "MORPHINE", "15")
        assert ok
    assert s.drug_overdose
    # The adverse event is scheduled and interrupts a wait.
    e.apply_action(s, "WAIT", None)
    assert any(m.kind == "CRITICAL" and "呼吸抑制" in m.text for m in s.public_log)
    assert any("吗啡" in m.text for m in s.public_log)
    assert any("药物不良反应" in m.text for m in s.public_log)


def test_overdose_is_abnormal_evidence_and_surfaces_in_consult():
    s = new_session()
    while active_meds(s.hidden.physio).get("MORPHINE", {}).get("cumulative", 0) < MORPHINE_OVERDOSE_MG:
        e.apply_action(s, "GIVE", "MORPHINE", "15")
    from modules.simulations.engine import _has_abnormal_evidence, build_consult_summary

    assert _has_abnormal_evidence(s)
    summary = build_consult_summary(s)
    assert "吗啡" in summary
    assert "不良反应" in summary


def test_consciousness_drops_with_hypoperfusion_and_sedation():
    s = new_session()
    assert s.hidden.physio["conscious"] > 0.9
    e.apply_action(s, "GIVE", "MORPHINE", "15")
    e.apply_action(s, "GIVE", "MORPHINE", "15")
    e.apply_action(s, "GIVE", "MORPHINE", "15")
    e.apply_action(s, "WAIT", None)  # a tick runs the metabolism step
    assert s.hidden.physio["conscious"] < 0.6


def test_unconscious_patient_cannot_talk():
    s = new_session()
    while active_meds(s.hidden.physio).get("MORPHINE", {}).get("cumulative", 0) < MORPHINE_OVERDOSE_MG:
        e.apply_action(s, "GIVE", "MORPHINE", "15")
    e.apply_action(s, "WAIT", None)  # step applies sedation
    ok, msgs = e.apply_action(s, "TALK", "patient", "你现在感觉怎么样？")
    assert not ok
    assert any("昏迷" in m.text for m in msgs)


def test_dose_validation_rejects_above_max_and_garbage():
    s = new_session()
    ok, msgs = e.apply_action(s, "GIVE", "MORPHINE", "999")
    assert not ok
    assert any("剂量" in m.text for m in msgs)
    ok2, msgs2 = e.apply_action(s, "GIVE", "MORPHINE", "abc")
    assert not ok2
    assert any("剂量" in m.text for m in msgs2)


def test_unknown_drug_rejected_from_surface():
    s = new_session()
    ok, msgs = e.apply_action(s, "GIVE", "PARACETAMOL", None)
    assert not ok
    assert any("未知药物" in m.text for m in msgs)
    # The catalog is discoverable via bare /give, not embedded in the error.
    ok2, catalog = e.apply_action(s, "GIVE", None, None)
    assert ok2
    assert any("FLUIDS" in m.text for m in catalog)


def test_infection_case_stocks_antibiotics_not_transfusion():
    inf = get_case("mvpi-1")
    assert "ANTIBIOTIC" in inf.surface.drugs
    assert "TRANSFUSE" not in inf.surface.drugs
    bleed = get_case("mvpb-1")
    assert "TRANSFUSE" in bleed.surface.drugs
    assert "ANTIBIOTIC" not in bleed.surface.drugs
    # Giving antibiotics is rejected in the bleeding case, allowed in infection.
    s_bleed = new_session()
    ok, _ = e.apply_action(s_bleed, "GIVE", "ANTIBIOTIC", None)
    assert not ok
    s_inf = new_session("mvpi-1")
    ok, _ = e.apply_action(s_inf, "GIVE", "ANTIBIOTIC", None)
    assert ok


def test_antibiotic_slows_infection_progression():
    s = new_session("mvpi-1")
    e.apply_action(s, "GIVE", "ANTIBIOTIC")
    # Progression mult 0.55 applies from the next tick onward.
    e.apply_action(s, "ASSESS", "drain")
    e.apply_action(s, "ASSESS", "drain")  # spans tick at 6
    sev_with_abx = s.hidden.values["infection"]
    s2 = new_session("mvpi-1")
    e.apply_action(s2, "ASSESS", "drain")
    e.apply_action(s2, "ASSESS", "drain")
    assert sev_with_abx < s2.hidden.values["infection"]


def test_assess_targets_driven_by_case_surface():
    s = new_session()
    ok, msgs = e.apply_action(s, "ASSESS", "xray")
    assert not ok
    assert any("评估目标无效" in m.text for m in msgs)
    assert "vitals" in msgs[-1].text  # surface lists the valid targets


def test_wait_with_lab_target_waits_for_that_lab():
    s = new_session()
    e.apply_action(s, "ORDER", "abg")  # sampled @3, ready @13
    e.apply_action(s, "ORDER", "cbc")  # sampled @6, ready @21
    e.apply_action(s, "WAIT", "abg")
    assert s.current_time == 13
    assert {r.kind for r in s.records} == {"ABG"}
    e.apply_action(s, "WAIT", "cbc")
    assert s.current_time == 21
    assert {r.kind for r in s.records} == {"ABG", "CBC"}


def test_give_with_dose_text_and_default():
    s = new_session()
    ok, msgs = e.apply_action(s, "GIVE", "OXYGEN", "5")
    assert ok
    med = active_meds(s.hidden.physio)["OXYGEN"]
    assert med["plasma"] == 5 / 3  # 5L at 3L/default = 1.667 units
    ok2, _ = e.apply_action(s, "GIVE", "OXYGEN", None)
    assert ok2
    assert active_meds(s.hidden.physio)["OXYGEN"]["doses"] == 2


def test_oxygen_raises_spo2():
    s = new_session()
    e.apply_action(s, "GIVE", "MORPHINE", "15")  # depress respiration
    e.apply_action(s, "ASSESS", "vitals")
    low = s.vitals[-1].spo2
    e.apply_action(s, "GIVE", "OXYGEN", "6")
    e.apply_action(s, "ASSESS", "vitals")
    assert s.vitals[-1].spo2 > low


def test_give_without_target_prints_categorized_catalog():
    s = new_session()
    ok, msgs = e.apply_action(s, "GIVE", None, None)
    assert ok
    text = msgs[-1].text
    assert "可用药物" in text
    assert "液体与容量" in text  # category header
    assert "镇痛" in text
    # Catalog is factual — no efficacy/risk guidance embedded.
    assert "危险" not in text
    assert "掩盖" not in text


def test_nsaid_is_neutral_analgesia_alternative():
    # NSAID masks pain without respiratory depression (unlike morphine).
    s = new_session()
    e.apply_action(s, "GIVE", "NSAID", "800")
    e.apply_action(s, "ASSESS", "vitals")
    assert s.vitals[-1].rr > 10  # no respiratory suppression
    s2 = new_session()
    e.apply_action(s2, "GIVE", "MORPHINE", "15")
    e.apply_action(s2, "ASSESS", "vitals")
    assert s2.vitals[-1].rr < s.vitals[-1].rr  # morphine suppresses more


def test_diuretic_drains_volume_and_lowers_bp():
    s = new_session()
    e.apply_action(s, "GIVE", "FLUIDS")  # expand volume first
    vol_before = s.hidden.physio["vol"]
    e.apply_action(s, "GIVE", "DIURETIC", "40")
    e.apply_action(s, "ASSESS", "vitals")
    assert s.hidden.physio["vol"] < vol_before
    assert s.vitals[-1].sbp < 122


def test_vasopressor_raises_bp_via_svr():
    s = new_session()
    e.apply_action(s, "GIVE", "VASOPRESSOR", "10")
    e.apply_action(s, "ASSESS", "vitals")
    assert s.hidden.physio["svr"] > 1.0
    assert s.vitals[-1].sbp > 100


def test_new_drugs_stocked_in_bleeding_case():
    s = new_session()
    for drug in ("NSAID", "DIURETIC", "VASOPRESSOR"):
        ok, _ = e.apply_action(s, "GIVE", drug, None)
        assert ok, drug
