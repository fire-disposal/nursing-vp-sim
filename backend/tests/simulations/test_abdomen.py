"""腹部查体（/assess abdomen）— 外科病例（出血/感染）的腹征评估。

soft → distended（腹胀/轻压痛）→ guarded（肌紧张/反跳痛），由轴严重度 +
abdomen_gain 派生；感染病例腹膜刺激征出现更早。其余病例 surface 不含此目标。
"""

from modules.simulations import engine as e
from modules.simulations.case import get_case
from modules.simulations.engine import new_session


def test_abdomen_exposed_only_on_surgical_cases():
    for cid in ("mvpb-1", "mvpi-1"):
        assert "abdomen" in get_case(cid).surface.assessments, cid
    for cid in ("mvpd-1", "mvph-1", "mvpp-1", "mvpa-1"):
        assert "abdomen" not in get_case(cid).surface.assessments, cid


def test_abdomen_baseline_seeded_at_handover():
    s = new_session("mvpb-1")
    assert s.readings["abdomen"], "外科病例交班必须种入腹部基线"
    assert s.readings["abdomen"][-1].sign == "soft"
    assert s.readings["abdomen"][-1].abnormal is False


def test_abdomen_progresses_from_soft_to_guarded():
    s = new_session("mvpb-1")  # abdomen_gain 1.0：0.4 腹胀、0.8 肌紧张
    e.apply_action(s, "ASSESS", "abdomen")
    assert s.readings["abdomen"][-1].sign == "soft"
    e.apply_action(s, "WAIT", None)  # 恶化（sev 0.60）→ distended
    e.apply_action(s, "ASSESS", "abdomen")
    r = s.readings["abdomen"][-1]
    assert r.sign == "distended"
    assert r.abnormal is True
    assert e._has_abnormal_evidence(s)


def test_abdomen_infection_guards_earlier():
    s = new_session("mvpi-1")  # abdomen_gain 1.2：0.67 即肌紧张
    e.apply_action(s, "WAIT", None)  # 恶化（sev 0.75+）
    e.apply_action(s, "ASSESS", "abdomen")
    assert s.readings["abdomen"][-1].sign == "guarded"


def test_abdomen_description_and_trend():
    s = new_session("mvpb-1")
    e.apply_action(s, "ASSESS", "abdomen")
    e.apply_action(s, "WAIT", None)
    e.apply_action(s, "ASSESS", "abdomen")
    msgs = [m.text for m in s.public_log if m.kind == "ASSESSMENT" and "腹部" in m.text]
    assert msgs
    assert any("较上次" in m for m in msgs)


def test_abdomen_roundtrip_and_snapshot():
    from modules.simulations.service import build_snapshot
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session("mvpi-1")
    e.apply_action(s, "ASSESS", "abdomen")
    restored = state_from_dict(state_to_dict(s))
    assert restored.readings["abdomen"][-1].sign == s.readings["abdomen"][-1].sign
    snap = build_snapshot(1, restored)
    assert snap["readings"]["abdomen"]


def test_abdomen_not_in_catalog_for_medical_cases():
    from modules.simulations.catalog import build_action_catalog

    ids = {a["id"] for a in build_action_catalog(new_session("mvpa-1"))["assess"]}
    assert "abdomen" not in ids
