"""Server-driven action catalog — what the player may do right now.

A pure function of state + case surface. The frontend renders its whole action
panel from this structure and NEVER re-implements a rule: ``enabled`` /
``disabled_reason`` are computed here, so a disabled button always explains
itself. Nothing here reads hidden severity — every gate is derived from what
the player already knows (budget, pending, monitoring, consciousness,
evidence, case status).
"""

from .case import (
    CONSULT_COST,
    DIAG_BUDGET_START,
    DRUGS,
    DURATION_MIN,
    TREAT_BUDGET_START,
    case_of,
)


def _evidence(state) -> bool:
    from .coach import _known_evidence

    return _known_evidence(state)


def _pending(state, kind: str) -> bool:
    return any(t.kind == kind and t.status == "PROCESSING" for t in state.pending_tasks)


def _entry(**kw) -> dict:
    """One action entry with the full button contract (defaults filled)."""
    base = {
        "id": "",
        "label": "",
        "cost": None,
        "cost_label": None,
        "duration": None,
        "turnaround": None,
        "unit": None,
        "default_dose": None,
        "max_dose": None,
        "enabled": True,
        "disabled_reason": None,
    }
    base.update(kw)
    return base


def _assess_entries(case, ended: bool) -> list[dict]:
    return [
        _entry(
            id=k,
            label=label,
            duration=DURATION_MIN.get(f"ASSESS_{k.upper()}", 1),
            enabled=not ended,
            disabled_reason="病例已结束" if ended else None,
        )
        for k, label in case.surface.assessments.items()
    ]


def _order_entries(state, case, ended: bool, diag_left: int) -> list[dict]:
    entries = []
    for k, spec in case.resources.lab_kinds.items():
        reason = None
        if ended:
            reason = "病例已结束"
        elif _pending(state, k):
            reason = "已有进行中同项检查"
        elif diag_left < spec.cost:
            reason = f"检查点不足（剩余 {diag_left}）"
        entries.append(
            _entry(
                id=k,
                label=spec.label,
                cost=spec.cost,
                cost_label=f"{spec.cost}检查点",
                turnaround=spec.turnaround,
                enabled=reason is None,
                disabled_reason=reason,
            )
        )
    return entries


def _give_entries(state, case, ended: bool, treat_left: int) -> list[dict]:
    entries = []
    for k in case.surface.drugs:
        spec = DRUGS[k]
        reason = None
        if ended:
            reason = "病例已结束"
        elif treat_left < spec.cost:
            reason = f"治疗点不足（剩余 {treat_left}）"
        entries.append(
            _entry(
                id=k,
                label=spec.label,
                cost=spec.cost,
                cost_label=f"{spec.cost}治疗点",
                duration=spec.duration_min,
                unit=spec.unit,
                default_dose=spec.default_dose,
                max_dose=spec.max_dose,
                enabled=reason is None,
                disabled_reason=reason,
            )
        )
    return entries


def _talk_entries(state, case, ended: bool) -> list[dict]:
    entries = []
    for role in case.surface.talk_roles:
        reason = None
        if ended:
            reason = "病例已结束"
        elif role == "patient":
            conscious = case.physiology.consciousness(state.hidden.values, state.hidden.physio)
            if conscious < 0.3:
                reason = "患者昏迷，无法应答"
        entries.append(
            _entry(
                id=role,
                label="患者" if role == "patient" else "家属",
                enabled=reason is None,
                disabled_reason=reason,
            )
        )
    return entries


def _manage_entries(state, ended: bool, diag_left: int, evidence: bool) -> list[dict]:
    monitor_reason = "病例已结束" if ended else ("监护已开启" if state.hidden.monitoring_enabled else None)
    consult_reason = None
    if ended:
        consult_reason = "病例已结束"
    elif diag_left < CONSULT_COST:
        consult_reason = f"检查点不足（剩余 {diag_left}）"
    report_reason = "病例已结束" if ended else ("需先获得异常证据（评估/监护/检查）" if not evidence else None)
    return [
        _entry(
            id="monitor",
            label="开启持续监护",
            duration=DURATION_MIN["MONITOR"],
            enabled=monitor_reason is None,
            disabled_reason=monitor_reason,
        ),
        _entry(
            id="consult",
            label="专家会诊",
            cost=CONSULT_COST,
            cost_label=f"{CONSULT_COST}检查点",
            duration=DURATION_MIN["CONSULT"],
            enabled=consult_reason is None,
            disabled_reason=consult_reason,
        ),
        _entry(
            id="diag",
            label="记录诊断",
            enabled=not ended,
            disabled_reason="病例已结束" if ended else None,
        ),
        _entry(
            id="report",
            label="向医生报告",
            duration=DURATION_MIN["REPORT"],
            enabled=report_reason is None,
            disabled_reason=report_reason,
        ),
        _entry(
            id="wait",
            label="等待/推进时间",
            enabled=not ended,
            disabled_reason="病例已结束" if ended else None,
        ),
        _entry(id="hint", label="教练提示", enabled=True),
    ]


def build_action_catalog(state) -> dict:
    """Grouped action entries for the current snapshot moment."""
    case = case_of(state)
    ended = state.case_status != "ACTIVE"
    diag_left = DIAG_BUDGET_START - state.diag_spent
    treat_left = TREAT_BUDGET_START - state.treat_spent
    return {
        "assess": _assess_entries(case, ended),
        "order": _order_entries(state, case, ended, diag_left),
        "give": _give_entries(state, case, ended, treat_left),
        "talk": _talk_entries(state, case, ended),
        "manage": _manage_entries(state, ended, diag_left, _evidence(state)),
    }
