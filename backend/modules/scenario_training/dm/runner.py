"""DM 运行器：受限多步循环（先读环境）→ 一次纠偏重试 → 退化为**保底回合**（学生永远看不到坏回合）。

形态（docs/21 §四）：
- **默认：受限多步循环**（`SCENARIO_DM_MAX_STEPS`，默认 3）。DM 可以先调只读工具看环境
  （`world.state` / `actor.knowledge` / `history.lastN`，外加只写自己草稿纸的 `note.write`），
  每条调用都落一条 `dm_step` 事件（教师回放可见、学生不可见）。工具协议是**提示词里的 JSON**
  （`{"tool": ..., "args": {...}}`），因此流式与非流式两条路径共用同一套循环。
- **一次响应可以带多条调用**（一行一个 JSON 对象；线上实测 2026-09-28 一次发了三条），
  按顺序执行、结果按顺序回注，**步数按条数计**（3 条 = 3 步，仍受上限约束，超出的不执行）。
- **降级：单步**。步数用尽、工具失败、输出不合法 → 退回"一次交付信封"（现有行为）。
- 重试区分两类失败（老系统的教训）：截断 → 用"压缩输出"提示重试；非法 JSON → 用错误摘要提示重试。
  两次都不成 → 用 pack 已声明的反应意图 + 可用动作拼一个**无 LLM** 的保底回合。
"""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import httpx

from core.config import SCENARIO_DM_MAX_STEPS
from core.exceptions import LLMBudgetExceeded, LLMParseError, LLMRateLimited, NoProviderAvailable
from infra.llm.client import CallContext, LLMClient
from infra.llm.profile import get_llm_config

from ..runtime.anchors import AnchorReport
from ..runtime.world import ActionRecord, World
from ..schema import ScenarioPack
from .contract import (
    ENVELOPE_KEYS,
    DMOption,
    DMToolCall,
    DMTurn,
    StepBatch,
    TurnParseError,
    TurnTruncatedError,
    parse_steps,
    parse_turn,
)
from .prompt import STEP_BUDGET_NOTE, build_dm_messages, retry_messages, step_messages, tool_reject_note
from .tools import run_tool, summarize

PURPOSE = "st_dm"
_MAX_ATTEMPTS = 2
_STEP_ARG_LIMIT = 200  # 事件里的参数摘要上限（事件不是日志转储）
# 供应商侧的任何 HTTP 失败都必须落到保底回合，而不是把 500 抛给学生（实测修正 2026-09-27）
_LLM_FAILURES = (
    NoProviderAvailable,
    LLMRateLimited,
    LLMBudgetExceeded,
    LLMParseError,
    httpx.HTTPError,
)

#: 每一步落事件用的回调（由会话层提供：写一条 `dm_step`）。异步——它要落库。
ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


def fallback_turn(pack: ScenarioPack, world: World, beats: list[dict[str, Any]]) -> DMTurn:
    """无 LLM 的保底：用 pack 已写的意图与动作清单拼一回合（不编造新内容）。"""
    intents = [str(beat.get("intent", "")).strip() for beat in beats if beat.get("intent")]
    narration = "；".join(intents) if intents else "（情境继续）"
    options = [
        DMOption(label=affordance.label, type=affordance.type, affordance_id=affordance.id)
        for affordance in pack.affordances
    ][:3]
    return DMTurn(narration=narration, options=options)


def _is_empty_envelope(turn: DMTurn) -> bool:
    """什么内容都没有的信封 = 没交付。

    实测（2026-09-28，真实 DeepSeek）：`response_format={"type":"json_object"}` 偶尔被回显成
    **整个输出**（`{"type": "json_object"}`），它能通过 `DMTurn` 校验（extra=ignore）却什么都没有；
    旧路径会把它当合法回合交给学生（空叙述）。这里把它算作一次失败，走重试/保底。
    """
    return not any(
        (
            turn.narration.strip(),
            turn.lines,
            turn.facts_declared,
            turn.notes,
            turn.effects,
            turn.reveals,
            turn.ad_hoc_cues,
            turn.options,
            turn.images,
            turn.image_request,
            turn.interpretation,
        )
    )


def _step_payload(call: DMToolCall, result: dict[str, Any], *, turn: int, step: int, ms: int) -> dict[str, Any]:
    args = {
        key: value if isinstance(value, (int, float, bool)) else str(value)[:_STEP_ARG_LIMIT]
        for key, value in call.args.items()
    }
    return {
        "turn": turn,
        "step": step,
        "tool": call.tool,
        "args": args,
        "ok": "error" not in result,
        "ms": ms,
        "result": summarize(call.tool, result)[:_STEP_ARG_LIMIT],
    }


async def _take_step(
    pack: ScenarioPack,
    world: World,
    call: DMToolCall,
    *,
    turn: int,
    step: int,
    on_step: ProgressCallback | None,
) -> tuple[str, dict[str, Any]]:
    """执行一条读工具：计时 → 执行 → 落一条 `dm_step` 事件；返回 `(工具名, 结果)` 供回注。"""
    started = time.perf_counter()
    result = run_tool(pack, world, call.tool, call.args)
    ms = int((time.perf_counter() - started) * 1000)
    if on_step is not None:
        await on_step(_step_payload(call, result, turn=turn, step=step, ms=ms))
    return call.tool, result


@dataclass(frozen=True)
class _BatchRun:
    """一批调用的执行结果：计入的步数、这批带来的问题、以及**是否读到了东西**。

    `progressed=False`（只被拒 / 预算已用尽 ⇒ 一条都没执行）时调用方不能空转：要么纠偏重试，
    要么退单步。
    """

    steps: int
    problems: tuple[str, ...] = ()
    progressed: bool = False


async def _take_batch(
    pack: ScenarioPack,
    world: World,
    batch: StepBatch,
    *,
    turn: int,
    steps: int,
    budget: int,
    on_step: ProgressCallback | None,
    messages: list[dict[str, str]],
    raw: str,
) -> _BatchRun:
    """执行一批工具调用（**步数预算按条数计**）：逐条落 `dm_step`，再把结果与说明拼回对话。

    超预算的调用**不执行**（预算就是预算）：问题照记，回注里说明"步数已用尽"；
    被拒的调用（未知工具名 / `args` 形状错）同样不执行，回注里给出原因与可用工具——
    两者都不静默吞掉：模型下一条消息必须看得到"这一步没发生、为什么"。
    """
    room = max(0, budget - steps)
    taken, skipped = batch.calls[:room], batch.calls[room:]
    results: list[tuple[str, dict[str, Any]]] = []
    for offset, call in enumerate(taken):
        results.append(await _take_step(pack, world, call, turn=turn, step=steps + offset + 1, on_step=on_step))
    problems = [f"dm_step_budget_exhausted:{call.tool}" for call in skipped]
    notes = [STEP_BUDGET_NOTE] if skipped else []
    if batch.problem is not None:
        problems.append(batch.problem)
    if batch.rejection is not None:
        notes.append(tool_reject_note(batch.rejection))
    step_messages(messages, raw, results, note="\n\n".join(notes) or None)
    return _BatchRun(steps=steps + len(taken), problems=tuple(problems), progressed=bool(results))


def _ctx(
    purpose: str,
    user_id: int,
    pack: ScenarioPack,
    world: World,
    *,
    steps: int,
    attempt: int,
    **extra: Any,
) -> CallContext:
    return CallContext(
        purpose=purpose,
        user_id=user_id,
        log_meta={
            "module": "scenario_training",
            "turn": world.turn,
            "step": steps,
            "attempt": attempt,
            "pack": pack.key,
            **extra,
        },
    )


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
    max_steps: int | None = None,
    on_step: ProgressCallback | None = None,
    anchors: AnchorReport | None = None,
) -> tuple[DMTurn, list[str]]:
    """`action=None` + `opening=True` = 开场回合：DM 先立场景，再等学生动手。

    `anchors` = 本回合的锚点状态（由调用方从事件流重算，见 `runtime/anchors.py`）。
    """
    problems: list[str] = []
    budget = SCENARIO_DM_MAX_STEPS if max_steps is None else max_steps
    messages = build_dm_messages(pack, world, action, beats, opening=opening, max_steps=budget, anchors=anchors)
    steps = 0
    attempt = 0
    while attempt < _MAX_ATTEMPTS:
        ctx = _ctx(purpose, user_id, pack, world, steps=steps, attempt=attempt + 1)
        try:
            raw = await llm.call(messages, purpose=purpose, ctx=ctx, **get_llm_config(purpose))
        except _LLM_FAILURES as exc:
            problems.append(f"dm_provider_error:{type(exc).__name__}")
            break
        batch = parse_steps(raw)
        if batch.is_step:
            taken = await _take_batch(
                pack,
                world,
                batch,
                turn=world.turn,
                steps=steps,
                budget=budget,
                on_step=on_step,
                messages=messages,
                raw=raw,
            )
            steps = taken.steps
            problems.extend(taken.problems)
            if not taken.progressed:
                # 一条都没执行（只被拒 / 预算已用尽）⇒ 这是一次"没交付"，吃重试额度
                attempt += 1
            continue  # 读了才有得说：同一回合接着决定（步数已按**条数**计入）
        try:
            turn = parse_turn(raw)
        except TurnTruncatedError as exc:
            problems.append(f"dm_truncated:{exc}")
            retry_messages(messages, problems[-1], compress=True)
            attempt += 1
            continue
        except TurnParseError as exc:
            problems.append(f"dm_parse:{str(exc)[:120]}")
            retry_messages(messages, problems[-1])
            attempt += 1
            continue
        if _is_empty_envelope(turn):
            problems.append("dm_empty_turn")
            retry_messages(messages, "上一次输出是**空的**（只有响应格式回显，没有任何内容）。请输出完整信封。")
            attempt += 1
            continue
        return turn, problems
    return fallback_turn(pack, world, beats), [*problems, "dm_fallback"]


def _scan_visible_blocks(seen: dict[str, Any], buffer: str) -> dict[str, Any]:
    """从**累积缓冲**里挑出这一批新出现的**信封字段**（工具调用的字段不属于信封，不推给前端）。"""
    from .stream import fresh_fields, scan_complete_fields

    fresh = fresh_fields(seen, scan_complete_fields(buffer))
    if not fresh:
        return {}
    seen.update(fresh)
    return {key: value for key, value in fresh.items() if key in ENVELOPE_KEYS}


@dataclass(frozen=True)
class _Round:
    """一轮流式输出的归宿：要么继续读一批（可能多条），要么交付信封，要么失败（退单步）。"""

    batch: StepBatch | None = None
    turn: DMTurn | None = None
    failure: str | None = None


def _classify_round(buffer: str) -> _Round:
    batch = parse_steps(buffer)
    if batch.is_step:
        return _Round(batch=batch)  # 执行与预算由 `_take_batch` 管（两条路径共用同一套）
    try:
        turn = parse_turn(buffer)
    except (TurnParseError, TurnTruncatedError) as exc:
        return _Round(failure=f"stream_parse:{str(exc)[:80]}")
    if _is_empty_envelope(turn):
        return _Round(failure="stream_empty_turn")
    return _Round(turn=turn)


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
    max_steps: int | None = None,
    on_step: ProgressCallback | None = None,
    anchors: AnchorReport | None = None,
):
    """**流式**跑一回合：先按块推（叙述完整就推叙述、台词完整就推台词），最后给出权威回合。

    - `{"kind": "blocks", "blocks": {...}}`：已经写完的顶层字段（前端可先渲染）；
    - `{"kind": "turn", "turn": DMTurn, "problems": [...]}`：完整回合（**由它**去校验并落地状态）。

    多步循环照跑，但**工具调用那一轮不推任何块**（它的字段不在信封里，推给前端只会是噪音）；
    流式中途失败 → 退回非流式 `run_dm`（结果与旧路径一致，绝不半途而废）。
    """
    budget = SCENARIO_DM_MAX_STEPS if max_steps is None else max_steps
    messages = build_dm_messages(pack, world, action, beats, opening=opening, max_steps=budget, anchors=anchors)
    steps = 0
    while True:
        ctx = _ctx(purpose, user_id, pack, world, steps=steps, attempt=1, stream=True)
        buffer = ""
        seen: dict[str, Any] = {}
        failure: str | None = None
        try:
            async for chunk in llm.stream(messages, purpose=purpose, ctx=ctx, **get_llm_config(purpose)):
                buffer += chunk
                visible = _scan_visible_blocks(seen, buffer)
                if visible:
                    yield {"kind": "blocks", "blocks": visible}
        except _LLM_FAILURES as exc:
            failure = f"stream_error:{type(exc).__name__}"
        else:
            outcome = _classify_round(buffer)
            if outcome.batch is not None:
                taken = await _take_batch(
                    pack,
                    world,
                    outcome.batch,
                    turn=world.turn,
                    steps=steps,
                    budget=budget,
                    on_step=on_step,
                    messages=messages,
                    raw=buffer,
                )
                steps = taken.steps
                if taken.progressed:
                    continue
                # 一条都没执行（只被拒 / 预算用尽）→ 带上原因退单步路径（它有重试与保底）
                failure = taken.problems[-1] if taken.problems else "stream_step_blocked"
            elif outcome.turn is not None:
                yield {"kind": "turn", "turn": outcome.turn, "problems": []}
                return
            else:
                failure = outcome.failure

        # 走到这里一律退**单步**（流断 / 预算用尽仍在要工具 / 输出不合法或为空）：
        # 单步路径自带重试与保底，绝不把半成品交给学生。
        turn, problems = await run_dm(
            llm,
            pack,
            world,
            action,
            beats,
            user_id=user_id,
            purpose=purpose,
            opening=opening,
            max_steps=0,
            on_step=on_step,
            anchors=anchors,
        )
        yield {"kind": "turn", "turn": turn, "problems": [*problems, failure]}
        return
