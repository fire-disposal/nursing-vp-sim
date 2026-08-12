"""Clinical action handlers — the player-facing operations of the simulation.

A distinct business stage from ``engine.py`` (core state machine): these turn a
structured action into time consumption, state changes and messages. They use
the engine's event loop and shared helpers via ``from . import engine``.
"""

from collections.abc import Callable
from dataclasses import dataclass

from . import engine
from .case import (
    CASES,
    CONSULT_COST,
    DIAG_BUDGET_START,
    DRUGS,
    DURATION_MIN,
    TREAT_BUDGET_START,
    active_meds,
    case_of,
    case_options_text,
    clock_text,
    lab_options_text,
)


def _clock(state, minute: int) -> str:
    """模拟分钟 → 本病例起始时钟上的墙钟（分片化时间）。"""
    return clock_text(minute, case_of(state).start_clock)


from .state import (
    BreathReading,
    ClinicalRecord,
    DomainMessage,
    DrainReading,
    GlucoseReading,
    PainReading,
    PendingTask,
    Reading,
    SessionState,
    UrineReading,
    VitalsReading,
)


def _status_brief(r) -> str:
    """One-line value summary for any reading type (compact, factual)."""
    d = r.__dict__ if hasattr(r, "__dict__") else dict(r)
    pairs = [f"{k}={v}" for k, v in d.items() if k not in ("minute", "abnormal")]
    return " ".join(pairs) if pairs else "已评估"


def _do_status(state, _target, text, messages) -> bool:
    case = case_of(state)
    lines = [f"{case.name}（{case.version}）"]
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
    conscious = case.physiology.consciousness(state.hidden.values, state.hidden.physio)
    lines.append(
        f"患者意识：{'清醒' if conscious >= 0.6 else '嗜睡' if conscious >= 0.3 else '昏迷'}（{conscious:.2f}）"
    )
    meds = active_meds(state.hidden.physio)
    active = [f"{DRUGS[k].label} {m['plasma']:.1f}" for k, m in meds.items() if k in DRUGS and m["plasma"] > 0.05]
    if active:
        lines.append("体内药物：" + "、".join(active))
    for target in case.surface.assessments:
        readings = state.readings.get(target)
        if readings:
            r = readings[-1]
            lines.append(f"最近{case.surface.assessments[target]}：{_status_brief(r)}")
    pending = engine._all_pending(state)
    if pending:
        labs = case.resources.lab_kinds
        summary = "、".join(f"{labs[t.kind].label}(#{t.id})→{_clock(state, t.due_at)}" for t in pending)
        lines.append(f"进行中检查：{summary}")
    else:
        lines.append("检查：无进行中的申请")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_assess(state, target, text, messages) -> bool:
    case = case_of(state)
    available = case.surface.assessments
    if (target or "") not in available:
        messages.append(
            DomainMessage("SYSTEM", state.current_time, f"评估目标无效（{' / '.join(sorted(available))}）。")
        )
        return False
    spec = _ASSESS_SPECS[target]
    return _run_assess(state, spec, _assess_history(state, target), messages)


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


def _assess_history(state, target: str) -> list:
    """The reading list for an assessment target — from the generic container."""
    if target not in state.readings:
        state.readings[target] = []
    return state.readings[target]


# ── Observation builders / describers / trenders (one set per target) ──


def _build_vitals(state) -> VitalsReading:
    case = case_of(state)
    v = case.physiology.vitals(state.hidden.values, state.hidden.physio)
    return VitalsReading(
        minute=state.current_time,
        abnormal=case.physiology.vitals_abnormal(v),
        hr=v["hr"],
        sbp=v["sbp"],
        dbp=v["dbp"],
        rr=v["rr"],
        spo2=v["spo2"],
        temp=v["temp"],
    )


def _build_drain(state) -> DrainReading:
    case = case_of(state)
    output = case.physiology.drain(state.hidden.values)
    return DrainReading(minute=state.current_time, abnormal=case.physiology.drain_abnormal(output), output_ml=output)


def _build_pain(state) -> PainReading:
    case = case_of(state)
    score = case.physiology.pain(state.hidden.values, state.hidden.physio)  # meds mask it
    return PainReading(minute=state.current_time, abnormal=case.physiology.pain_abnormal(score), score=score)


def _build_urine(state) -> UrineReading:
    case = case_of(state)
    output = case.physiology.urine(state.hidden.values, state.hidden.physio)
    return UrineReading(minute=state.current_time, abnormal=case.physiology.urine_abnormal(output), output_ml=output)


def _describe_vitals(state, r) -> str:
    note = "存在异常" if r.abnormal else "未见明显异常"
    text = f"生命体征：HR {r.hr} bpm，BP {r.sbp}/{r.dbp} mmHg，RR {r.rr}，SpO2 {r.spo2}%，T {r.temp}℃。{note}。"
    if r.rr <= 10:
        text += "呼吸浅慢。"
    if r.spo2 <= 92:
        text += "血氧饱和度低。"
    if state.fluid_support > 0:
        text += "（补液支持中）"
    return text


def _describe_drain(state, r) -> str:
    note = "量超出正常范围" if r.abnormal else "量在正常范围"
    return f"引流评估：{r.output_ml} ml。{note}。"


def _describe_pain(state, r) -> str:
    note = "评分偏高" if r.abnormal else "评分在正常范围"
    return f"疼痛评估：VAS {r.score}/10 分。{note}。"


def _describe_urine(state, r) -> str:
    note = "低于正常范围" if r.abnormal else "在正常范围"
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


def _build_glucose(state) -> GlucoseReading:
    case = case_of(state)
    mmol = case.physiology.glucose(state.hidden.values, state.hidden.physio)
    return GlucoseReading(minute=state.current_time, abnormal=case.physiology.glucose_abnormal(mmol), mmol=mmol)


def _describe_glucose(state, r) -> str:
    note = "超出正常范围" if r.abnormal else "在正常范围"
    return f"指尖血糖：{r.mmol} mmol/L。{note}。"


def _trend_glucose(r, prev) -> str:
    if prev is None or r.mmol == prev.mmol:
        return ""
    arrow = "↑" if r.mmol > prev.mmol else "↓"
    return f" 较上次 {prev.mmol}→{r.mmol} mmol/L（{arrow}{abs(round(r.mmol - prev.mmol, 1))}）。"


def _build_breath(state) -> BreathReading:
    case = case_of(state)
    sound = case.physiology.breath(state.hidden.values, state.hidden.physio)
    return BreathReading(minute=state.current_time, abnormal=case.physiology.breath_abnormal(sound), sound=sound)


_SOUND_TEXT = {
    "clear": "双肺呼吸音清晰",
    "crackles": "双肺底可闻湿啰音",
    "wheeze": "双肺可闻哮鸣音",
    "diminished": "呼吸音减低",
}


def _describe_breath(state, r) -> str:
    text = f"肺部听诊：{_SOUND_TEXT.get(r.sound, r.sound)}。"
    return text + ("（异常）" if r.abnormal else "（正常）")


def _trend_breath(r, prev) -> str:
    if prev is None or r.sound == prev.sound:
        return ""
    return f" 较上次 {_SOUND_TEXT.get(prev.sound, prev.sound)}→{_SOUND_TEXT.get(r.sound, r.sound)}。"


_ASSESS_SPECS: dict[str, AssessSpec] = {
    "vitals": AssessSpec("生命体征", DURATION_MIN["ASSESS_VITALS"], _build_vitals, _describe_vitals, _trend_vitals),
    "drain": AssessSpec("引流", DURATION_MIN["ASSESS_DRAIN"], _build_drain, _describe_drain, _trend_ml),
    "pain": AssessSpec("疼痛", DURATION_MIN["ASSESS_PAIN"], _build_pain, _describe_pain, _trend_pain),
    "urine": AssessSpec("尿量", DURATION_MIN["ASSESS_URINE"], _build_urine, _describe_urine, _trend_ml),
    "glucose": AssessSpec("血糖", DURATION_MIN["ASSESS_GLUCOSE"], _build_glucose, _describe_glucose, _trend_glucose),
    "breath": AssessSpec("肺部听诊", DURATION_MIN["ASSESS_BREATH"], _build_breath, _describe_breath, _trend_breath),
}


def _do_order_lab(state, target, text, messages) -> bool:
    case = case_of(state)
    labs = case.resources.lab_kinds
    kind = (target or "").upper()
    if kind not in labs:
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
                f"已有进行中的{labs[kind].label}（order #{pending.id}），预计 {_clock(state, pending.due_at)} 返回，拒绝重复申请。",
            )
        )
        return False
    cost = labs[kind].cost
    if not _check_budget(state, "diag", cost, messages, labs[kind].label, f"可用：{lab_options_text()}。"):
        state.insufficient_funds = True
        return False
    start = state.current_time
    completion = start + DURATION_MIN["ORDER_LAB"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.seq += 1
    task_id = f"{kind.lower()}-{state.seq}"
    due_at = completion + labs[kind].turnaround
    state.pending_tasks.append(
        PendingTask(
            id=task_id,
            kind=kind,
            status="PROCESSING",
            ordered_at=start,
            sampled_at=completion,
            due_at=due_at,
            sample_snapshot={
                "values": dict(state.hidden.values),
                "physio": dict(state.hidden.physio),
                "case_id": state.case_id,
                "minute": completion,
                "monitoring": state.hidden.monitoring_enabled,
                "transfused": state.transfused,
            },
            cost_yuan=cost,
        )
    )
    engine._schedule(state, due_at, 2, "LAB_READY", {"pending_id": task_id})
    if kind == "CBC":
        state.cbc_count += 1
    state.diag_spent += cost
    label = labs[kind].label
    messages.append(
        DomainMessage(
            "LAB",
            completion,
            f"已申请{label}（order #{task_id}），采血/检查完成于 {_clock(state, completion)}，预计 {_clock(state, due_at)} 返回。"
            f"扣 {cost} 检查点，剩余检查点 {DIAG_BUDGET_START - state.diag_spent}。",
        )
    )
    return True


def _do_view_lab(state, target, text, messages) -> bool:
    labs = case_of(state).resources.lab_kinds
    kind = (target or "").upper()
    if kind not in labs:
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
        messages.append(DomainMessage("LAB", state.current_time, f"{labs[kind].label}暂无已返回结果。"))
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
        f"CBC（order #{rec.order_id}，采血 {_clock(state, rec.sampled_at)}，返回 {_clock(state, rec.ready_at)}）："
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
        f"动脉血气（order #{rec.order_id}，采血 {_clock(state, rec.sampled_at)}）："
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
    return f"凝血功能（order #{rec.order_id}，采血 {_clock(state, rec.sampled_at)}）：PT-INR {r['inr']}（{flag}）。"


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
        return f"{case_of(state).resources.lab_kinds[rec.kind].label}（order #{rec.order_id}）：{rec.result}"
    return formatter(state, rec)


def _do_monitor(state, _target, text, messages) -> bool:
    if state.hidden.monitoring_enabled:
        messages.append(DomainMessage("SYSTEM", state.current_time, "持续生命体征监护已开启，无需重复开启。"))
        return False
    completion = state.current_time + DURATION_MIN["MONITOR"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.hidden.monitoring_enabled = True
    messages.append(DomainMessage("SYSTEM", completion, "已开启持续生命体征监护。"))
    if (
        not state.monitor_alert_fired
        and state.hidden.values[case_of(state).course.axis] >= case_of(state).course.mid_severity
    ):
        state.monitor_alert_fired = True
        case = case_of(state)
        v = case.physiology.vitals(state.hidden.values, state.hidden.physio)
        messages.append(
            DomainMessage(
                "MONITOR",
                completion,
                case.narrative.monitor_alert(v),
            )
        )
    return True


def _parse_dose(spec, text) -> float | None:
    """Resolve dose text to a valid amount, or None if invalid/out of range."""
    if not (text and text.strip()):
        return spec.default_dose
    try:
        dose = float(text.strip())
    except ValueError:
        return None
    if dose <= 0 or dose > spec.max_dose:
        return None
    return dose


def _drug_catalog_text(case) -> str:
    """分类名录：/give 无目标或 ? 时打印，按类别分组，不评价疗效/风险."""
    by_cat: dict[str, list[str]] = {}
    for key in sorted(case.surface.drugs):
        spec = DRUGS[key]
        by_cat.setdefault(spec.category, []).append(
            f"{key}（{spec.default_dose:.0f}{spec.unit}，上限 {spec.max_dose:.0f}{spec.unit}）"
        )
    lines = ["可用药物（按类别）："]
    for cat, items in by_cat.items():
        lines.append(f"  {cat}：" + "  ".join(items))
    lines.append("用法：/give <药物> [剂量]")
    return "\n".join(lines)


def _do_give(state, target, text, messages) -> bool:
    """给药：/give <药物> [剂量]。无目标/`?` 时打印分类名录。

    Pharmacokinetics: each dose raises plasma concentration (effects scale
    with it), which decays by the drug's half-life. Cumulative dose drives
    overdose — effects and risks are discoverable via assessment, not told.
    """
    case = case_of(state)
    key = (target or "").upper()
    if not key or key == "?":
        messages.append(DomainMessage("SYSTEM", state.current_time, _drug_catalog_text(case)))
        return True
    if key not in case.surface.drugs:
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                f"未知药物：{target}。输入 /give 查看分类名录。",
            )
        )
        return False
    spec = DRUGS[key]
    if not _check_budget(state, "treat", spec.cost, messages, spec.label):
        return False

    dose = _parse_dose(spec, text)
    if dose is None:
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                f"剂量无效：{text}。默认 {spec.default_dose:.0f}{spec.unit}，上限 {spec.max_dose:.0f}{spec.unit}。",
            )
        )
        return False

    completion = state.current_time + spec.duration_min
    engine._advance(state, messages, completion)
    state.current_time = completion
    state.treat_spent += spec.cost

    # Pharmacokinetics: raise plasma by dose units (1 default dose = 1 unit).
    meds = state.hidden.physio.setdefault("meds", {})
    med = meds.setdefault(key, {"plasma": 0.0, "cumulative": 0.0, "doses": 0})
    units = dose / spec.default_dose
    med["plasma"] += units
    med["cumulative"] += dose
    med["doses"] += 1

    _apply_drug_effects(state, key, spec, units)
    _maybe_schedule_overdose(state, key, spec, med, completion)

    messages.append(
        DomainMessage(
            "SYSTEM",
            completion,
            f"已给予{spec.label} {dose:.0f}{spec.unit}。扣 {spec.cost} 治疗点，"
            f"剩余治疗点 {TREAT_BUDGET_START - state.treat_spent}。",
        )
    )
    return True


def _apply_drug_effects(state, key: str, spec, units: float) -> None:
    """Direct compartment effects (fluids expand volume, transfusion raises Hb,
    diuretics remove volume, vasopressors add resistance)."""
    if spec.vol_per_dose:
        state.hidden.physio["vol"] = min(1.05, state.hidden.physio["vol"] + spec.vol_per_dose * units)
    if spec.hb_per_dose:
        state.hidden.physio["hb"] = min(200.0, state.hidden.physio["hb"] + spec.hb_per_dose * units)
    if spec.vol_drain:
        state.hidden.physio["vol"] = max(0.4, state.hidden.physio["vol"] - spec.vol_drain * units)
    if spec.svr_gain:
        state.hidden.physio["svr"] = min(1.5, state.hidden.physio["svr"] + spec.svr_gain * units)
    # Legacy flags the course progression engine still reads.
    if key == "FLUIDS":
        state.fluid_support = min(3, state.fluid_support + 2)
        state.fluids_given = True
    if key == "TRANSFUSE":
        state.transfused = True
    if key == "MORPHINE":
        state.analgesia = True


def _maybe_schedule_overdose(state, key: str, spec, med: dict, completion: int) -> None:
    """Overdose: cumulative dose beyond the toxicity threshold is an event."""
    if spec.toxicity_threshold < 1e9 and med["cumulative"] >= spec.toxicity_threshold and not state.drug_overdose:
        state.drug_overdose = True
        engine._schedule(state, completion + case_of(state).course.interval_min, 1, "DRUG_ADVERSE", {"drug": key})


def _do_talk(state, target, text, messages) -> bool:
    """与患者或家属对话：LLM 扮演对应角色，仅基于已知观察作答。

    The engine consumes the time and records the player's line; the actual
    persona reply is produced at the LLM boundary (service._run_talk), so the
    engine stays pure and deterministic. An unconscious patient cannot talk —
    a real consequence of hypoperfusion or opioid overdose.
    """
    case = case_of(state)
    who = (target or "").lower().strip()
    if who not in case.surface.talk_roles:
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                "对话对象无效（patient=患者 / family=家属）。用法：/talk patient 你现在感觉怎么样？",
            )
        )
        return False
    line = (text or "").strip()
    if not line:
        messages.append(
            DomainMessage(
                "SYSTEM",
                state.current_time,
                f"请说出你想问{'患者' if who == 'patient' else '家属'}的话，如 /talk {who} 你现在感觉怎么样？",
            )
        )
        return False
    if who == "patient":
        conscious = case.physiology.consciousness(state.hidden.values, state.hidden.physio)
        if conscious < 0.3:
            messages.append(
                DomainMessage(
                    "SYSTEM",
                    state.current_time,
                    "患者昏迷，无法应答。检查意识状态并处理病因（低灌注/缺氧/药物过量）。",
                )
            )
            return False
        if conscious < 0.6:
            messages.append(
                DomainMessage(
                    "SYSTEM",
                    state.current_time,
                    "患者嗜睡，应答迟缓，信息可能不可靠。",
                )
            )
    completion = state.current_time + DURATION_MIN["TALK"]
    engine._advance(state, messages, completion)
    state.current_time = completion
    role = "患者" if who == "patient" else "家属"
    messages.append(DomainMessage("TALK", completion, f"你（对{role}说）：{line}"))
    return True


def _do_diag(state, target, text, messages) -> bool:
    if not target or not target.strip():
        messages.append(DomainMessage("SYSTEM", state.current_time, "请写出你的判断：/diag <你的判断>。"))
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


def _do_consult(state, _target, text, messages) -> bool:
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


def _do_report(state, _target, text, messages) -> bool:
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
    if state.hidden.values[case_of(state).course.axis] >= case_of(state).course.deterioration_severity:
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


def _do_wait(state, target, text, messages) -> bool:
    """等待至下一可见中断事件；带目标（lab kind）时只等到该检查返回。

    Generic: any pending lab kind is a valid target, not just CBC.
    """
    kind = (target or "").upper().strip()
    if kind:
        case = case_of(state)
        if kind not in case.resources.lab_kinds:
            messages.append(
                DomainMessage(
                    "SYSTEM",
                    state.current_time,
                    f"未知检查：{target}。可用：{', '.join(sorted(case.resources.lab_kinds))}。",
                )
            )
            return False
        pending = engine._pending_task(state, kind)
        if pending is None:
            messages.append(DomainMessage("SYSTEM", state.current_time, f"没有进行中的 {kind}，无需等待。"))
            return True
        until = pending.due_at
    else:
        until = state.current_time + engine._WAIT_HORIZON
    stopping = engine._advance(state, messages, until, stop_on_interrupt=True)
    if stopping is not None:
        messages.append(
            DomainMessage(
                "SYSTEM",
                stopping.at_minute,
                f"等待被 {engine._interrupt_label(stopping.type)} 打断" + (f"；{kind} 仍 pending。" if kind else "。"),
            )
        )
    elif kind:
        messages.append(DomainMessage("SYSTEM", state.current_time, f"等待结束，{kind} 已返回。"))
    else:
        messages.append(DomainMessage("SYSTEM", state.current_time, "等待完成，无新事件。"))
    return True


def _do_history(state, _target, text, messages) -> bool:
    if not state.action_log:
        messages.append(DomainMessage("SYSTEM", state.current_time, "尚无动作记录。"))
        return True
    lines = ["历史动作："]
    for a in state.action_log:
        target = f" {a.action_target}" if a.action_target else ""
        lines.append(f"{_clock(state, a.started_at)}→{_clock(state, a.completed_at)} /{a.action_type.lower()}{target}")
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _do_help(state, _target, text, messages) -> bool:
    topic = (_target or "").lower().strip()
    lines = _help_topic(state, topic) if topic else _help_overview(state)
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


def _help_overview(state) -> list[str]:
    case = case_of(state)
    return [
        "可用命令（输入 /help <命令> 查看子命令）：",
        "",
        "  信息   /status /history /pending /help",
        f"  评估   /assess <{'|'.join(case.surface.assessments)}>   (/help assess)",
        "  检查   /order <项目> /view <项目>   (/help order)",
        f"  给药   /give <{'|'.join(case.surface.drugs)}> [剂量]   (/help give)",
        f"  对话   /talk <{'|'.join(case.surface.talk_roles)}> <你说的话>   (/help talk)",
        "  处理   /monitor /report /wait [检查] /diag",
        "",
        f"目标：{case.narrative.goal}",
    ]


def _help_topic(state, topic: str) -> list[str]:
    case = case_of(state)
    if topic in ("assess", "评估"):
        return [
            "评估目标（耗时）：",
            *[
                f"  /assess {k}  {DURATION_MIN.get(f'ASSESS_{k.upper()}', '?')}min  {v}"
                for k, v in case.surface.assessments.items()
            ],
        ]
    if topic in ("order", "检查"):
        labs = case.resources.lab_kinds
        return [
            "可申请检查（检查点/周转）：",
            *[f"  /order {k}   {s.cost}检查点/{s.turnaround}min  {s.label}" for k, s in sorted(labs.items())],
            "同项目 pending 不可重复；受检查点(400)约束；/view <项目> 查结果。",
        ]
    if topic in ("view", "查看"):
        labs = case.resources.lab_kinds
        return [
            "查看已返回检查：",
            "  " + " /view ".join(["", *sorted(labs)]),
            "结果一次性实例化，反映采样时状态。",
        ]
    if topic in ("give", "给药", "intervention", "干预"):
        return [
            "给药（/give <药物> [剂量]，/give 查看分类名录）：",
            *[
                f"  /give {k} [{DRUGS[k].default_dose:.0f}{DRUGS[k].unit}]  {DRUGS[k].cost}治疗点/{DRUGS[k].duration_min}min"
                for k in sorted(case.surface.drugs)
            ],
            "  /consult      120检查点/2min  专家会诊（基于已有信息）",
            "  /diag <判断>   记录你的诊断/推理",
        ]
    if topic in ("talk", "对话"):
        return [
            "与患者/家属对话（2min/次，仅基于已知观察，不泄露隐藏病程）：",
            *[f"  /talk {role}  与{role}交谈" for role in case.surface.talk_roles],
            "对话用于采集主诉/背景信息，帮助形成判断；不能替代评估与检查证据。",
        ]
    if topic in ("处理", "report", "wait"):
        return [
            "处理与等待：",
            "  /monitor vitals  2min  开启持续监护（达阈值报警）",
            "  /report doctor   2min  报告（需已有异常证据）",
            "  /wait            等待至下一可见中断事件",
            "  /wait <检查>     等待指定检查返回（如 /wait cbc）",
            "  /diag <判断>     记录你的诊断/推理",
        ]
    return [f"未知主题：{topic}。输入 /help 查看命令分组。"]


def _do_case(state, target, text, messages) -> bool:
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


def _do_pending(state, _target, text, messages) -> bool:
    pending = engine._all_pending(state)
    if not pending:
        messages.append(DomainMessage("SYSTEM", state.current_time, "当前没有进行中的检查。"))
        return True
    lines = ["进行中检查："]
    for t in pending:
        labs = case_of(state).resources.lab_kinds
        lines.append(
            f"{labs[t.kind].label}（order #{t.id}）：采血/检查 {_clock(state, t.sampled_at)}，预计 {_clock(state, t.due_at)} 返回。费用 ¥{t.cost_yuan}。"
        )
    messages.append(DomainMessage("SYSTEM", state.current_time, "\n".join(lines)))
    return True


_HANDLERS = {
    "STATUS": _do_status,
    "ASSESS": _do_assess,
    "ORDER": _do_order_lab,
    "VIEW": _do_view_lab,
    "DIAG": _do_diag,
    "TALK": _do_talk,
    "MONITOR": _do_monitor,
    "CONSULT": _do_consult,
    "GIVE": _do_give,
    "REPORT": _do_report,
    "WAIT": _do_wait,
    "HISTORY": _do_history,
    "HELP": _do_help,
    "PENDING": _do_pending,
    "CASE": _do_case,
}
