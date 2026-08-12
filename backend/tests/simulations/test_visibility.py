"""MVP-B §12.2 — information visibility minimum model."""

from modules.simulations import engine as e
from modules.simulations.engine import new_session


def test_initial_state_leaks_no_severity():
    s = new_session()
    # Handover brief is seeded, but it never exposes the hidden severity.
    assert s.public_log
    assert not any("严重度" in m.text or "0.12" in m.text for m in s.public_log)
    # /status must not expose the hidden severity either.
    e.apply_action(s, "STATUS", None)
    assert not any("严重度" in m.text for m in s.public_log)


def test_drain_abnormal_not_shown_until_assessed():
    s = new_session()
    # Advance hidden course past the drain threshold without assessing.
    e.apply_action(s, "WAIT", None)  # to minute 48, severity 0.60
    # Only the (normal) handover baseline exists — the abnormal drain is hidden.
    assert len(s.drain) == 1
    assert s.drain[0].abnormal is False
    assert not any("引流" in m.text and "ml" in m.text for m in s.public_log[2:])


def test_no_monitor_alert_without_monitoring():
    s = new_session()
    e.apply_action(s, "WAIT", None)  # reaches deterioration at 48, severity 0.60
    # Mid threshold crossed but monitoring never enabled -> no MONITOR alert.
    assert not s.monitor_alert_fired
    assert not any(m.kind == "MONITOR" for m in s.public_log)


def test_cbc_value_hidden_until_view():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")  # 0->3 ready 18
    e.apply_action(s, "WAIT", "cbc")
    # Result materialized but not revealed.
    assert len(s.records) == 1
    assert s.records[0].revealed is False
    assert not any("Hb" in m.text for m in s.public_log)
    # View reveals exactly once.
    e.apply_action(s, "VIEW", "cbc")
    assert s.records[0].revealed is True
    assert any("Hb" in m.text for m in s.public_log[-2:])


def test_status_does_not_reveal_future_events():
    s = new_session()
    e.apply_action(s, "STATUS", None)
    assert not any("恶化" in m.text or "报警" in m.text or "失败" in m.text for m in s.public_log)


def test_snapshot_excludes_hidden_state_and_unrevealed_cbc():
    from modules.simulations.service import build_snapshot

    s = new_session()
    e.apply_action(s, "ORDER", "cbc")  # hidden severity 0.12, cost 35
    e.apply_action(s, "WAIT", "cbc")  # CBC materialized but not revealed
    snap = build_snapshot(1, s)
    # No hidden severity anywhere in the public snapshot.
    assert "hidden" not in snap
    assert not any("severity" in str(v) for v in snap["vitals"])
    # Unrevealed CBC exposes no values, only a count.
    assert snap["unrevealed_lab_count"] == 1
    assert snap["lab_records"] == []
    assert snap["diag_spent"] == 35


def test_state_roundtrip_preserves_determinism():
    from modules.simulations.service import build_snapshot
    from modules.simulations.state import state_from_dict, state_to_dict

    s = new_session()
    e.apply_action(s, "MONITOR", "vitals")
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT", "cbc")
    raw = state_to_dict(s)
    restored = state_from_dict(raw)
    assert restored.hidden.values == s.hidden.values
    assert restored.current_time == s.current_time
    assert restored.pending_tasks == s.pending_tasks
    assert restored.records == s.records
    assert build_snapshot(7, restored) == build_snapshot(7, s)
