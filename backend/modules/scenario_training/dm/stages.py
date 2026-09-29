"""两个模型阶段的运行器（**固定阶段，不是多步循环**，docs/23 §4.1）。

- `run_intent`：自由表达 → `IntentResolution`（一个短调用；结构化动作根本不走这里）；
- `run_delivery`：结算结果 → `SceneDelivery`（没有写权限；不申请工具、不重新解释动作）；
- `run_hint`：求提示 → `SceneDelivery`（只读教学交互）。

失败口径：结构失败最多各纠正一次（错误反馈限定在该阶段）；共享预算耗尽或供应商故障
直接抛 `StageFailure`——**不重试已提交的世界动作，也不生成"情境继续"的假回合**。
"""

from __future__ import annotations

from typing import Any

import httpx

from core.exceptions import LLMBudgetExceeded, LLMParseError, LLMRateLimited, NoProviderAvailable
from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_llm_config

from ..runtime.world import World
from ..schema import ScenarioPack
from ..turns import IntentResolution, ResolvedTurn, SceneDelivery
from .contract import (
    StageError,
    parse_delivery,
    parse_intent,
    validate_delivery,
    validate_intent,
)
from .prompt import build_delivery_messages, build_intent_messages, ref_fix_hint, retry_messages

PURPOSE_INTENT = "st_intent"
PURPOSE_DELIVERY = "st_dm"
_ATTEMPTS = 2  # 结构失败最多纠正一次

_LLM_FAILURES = (
    NoProviderAvailable,
    LLMRateLimited,
    LLMBudgetExceeded,
    LLMParseError,
    httpx.HTTPError,
)


class StageFailure(RuntimeError):
    """该阶段拿不到可用输出：调用方据此返回明确失败（**不推进世界**）。"""

    def __init__(self, code: str, problems: list[str]) -> None:
        super().__init__("；".join(problems) or code)
        self.code = code
        self.problems = problems


def _ctx(purpose: str, user_id: int, pack: ScenarioPack, world: World, **extra: Any) -> CallContext:
    return CallContext(
        purpose=purpose,
        user_id=user_id,
        log_meta={"module": "scenario_training", "pack": pack.key, "turn": world.turn, **extra},
    )


async def run_intent(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    *,
    mode: str,
    text: str,
    target: dict[str, Any] | None = None,
    affordance_id: str | None = None,
    selection: list[str] | None = None,
    user_id: int,
) -> tuple[IntentResolution, list[str]]:
    """把学生的一次表达解析成 `IntentResolution`（解析阶段**不写世界**）。"""
    messages = build_intent_messages(
        pack, world, mode=mode, text=text, target=target, affordance_id=affordance_id, selection=selection
    )
    problems: list[str] = []
    for attempt in range(_ATTEMPTS):
        try:
            raw = await llm.call(
                messages,
                purpose=PURPOSE_INTENT,
                ctx=_ctx(PURPOSE_INTENT, user_id, pack, world, attempt=attempt + 1),
                **get_llm_config(PURPOSE_INTENT),
            )
        except _LLM_FAILURES as exc:
            problems.append(f"intent_provider_error:{type(exc).__name__}")
            raise StageFailure("provider_unavailable", problems) from exc
        try:
            proposed = parse_intent(raw)
        except StageError as exc:
            problems.append(str(exc)[:160])
            if attempt + 1 < _ATTEMPTS:
                retry_messages(messages, str(exc)[:160])
                continue
            raise StageFailure("intent_failed", problems) from exc
        resolved = validate_intent(pack, world, proposed, utterance=text, problems=problems)
        return resolved, problems
    raise StageFailure("intent_failed", problems)


async def run_delivery(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    *,
    request_text: str,
    request_mode: str,
    target: dict[str, Any] | None,
    resolved: ResolvedTurn,
    notice: str,
    allowed_refs: set[str],
    user_id: int,
    mode: str = "turn",
) -> tuple[SceneDelivery, list[str]]:
    """把已经结算完的处境演出来（演出阶段**没有状态写权限**）。"""
    messages = build_delivery_messages(
        pack,
        world,
        request_text=request_text,
        request_mode=request_mode,
        target=target,
        resolved=resolved,
        notice=notice,
        mode=mode,
    )
    problems: list[str] = []
    purpose = PURPOSE_DELIVERY
    for attempt in range(_ATTEMPTS):
        try:
            raw = await llm.call(
                messages,
                purpose=purpose,
                ctx=_ctx(purpose, user_id, pack, world, attempt=attempt + 1, stage=mode),
                **get_llm_config(purpose),
            )
        except _LLM_FAILURES as exc:
            problems.append(f"delivery_provider_error:{type(exc).__name__}")
            raise StageFailure("provider_unavailable", problems) from exc
        try:
            proposed = parse_delivery(raw)
            clean = validate_delivery(pack, world, proposed, allowed_refs=allowed_refs)
        except StageError as exc:
            # 越界（未知说话人/未授权引用/泄底）与空交付都是**整条拒绝**：
            # 只在这条有界纠偏里重来一次，第二次仍不合格就不提交（不"剥掉非法部分再照说"）。
            # 反馈要**能教模型照做**：引用类错误附带命名空间要求与本回合可用引用（平台说模型的方言）。
            problems.append(str(exc)[:160])
            if attempt + 1 < _ATTEMPTS:
                retry_messages(messages, ref_fix_hint(str(exc)[:160], allowed_refs)[:400])
                continue
            raise StageFailure("delivery_failed", problems) from exc
        return clean, problems
    raise StageFailure("delivery_failed", problems)


async def run_hint(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    *,
    text: str,
    allowed_refs: set[str],
    user_id: int,
) -> tuple[SceneDelivery, list[str]]:
    """求提示：只读交付路径（**不推进世界、不揭开未获准的线索**）。"""
    from ..turns import ActionEcho, AttemptOutcome, ResolvedTurn

    placeholder = ResolvedTurn(
        request_id="hint",
        base_seq=world.seq,
        turn=world.turn,
        outcome=AttemptOutcome.HINT,
        action=ActionEcho(kind="hint", label="（学生请求了一次提示）", text=text),
        visible_events=[],
    )
    return await run_delivery(
        llm,
        pack,
        world,
        request_text=text,
        request_mode="speech",
        target=None,
        resolved=placeholder,
        notice="",
        allowed_refs=allowed_refs,
        user_id=user_id,
        mode="hint",
    )
