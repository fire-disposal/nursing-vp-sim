"""教学要点（teaching_points）— 每病例一句话学习目标，结局复盘时展示。"""

from modules.simulations import engine as e
from modules.simulations.case import CASES, get_case
from modules.simulations.engine import new_session


def test_every_case_has_teaching_points():
    for cid in CASES:
        points = get_case(cid).narrative.teaching_points
        assert points, cid
        assert "：" in points
        assert "。" in points


def test_audit_summary_contains_teaching_points():
    s = new_session("mvpd-1")
    e.apply_action(s, "ASSESS", "vitals")
    e.apply_action(s, "WAIT", None)  # 恶化 → 异常证据
    e.apply_action(s, "REPORT", "doctor")
    audit = [m.text for m in s.public_log if m.kind == "AUDIT"]
    assert audit
    assert "教学要点" in audit[-1]
    assert "胰岛素" in audit[-1]  # DKA 教学要点内容


def test_teaching_points_in_snapshot():
    from modules.simulations.service import build_snapshot

    s = new_session("mvpa-1")
    snap = build_snapshot(1, s)
    assert "沙丁胺醇" in snap["teaching_points"]


def test_teaching_points_never_leak_hidden_values():
    for cid in CASES:
        points = get_case(cid).narrative.teaching_points
        assert "严重度" not in points
        assert "0." not in points
