"""教师/管理回放：把**已提交事件**摊成「结算 → 模型循环 → 交付」的来源回放。

只读投影，不新增真源，也不把模型的思考过程当执行证据（docs/scenario.md）：
每个回放条目都来自事件载荷里**平台自己记下**的东西（输入、结算差量、每一次工具调用与它的
拒绝原因、最终交付、问题与模型调用数）。
"""

from __future__ import annotations

from typing import Any, Literal

from ..api_models import ScenarioAdminTurnReplay
from ..turns import (
    ActionEcho,
    AppliedEffect,
    AttemptOutcome,
    DeliveryMessage,
    ModelCalls,
    ResolvedTurn,
    SceneDelivery,
    ToolStep,
    TurnInput,
)

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
            )
            for item in messages
        ]
    )


def _resolved_of(payload: dict[str, Any]) -> ResolvedTurn | None:
    actions = payload.get("actions") or []
    if not actions:
        return None
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
        raw_models = payload.get("models")
        out.append(
            ScenarioAdminTurnReplay(
                seq=int(event.get("seq") or 0),
                turn=int(payload.get("turn") or 0),
                request_id=str(payload.get("request_id") or ""),
                kind=str((payload.get("input") or {}).get("kind") or ""),
                input=_turn_input(payload.get("input") or {}),
                resolved=_resolved_of(payload),
                delivery=_delivery_of(payload),
                tools=[ToolStep.model_validate(item) for item in payload.get("tools") or []],
                tool_rejections={str(k): int(v) for k, v in (payload.get("tool_rejections") or {}).items()},
                notes=[str(item) for item in payload.get("notes") or []],
                outcome=str(payload.get("outcome") or ""),
                block_reason=payload.get("block_reason") or None,
                problems=[str(item) for item in payload.get("problems") or []],
                models=ModelCalls.model_validate(raw_models) if isinstance(raw_models, dict) else None,
            )
        )
    return out


__all__ = ["admin_turns"]
