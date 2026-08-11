"""MVP-B §12.3 — CBC lifecycle, single materialization, trend rules."""

from modules.simulations import engine as e
from modules.simulations.engine import new_session


def test_order_creates_pending_and_charges_once():
    s = new_session()
    ok, _ = e.apply_action(s, "ORDER", "cbc")
    assert ok
    assert len(s.pending_tasks) == 1
    assert s.pending_tasks[0].status == "PROCESSING"
    assert s.pending_tasks[0].cost_yuan == 35
    assert s.pending_tasks[0].due_at == 3 + 15  # sampled 3, turnaround 15
    assert s.cbc_count == 1
    assert s.diag_spent == 35


def test_repeat_while_pending_rejected_without_double_charge():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    ok, msgs = e.apply_action(s, "ORDER", "cbc")
    assert not ok
    assert s.current_time == 3  # rejected -> no time consumed
    assert s.cbc_count == 1
    assert s.diag_spent == 35
    assert s.repeat_while_pending is True
    assert any("拒绝" in m.text for m in msgs)


def test_cbc_ready_materializes_exactly_once():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT_CBC", None)
    assert len(s.records) == 1
    assert s.pending_tasks[0].status == "READY"
    # Re-processing the ready moment must not add a second record.
    e.apply_action(s, "STATUS", None)
    assert len(s.records) == 1


def test_multiple_views_return_same_record():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW", "cbc")
    first = s.records[0].result
    e.apply_action(s, "VIEW", "cbc")
    assert len(s.records) == 1
    assert s.records[0].result == first


def test_result_reflects_sampled_time_not_return_time():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")  # sampled at minute 3 (severity 0.12)
    e.apply_action(s, "WAIT_CBC", None)  # returns at minute 18 (severity 0.30)
    r = s.records[0].result
    # Sampled severity 0.12 -> Hb 123.4; return-time severity 0.30 -> 91.
    assert r["sampled_severity"] == 0.12
    assert r["hb"] == 123.4


def test_second_cbc_uses_new_snapshot_and_previous_value():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")  # sampled@3 severity 0.12 -> Hb 123.4
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW", "cbc")
    e.apply_action(s, "ORDER", "cbc")  # sampled@21 severity 0.30 -> Hb 91
    e.apply_action(s, "WAIT_CBC", None)
    e.apply_action(s, "VIEW", "cbc")
    first, second = s.records[0].result, s.records[1].result
    # Ongoing bleeding: second Hb must not rise relative to the first.
    assert second["hb"] < first["hb"]
    assert second["hb"] == 91.0
    assert second["abnormal"] is True


def test_third_cbc_allowed_after_ready_but_second_blocked_while_pending():
    s = new_session()
    e.apply_action(s, "ORDER", "cbc")
    ok, _ = e.apply_action(s, "ORDER", "cbc")  # still pending -> blocked
    assert not ok
    e.apply_action(s, "WAIT_CBC", None)
    ok, _ = e.apply_action(s, "ORDER", "cbc")  # first ready -> allowed
    assert ok
    assert s.cbc_count == 2
