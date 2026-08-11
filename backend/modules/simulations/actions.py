"""Clinical action handlers — the player-facing operations of the simulation.

A distinct business stage from ``engine.py`` (core state machine): these turn a
structured action into time consumption, state changes and messages. They use
the engine's event loop and shared helpers via ``from . import engine``.
"""

from collections.abc import Callable
from dataclasses import dataclass

from . import engine
from .case import (
    ANALGESIA_PAIN_MASK,
    CASE,
    CASES,
    CONSULT_COST,
    DETERIORATION_SEVERITY,
    DIAG_BUDGET_START,
    DURATION_MIN,
    FLUID_BP_MASK_PER_UNIT,
    INTERVENTION_COSTS,
    LAB_KINDS,
    TREAT_BUDGET_START,
    VITALS_MID_SEVERITY,
    case_options_text,
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
    Reading,
    SessionState,
    UrineReading,
    VitalsReading,
)


def _do_status(state, _target, messages) -> bool:
    lines = [f"{CASE.name}（{CASE.version}）"]
    lines.append(f"病例状态：{state.case_status}")
    lines.append(
        f"资源：检查点 {DIAG_BUDGET_START - state.diag_spent} · 治疗点 {TREAT_BUDGET_START - state.treat_spent} · 已用时 {state.current_time}min"
    )
    lines.append(f"你的诊断：{state.diagnosis or '未记录（用 /diag 写下你的判断）'}")
    evid = "已获取" if engine._has_abnormal_evidence(state) else "未获取"
    lines.append(
        f"目标清单：异常证据 {evid} · 监护 {'开启' if state.hidden.monitoring_enabled else '未开'} · 已报告 {'是' if state.hidden.reported_to_doctor else '否'}"
    )
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
        summary = "、".join(f"{LAB_KINDS[t.kind].label}(#{t.id})→{clock_text(t.due_at)}" for t in pending)
        lines.append(f"进行中检查：{summary}")
    else:
        lines.append("检查：无进行中的申请")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_assess(state, target, messages) -> bool:
    spec = _ASSESS_SPECS.get(target or "")
    if spec is None:
        messages.append(
            DomainMessage("SYSTEM", state.current_time, f"评估目标无效（{' / '.join(sorted(_ASSESS_SPECS))}）。")
        )
        return False
    return _run_assess(state, spec, getattr(state, target), messages)


def _run_assess(state, spec, history, messages) -> bool:
    """Shared skeleton for every observation: consume time, take a reading,
    record it, and describe it (with trend vs the previous one)."""
    completion = state.current_time + spec.duration_min
    engine._advance(state, messages, completion)
    state.current_time = completion
    reading = spec.build(state)
    history.append(reading)
    prev = history[-2] if len(history) >= 2 else None
    text = spec.describe(state, reading) + spec.trend(reading, prev)
    messages.append(DomainMessage("ASSESSMENT", completion, text))
    return True


# ── Observation builders / describers / trenders (one set per target) ──


def _build_vitals(state) -> VitalsReading:
    v = vitals(state.hidden.bleeding_severity)
    sbp = v["sbp"]
    if state.fluid_support > 0:
        sbp = min(118, sbp + FLUID_BP_MASK_PER_UNIT * state.fluid_support)  # bolus masks volume loss
    return VitalsReading(
        minute=state.current_time,
        abnormal=vitals_abnormal({"hr": v["hr"], "sbp": sbp}),
        hr=v["hr"],
        sbp=sbp,
        dbp=v["dbp"],
        rr=v["rr"],
        spo2=v["spo2"],
        temp=v["temp"],
    )


def _build_drain(state) -> DrainReading:
    output = drain_output(state.hidden.bleeding_severity)
    return DrainReading(minute=state.current_time, abnormal=drain_abnormal(output), output_ml=output)


def _build_pain(state) -> PainReading:
    score = pain_score(state.hidden.bleeding_severity)
    if state.analgesia:
        score = max(1, score - ANALGESIA_PAIN_MASK)
    return PainReading(minute=state.current_time, abnormal=pain_abnormal(score), score=score)


def _build_urine(state) -> UrineReading:
    output = urine_output(state.hidden.bleeding_severity)
    return UrineReading(minute=state.current_time, abnormal=urine_abnormal(output), output_ml=output)


def _describe_vitals(state, r) -> str:
    note = "存在异常" if r.abnormal else "未见明显异常"
    text = f"生命体征：HR {r.hr} bpm，BP {r.sbp}/{r.dbp} mmHg，RR {r.rr}，SpO2 {r.spo2}%，T {r.temp}℃。{note}。"
    if r.abnormal:
        text += "皮肤湿冷、脉搏细速。"
    if state.fluid_support > 0:
        text += "（补液支撑下血压）"
    return text


def _describe_drain(state, r) -> str:
    note = "引流液呈鲜红色、量增多，警惕活动性出血" if r.abnormal else "引流液淡黄清亮，量在正常范围"
    return f"引流评估：{r.output_ml} ml。{note}。"


def _describe_pain(state, r) -> str:
    note = "腹痛明显，警惕" if r.abnormal else "疼痛可控"
    text = f"疼痛评估：VAS {r.score}/10 分。{note}。"
    if state.analgesia:
        text += "（已镇痛，评分可能偏低）"
    return text


def _describe_urine(state, r) -> str:
    note = "尿量偏少，警惕低血容量" if r.abnormal else "尿量尚可"
    return f"尿量（近4h）：{r.output_ml} ml。{note}。"


def _trend_vitals(r, prev) -> str:
    if prev is None:
        return ""
    dh = r.hr - prev.hr
    ds = r.sbp - prev.sbp
    if not (dh or ds):
        return ""
    return (
        f" 较上次 HR {prev.hr}→{r.hr}（{'↑' if dh > 0 else '↓'}{abs(dh)}），BP {prev.sbp}/{prev.dbp}→{r.sbp}/{r.dbp}。"
    )


def _trend_ml(r, prev) -> str:
    if prev is None or r.output_ml == prev.output_ml:
        return ""
    arrow = "↑" if r.output_ml > prev.output_ml else "↓"
    return f" 较上次 {prev.output_ml}→{r.output_ml} ml（{arrow}{abs(r.output_ml - prev.output_ml)}）。"


def _trend_pain(r, prev) -> str:
    return ""


@dataclass(frozen=True)
class AssessSpec:
    """How one observation target behaves — composition: duration plus how to
    build the reading, describe it and compare it with the previous one."""

    label: str
    duration_min: int
    build: Callable[[SessionState], Reading]
    describe: Callable[[SessionState, Reading], str]
    trend: Callable[[Reading, Reading | None], str]


_ASSESS_SPECS: dict[str, AssessSpec] = {
    "vitals": AssessSpec("生命体征", DURATION_MIN["ASSESS_VITALS"], _build_vitals, _describe_vitals, _trend_vitals),
    "drain": AssessSpec("引流", DURATION_MIN["ASSESS_DRAIN"], _build_drain, _describe_drain, _trend_ml),
    "pain": AssessSpec("疼痛", DURATION_MIN["ASSESS_PAIN"], _build_pain, _describe_pain, _trend_pain),
    "urine": AssessSpec("尿量", DURATION_MIN["ASSESS_URINE"], _build_urine, _describe_urine, _trend_ml),
}


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
                f"已有进行中的{LAB_KINDS[kind].label}（order #{pending.id}），预计 {clock_text(pending.due_at)} 返回，拒绝重复申请。",
            )
        )
        return False
    cost = LAB_KINDS[kind].cost
    if not _check_budget(state, "diag", cost, messages, LAB_KINDS[kind].label, f"可用：{lab_options_text()}。"):
        state.insufficient_funds = True
        return False
    start = state.current_time
    completion = start + DURATION_MIN["ORDER_LAB"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.seq += 1
    task_id = f"{kind.lower()}-{state.seq}"
    due_at = completion + LAB_KINDS[kind].turnaround
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
    state.diag_spent += cost
    label = LAB_KINDS[kind].label
    messages.append(
        DomainMessage(
            "LAB",
            completion,
            f"已申请{label}（order #{task_id}），采血/检查完成于 {clock_text(completion)}，预计 {clock_text(due_at)} 返回。"
            f"扣 {cost} 检查点，剩余检查点 {DIAG_BUDGET_START - state.diag_spent}。",
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
        messages.append(DomainMessage("LAB", state.current_time, f"{LAB_KINDS[kind].label}暂无已返回结果。"))
        return True
    rec = max(recs, key=lambda r: r.ready_at)
    rec.revealed = True
    messages.append(DomainMessage("LAB", state.current_time, _lab_result_text(state, rec)))
    return True


def _earlier_record(state, rec):
    earlier = [x for x in state.records if x.kind == rec.kind and x.sampled_at < rec.sampled_at]
    return max(earlier, key=lambda x: x.sampled_at) if earlier else None


def _fmt_cbc(state, rec: ClinicalRecord) -> str:
    r = rec.result
    flag = "异常" if r["abnormal"] else "正常"
    text = (
        f"CBC（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}，返回 {clock_text(rec.ready_at)}）："
        f"Hb {r['hb']} g/L（{flag}），WBC {r['wbc']} ×10⁹/L，PLT {r['platelet']} ×10⁹/L。"
    )
    prev = _earlier_record(state, rec)
    if prev:
        d = round(r["hb"] - prev.result["hb"], 1)
        arrow = "↓" if d < 0 else ("↑" if d > 0 else "→")
        text += f" 较上次 Hb {prev.result['hb']}→{r['hb']} g/L（{arrow}{abs(d)}）。"
    return text


def _fmt_abg(state, rec: ClinicalRecord) -> str:
    r = rec.result
    flag = "异常" if r["abnormal"] else "正常"
    text = (
        f"动脉血气（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}）："
        f"pH {r['ph']}，乳酸 {r['lactate']} mmol/L（{flag}）。"
    )
    prev = _earlier_record(state, rec)
    if prev:
        d = round(r["lactate"] - prev.result["lactate"], 2)
        arrow = "↓" if d < 0 else ("↑" if d > 0 else "→")
        text += f" 较上次乳酸 {prev.result['lactate']}→{r['lactate']} mmol/L（{arrow}{abs(d)}）。"
    return text


def _fmt_coag(state, rec: ClinicalRecord) -> str:
    r = rec.result
    flag = "异常" if r["abnormal"] else "正常"
    return f"凝血功能（order #{rec.order_id}，采血 {clock_text(rec.sampled_at)}）：PT-INR {r['inr']}（{flag}）。"


def _fmt_us(state, rec: ClinicalRecord) -> str:
    r = rec.result
    flag = "异常" if r["abnormal"] else "正常"
    finding = "腹腔可见游离液体" if r["free_fluid"] else "腹腔未见明显游离液体"
    return f"腹部超声（order #{rec.order_id}）：{finding}（{flag}）。"


_LAB_FORMATTERS = {
    "CBC": _fmt_cbc,
    "ABG": _fmt_abg,
    "COAG": _fmt_coag,
    "US": _fmt_us,
}


def _lab_result_text(state, rec: ClinicalRecord) -> str:
    formatter = _LAB_FORMATTERS.get(rec.kind)
    if formatter is None:
        return f"{LAB_KINDS[rec.kind].label}（order #{rec.order_id}）：{rec.result}"
    return formatter(state, rec)


def _do_monitor(state, _target, messages) -> bool:
    if state.hidden.monitoring_enabled:
        messages.append(DomainMessage("SYSTEM", state.current_time, "持续生命体征监护已开启，无需重复开启。"))
        return False
    completion = state.current_time + DURATION_MIN["MONITOR"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.hidden.monitoring_enabled = True
    messages.append(DomainMessage("SYSTEM", completion, "已开启持续生命体征监护。"))
    if not state.monitor_alert_fired and state.hidden.bleeding_severity >= VITALS_MID_SEVERITY:
        state.monitor_alert_fired = True
        v = vitals(state.hidden.bleeding_severity)
        messages.append(
            DomainMessage(
                "MONITOR",
                completion,
                CASE.narrative.monitor_alert(v),
            )
        )
    return True


def _do_fluids(state, _target, messages) -> bool:
    return _run_intervention(state, "FLUIDS", messages)


def _do_transfuse(state, _target, messages) -> bool:
    return _run_intervention(state, "TRANSFUSE", messages)


def _do_analgesia(state, _target, messages) -> bool:
    return _run_intervention(state, "ANALGESIA", messages)


def _run_intervention(state, kind: str, messages) -> bool:
    spec = _INTERVENTIONS.get(kind)
    if spec is None:
        messages.append(
            DomainMessage(
                "SYSTEM", state.current_time, f"未知干预：{kind}。可用：{', '.join(sorted(_INTERVENTIONS))}。"
            )
        )
        return False
    if not _check_budget(state, "treat", spec.cost, messages, spec.label):
        return False
    completion = state.current_time + spec.duration_min
    engine._advance(state, messages, completion)
    state.current_time = completion
    spec.apply(state)
    state.treat_spent += spec.cost
    messages.append(
        DomainMessage(
            "SYSTEM",
            completion,
            f"已{spec.label}。{spec.followup}扣 {spec.cost} 治疗点，剩余治疗点 {TREAT_BUDGET_START - state.treat_spent}。",
        )
    )
    return True


def _apply_fluids(state) -> None:
    state.fluid_support = min(3, state.fluid_support + 2)
    state.fluids_given = True


def _apply_transfuse(state) -> None:
    state.transfused = True


def _apply_analgesia(state) -> None:
    state.analgesia = True


@dataclass(frozen=True)
class InterventionSpec:
    """One intervention as a composition: duration, its effect on the state,
    its resource cost in 治疗点 and the follow-up note. Effects buy time but
    mask a clue."""

    label: str
    duration_min: int
    cost: int
    apply: Callable[[SessionState], None]
    followup: str


_INTERVENTIONS: dict[str, InterventionSpec] = {
    "FLUIDS": InterventionSpec(
        "快速补液 500ml",
        DURATION_MIN["FLUIDS"],
        INTERVENTION_COSTS["FLUIDS"],
        _apply_fluids,
        "血压支撑暂时改善——需明确出血来源，勿被掩盖。",
    ),
    "TRANSFUSE": InterventionSpec(
        "输注红细胞 2U",
        DURATION_MIN["TRANSFUSE"],
        INTERVENTION_COSTS["TRANSFUSE"],
        _apply_transfuse,
        "失血速度放缓，但仍需明确并处理出血源。",
    ),
    "ANALGESIA": InterventionSpec(
        "给予镇痛",
        DURATION_MIN["ANALGESIA"],
        INTERVENTION_COSTS["ANALGESIA"],
        _apply_analgesia,
        "注意：可能掩盖腹痛这一早期线索。",
    ),
}


def _do_diag(state, target, messages) -> bool:
    if not target or not target.strip():
        messages.append(
            DomainMessage("SYSTEM", state.current_time, f"请写出你的判断，如 /diag {CASE.narrative.diag_hint}。")
        )
        return False
    state.diagnosis = target.strip()
    messages.append(
        DomainMessage(
            "SYSTEM",
            state.current_time,
            f"已记录你的诊断：{state.diagnosis}。继续收集证据可完善判断，报告时一并提交。",
        )
    )
    return True


def _check_budget(state, pool: str, cost: int, messages, what: str, hint: str = "") -> bool:
    """Shared resource gate over one of the two abstract pools (diag/treat).

    ``pool="diag"`` spends 检查点 (labs + consult); ``pool="treat"`` spends
    治疗点 (interventions). Returns False and reports the shortfall otherwise.
    """
    if pool == "treat":
        remaining = TREAT_BUDGET_START - state.treat_spent
        unit = "治疗点"
    else:
        remaining = DIAG_BUDGET_START - state.diag_spent
        unit = "检查点"
    if remaining >= cost:
        return True
    messages.append(
        DomainMessage(
            "SYSTEM",
            state.current_time,
            f"{unit}不足：{what}需 {cost} {unit}，当前剩余 {remaining} {unit}。{hint}",
        )
    )
    return False


def _do_consult(state, _target, messages) -> bool:
    if not _check_budget(state, "diag", CONSULT_COST, messages, "专家会诊"):
        return False
    completion = state.current_time + DURATION_MIN["CONSULT"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.diag_spent += CONSULT_COST
    state.consult_count += 1
    messages.append(
        DomainMessage(
            "SYSTEM",
            completion,
            f"专家会诊已申请（{CONSULT_COST} 检查点，{DURATION_MIN['CONSULT']}min）。专家正在基于已有信息分析…",
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
    if state.diagnosis:
        messages.append(
            DomainMessage(
                "SYSTEM",
                completion,
                f"已向医生报告病情。你的诊断：{state.diagnosis}。",
            )
        )
    else:
        messages.append(DomainMessage("SYSTEM", completion, "已向医生报告病情。"))
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
        messages.append(DomainMessage("SYSTEM", stopping.at_minute, "等待结束，被事件中断。"))
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
                f"等待被 {engine._interrupt_label(stopping.type)} 打断；CBC 仍 pending。",
            )
        )
    else:
        messages.append(DomainMessage("SYSTEM", state.current_time, "等待结束，CBC 已返回。"))
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
    topic = (_target or "").lower().strip()
    lines = _help_topic(topic) if topic else _help_overview()
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _help_overview() -> list[str]:
    return [
        "可用命令（输入 /help <命令> 查看子命令）：",
        "",
        "  信息   /status /history /pending /help",
        "  评估   /assess <目标>        (/help assess)",
        "  检查   /order <项目> /view <项目>   (/help order)",
        "  干预   /give fluids /transfuse /analgesia",
        "  处理   /monitor /report /wait /wait cbc /diag",
        "",
        f"目标：{CASE.narrative.goal}",
    ]


def _help_topic(topic: str) -> list[str]:
    if topic in ("assess", "评估"):
        return [
            "评估目标（耗时）：",
            "  /assess vitals  2min  生命体征 HR/BP/RR/SpO2/T",
            "  /assess drain   3min  引流量",
            "  /assess pain    1min  疼痛 VAS",
            "  /assess urine   2min  尿量",
        ]
    if topic in ("order", "检查"):
        return [
            "可申请检查（检查点/周转）：",
            "  /order cbc   35检查点/15min   Hb/WBC/PLT",
            "  /order abg   60检查点/10min   乳酸/pH",
            "  /order coag  50检查点/20min   PT-INR",
            "  /order us    120检查点/20min  腹部游离液",
            "同项目 pending 不可重复；受检查点(400)约束；/view <项目> 查结果。",
        ]
    if topic in ("view", "查看"):
        return [
            "查看已返回检查：",
            "  /view cbc /view abg /view coag /view us",
            "结果一次性实例化，反映采样时状态。",
        ]
    if topic in ("intervention", "干预"):
        return [
            "干预（耗治疗点 + 时间，均有取舍）：",
            "  /give fluids  30治疗点/3min   补液：掩盖血压但争取时间",
            "  /transfuse    60治疗点/5min   输血：放缓失血",
            "  /analgesia    20治疗点/1min   镇痛：可能掩盖腹痛",
            "  /consult      120检查点/2min  专家会诊：基于已有信息给建议与检查方向",
            "  /diag <判断>   记录你的诊断/推理",
        ]
    if topic in ("处理", "report", "wait"):
        return [
            "处理与等待：",
            "  /monitor vitals  2min  开启持续监护（达阈值报警）",
            "  /report doctor   2min  报告（需已有异常证据）",
            "  /wait            等待至下一可见中断事件",
            "  /wait cbc        等待最近 pending CBC",
            "  /diag <判断>     记录你的诊断/推理",
        ]
    return [f"未知主题：{topic}。输入 /help 查看命令分组。"]


def _do_case(state, target, messages) -> bool:
    if not target:
        lines = [f"当前病例：{state.case_id} {CASES[state.case_id].name}"]
        lines.append(f"可用病例：{case_options_text()}")
        lines.append("切换：/case <id>（将开启新局）")
        messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
        return True
    cid = target.strip().lower()
    if cid not in CASES:
        messages.append(DomainMessage("SYSTEM", state.current_time, f"未知病例：{cid}。可用：{case_options_text()}。"))
        return False
    messages.append(DomainMessage("SYSTEM", state.current_time, f"切换病例 {cid}（{CASES[cid].name}）将开启新局。"))
    return True


def _do_pending(state, _target, messages) -> bool:
    pending = engine._all_pending(state)
    if not pending:
        messages.append(DomainMessage("SYSTEM", state.current_time, "当前没有进行中的检查。"))
        return True
    lines = ["进行中检查："]
    for t in pending:
        lines.append(
            f"{LAB_KINDS[t.kind].label}（order #{t.id}）：采血/检查 {clock_text(t.sampled_at)}，预计 {clock_text(t.due_at)} 返回。费用 ¥{t.cost_yuan}。"
        )
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


_HANDLERS = {
    "STATUS": _do_status,
    "ASSESS": _do_assess,
    "ORDER": _do_order_lab,
    "VIEW": _do_view_lab,
    "DIAG": _do_diag,
    "MONITOR": _do_monitor,
    "CONSULT": _do_consult,
    "FLUIDS": _do_fluids,
    "TRANSFUSE": _do_transfuse,
    "ANALGESIA": _do_analgesia,
    "REPORT": _do_report,
    "WAIT": _do_wait,
    "WAIT_CBC": _do_wait_cbc,
    "HISTORY": _do_history,
    "HELP": _do_help,
    "PENDING": _do_pending,
    "CASE": _do_case,
}
