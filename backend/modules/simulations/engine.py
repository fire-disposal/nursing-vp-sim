"""Pure simulation engine core — state machine, time advance, outcomes.

No DB, no HTTP. The engine mutates a ``SessionState`` and returns structured
``DomainMessage``s; the React console / FastAPI never re-implement these rules.

Determinism: same-minute events settle by (at_minute, priority, sequence);
``sequence`` is a monotonic counter assigned at schedule time.

Player role: a clinical operator at the nurse station / doctor side. Clinical
action handlers live in ``actions.py`` (a distinct business stage); this module
owns construction, the event loop, hidden disease course, and endings.
"""

from .case import (
    BLEEDING_INTERVAL_MIN,
    CASE,
    DETERIORATION_SEVERITY,
    FAILURE_SEVERITY,
    LAB_KINDS,
    SEVERITY_START,
    SEVERITY_STEP,
    VITALS_MID_SEVERITY,
    clock_text,
    drain_abnormal,
    drain_output,
    materialize_lab,
    pain_abnormal,
    pain_score,
    urine_abnormal,
    urine_output,
    vitals,
    vitals_abnormal,
)
from .state import (
    ActionRecord,
    ClinicalRecord,
    DomainMessage,
    DrainReading,
    HiddenClinicalState,
    PainReading,
    PendingTask,
    ScheduledEvent,
    SessionState,
    UrineReading,
    VitalsReading,
)

ACTIVE = "ACTIVE"
SUCCESS = "SUCCESS"
FAILURE = "FAILURE"

# Event types that hand control back to the player when they interrupt a wait.
_INTERRUPT_TYPES = frozenset(
    {"LAB_READY", "MONITOR_ALERT", "SPONTANEOUS_DETERIORATION", "CASE_SUCCESS", "CASE_FAILURE"}
)

# Non-clinical commands allowed after the case has ended.
_NON_CLINICAL = frozenset({"STATUS", "VIEW", "HISTORY", "HELP", "PENDING", "CASE"})

# Waiting horizon — large enough to always reach the failure outcome.
_WAIT_HORIZON = 100000


# ── Construction ──────────────────────────────────────────────────────────


def new_session(case_id: str = "mvpb-1") -> SessionState:
    state = SessionState(
        hidden=HiddenClinicalState(
            bleeding_severity=SEVERITY_START,
            reported_to_doctor=False,
            monitoring_enabled=False,
        ),
        current_time=0,
        case_status=ACTIVE,
        case_id=case_id,
    )
    _seed_handover(state)
    _schedule(state, BLEEDING_INTERVAL_MIN, 0, "BLEEDING_PROGRESS", {})
    return state


def _seed_handover(state: SessionState) -> None:
    """Seed the shift handover: baseline observations the player takes over
    with. All values are normal at the starting severity, so nothing leaks the
    hidden bleeding — they give the player the case context and a trend baseline.
    """
    v = vitals(SEVERITY_START)
    state.vitals.append(
        VitalsReading(
            minute=0,
            abnormal=vitals_abnormal(v),
            hr=v["hr"],
            sbp=v["sbp"],
            dbp=v["dbp"],
            rr=v["rr"],
            spo2=v["spo2"],
            temp=v["temp"],
        )
    )
    state.drain.append(
        DrainReading(
            minute=0, abnormal=drain_abnormal(drain_output(SEVERITY_START)), output_ml=drain_output(SEVERITY_START)
        )
    )
    state.pain.append(
        PainReading(minute=0, abnormal=pain_abnormal(pain_score(SEVERITY_START)), score=pain_score(SEVERITY_START))
    )
    state.urine.append(
        UrineReading(
            minute=0,
            abnormal=urine_abnormal(urine_output(SEVERITY_START)),
            output_ml=urine_output(SEVERITY_START),
        )
    )
    state.public_log = [
        DomainMessage(
            "SYSTEM",
            0,
            f"交班：{CASE.patient}。任务：{CASE.narrative.handover_task}。输入 /help 查看命令（分级）。",
        ),
        DomainMessage(
            "ASSESSMENT",
            0,
            f"基线：HR {v['hr']} | BP {v['sbp']}/{v['dbp']} | RR {v['rr']} | SpO2 {v['spo2']}% | T {v['temp']}℃ | "
            f"引流 {state.drain[0].output_ml}ml | VAS {state.pain[0].score} | 尿量 {state.urine[0].output_ml}ml。",
        ),
    ]


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
    handler = _EVENT_HANDLERS.get(ev.type)
    if handler is not None:
        handler(state, ev, messages)


def _on_bleeding_progress(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    if state.case_status != ACTIVE or state.hidden.reported_to_doctor:
        return  # bleeding controlled — no further progression, no reschedule
    mult = 1.0
    if state.fluid_support > 0:
        mult *= CASE.course.fluid_progression_mult
        state.fluid_support -= 1  # bolus support is transient
    if state.transfused:
        mult *= CASE.course.transfuse_progression_mult  # transfusion slows but does not stop the bleed
    sev = state.hidden.bleeding_severity + SEVERITY_STEP * mult
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


def _on_lab_ready(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    task_id = ev.payload.get("pending_id")
    task = next((t for t in state.pending_tasks if t.id == task_id), None)
    if task is None or task.status != "PROCESSING":
        return
    task.status = "READY"
    previous = _latest_record_result(state, task.kind)
    result = materialize_lab(task.kind, task.sample_snapshot, previous)
    state.records.append(
        ClinicalRecord(
            order_id=task.id,
            kind=task.kind,
            sampled_at=task.sampled_at,
            ready_at=ev.at_minute,
            result=result,
            revealed=False,
        )
    )
    label = LAB_KINDS[task.kind].label
    messages.append(
        DomainMessage(
            "LAB",
            ev.at_minute,
            f"{label} 结果已返回（order #{task.id}）。使用 /view {task.kind.lower()} 查看具体数值。",
        )
    )


def _on_monitor_alert(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    v = vitals(state.hidden.bleeding_severity)
    messages.append(DomainMessage("MONITOR", ev.at_minute, CASE.narrative.monitor_alert(v)))


def _on_deterioration(state: SessionState, ev: ScheduledEvent, messages: list[DomainMessage]) -> None:
    v = vitals(state.hidden.bleeding_severity)
    messages.append(DomainMessage("CRITICAL", ev.at_minute, CASE.narrative.deterioration(v)))


_EVENT_HANDLERS = {
    "BLEEDING_PROGRESS": _on_bleeding_progress,
    "LAB_READY": _on_lab_ready,
    "MONITOR_ALERT": _on_monitor_alert,
    "SPONTANEOUS_DETERIORATION": _on_deterioration,
    "CASE_SUCCESS": lambda state, ev, messages: _end_case(state, SUCCESS, ev.at_minute, messages),
    "CASE_FAILURE": lambda state, ev, messages: _end_case(state, FAILURE, ev.at_minute, messages),
}


def _end_case(state: SessionState, status: str, minute: int, messages: list[DomainMessage]) -> None:
    if state.case_status != ACTIVE:
        return
    state.case_status = status
    state.case_ended_at = minute
    if status == FAILURE:
        messages.append(DomainMessage("CRITICAL", minute, CASE.narrative.failure()))
    else:
        messages.append(DomainMessage("SYSTEM", minute, CASE.narrative.discharge()))
    messages.append(DomainMessage("AUDIT", minute, _audit_summary(state, minute)))


def _settlement_verdict(state: SessionState) -> str:
    """Why this outcome — the explicit settlement judgment for the player."""
    if state.case_status == FAILURE:
        return CASE.narrative.verdict_failure
    if state.delayed_success:
        return CASE.narrative.verdict_delayed
    return CASE.narrative.verdict_timely


def _audit_summary(state: SessionState, minute: int) -> str:
    parts = [f"结局摘要：检查 {len(state.records)} 次，耗检查点 {state.diag_spent}，耗治疗点 {state.treat_spent}。"]
    if state.diagnosis:
        parts.append(f"你的诊断：{state.diagnosis}；")
    if state.repeat_while_pending:
        parts.append("存在 pending 时重复申请。")
    if state.insufficient_funds:
        parts.append("曾因资源不足被拒。")
    if state.consult_count:
        parts.append(f"专家会诊 {state.consult_count} 次。")
    cbc_recs = [r for r in state.records if r.kind == "CBC"]
    if len(cbc_recs) >= 2:
        latest_two = sorted(cbc_recs, key=lambda r: r.sampled_at)[-2:]
        interval = latest_two[1].sampled_at - latest_two[0].sampled_at
        hb_delta = round(latest_two[1].result["hb"] - latest_two[0].result["hb"], 1)
        parts.append(f"两次 CBC 采样间隔 {interval} 分钟，Hb 变化 {hb_delta:+g} g/L。")
    parts.append(f"病例时长 {minute} 分钟（{clock_text(minute)}）。")
    parts.append(_settlement_verdict(state))
    return " ".join(parts)


# ── Dispatch ──────────────────────────────────────────────────────────────


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


# ── Shared helpers (also used by action handlers) ─────────────────────────


def _pending_task(state: SessionState, kind: str) -> PendingTask | None:
    return next((t for t in state.pending_tasks if t.kind == kind and t.status == "PROCESSING"), None)


def _all_pending(state: SessionState) -> list[PendingTask]:
    return [t for t in state.pending_tasks if t.status == "PROCESSING"]


def _latest_record_result(state: SessionState, kind: str) -> dict | None:
    recs = [r for r in state.records if r.kind == kind]
    return max(recs, key=lambda r: r.sampled_at).result if recs else None


def _has_abnormal_evidence(state: SessionState) -> bool:
    if any(r.abnormal for r in state.vitals):
        return True
    if any(r.abnormal for r in state.drain):
        return True
    if any(r.abnormal for r in state.pain):
        return True
    if any(r.abnormal for r in state.urine):
        return True
    if state.monitor_alert_fired or state.deteriorated:
        return True
    if any(r.revealed and r.result.get("abnormal") for r in state.records):
        return True
    return False


def _interrupt_label(etype: str) -> str:
    return {
        "LAB_READY": "检查返回",
        "MONITOR_ALERT": "监护报警",
        "SPONTANEOUS_DETERIORATION": "病情恶化",
        "CASE_SUCCESS": "结局",
        "CASE_FAILURE": "结局",
    }.get(etype, etype)


_READING_SECTIONS = (
    ("生命体征", "vitals", lambda r: f"{clock_text(r.minute)} HR{r.hr} BP{r.sbp}/{r.dbp} RR{r.rr}"),
    ("引流", "drain", lambda r: f"{clock_text(r.minute)} {r.output_ml}ml"),
    ("疼痛", "pain", lambda r: f"{clock_text(r.minute)} VAS{r.score}"),
    ("尿量", "urine", lambda r: f"{clock_text(r.minute)} {r.output_ml}ml"),
)


def build_consult_summary(state: SessionState) -> str:
    """Known-information summary for the expert consultation.

    Built ONLY from what the player has observed/revealed — never from the
    hidden bleeding state, so the expert cannot leak the hidden course.
    """
    lines = [f"交班：{CASE.patient}。当前时间 {clock_text(state.current_time)}。"]
    for label, attr, fmt in _READING_SECTIONS:
        readings = getattr(state, attr)
        if readings:
            lines.append(f"{label}：" + "；".join(fmt(r) for r in readings))
    revealed = [r for r in state.records if r.revealed]
    if revealed:
        lines.append(
            "检查结果："
            + "；".join(
                f"{LAB_KINDS[r.kind].label} { {k: v for k, v in r.result.items() if k != 'sampled_severity'} }"
                for r in revealed
            )
        )
    alerts = [
        t
        for flag, t in ((state.monitor_alert_fired, "已发生监护报警"), (state.deteriorated, "病情已出现明显恶化"))
        if flag
    ]
    if alerts:
        lines.append("、".join(alerts) + "。")
    interventions = [
        label
        for flag, label in (
            (state.fluids_given, "已快速补液"),
            (state.transfused, "已输血"),
            (state.analgesia, "已镇痛"),
        )
        if flag
    ]
    if interventions:
        lines.append("干预：" + "、".join(interventions))
    if state.diagnosis:
        lines.append(f"护士判断：{state.diagnosis}")
    pending = _all_pending(state)
    if pending:
        lines.append("进行中检查：" + "、".join(LAB_KINDS[t.kind].label for t in pending))
    return "\n".join(lines)


from .actions import _HANDLERS  # handler table for the dispatch above
