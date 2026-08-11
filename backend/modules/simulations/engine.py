"""Pure simulation engine — no DB, no HTTP.

The engine only ever mutates a ``SessionState`` and returns structured
``DomainMessage``s. FastAPI and the React console must not re-implement any
rule here; they translate structured actions and render messages.

Determinism: events in the same minute are settled by (at_minute, priority,
sequence); ``sequence`` is a monotonically increasing counter assigned at
schedule time, so same-minute ordering is stable across identical plays.
"""

from .case import (
    BLEEDING_INTERVAL_MIN,
    CASE_NAME,
    CASE_VERSION,
    CBC_COST_YUAN,
    CBC_TURNAROUND_MIN,
    DETERIORATION_SEVERITY,
    DURATION_MIN,
    FAILURE_SEVERITY,
    SEVERITY_START,
    SEVERITY_STEP,
    VITALS_MID_SEVERITY,
    clock_text,
    drain_abnormal,
    drain_output,
    hb_abnormal,
    hb_for,
    vitals,
    vitals_abnormal,
    wbc_for,
)
from .state import (
    ActionRecord,
    ClinicalRecord,
    DomainMessage,
    DrainReading,
    HiddenClinicalState,
    PendingTask,
    ScheduledEvent,
    SessionState,
    VitalsReading,
)

ACTIVE = "ACTIVE"
SUCCESS = "SUCCESS"
FAILURE = "FAILURE"

# Event types that hand control back to the player when they interrupt a wait.
_INTERRUPT_TYPES = frozenset(
    {"CBC_READY", "MONITOR_ALERT", "SPONTANEOUS_DETERIORATION", "CASE_SUCCESS", "CASE_FAILURE"}
)

# Non-clinical commands allowed after the case has ended.
_NON_CLINICAL = frozenset({"STATUS", "VIEW_CBC", "HISTORY", "HELP", "PENDING"})

# Waiting horizon — large enough to always reach the failure outcome.
_WAIT_HORIZON = 100000


# ── Construction ──────────────────────────────────────────────────────────


def new_session() -> SessionState:
    state = SessionState(
        hidden=HiddenClinicalState(
            bleeding_severity=SEVERITY_START,
            reported_to_doctor=False,
            monitoring_enabled=False,
        ),
        current_time=0,
        case_status=ACTIVE,
    )
    _schedule(state, BLEEDING_INTERVAL_MIN, 0, "BLEEDING_PROGRESS", {})
    return state


def _schedule(state: SessionState, at_minute: int, priority: int, etype: str, payload: dict) -> None:
    state.seq += 1
    state.events.append(ScheduledEvent(at_minute, priority, state.seq, f"{etype}-{state.seq}", etype, payload))


# ── Time advance ──────────────────────────────────────────────────────────


def _advance(
    state: SessionState, messages: list[DomainMessage], until: int, stop_on_interrupt: bool = False
) -> ScheduledEvent | None:
    """Process due events up to ``until`` in deterministic order.

    Returns the interrupting event if ``stop_on_interrupt`` and one fired.
    ``state.current_time`` is set to the minute of the last processed event.
    """
    stopping: ScheduledEvent | None = None
    while True:
        due = [e for e in state.events if e.at_minute <= until]
        if not due:
            break
        due.sort(key=lambda e: (e.at_minute, e.priority, e.sequence))
        ev = due[0]
        state.events.remove(ev)
        state.current_time = ev.at_minute
        _handle_event(state, ev, messages)
        if stop_on_interrupt and ev.type in _INTERRUPT_TYPES:
            stopping = ev
            break
    return stopping


def _handle_event(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    if ev.type == "BLEEDING_PROGRESS":
        _on_bleeding_progress(state, ev, messages)
    elif ev.type == "CBC_READY":
        _on_cbc_ready(state, ev, messages)
    elif ev.type == "MONITOR_ALERT":
        v = vitals(state.hidden.bleeding_severity)
        messages.append(
            DomainMessage(
                "MONITOR",
                ev.at_minute,
                f"监护报警（{clock_text(ev.at_minute)}）：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，RR {v['rr']}。生命体征异常，请处理。",
            )
        )
    elif ev.type == "SPONTANEOUS_DETERIORATION":
        v = vitals(state.hidden.bleeding_severity)
        messages.append(
            DomainMessage(
                "CRITICAL",
                ev.at_minute,
                f"患者病情明显恶化（{clock_text(ev.at_minute)}）：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，引流增多。需立即处理。",
            )
        )
    elif ev.type == "CASE_SUCCESS":
        _end_case(state, SUCCESS, ev.at_minute, messages)
    elif ev.type == "CASE_FAILURE":
        _end_case(state, FAILURE, ev.at_minute, messages)


def _on_bleeding_progress(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    if state.case_status != ACTIVE or state.hidden.reported_to_doctor:
        return  # bleeding controlled — no further progression, no reschedule
    sev = state.hidden.bleeding_severity + SEVERITY_STEP
    state.hidden.bleeding_severity = sev
    _schedule(state, ev.at_minute + BLEEDING_INTERVAL_MIN, 0, "BLEEDING_PROGRESS", {})

    if not state.deteriorated and sev >= DETERIORATION_SEVERITY:
        state.deteriorated = True
        _schedule(state, ev.at_minute, 1, "SPONTANEOUS_DETERIORATION", {})
    if state.hidden.monitoring_enabled and not state.monitor_alert_fired and sev >= VITALS_MID_SEVERITY:
        state.monitor_alert_fired = True
        _schedule(state, ev.at_minute, 1, "MONITOR_ALERT", {})
    if sev >= FAILURE_SEVERITY:
        _schedule(state, ev.at_minute, 3, "CASE_FAILURE", {})


def _on_cbc_ready(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    task_id = ev.payload.get("pending_id")
    task = next((t for t in state.pending_tasks if t.id == task_id), None)
    if task is None or task.status != "PROCESSING":
        return
    task.status = "READY"
    previous = _latest_cbc_result(state)
    result = materialize_cbc(task.sample_snapshot, previous)
    state.records.append(
        ClinicalRecord(
            order_id=task.id,
            kind="CBC",
            sampled_at=task.sampled_at,
            ready_at=ev.at_minute,
            result=result,
            revealed=False,
        )
    )
    messages.append(
        DomainMessage(
            "LAB",
            ev.at_minute,
            f"CBC 结果已返回（order #{task.id}）。使用 /view cbc 查看具体数值。",
        )
    )


def _end_case(state: SessionState, status: str, minute: int, messages: list[DomainMessage]) -> None:
    if state.case_status != ACTIVE:
        return
    state.case_status = status
    state.case_ended_at = minute
    if status == FAILURE:
        messages.append(DomainMessage("CRITICAL", minute, "患者病情急剧恶化，隐匿性出血未被及时发现与控制——病例失败。"))
    else:
        messages.append(DomainMessage("SYSTEM", minute, "病情得到控制，病例结束（较好结局）。"))
    messages.append(DomainMessage("AUDIT", minute, _audit_summary(state, minute)))


def _audit_summary(state: SessionState, minute: int) -> str:
    parts = [f"结局摘要：CBC 次数 {state.cbc_count}，检查总费用 ¥{state.cost_total}。"]
    if state.repeat_while_pending:
        parts.append("存在 pending 时重复申请。")
    parts.append(f"病例时长 {minute} 分钟（{clock_text(minute)}）。")
    return " ".join(parts)


# ── CBC materialization ───────────────────────────────────────────────────


def materialize_cbc(sample_snapshot: dict, previous: dict | None) -> dict:
    """On-demand CBC result, reflecting the sampled-time bleeding state.

    A CBC is materialized only once (when the CBC_READY event fires) and only
    from the light snapshot saved at sampling time — never from the state at
    result-return time.
    """
    sev = sample_snapshot["severity"]
    hb = hb_for(sev)
    if previous is not None:
        # Ongoing bleeding (severity not falling) must never show a rise in Hb.
        if sev >= previous["sampled_severity"]:
            hb = min(hb, previous["hb"])
    return {
        "hb": round(hb, 1),
        "wbc": wbc_for(sev),
        "platelet": 220,
        "sampled_severity": round(sev, 4),
        "abnormal": hb_abnormal(hb),
    }


def _latest_cbc_result(state: SessionState) -> dict | None:
    if not state.records:
        return None
    return max(state.records, key=lambda r: r.sampled_at).result


# ── Action dispatch ───────────────────────────────────────────────────────


def apply_action(state: SessionState, action_type: str, target: str | None) -> tuple[bool, list[DomainMessage]]:
    messages: list[DomainMessage] = []

    if action_type not in _NON_CLINICAL and state.case_status != ACTIVE:
        messages.append(DomainMessage("SYSTEM", state.current_time, "病例已结束，无法执行临床操作。"))
        return False, messages

    handler = _HANDLERS.get(action_type)
    if handler is None:
        messages.append(DomainMessage("SYSTEM", state.current_time, f"未知动作：{action_type}"))
        return False, messages

    started_at = state.current_time
    ok = handler(state, target, messages)
    if ok:
        state.revision += 1
        state.action_log.append(ActionRecord(started_at, state.current_time, action_type, target, _outcome(messages)))
    state.public_log.extend(messages)
    return ok, messages


def _outcome(messages: list[DomainMessage]) -> str:
    for m in messages:
        if m.kind in ("ASSESSMENT", "LAB", "MONITOR", "CRITICAL", "WARNING"):
            return m.text
    return messages[-1].text if messages else ""


# ── Action handlers (state, target, messages) -> bool ─────────────────────


def _do_status(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    lines = [f"{CASE_NAME}（{CASE_VERSION}）", f"当前时间：{clock_text(state.current_time)}"]
    lines.append(f"病例状态：{state.case_status}")
    if state.hidden.monitoring_enabled:
        lines.append("持续生命体征监护：已开启")
    if state.hidden.reported_to_doctor:
        lines.append("已向医生报告")
    if state.vitals:
        v = state.vitals[-1]
        lines.append(f"最近生命体征：HR {v.hr} bpm，BP {v.sbp}/{v.dbp} mmHg，RR {v.rr}，SpO2 {v.spo2}%")
    if state.drain:
        d = state.drain[-1]
        lines.append(f"最近引流：{d.output_ml} ml")
    pending = _pending_cbc(state)
    if pending:
        lines.append(f"CBC 处理中（order #{pending.id}），预计 {clock_text(pending.due_at)} 返回")
    else:
        lines.append("CBC：无进行中的申请")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_assess(state: SessionState, target: str | None, messages: list[DomainMessage]) -> bool:
    if target == "vitals":
        return _do_assess_vitals(state, messages)
    if target == "drain":
        return _do_assess_drain(state, messages)
    messages.append(DomainMessage("SYSTEM", state.current_time, "评估目标无效（vitals / drain）。"))
    return False


def _do_assess_vitals(state: SessionState, messages: list[DomainMessage]) -> bool:
    completion = state.current_time + DURATION_MIN["ASSESS_VITALS"]
    _advance(state, messages, completion)
    state.current_time = completion
    v = vitals(state.hidden.bleeding_severity)
    abnormal = vitals_abnormal(v)
    state.vitals.append(VitalsReading(completion, v["hr"], v["sbp"], v["dbp"], v["rr"], v["spo2"], v["temp"], abnormal))
    note = "存在异常" if abnormal else "未见明显异常"
    messages.append(
        DomainMessage(
            "ASSESSMENT",
            completion,
            f"生命体征（{clock_text(completion)}）：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，RR {v['rr']}，SpO2 {v['spo2']}%，T {v['temp']}℃。{note}。",
        )
    )
    return True


def _do_assess_drain(state: SessionState, messages: list[DomainMessage]) -> bool:
    completion = state.current_time + DURATION_MIN["ASSESS_DRAIN"]
    _advance(state, messages, completion)
    state.current_time = completion
    output = drain_output(state.hidden.bleeding_severity)
    abnormal = drain_abnormal(output)
    state.drain.append(DrainReading(completion, output, abnormal))
    note = "引流增多，异常" if abnormal else "引流量在正常范围"
    messages.append(
        DomainMessage("ASSESSMENT", completion, f"引流评估（{clock_text(completion)}）：{output} ml。{note}。")
    )
    return True


def _do_order_cbc(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    pending = _pending_cbc(state)
    if pending is not None:
        state.repeat_while_pending = True
        messages.append(
            DomainMessage(
                "LAB",
                state.current_time,
                f"已有进行中的 CBC（order #{pending.id}），预计 {clock_text(pending.due_at)} 返回，拒绝重复申请。",
            )
        )
        return False
    start = state.current_time
    completion = start + DURATION_MIN["ORDER_CBC"]
    _advance(state, messages, completion)
    state.current_time = completion
    state.seq += 1
    task_id = f"cbc-{state.seq}"
    due_at = completion + CBC_TURNAROUND_MIN
    state.pending_tasks.append(
        PendingTask(
            id=task_id,
            kind="CBC",
            status="PROCESSING",
            ordered_at=start,
            sampled_at=completion,
            due_at=due_at,
            sample_snapshot={
                "severity": state.hidden.bleeding_severity,
                "minute": completion,
                "monitoring": state.hidden.monitoring_enabled,
            },
            cost_yuan=CBC_COST_YUAN,
        )
    )
    _schedule(state, due_at, 2, "CBC_READY", {"pending_id": task_id})
    state.cbc_count += 1
    state.cost_total += CBC_COST_YUAN
    messages.append(
        DomainMessage(
            "LAB",
            completion,
            f"已申请 CBC（order #{task_id}），采血完成于 {clock_text(completion)}，预计 {clock_text(due_at)} 返回。费用 ¥{CBC_COST_YUAN}。",
        )
    )
    return True


def _do_monitor(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    if state.hidden.monitoring_enabled:
        messages.append(DomainMessage("SYSTEM", state.current_time, "持续生命体征监护已开启，无需重复开启。"))
        return False
    completion = state.current_time + DURATION_MIN["MONITOR"]
    _advance(state, messages, completion)
    state.current_time = completion
    state.hidden.monitoring_enabled = True
    messages.append(DomainMessage("SYSTEM", completion, f"已开启持续生命体征监护（{clock_text(completion)}）。"))
    # Monitoring started while the mid threshold is already crossed → alert now.
    if not state.monitor_alert_fired and state.hidden.bleeding_severity >= VITALS_MID_SEVERITY:
        state.monitor_alert_fired = True
        v = vitals(state.hidden.bleeding_severity)
        messages.append(
            DomainMessage(
                "MONITOR",
                completion,
                f"监护报警（{clock_text(completion)}）：HR {v['hr']} bpm，BP {v['sbp']}/{v['dbp']} mmHg，RR {v['rr']}。生命体征异常，请处理。",
            )
        )
    return True


def _do_report(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    if not _has_abnormal_evidence(state):
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                "没有已确认的异常证据，无法提交有效报告。请先通过评估 / 监护 / CBC 获取至少一项异常证据。",
            )
        )
        return False
    completion = state.current_time + DURATION_MIN["REPORT"]
    _advance(state, messages, completion)
    state.current_time = completion
    if state.case_status != ACTIVE:
        messages.append(DomainMessage("SYSTEM", completion, "病情已在报告过程中终结，报告无效。"))
        return False
    state.hidden.reported_to_doctor = True
    messages.append(DomainMessage("SYSTEM", completion, f"已向医生报告病情（{clock_text(completion)}）。"))
    _end_case(state, SUCCESS, completion, messages)
    return True


def _do_wait(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    until = state.current_time + _WAIT_HORIZON
    stopping = _advance(state, messages, until, stop_on_interrupt=True)
    if stopping is not None:
        messages.append(
            DomainMessage("SYSTEM", stopping.at_minute, f"等待至 {clock_text(stopping.at_minute)}，被事件中断。")
        )
    else:
        messages.append(DomainMessage("SYSTEM", state.current_time, "等待完成，无新事件。"))
    return True


def _do_wait_cbc(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    pending = _pending_cbc(state)
    if pending is None:
        messages.append(DomainMessage("SYSTEM", state.current_time, "没有进行中的 CBC，无需等待。"))
        return True
    stopping = _advance(state, messages, pending.due_at, stop_on_interrupt=True)
    if stopping is not None and stopping.type != "CBC_READY":
        messages.append(
            DomainMessage(
                "SYSTEM",
                stopping.at_minute,
                f"等待被 {_interrupt_label(stopping.type)} 打断（{clock_text(stopping.at_minute)}）；CBC 仍 pending。",
            )
        )
    else:
        messages.append(
            DomainMessage("SYSTEM", state.current_time, f"等待至 {clock_text(state.current_time)}，CBC 已返回。")
        )
    return True


def _do_view_cbc(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    if not state.records:
        messages.append(DomainMessage("LAB", state.current_time, "暂无可查看的已返回 CBC。"))
        return True
    rec = max(state.records, key=lambda r: r.ready_at)
    rec.revealed = True
    r = rec.result
    flag = "异常" if r["abnormal"] else "正常"
    messages.append(
        DomainMessage(
            "LAB",
            state.current_time,
            f"CBC（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}，返回 {clock_text(rec.ready_at)}）：Hb {r['hb']} g/L（{flag}），WBC {r['wbc']} ×10⁹/L，PLT {r['platelet']} ×10⁹/L。",
        )
    )
    return True


def _do_history(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    if not state.action_log:
        messages.append(DomainMessage("SYSTEM", state.current_time, "尚无动作记录。"))
        return True
    lines = ["历史动作："]
    for a in state.action_log:
        target = f" {a.action_target}" if a.action_target else ""
        lines.append(f"{clock_text(a.started_at)}→{clock_text(a.completed_at)} /{a.action_type.lower()}{target}")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_help(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    lines = [
        "可用命令：",
        "/status                查看已知状态",
        "/assess vitals         测量生命体征（2 min）",
        "/assess drain          评估引流（3 min）",
        "/order cbc             申请 CBC（3 min，15 min 返回）",
        "/monitor vitals        开启持续监护（2 min）",
        "/report doctor         向医生报告（2 min，需已有异常证据）",
        "/wait                  等待至下一个可见中断事件",
        "/wait cbc              等待最近一次 pending CBC 返回",
        "/view cbc              查看最近一次已返回 CBC",
        "/history               查看已发生动作与公开事件",
        "/pending               查看进行中的检查",
        "/help                  显示本帮助",
    ]
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_pending(state: SessionState, _target: str | None, messages: list[DomainMessage]) -> bool:
    pending = _pending_cbc(state)
    if pending is None:
        messages.append(DomainMessage("SYSTEM", state.current_time, "当前没有进行中的检查。"))
        return True
    messages.append(
        DomainMessage(
            "SYSTEM",
            state.current_time,
            f"CBC（order #{pending.id}）：采血 {clock_text(pending.sampled_at)}，预计 {clock_text(pending.due_at)} 返回。费用 ¥{pending.cost_yuan}。",
        )
    )
    return True


_HANDLERS = {
    "STATUS": _do_status,
    "ASSESS": _do_assess,
    "ORDER": _do_order_cbc,
    "MONITOR": _do_monitor,
    "REPORT": _do_report,
    "WAIT": _do_wait,
    "WAIT_CBC": _do_wait_cbc,
    "VIEW_CBC": _do_view_cbc,
    "HISTORY": _do_history,
    "HELP": _do_help,
    "PENDING": _do_pending,
}


# ── Helpers ───────────────────────────────────────────────────────────────


def _pending_cbc(state: SessionState) -> PendingTask | None:
    return next((t for t in state.pending_tasks if t.kind == "CBC" and t.status == "PROCESSING"), None)


def _has_abnormal_evidence(state: SessionState) -> bool:
    if any(r.abnormal for r in state.vitals):
        return True
    if any(r.abnormal for r in state.drain):
        return True
    if state.monitor_alert_fired or state.deteriorated:
        return True
    if any(r.revealed and r.result.get("abnormal") for r in state.records):
        return True
    return False


def _interrupt_label(etype: str) -> str:
    return {
        "MONITOR_ALERT": "监护报警",
        "SPONTANEOUS_DETERIORATION": "病情恶化",
        "CBC_READY": "CBC 返回",
        "CASE_SUCCESS": "结局",
        "CASE_FAILURE": "结局",
    }.get(etype, etype)
