"""Playability diversity: pain/urine assessment, new labs, interventions."""

from modules.simulations import engine as e
from modules.simulations.engine import SUCCESS, new_session


def test_pain_assessment_normal_then_abnormal():
    s = new_session()
    e.apply_action(s, "ASSESS", "pain")  # VAS 2, normal
    assert s.pain[-1].abnormal is False
    e.apply_action(s, "WAIT", None)  # to deterioration, severity 0.60
    e.apply_action(s, "ASSESS", "pain")  # VAS 6, abnormal
    assert s.pain[-1].abnormal is True
    assert any(m.kind == "ASSESSMENT" and "腹痛明显" in m.text for m in s.public_log)


def test_urine_output_drops():
    s = new_session()
    e.apply_action(s, "ASSESS", "urine")  # ~178 ml, normal
    assert s.urine[-1].abnormal is False
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ASSESS", "urine")  # ~92 ml, abnormal
    assert s.urine[-1].abnormal is True


def test_pain_can_be_report_evidence():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")  # normal
    e.apply_action(s, "WAIT", None)  # to 48, severity 0.60
    e.apply_action(s, "ASSESS", "pain")  # abnormal
    ok, _ = e.apply_action(s, "REPORT", "doctor")
    assert ok
    assert s.case_status == SUCCESS


def test_fluids_mask_bp_on_vitals_assessment():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # to 48, severity 0.60, true SBP 95
    e.apply_action(s, "FLUIDS", None)  # support = 2
    e.apply_action(s, "ASSESS", "vitals")
    reading = s.vitals[-1]
    assert reading.sbp > 95  # masked above the true value
    assert any("补液支撑" in m.text for m in s.public_log[-3:])


def _deteriorate_minute(setup_action: tuple[str, str | None] | None) -> int:
    s = new_session()
    if setup_action:
        e.apply_action(s, setup_action[0], setup_action[1])
    e.apply_action(s, "WAIT", None)  # stops at the deterioration anchor
    assert s.deteriorated
    return s.current_time


def test_fluids_delay_deterioration():
    # Same end-state (deterioration) reached later when fluids were given.
    assert _deteriorate_minute(("FLUIDS", None)) > _deteriorate_minute(None)


def test_transfusion_delay_deterioration():
    assert _deteriorate_minute(("TRANSFUSE", None)) > _deteriorate_minute(None)


def test_analgesia_masks_pain():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # to 48, severity 0.60
    e.apply_action(s, "ANALGESIA", None)
    e.apply_action(s, "ASSESS", "pain")
    # True VAS 6 -> masked to 4 (still >=4 abnormal), but noted as masked.
    assert any("镇痛" in m.text for m in s.public_log[-2:])
    # Without analgesia the raw score would be higher.
    s2 = new_session()
    e.apply_action(s2, "WAIT", None)
    e.apply_action(s2, "ASSESS", "pain")
    assert s2.pain[-1].score > s.pain[-1].score


def test_abg_and_us_labs_are_orderable_and_evidence():
    s = new_session()
    e.apply_action(s, "ORDER", "abg")   # ready at 13
    e.apply_action(s, "ORDER", "us")    # ready at 23
    e.apply_action(s, "WAIT", None)     # stops at first LAB_READY (abg@13)
    assert s.records[0].kind == "ABG"
    e.apply_action(s, "WAIT", None)     # to US@23
    assert {r.kind for r in s.records} == {"ABG", "US"}
    e.apply_action(s, "VIEW", "us")
    assert any("游离液体" in m.text for m in s.public_log[-3:])


def test_treat_budget_blocks_third_intervention():
    s = new_session()
    e.apply_action(s, "FLUIDS", None)     # 30 治疗点
    e.apply_action(s, "ANALGESIA", None)  # +20 -> 50
    ok, msgs = e.apply_action(s, "TRANSFUSE", None)  # needs 60 > 50 remaining
    assert not ok
    assert s.treat_spent == 50
    assert any("治疗点不足" in m.text for m in msgs)


def test_unknown_lab_kind_rejected():
    s = new_session()
    ok, msgs = e.apply_action(s, "ORDER", "mri")
    assert not ok
    assert any("未知检查" in m.text for m in msgs)


def test_budget_blocks_repeat_orders():
    s = new_session()
    e.apply_action(s, "ORDER", "us")    # 120
    e.apply_action(s, "WAIT", None)     # ready @23
    e.apply_action(s, "ORDER", "us")    # +120 -> 240
    e.apply_action(s, "WAIT", None)     # ready @46
    e.apply_action(s, "ORDER", "abg")   # +60 -> 300
    e.apply_action(s, "WAIT", None)     # ready @56
    e.apply_action(s, "ORDER", "coag")  # +50 -> 350
    # Re-order us — 350+120 > 400 diag budget → rejected, never overspent.
    ok, msgs = e.apply_action(s, "ORDER", "us")
    assert not ok
    assert s.insufficient_funds is True
    assert s.diag_spent == 350
    assert any("检查点不足" in m.text for m in msgs)
