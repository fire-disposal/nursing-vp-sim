"""复盘报告：**先看事情，再看评价**（docs/23 §7.7）。

顺序固定：结局与处境 → 关键回合（你做了什么、当时有什么证据、发生了哪些已记录的变化）→
一处值得再想的决策 → 判读详情（次级区域，明确是场景规则反馈，不冒充能力判定）。

`reflection` 只由**已提交事件**推出，不读教学关注点、不读隐藏事实；没有因果证据时不声称因果。
"""

from __future__ import annotations

from typing import Any

from ..api_models import (
    ScenarioAssessment,
    ScenarioCriterion,
    ScenarioDim,
    ScenarioKeyTurn,
    ScenarioOutcome,
    ScenarioReport,
    ScenarioScore,
    ScenarioTimelineEntry,
    ScenarioView,
)
from ..judge.rules import DecisionResult, dims_snapshot, evaluate, score_report, summarize
from ..schema import ScenarioPack
from .world import World, is_lost, state_label

EVIDENCE_CUES = 3


def state_at(world: World, key: str, turn: int) -> Any:
    """某回合开始时该键的取值（历史取值与回合号并行记录，可精确定位）。"""
    turns = world.state_turns.get(key, [])
    history = world.state_history.get(key, [])
    value: Any = None
    for index, item_turn in enumerate(turns):
        if item_turn <= turn and index < len(history):
            value = history[index]
        elif item_turn > turn:
            break
    return value


def turn_changes(pack: ScenarioPack, world: World, turn: int) -> list[str]:
    """某一回合**已经记录在案**的可见变化（读数、线索、反应）。"""
    changes: list[str] = []
    for key, turns in world.state_turns.items():
        history = world.state_history.get(key, [])
        for index, item_turn in enumerate(turns):
            if item_turn != turn or index >= len(history):
                continue
            old = history[index - 1] if index else None
            changes.append(f"{state_label(pack, key)}：{old} → {history[index]}")
    for cue_id, item_turn in world.revealed_turns.items():
        if item_turn != turn:
            continue
        cue = pack.cue(cue_id)
        if cue is not None:
            changes.append(cue.text)
    for reaction_id, item_turn in world.fired_turns.items():
        if item_turn != turn:
            continue
        reaction = next((item for item in pack.reactions if item.id == reaction_id), None)
        if reaction is not None:
            changes.append(reaction.intent)
    return changes


def key_turns(pack: ScenarioPack, world: World) -> list[ScenarioKeyTurn]:
    """关键回合：动作 → 当时的证据 → 已记录的变化（全部来自已提交事件）。"""
    out: list[ScenarioKeyTurn] = []
    for action in world.actions:
        evidence = [
            text for cue_id, text in pack.cue_items(world.revealed) if world.revealed_turns.get(cue_id, 0) < action.turn
        ][-EVIDENCE_CUES:]
        for key in world.state_turns:
            if any(item_turn == action.turn for item_turn in world.state_turns[key]):
                continue
            value = state_at(world, key, action.turn - 1)
            if value is not None and key in pack.state_keys:
                evidence.append(f"{state_label(pack, key)} {value}")
        out.append(
            ScenarioKeyTurn(
                turn=action.turn,
                student=action.text or action.label(pack),
                evidence=evidence[: EVIDENCE_CUES + 4],
                changes=turn_changes(pack, world, action.turn),
            )
        )
    return out


def reflection(results: list[DecisionResult]) -> str | None:
    """只基于已记录事件的反思问题；不声称学生"导致了"什么。"""
    scored = [item for item in results if item.weight > 0]
    if not scored:
        return None
    worst = min(scored, key=lambda item: (item.score, -item.weight))
    return f"回看「{worst.title}」。这条记录是：{worst.detail}。如果重来一次，你会在哪一步换一种做法？"


def _criterion(item: dict[str, Any]) -> ScenarioCriterion:
    return ScenarioCriterion(
        id=str(item["id"]),
        title=str(item.get("title") or ""),
        anchor=item["anchor"],
        score=float(item.get("score") or 0),
        weight=float(item.get("weight") or 0),
        detail=str(item.get("detail") or ""),
        evidence=[str(entry) for entry in item.get("evidence") or []],
    )


def build_report(pack: ScenarioPack, world: World, *, view: ScenarioView) -> ScenarioReport:
    """结算报告：结局/关键回合/反思先行，分数与判读退到 `assessment`。"""
    results = evaluate(pack, world)
    raw = score_report(results)
    criteria = [_criterion(item) for item in raw["criteria"]]
    lost = is_lost(pack, world)
    return ScenarioReport(
        pack=view.pack,
        outcome=ScenarioOutcome(
            status="lost" if lost else "ended_by_student",
            reason="",
            turn=world.turn,
            lost=lost,
        ),
        key_turns=key_turns(pack, world),
        reflection=reflection(results),
        assessment=ScenarioAssessment(
            summary=summarize(results),
            score=ScenarioScore(
                rate=raw["rate"],
                weighted_sum=float(raw["weighted_sum"]),
                total_weight=float(raw["total_weight"]),
                criteria=criteria,
            ),
            criteria=criteria,
            dims=[ScenarioDim.model_validate(item) for item in dims_snapshot(pack, world)],
        ),
        timeline=list(view.timeline),
    )


def timeline_of(view: ScenarioView) -> list[ScenarioTimelineEntry]:
    return list(view.timeline)
