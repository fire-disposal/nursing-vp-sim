"""MVP-B §12.1 — time resources, anchors, event settling."""

from modules.simulations import engine as e
from modules.simulations.engine import new_session


def test_assess_drain_consumes_exactly_3_minutes():
    s = new_session()
    ok, _ = e.apply_action(s, "ASSESS", "drain")
    assert ok
    assert s.current_time == 3
    assert s.drain[-1].minute == 3


def test_assess_vitals_consumes_2_minutes():
    s = new_session()
    e.apply_action(s, "ASSESS", "vitals")
    assert s.current_time == 2


def test_hidden_disease_events_not_lost_across_action():
    # Two 3-min drain assessments span the first bleeding tick (minute 6).
    s = new_session()
    assert s.hidden.values["bleeding"] == 0.12
    e.apply_action(s, "ASSESS", "drain")  # 0 -> 3, no tick yet
    e.apply_action(s, "ASSESS", "drain")  # 3 -> 6, tick at 6 processed
    assert s.current_time == 6
    assert s.hidden.values["bleeding"] == 0.18


def test_clock_never_goes_backward():
    s = new_session()
    times = [s.current_time]
    for action, target in [("ASSESS", "vitals"), ("ASSESS", "drain"), ("WAIT", None), ("VIEW", "cbc")]:
        e.apply_action(s, action, target)
        times.append(s.current_time)
    assert times == sorted(times)


def test_wait_reaches_next_visible_interrupt():
    # Without monitoring the first visible interrupt is the late deterioration.
    s = new_session()
    e.apply_action(s, "WAIT", None)
    assert s.current_time == 48
    assert s.deteriorated
    assert any(m.kind == "CRITICAL" for m in s.public_log)


def test_wait_cbc_interrupted_by_earlier_monitor_alert():
    # Monitor early, delay the CBC order so its due time lands after the alert.
    s = new_session()
    e.apply_action(s, "MONITOR", "vitals")  # 0->2
    e.apply_action(s, "ASSESS", "drain")  # 2->5
    e.apply_action(s, "ASSESS", "vitals")  # 5->7
    e.apply_action(s, "ORDER", "cbc")  # 7->10, ready at 25
    ok, _ = e.apply_action(s, "WAIT_CBC", None)
    assert ok
    assert s.current_time == 24  # monitor alert fires at severity 0.34 (minute 24)
    assert s.monitor_alert_fired
    # CBC still pending and not materialized.
    assert s.pending_tasks[0].status == "PROCESSING"
    assert not s.records
    assert any("打断" in m.text for m in s.public_log[-5:])
    # Player handles, then can wait again to the CBC anchor.
    e.apply_action(s, "WAIT_CBC", None)
    assert s.current_time == 25
    assert s.pending_tasks[0].status == "READY"
    assert len(s.records) == 1


def test_same_minute_events_settle_in_stable_order():
    # At minute 24 severity crosses both the mid threshold (monitor alert,
    # priority 1) — the alert must be produced deterministically.
    s = new_session()
    e.apply_action(s, "MONITOR", "vitals")  # 0->2
    e.apply_action(s, "ASSESS", "drain")  # 2->5
    e.apply_action(s, "ASSESS", "vitals")  # 5->7
    e.apply_action(s, "ORDER", "cbc")  # 7->10 ready 25
    e.apply_action(s, "WAIT_CBC", None)
    alerts = [m for m in s.public_log if m.kind == "MONITOR"]
    assert len(alerts) == 1
    assert alerts[0].at_minute == 24
