"""Clinical action handlers — the player-facing operations of the simulation.

A distinct business stage from ``engine.py`` (core state machine): these turn a
structured action into time consumption, state changes and messages. They use
the engine's event loop and shared helpers via ``from . import engine``.
"""

from . import engine
from .case import (
    ANALGESIA_PAIN_MASK,
    BUDGET_START,
    CASE_NAME,
    CASE_VERSION,
    DETERIORATION_SEVERITY,
    DURATION_MIN,
    FLUID_BP_MASK_PER_UNIT,
    LAB_KINDS,
    VITALS_MID_SEVERITY,
    clock_text,
    drain_abnormal,
    drain_output,
    lab_options_text,
    pain_abnormal,
    pain_score,
    urine_abnormal,
    urine_output,
    vitals,
    vitals_abnormal,
)
from .state import (
    ClinicalRecord,
    DomainMessage,
    DrainReading,
    PainReading,
    PendingTask,
    UrineReading,
    VitalsReading,
)

_ASSESS_TARGETS = frozenset({"vitals", "drain", "pain", "urine"})


def _do_status(state, _target, messages) -> bool:
    lines = [f"{CASE_NAME}（{CASE_VERSION}）", f"当前时间：{clock_text(state.current_time)}"]
    lines.append(f"病例状态：{state.case_status}")
    lines.append(f"剩余预算：¥{max(0, BUDGET_START - state.cost_total)}")
    if state.hidden.monitoring_enabled:
        lines.append("持续生命体征监护：已开启")
    if state.hidden.reported_to_doctor:
        lines.append("已向医生报告")
    if state.vitals:
        v = state.vitals[-1]
        lines.append(f"最近生命体征：HR {v.hr} bpm，BP {v.sbp}/{v.dbp} mmHg，RR {v.rr}，SpO2 {v.spo2}%")
    if state.drain:
        lines.append(f"最近引流：{state.drain[-1].output_ml} ml")
    if state.pain:
        lines.append(f"最近疼痛：VAS {state.pain[-1].score}/10")
    if state.urine:
        lines.append(f"最近尿量（近4h）：{state.urine[-1].output_ml} ml")
    pending = engine._all_pending(state)
    if pending:
        summary = "、".join(f"{LAB_KINDS[t.kind]['label']}(#{t.id})→{clock_text(t.due_at)}" for t in pending)
        lines.append(f"进行中检查：{summary}")
    else:
        lines.append("检查：无进行中的申请")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_assess(state, target, messages) -> bool:
    if target not in _ASSESS_TARGETS:
        messages.append(
            DomainMessage("SYSTEM", state.current_time, f"评估目标无效（{' / '.join(sorted(_ASSESS_TARGETS))}）。")
        )
        return False
    return {
        "vitals": _do_assess_vitals,
        "drain": _do_assess_drain,
        "pain": _do_assess_pain,
        "urine": _do_assess_urine,
    }[target](state, messages)


def _do_assess_vitals(state, messages) -> bool:
    completion = state.current_time + DURATION_MIN["ASSESS_VITALS"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    v = vitals(state.hidden.bleeding_severity)
    sbp = v["sbp"]
    if state.fluid_support > 0:
        sbp = min(118, sbp + FLUID_BP_MASK_PER_UNIT * state.fluid_support)  # bolus masks volume loss
    hr, dbp, rr, spo2, temp = v["hr"], v["dbp"], v["rr"], v["spo2"], v["temp"]
    abnormal = vitals_abnormal({"hr": hr, "sbp": sbp})
    state.vitals.append(VitalsReading(completion, hr, sbp, dbp, rr, spo2, temp, abnormal))
    note = "存在异常" if abnormal else "未见明显异常"
    text = (
        f"生命体征（{clock_text(completion)}）：HR {hr} bpm，BP {sbp}/{dbp} mmHg，"
        f"RR {rr}，SpO2 {spo2}%，T {temp}℃。{note}。"
    )
    if state.fluid_support > 0:
        text += "（补液支撑下血压）"
    prev = state.vitals[-2] if len(state.vitals) >= 2 else None
    if prev is not None:
        dh = hr - prev.hr
        ds = sbp - prev.sbp
        if dh or ds:
            text += (
                f" 较上次 HR {prev.hr}→{hr}（{'↑' if dh > 0 else '↓'}{abs(dh)}），"
                f"BP {prev.sbp}/{prev.dbp}→{sbp}/{dbp}。"
            )
    messages.append(DomainMessage("ASSESSMENT", completion, text))
    return True


def _do_assess_drain(state, messages) -> bool:
    completion = state.current_time + DURATION_MIN["ASSESS_DRAIN"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    output = drain_output(state.hidden.bleeding_severity)
    abnormal = drain_abnormal(output)
    state.drain.append(DrainReading(completion, output, abnormal))
    note = "引流增多，异常" if abnormal else "引流量在正常范围"
    text = f"引流评估（{clock_text(completion)}）：{output} ml。{note}。"
    prev = state.drain[-2] if len(state.drain) >= 2 else None
    if prev is not None and output != prev.output_ml:
        arrow = "↑" if output > prev.output_ml else "↓"
        text += f" 较上次 {prev.output_ml}→{output} ml（{arrow}{abs(output - prev.output_ml)}）。"
    messages.append(DomainMessage("ASSESSMENT", completion, text))
    return True


def _do_assess_pain(state, messages) -> bool:
    completion = state.current_time + DURATION_MIN["ASSESS_PAIN"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    score = pain_score(state.hidden.bleeding_severity)
    if state.analgesia:
        score = max(1, score - ANALGESIA_PAIN_MASK)
    abnormal = pain_abnormal(score)
    state.pain.append(PainReading(completion, score, abnormal))
    note = "腹痛明显，警惕" if abnormal else "疼痛可控"
    text = f"疼痛评估（{clock_text(completion)}）：VAS {score}/10 分。{note}。"
    if state.analgesia:
        text += "（已镇痛，评分可能偏低）"
    messages.append(DomainMessage("ASSESSMENT", completion, text))
    return True


def _do_assess_urine(state, messages) -> bool:
    completion = state.current_time + DURATION_MIN["ASSESS_URINE"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    output = urine_output(state.hidden.bleeding_severity)
    abnormal = urine_abnormal(output)
    state.urine.append(UrineReading(completion, output, abnormal))
    note = "尿量偏少，警惕低血容量" if abnormal else "尿量尚可"
    text = f"尿量（{clock_text(completion)}，近4h）：{output} ml。{note}。"
    prev = state.urine[-2] if len(state.urine) >= 2 else None
    if prev is not None and output != prev.output_ml:
        arrow = "↓" if output < prev.output_ml else "↑"
        text += f" 较上次 {prev.output_ml}→{output} ml（{arrow}{abs(output - prev.output_ml)}）。"
    messages.append(DomainMessage("ASSESSMENT", completion, text))
    return True


def _do_order_lab(state, target, messages) -> bool:
    kind = (target or "").upper()
    if kind not in LAB_KINDS:
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                f"未知检查：{target}。可用：{lab_options_text()}。查看进行中 /pending，预算 /status。",
            )
        )
        return False
    pending = engine._pending_task(state, kind)
    if pending is not None:
        state.repeat_while_pending = True
        messages.append(
            DomainMessage(
                "LAB",
                state.current_time,
                f"已有进行中的{LAB_KINDS[kind]['label']}（order #{pending.id}），预计 {clock_text(pending.due_at)} 返回，拒绝重复申请。",
            )
        )
        return False
    cost = LAB_KINDS[kind]["cost"]
    remaining = BUDGET_START - state.cost_total
    if cost > remaining:
        state.insufficient_funds = True
        messages.append(
            DomainMessage(
                "LAB",
                state.current_time,
                f"资金不足：{LAB_KINDS[kind]['label']} 需 ¥{cost}，当前剩余 ¥{remaining}。可用：{lab_options_text()}。",
            )
        )
        return False
    start = state.current_time
    completion = start + DURATION_MIN["ORDER_LAB"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.seq += 1
    task_id = f"{kind.lower()}-{state.seq}"
    due_at = completion + LAB_KINDS[kind]["turnaround"]
    state.pending_tasks.append(
        PendingTask(
            id=task_id,
            kind=kind,
            status="PROCESSING",
            ordered_at=start,
            sampled_at=completion,
            due_at=due_at,
            sample_snapshot={
                "severity": state.hidden.bleeding_severity,
                "minute": completion,
                "monitoring": state.hidden.monitoring_enabled,
            },
            cost_yuan=cost,
        )
    )
    engine._schedule(state, due_at, 2, "LAB_READY", {"pending_id": task_id})
    if kind == "CBC":
        state.cbc_count += 1
    state.cost_total += cost
    label = LAB_KINDS[kind]["label"]
    messages.append(
        DomainMessage(
            "LAB",
            completion,
            f"已申请{label}（order #{task_id}），采血/检查完成于 {clock_text(completion)}，预计 {clock_text(due_at)} 返回。扣费 ¥{cost}，剩余预算 ¥{BUDGET_START - state.cost_total}。",
        )
    )
    return True


def _do_view_lab(state, target, messages) -> bool:
    kind = (target or "").upper()
    if kind not in LAB_KINDS:
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                f"未知检查：{target}。可用：{lab_options_text()}。查看进行中 /pending。",
            )
        )
        return False
    recs = [r for r in state.records if r.kind == kind]
    if not recs:
        messages.append(DomainMessage("LAB", state.current_time, f"{LAB_KINDS[kind]['label']}暂无已返回结果。"))
        return True
    rec = max(recs, key=lambda r: r.ready_at)
    rec.revealed = True
    messages.append(DomainMessage("LAB", state.current_time, _lab_result_text(state, rec)))
    return True


def _lab_result_text(state, rec: ClinicalRecord) -> str:
    r = rec.result
    flag = "异常" if r["abnormal"] else "正常"
    earlier = [x for x in state.records if x.kind == rec.kind and x.sampled_at < rec.sampled_at]
    prev = max(earlier, key=lambda x: x.sampled_at) if earlier else None
    if rec.kind == "CBC":
        text = (
            f"CBC（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}，返回 {clock_text(rec.ready_at)}）："
            f"Hb {r['hb']} g/L（{flag}），WBC {r['wbc']} ×10⁹/L，PLT {r['platelet']} ×10⁹/L。"
        )
        if prev:
            d = round(r["hb"] - prev.result["hb"], 1)
            arrow = "↓" if d < 0 else ("↑" if d > 0 else "→")
            text += f" 较上次 Hb {prev.result['hb']}→{r['hb']} g/L（{arrow}{abs(d)}）。"
    elif rec.kind == "ABG":
        text = (
            f"动脉血气（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}）："
            f"pH {r['ph']}，乳酸 {r['lactate']} mmol/L（{flag}）。"
        )
        if prev:
            d = round(r["lactate"] - prev.result["lactate"], 2)
            arrow = "↓" if d < 0 else ("↑" if d > 0 else "→")
            text += f" 较上次乳酸 {prev.result['lactate']}→{r['lactate']} mmol/L（{arrow}{abs(d)}）。"
    elif rec.kind == "COAG":
        text = f"凝血功能（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}）：PT-INR {r['inr']}（{flag}）。"
    else:  # US
        finding = "腹腔可见游离液体" if r["free_fluid"] else "腹腔未见明显游离液体"
        text = f"腹部超声（order #{rec.order_id}）：{finding}（{flag}）。"
    return text


def _do_monitor(state, _target, messages) -> bool:
    if state.hidden.monitoring_enabled:
        messages.append(DomainMessage("SYSTEM", state.current_time, "持续生命体征监护已开启，无需重复开启。"))
        return False
    completion = state.current_time + DURATION_MIN["MONITOR"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.hidden.monitoring_enabled = True
    messages.append(DomainMessage("SYSTEM", completion, f"已开启持续生命体征监护（{clock_text(completion)}）。"))
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


def _do_give_fluids(state, _target, messages) -> bool:
    completion = state.current_time + DURATION_MIN["FLUIDS"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.fluid_support = min(3, state.fluid_support + 2)
    messages.append(
        DomainMessage(
            "SYSTEM",
            completion,
            f"已快速补液 500ml（{clock_text(completion)}）。血压支撑暂时改善——需明确出血来源，勿被掩盖。",
        )
    )
    return True


def _do_transfuse(state, _target, messages) -> bool:
    completion = state.current_time + DURATION_MIN["TRANSFUSE"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.transfused = True
    messages.append(
        DomainMessage(
            "SYSTEM",
            completion,
            f"已输注红细胞 2U（{clock_text(completion)}）。失血速度放缓，但仍需明确并处理出血源。",
        )
    )
    return True


def _do_analgesia(state, _target, messages) -> bool:
    completion = state.current_time + DURATION_MIN["ANALGESIA"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.analgesia = True
    messages.append(
        DomainMessage(
            "SYSTEM",
            completion,
            f"已给予镇痛（{clock_text(completion)}）。注意：可能掩盖腹痛这一早期线索。",
        )
    )
    return True


def _do_report(state, _target, messages) -> bool:
    if not engine._has_abnormal_evidence(state):
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                "没有已确认的异常证据，无法提交有效报告。请先通过评估 / 监护 / 检查获取至少一项异常证据。",
            )
        )
        return False
    completion = state.current_time + DURATION_MIN["REPORT"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    if state.case_status != engine.ACTIVE:
        messages.append(DomainMessage("SYSTEM", completion, "病情已在报告过程中终结，报告无效。"))
        return False
    state.hidden.reported_to_doctor = True
    messages.append(DomainMessage("SYSTEM", completion, f"已向医生报告病情（{clock_text(completion)}）。"))
    if state.hidden.bleeding_severity >= DETERIORATION_SEVERITY:
        state.delayed_success = True
        messages.append(
            DomainMessage(
                "WARNING",
                completion,
                "注意：报告时病情已出现明显恶化——处置及时，但发现偏晚。",
            )
        )
    engine._end_case(state, engine.SUCCESS, completion, messages)
    return True


def _do_wait(state, _target, messages) -> bool:
    until = state.current_time + engine._WAIT_HORIZON
    stopping = engine._advance(state, messages, until, stop_on_interrupt=True)
    if stopping is not None:
        messages.append(
            DomainMessage("SYSTEM", stopping.at_minute, f"等待至 {clock_text(stopping.at_minute)}，被事件中断。")
        )
    else:
        messages.append(DomainMessage("SYSTEM", state.current_time, "等待完成，无新事件。"))
    return True


def _do_wait_cbc(state, _target, messages) -> bool:
    pending = engine._pending_task(state, "CBC")
    if pending is None:
        messages.append(DomainMessage("SYSTEM", state.current_time, "没有进行中的 CBC，无需等待。"))
        return True
    stopping = engine._advance(state, messages, pending.due_at, stop_on_interrupt=True)
    if stopping is not None and stopping.type != "LAB_READY":
        messages.append(
            DomainMessage(
                "SYSTEM",
                stopping.at_minute,
                f"等待被 {engine._interrupt_label(stopping.type)} 打断（{clock_text(stopping.at_minute)}）；CBC 仍 pending。",
            )
        )
    else:
        messages.append(
            DomainMessage("SYSTEM", state.current_time, f"等待至 {clock_text(state.current_time)}，CBC 已返回。")
        )
    return True


def _do_history(state, _target, messages) -> bool:
    if not state.action_log:
        messages.append(DomainMessage("SYSTEM", state.current_time, "尚无动作记录。"))
        return True
    lines = ["历史动作："]
    for a in state.action_log:
        target = f" {a.action_target}" if a.action_target else ""
        lines.append(f"{clock_text(a.started_at)}→{clock_text(a.completed_at)} /{a.action_type.lower()}{target}")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_help(state, _target, messages) -> bool:
    lines = [
        "可用命令：",
        "/status                查看已知状态",
        "/assess vitals         测量生命体征（2 min）",
        "/assess drain          评估引流（3 min）",
        "/assess pain           疼痛评估（1 min）",
        "/assess urine          尿量评估（2 min）",
        "/order cbc|abg|coag|us 申请检查（3 min，各带周转/费用）",
        "/view cbc|abg|coag|us  查看已返回检查",
        "/monitor vitals        开启持续监护（2 min）",
        "/give fluids           快速补液（3 min，争取时间但掩盖血压）",
        "/transfuse             输注红细胞（5 min，放缓失血）",
        "/analgesia             给予镇痛（1 min，可能掩盖腹痛）",
        "/report doctor         向医生报告（2 min，需已有异常证据）",
        "/wait                  等待至下一个可见中断事件",
        "/wait cbc              等待最近一次 pending CBC 返回",
        "/history /pending /help",
    ]
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_pending(state, _target, messages) -> bool:
    pending = engine._all_pending(state)
    if not pending:
        messages.append(DomainMessage("SYSTEM", state.current_time, "当前没有进行中的检查。"))
        return True
    lines = ["进行中检查："]
    for t in pending:
        lines.append(
            f"{LAB_KINDS[t.kind]['label']}（order #{t.id}）：采血/检查 {clock_text(t.sampled_at)}，预计 {clock_text(t.due_at)} 返回。费用 ¥{t.cost_yuan}。"
        )
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


_HANDLERS = {
    "STATUS": _do_status,
    "ASSESS": _do_assess,
    "ORDER": _do_order_lab,
    "VIEW": _do_view_lab,
    "MONITOR": _do_monitor,
    "FLUIDS": _do_give_fluids,
    "TRANSFUSE": _do_transfuse,
    "ANALGESIA": _do_analgesia,
    "REPORT": _do_report,
    "WAIT": _do_wait,
    "WAIT_CBC": _do_wait_cbc,
    "HISTORY": _do_history,
    "HELP": _do_help,
    "PENDING": _do_pending,
}
