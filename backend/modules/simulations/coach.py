"""Coach hint ladder — deterministic, non-spoiling guidance.

The ladder is a pure function of what the player has ALREADY seen or done
(action_log, readings, monitor/report flags) — never of hidden severity
values. Levels escalate monotonically (``state.hint_level``); a hint is
auto-appended on level-up (engine.apply_action) and always queryable via
the /hint command. No LLM, no randomness — the same state always yields the
same hint, so tests can assert the guidance contract exactly.
"""

from .case import case_of


def opening_hint(case) -> str:
    """开局提示（L1 档）— 按病例评估面生成，不硬编码「引流/疼痛/尿量」。

    例如出血病例提示「再针对性评估引流、疼痛、尿量…」，哮喘病例则提示
    「肺部听诊、疼痛、尿量…」——避免给出病例并不存在的评估建议。
    """
    others = [label for k, label in case.surface.assessments.items() if k != "vitals"]
    tail = "、".join(others[:3])
    if len(others) > 3:
        tail += "等"
    if not tail:
        tail = "其他项目"
    return f"先评估建立基线：/assess vitals（2min）看生命体征，再针对性评估{tail}。"


def _known_evidence(state) -> bool:
    """Player-visible evidence: any abnormal reading / revealed abnormal lab /
    monitor alert / deterioration / overdose. Mirrors engine._has_abnormal_evidence
    without importing engine at module load (avoids the actions↔engine cycle)."""
    for readings in state.readings.values():
        if any(getattr(r, "abnormal", False) for r in readings):
            return True
    if state.monitor_alert_fired or state.deteriorated or state.drug_overdose:
        return True
    if any(r.revealed and r.result.get("abnormal") for r in state.records):
        return True
    return False


def coach_hint(state) -> tuple[int, str]:
    """(level, text) for the current situation — the best guidance right now.

    Level stages: 1 开篇评估 → 2 建立监护/检查方向 → 3 已有证据准备报告 →
    4 已报告/结局。The caller persists ``max(state.hint_level, level)`` and
    auto-shows the hint on level-up, so guidance appears exactly when the
    player crosses a milestone — never as spam.
    """
    case = case_of(state)
    if state.case_status != "ACTIVE":
        return 4, "病例已结束：/status 查看结算，或点「重新开始」再试一局。"

    evidence = _known_evidence(state)
    reported = state.hidden.reported_to_doctor
    # 只有「带目标的评估」才算已评估——裸 /assess（列目录）不算。
    assessed = any(a.action_type == "ASSESS" and a.action_target for a in state.action_log)
    ordered = any(a.action_type == "ORDER" for a in state.action_log)

    if reported:
        return 4, "已向医生报告。继续观察与支持治疗，用 /wait 推进时间等待结局。"
    if evidence:
        return 3, "已有关键异常证据（体征/引流/检查）。可先 /diag 写下判断，再 /report doctor 向医生报告。"
    if assessed:
        if not state.hidden.monitoring_enabled and not ordered:
            return 2, "基线已建立。建议开启持续监护（/monitor vitals）或申请血常规（/order cbc），盯住趋势。"
        if any(t.status == "PROCESSING" for t in state.pending_tasks):
            return 2, "有检查进行中：可用 /wait 或 /wait <项目> 推进时间，留意监护报警/病情恶化打断。"
        return 2, "基线已建立。可继续评估其他项目（/assess 查看），或开启监护、申请检查，观察趋势变化。"
    return 1, opening_hint(case)
