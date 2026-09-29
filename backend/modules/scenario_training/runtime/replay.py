"""教师/管理回放：把**已提交事件**摊成「解析 → 结算 → 交付」的来源回放。

只读投影，不新增真源，也不把模型的思考过程当执行证据（docs/scenario.md）：
每个回放条目都来自事件载荷里**平台自己记下**的东西（输入、解析结果、结算差量、最终交付、问题与模型调用数）。
教学关注点是逐回合重算的投影（`project_focus`），取代旧的锚点面板。
"""

from __future__ import annotations

from typing import Any, Literal

from ..api_models import (
    ScenarioAdminFocusState,
    ScenarioAdminFocusTurn,
    ScenarioAdminTurnReplay,
)
from ..schema import ScenarioPack
from ..turns import DeliveryMessage, ModelsUsed, ResolvedTurn, SceneDelivery, TurnInput
from .world import project_focus, world_from_events

_TURN_KIND = "turn_committed"
# 回合种类只有这三种（同 `ActionEcho.kind` / `TurnInput.kind`）；表里没有的输入一律降级成 action
EchoKind = Literal["speech", "action", "hint"]
_KIND_BY_ACTION_TYPE: dict[str, EchoKind] = {"say": "speech", "act": "action", "ask": "action"}
_KIND_WHITELIST: dict[str, EchoKind] = {"speech": "speech", "action": "action", "hint": "hint"}


def _delivery_of(payload: dict[str, Any]) -> SceneDelivery | None:
    messages = payload.get("messages") or []
    if not messages:
        return None
    return SceneDelivery(
        messages=[
            DeliveryMessage(
                speaker=item.get("speaker"),
                as_role=str(item.get("as_role") or ""),
                ephemeral=bool(item.get("ephemeral")),
                text=str(item.get("text") or ""),
                sources=[str(ref) for ref in item.get("sources") or []],
            )
            for item in messages
        ],
        assets=[str(item) for item in payload.get("images") or []],
    )


def _resolved_of(payload: dict[str, Any]) -> ResolvedTurn | None:
    actions = payload.get("actions") or []
    if not actions:
        return None
    from ..turns import ActionEcho, AppliedEffect, AttemptOutcome, VisibleEvent

    action = actions[0]
    try:
        outcome = AttemptOutcome(str(payload.get("outcome") or "speech"))
    except ValueError:
        outcome = AttemptOutcome.SPEECH
    return ResolvedTurn(
        request_id=str(payload.get("request_id") or ""),
        base_seq=max(0, int(payload.get("turn") or 0) - 1),
        turn=int(payload.get("turn") or 0),
        time_cost=int(payload.get("time_cost") or 0),
        outcome=outcome,
        block_reason=str(payload.get("block_reason") or ""),
        action=ActionEcho(
            # `ActionRecord.type` 是自由通道的声明（say/act/ask），`ActionEcho.kind` 是回合种类
            kind=_KIND_BY_ACTION_TYPE.get(str(action.get("type")), "action"),
            affordance_id=action.get("affordance_id"),
            label=str(action.get("text") or action.get("affordance_id") or ""),
            target=action.get("target"),
            text=str(action.get("text") or ""),
            selection=[str(item) for item in action.get("selected") or []],
            outcome=outcome,
            block_reason=str(payload.get("block_reason") or ""),
        ),
        effects=[AppliedEffect.model_validate(item) for item in payload.get("effects") or []],
        reveals=[str(item) for item in payload.get("reveals") or []],
        reactions=[str(item) for item in payload.get("reactions") or []],
        social=[AppliedEffect.model_validate(item) for item in payload.get("social") or []],
        visible_events=[VisibleEvent.model_validate(item) for item in payload.get("visible_events") or []],
        facts=[str(item) for item in payload.get("facts") or []],
        problems=[str(item) for item in payload.get("problems") or []],
    )


def _turn_input(raw: dict[str, Any]) -> TurnInput:
    """请求回声 → 回放用的输入模型（多余键忽略、`null` 文本归一成空串）。"""
    return TurnInput(
        kind=_KIND_WHITELIST.get(str(raw.get("kind") or "action"), "action"),
        target=raw.get("target"),
        affordance_id=raw.get("affordance_id"),
        selection=[str(item) for item in raw.get("selection") or []],
        text=str(raw.get("text") or ""),
    )


def admin_turns(events: list[dict[str, Any]]) -> list[ScenarioAdminTurnReplay]:
    """逐回合回放（只含已提交的业务回合；澄清与提示另外记录，不在这里冒充结算）。"""
    out: list[ScenarioAdminTurnReplay] = []
    for event in events:
        if str(event.get("kind")) != _TURN_KIND:
            continue
        payload = event.get("payload") or {}
        turn = int(payload.get("turn") or 0)
        out.append(
            ScenarioAdminTurnReplay(
                seq=int(event.get("seq") or 0),
                turn=turn,
                request_id=str(payload.get("request_id") or ""),
                kind=str((payload.get("input") or {}).get("kind") or ""),
                input=_turn_input(payload.get("input") or {}),
                intent=payload.get("intent"),
                resolved=_resolved_of(payload),
                delivery=_delivery_of(payload),
                outcome=str(payload.get("outcome") or ""),
                block_reason=payload.get("block_reason") or None,
                problems=[str(item) for item in payload.get("problems") or []],
                models=ModelsUsed.model_validate(payload.get("models") or {}),
            )
        )
    return out


def focus_turns(pack: ScenarioPack, events: list[dict[str, Any]]) -> list[ScenarioAdminFocusTurn]:
    """教学关注点的**逐回合快照**：在每个回合边界重算一次（与结算同一份判据，不另立存储）。"""
    if not pack.teaching_focus:
        return []
    turn_events: dict[int, int] = {}
    for position, event in enumerate(events):
        payload = event.get("payload") or {}
        turn = payload.get("turn")
        if turn is not None:
            turn_events.setdefault(int(turn), position)
    out: list[ScenarioAdminFocusTurn] = []
    for turn in sorted(turn_events):
        prefix = events[: turn_events[turn] + 1]
        world = world_from_events(pack, prefix)
        out.append(
            ScenarioAdminFocusTurn(
                turn=turn,
                states=[
                    ScenarioAdminFocusState(
                        id=state.id,
                        intent=state.intent,
                        relevant=state.relevant,
                        addressed=state.addressed,
                        evidence_refs=list(state.evidence_refs),
                    )
                    for state in project_focus(pack, world)
                ],
            )
        )
    final = world_from_events(pack, events)
    if not out or out[-1].turn != final.turn:
        out.append(
            ScenarioAdminFocusTurn(
                turn=final.turn,
                states=[
                    ScenarioAdminFocusState(
                        id=state.id,
                        intent=state.intent,
                        relevant=state.relevant,
                        addressed=state.addressed,
                        evidence_refs=list(state.evidence_refs),
                    )
                    for state in project_focus(pack, final)
                ],
            )
        )
    return out
