"""DM 运行器：一次调用 + 一次纠偏重试，然后**退化**（学生永远看不到坏回合）。

重试区分两类失败（老系统的教训）：
- 截断 → 用"压缩输出"提示重试；
- 非法 JSON → 用错误摘要提示重试。
两次都不成 → 用 pack 已声明的反应意图 + 可用动作拼一个**无 LLM** 的保底回合。
"""

from __future__ import annotations

from typing import Any

import httpx

from core.exceptions import LLMBudgetExceeded, LLMParseError, LLMRateLimited, NoProviderAvailable
from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_llm_config

from ..runtime.world import ActionRecord, World
from ..schema import ScenarioPack
from .contract import DMOption, DMTurn, TurnParseError, TurnTruncatedError, parse_turn
from .prompt import build_dm_messages

PURPOSE = "st_dm"
# 供应商侧的任何 HTTP 失败都必须落到保底回合，而不是把 500 抛给学生（实测修正 2026-09-27）
_LLM_FAILURES = (
    NoProviderAvailable,
    LLMRateLimited,
    LLMBudgetExceeded,
    LLMParseError,
    httpx.HTTPError,
)


def fallback_turn(pack: ScenarioPack, world: World, beats: list[dict[str, Any]]) -> DMTurn:
    """无 LLM 的保底：用 pack 已写的意图与动作清单拼一回合（不编造新内容）。"""
    intents = [str(beat.get("intent", "")).strip() for beat in beats if beat.get("intent")]
    narration = "；".join(intents) if intents else "（情境继续）"
    options = [
        DMOption(label=affordance.label, type=affordance.type, affordance_id=affordance.id)
        for affordance in pack.affordances
    ][:3]
    return DMTurn(narration=narration, options=options)


async def run_dm(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    action: ActionRecord | None,
    beats: list[dict[str, Any]],
    *,
    user_id: int,
    purpose: str = PURPOSE,
    opening: bool = False,
) -> tuple[DMTurn, list[str]]:
    """`action=None` + `opening=True` = 开场回合：DM 先立场景，再等学生动手。"""
    problems: list[str] = []
    for attempt in range(2):
        hint = problems[-1] if problems else None
        messages = build_dm_messages(
            pack,
            world,
            action,
            beats,
            problem_hint=hint,
            compress=bool(hint and hint.startswith("dm_truncated")),
            opening=opening,
        )
        ctx = CallContext(
            purpose=purpose,
            user_id=user_id,
            log_meta={"module": "scenario_training", "turn": world.turn, "attempt": attempt + 1, "pack": pack.key},
        )
        try:
            raw = await llm.call(messages, purpose=purpose, ctx=ctx, **get_llm_config(purpose))
        except _LLM_FAILURES as exc:
            problems.append(f"dm_provider_error:{type(exc).__name__}")
            break
        try:
            return parse_turn(raw), problems
        except TurnTruncatedError as exc:
            problems.append(f"dm_truncated:{exc}")
        except TurnParseError as exc:
            problems.append(f"dm_parse:{str(exc)[:120]}")
    return fallback_turn(pack, world, beats), [*problems, "dm_fallback"]


async def iter_dm_stream(
    llm: LLMClient,
    pack: ScenarioPack,
    world: World,
    action: ActionRecord | None,
    beats: list[dict[str, Any]],
    *,
    user_id: int,
    purpose: str = PURPOSE,
    opening: bool = False,
):
    """**流式**跑一回合：先按块推（叙述完整就推叙述、台词完整就推台词），最后给出权威回合。

    - `{"kind": "blocks", "blocks": {...}}`：已经写完的顶层字段（前端可先渲染）；
    - `{"kind": "turn", "turn": DMTurn, "problems": [...]}`：完整回合（**由它**去校验并落地状态）。
    流式中途失败 → 退回非流式 `run_dm`（结果与旧路径一致，绝不半途而废）。
    """
    from .stream import fresh_fields, scan_complete_fields

    messages = build_dm_messages(pack, world, action, beats, opening=opening)
    ctx = CallContext(
        purpose=purpose,
        user_id=user_id,
        log_meta={"module": "scenario_training", "turn": world.turn, "stream": True, "pack": pack.key},
    )
    buffer = ""
    seen: dict[str, Any] = {}
    try:
        async for chunk in llm.stream(messages, purpose=purpose, ctx=ctx, **get_llm_config(purpose)):
            buffer += chunk
            fresh = fresh_fields(seen, scan_complete_fields(buffer))
            if fresh:
                seen.update(fresh)
                yield {"kind": "blocks", "blocks": fresh}
    except _LLM_FAILURES as exc:
        turn, problems = await run_dm(llm, pack, world, action, beats, user_id=user_id, opening=opening)
        yield {"kind": "turn", "turn": turn, "problems": [*problems, f"stream_error:{type(exc).__name__}"]}
        return

    try:
        yield {"kind": "turn", "turn": parse_turn(buffer), "problems": []}
    except (TurnParseError, TurnTruncatedError) as exc:
        turn, problems = await run_dm(llm, pack, world, action, beats, user_id=user_id, opening=opening)
        yield {"kind": "turn", "turn": turn, "problems": [*problems, f"stream_parse:{str(exc)[:80]}"]}
