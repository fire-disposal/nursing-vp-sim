"""会话：**唯一回合管线**（确定性结算 → 模型循环 → 原子提交）+ 开启 / 澄清 / 求提示 / 结束 / 结果查询。

四条纪律（docs/scenario.md）：
1. **固定顺序**：`check_request` → 平台结算 → 模型循环（工具逐条校验） → 原子提交；
   按钮与自由表达走同一条路；
2. **事务只包提交**：模型等待期间**不持有数据库事务**——读完立刻 `rollback()` 结束隐式事务，
   此后只使用纯值（id / 序号 / World 快照），绝不触碰已过期 ORM 实例的属性；
3. **原子提交**：一个业务回合只追加**一条**事件（工具调用逐条记在那条事件的载荷里）；
   提交时锁会话行、复核 `request_id` 幂等与 `expected_seq` 基线；失败不推进、不留半个世界；
4. **循环没交付就不提交**：步数上限用完仍未 `deliver` → 结构化失败（`internal_error`，不可重试）。
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from core.unit_of_work import unit_of_work
from infra.llm.client import LLMClient
from models.scenario_training import StEvent, StSession, StSessionRequest

from ..api_models import (
    ScenarioCloseResponse,
    ScenarioErrorInfo,
    ScenarioRequestLookup,
    ScenarioTurnRequest,
    ScenarioTurnResult,
)
from ..dm.agent import AgentFailure, AgentOutcome, notice_for, run_agent
from ..judge.rules import dims_snapshot
from ..schema import ScenarioPack
from ..turns import (
    AttemptOutcome,
    ModelCalls,
    ResolvedTurn,
    TurnPhase,
)
from ..turns import (
    TurnInput as TurnInputModel,
)
from .report import build_report
from .view import build_view
from .world import (
    TurnRejected,
    World,
    attach_clarification,
    attach_delivery,
    attach_hint,
    initial_world,
    is_lost,
    settle_turn,
    world_from_events,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session as OrmSession

KIND_OPENED = "session_opened"
KIND_TURN = "turn_committed"
KIND_CLARIFY = "clarification_exchange"
KIND_HINT = "hint_requested"
KIND_CLOSED = "session_closed"

EVENT_SCHEMA_VERSION = 1
_MESSAGE_ID = re.compile(r"^m(\d+)[a-z]")


class SessionClosed(RuntimeError):
    """会话已结束，不能再提交动作。"""


class SeqConflict(RuntimeError):
    """`expected_seq` 过期：客户端拿的是旧世界。"""

    def __init__(self, current_seq: int) -> None:
        super().__init__(f"expected_seq 过期（当前 {current_seq}）")
        self.current_seq = current_seq


class RequestConflict(RuntimeError):
    """同一个 `request_id` 被用于不同输入。"""


@dataclass
class TurnHooks:
    """传输层（SSE）观察点：**只观察，不参与结算**（HTTP 与 SSE 共用同一执行器）。"""

    on_phase: Any = None  # Callable[[str], Awaitable[None]]


@dataclass
class _Live:
    state: str  # in_flight | failed
    error: ScenarioErrorInfo | None = None


#: 进程内的在途/失败档案（**不是真源**：真源只有已提交的请求行；别的 worker 看不到这里）
_LIVE: dict[tuple[int, str], _Live] = {}
_LIVE_MAX = 512


def _live_set(session_id: int, request_id: str, entry: _Live) -> None:
    if len(_LIVE) >= _LIVE_MAX:
        _LIVE.pop(next(iter(_LIVE)))
    _LIVE[(session_id, request_id)] = entry


def _live_drop(session_id: int, request_id: str) -> None:
    _LIVE.pop((session_id, request_id), None)


def _live_get(session_id: int, request_id: str) -> _Live | None:
    return _LIVE.get((session_id, request_id))


def reset_live_registry() -> None:
    """测试用：清空在途档案（进程内，随时可丢）。"""
    _LIVE.clear()


# --------------------------------------------------------------------------- #
# 事件与读取
# --------------------------------------------------------------------------- #


def append_event(db: OrmSession, session_id: int, kind: str, payload: dict[str, Any]) -> StEvent:
    current = db.execute(select(func.max(StEvent.seq)).where(StEvent.session_id == session_id)).scalar()
    event = StEvent(session_id=session_id, seq=int(current or 0) + 1, kind=kind, payload=payload)
    db.add(event)
    db.flush()
    return event


def load_events(db: OrmSession, session_id: int) -> list[dict[str, Any]]:
    rows = db.execute(select(StEvent).where(StEvent.session_id == session_id).order_by(StEvent.seq)).scalars().all()
    return [{"seq": row.seq, "kind": row.kind, "payload": row.payload} for row in rows]


def current_seq(db: OrmSession, session_id: int) -> int:
    value = db.execute(select(func.max(StEvent.seq)).where(StEvent.session_id == session_id)).scalar()
    return int(value or 0)


def replay(db: OrmSession, session_id: int, pack: ScenarioPack) -> World:
    return world_from_events(pack, load_events(db, session_id))


def session_meta(session: StSession) -> dict[str, Any]:
    return dict(session.meta or {})


# --------------------------------------------------------------------------- #
# 幂等 / 冲突 / 提交
# --------------------------------------------------------------------------- #


def input_sha(request: ScenarioTurnRequest | Any) -> str:
    """请求的**输入身份**（不含 `request_id` 与 `expected_seq`）：同 id 同输入才幂等复用。"""
    payload = request.model_dump(mode="json") if hasattr(request, "model_dump") else dict(request)
    payload.pop("request_id", None)
    payload.pop("expected_seq", None)
    blob = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def find_request(db: OrmSession, session_id: int, request_id: str) -> StSessionRequest | None:
    return db.execute(
        select(StSessionRequest).where(
            StSessionRequest.session_id == session_id, StSessionRequest.request_id == request_id
        )
    ).scalar_one_or_none()


def _stored_turn(row: StSessionRequest) -> ScenarioTurnResult | None:
    return ScenarioTurnResult.model_validate(row.result) if row.kind == "turn" and row.result else None


def _stored_close(row: StSessionRequest) -> ScenarioCloseResponse | None:
    return ScenarioCloseResponse.model_validate(row.result) if row.kind == "close" and row.result else None


class _CommittedElsewhere(Exception):
    """提交时发现同 id 已在别处提交（并发同请求）——用已存结果作答。"""

    def __init__(self, row: StSessionRequest) -> None:
        super().__init__("already committed")
        self.row = row


def _lock_session(db: OrmSession, session_id: int) -> StSession:
    return db.execute(
        select(StSession).where(StSession.id == session_id).with_for_update().execution_options(populate_existing=True)
    ).scalar_one()


def _check_request_row(
    db: OrmSession, session_id: int, request_id: str, input_sha_value: str
) -> StSessionRequest | None:
    """提交边界上的幂等复核：同 id 同输入 → 复用；同 id 不同输入 → 拒绝。"""
    row = db.execute(
        select(StSessionRequest)
        .where(StSessionRequest.session_id == session_id, StSessionRequest.request_id == request_id)
        .with_for_update()
    ).scalar_one_or_none()
    if row is None:
        return None
    if row.input_sha != input_sha_value:
        raise RequestConflict(request_id)
    return row


def _commit_event(
    db: OrmSession,
    *,
    session_id: int,
    request_id: str,
    kind: str,
    kind_label: str,
    input_sha_value: str,
    expected_seq: int,
    payload: dict[str, Any],
    result: dict[str, Any],
) -> int:
    """短事务：锁会话行 → 复核幂等 → 复核基线 → 追加一条事件 + 写请求行。"""
    with unit_of_work(db, conflict_detail="提交失败"):
        _lock_session(db, session_id)
        existing = _check_request_row(db, session_id, request_id, input_sha_value)
        if existing is not None:
            raise _CommittedElsewhere(existing)
        base = current_seq(db, session_id)
        if base != expected_seq:
            raise SeqConflict(base)
        db.add(StEvent(session_id=session_id, seq=base + 1, kind=kind, payload=payload))
        db.add(
            StSessionRequest(
                session_id=session_id,
                request_id=request_id,
                kind=kind_label,
                input_sha=input_sha_value,
                seq=base + 1,
                result=result,
            )
        )
        db.flush()
        return base + 1


# --------------------------------------------------------------------------- #
# 载荷装配
# --------------------------------------------------------------------------- #


def _message_payload(message: Any) -> dict[str, Any]:
    return {
        "speaker": message.speaker,
        "as_role": message.as_role,
        "ephemeral": message.ephemeral,
        "text": message.text,
        "sources": [],
        "kind": "narration" if message.speaker is None else "speech",
        "origin": "dm",
    }


def _image_payload(asset_id: str) -> dict[str, Any]:
    return {"asset_id": asset_id, "caption": "", "origin": "pack"}


def _agent_payload(outcome: AgentOutcome) -> dict[str, Any]:
    """模型侧产物进事件载荷的那部分（步骤账 + 拒绝计数 + 备忘 + 时间推进）。"""
    return {
        **outcome.payload(),
        "notes": list(outcome.tools.notes),
        "presented": list(outcome.tools.presented),
    }


def _actions_of(world: World, resolved: ResolvedTurn) -> list[dict[str, Any]]:
    """本回合学生做的那件事（**已含世界答复**）；未建模也照记（判读要看得见它）。"""
    if not world.actions:
        return []
    record = world.actions[-1]
    payload = asdict(record)
    payload["turn"] = resolved.turn
    return [payload]


async def create_session(
    db: OrmSession,
    *,
    user_id: int,
    pack_key: str,
    pack_version: int,
    content: dict[str, Any],
    pack: ScenarioPack,
    llm: LLMClient,
    trial: bool = False,
) -> tuple[StSession, list[str]]:
    """开启一次情境：**先**在事务外把开场演出来，**再**用一个短事务落行与开场事件。

    会话行携带开局时的**内容快照**（`pack_content` + `pack_version`）：此后病例怎么改都不影响这一局。
    开场同样走模型循环（`stage="opening"`）：它可以把设备/图片摆出来、可以揭示"一进来就看得见"的线索。
    """
    world = initial_world(pack)
    # 开场也走模型循环：拿不到交付就**不建会话**（学生不该进到一个没有现场的空壳里）。
    # `AgentFailure` 直接抛给调用方，由路由翻成学生侧错误。
    outcome = await run_agent(llm, pack, world, request=None, resolved=None, user_id=user_id, stage="opening")
    problems: list[str] = list(outcome.problems)
    delivery_messages = [_message_payload(message) for message in outcome.delivery.messages]
    tools_payload = _agent_payload(outcome)
    attach_delivery(world, delivery_messages, turn=0, seq=0)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "pack_key": pack.key,
        "pack_version": pack_version,
        "player_role": pack.player.role,
        "trial": trial,
        "effects": [item.model_dump(mode="json") for item in outcome.tools.effects],
        "reveals": list(outcome.tools.reveals),
        "messages": delivery_messages,
        "images": [_image_payload(asset_id) for asset_id in outcome.tools.images],
        "presence": dict(outcome.tools.presence),
        "models": ModelCalls(calls=outcome.model_calls).model_dump(),
        "problems": problems,
        **tools_payload,
    }
    with unit_of_work(db, conflict_detail="开启情境失败"):
        session = StSession(
            user_id=user_id,
            pack_key=pack_key,
            pack_version=pack_version,
            pack_content=content,
            status="active",
            meta={**({"trial": True} if trial else {})},
        )
        db.add(session)
        db.flush()
        session_id = session.id
        append_event(db, session_id, KIND_OPENED, payload)
    # 刚提交的行必须读得到；`scalar_one()` 让"读不到"直接炸掉，而不是把 None 传给调用方
    reloaded = db.execute(select(StSession).where(StSession.id == session_id)).scalar_one()
    return reloaded, problems


# --------------------------------------------------------------------------- #
# 回合
# --------------------------------------------------------------------------- #


def _view_for(
    pack: ScenarioPack,
    world: World,
    *,
    session_id: int,
    pack_key: str,
    version: int,
    trial: bool,
    status: str = "active",
):
    return build_view(
        pack,
        world,
        session_id=session_id,
        status=status,
        pack_key=pack_key,
        version=version,
        dims=dims_snapshot(pack, world),
        trial=trial,
    )


def _messages_of(view: Any, seq: int) -> list[Any]:
    out: list[Any] = []
    for message in view.messages:
        match = _MESSAGE_ID.match(message.id)
        if match is not None and match.group(1) == str(seq):
            out.append(message)
    return out


async def _phase(hooks: TurnHooks | None, name: TurnPhase) -> None:
    if hooks is not None and hooks.on_phase is not None:
        await hooks.on_phase(name)


def _input_echo(request: ScenarioTurnRequest) -> TurnInputModel:
    return TurnInputModel(
        kind=request.kind,
        target=request.target,
        affordance_id=request.affordance_id,
        selection=list(request.selection),
        text=request.text or "",
    )


def _clarification(
    pack: ScenarioPack,
    world: World,
    request: ScenarioTurnRequest,
    *,
    question: str,
    session_id: int,
    pack_key: str,
    version: int,
    trial: bool,
    base_seq: int,
    problems: list[str] | None = None,
) -> tuple[dict[str, Any], ScenarioTurnResult]:
    """确定性澄清：多对象歧义由**平台**问一句（不花模型、不推进时间、不写世界）。"""
    seq = base_seq + 1
    attach_clarification(
        world,
        turn=world.turn,
        seq=seq,
        text=request.text or "",
        question=question,
        request_id=request.request_id,
    )
    world.seq = seq
    view = _view_for(pack, world, session_id=session_id, pack_key=pack_key, version=version, trial=trial)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request.request_id,
        "turn": world.turn,
        "input": request.model_dump(mode="json"),
        "text": request.text or "",
        "clarification": question,
        "models": ModelCalls().model_dump(),
        "problems": list(problems or []),
    }
    result = ScenarioTurnResult(
        request_id=request.request_id,
        seq=seq,
        committed=True,
        turn=world.turn,
        outcome=AttemptOutcome.CLARIFICATION,
        block_reason=None,
        messages=_messages_of(view, seq),
        view=view,
    )
    return payload, result


async def _hint(
    pack: ScenarioPack,
    world: World,
    request: ScenarioTurnRequest,
    *,
    session_id: int,
    pack_key: str,
    version: int,
    trial: bool,
    base_seq: int,
    llm: LLMClient,
    user_id: int,
) -> tuple[dict[str, Any], ScenarioTurnResult]:
    """求提示：走**只读**的模型循环（工具只有读工具），记录后原样交付，不推进世界。"""
    seq = base_seq + 1
    echo = _input_echo(request)
    problems: list[str] = []
    outcome = await run_agent(llm, pack, world, request=echo, resolved=None, user_id=user_id, stage="hint")
    problems += outcome.problems
    messages = [_message_payload(message) for message in outcome.delivery.messages]
    attach_hint(
        world,
        turn=world.turn,
        seq=seq,
        text=request.text or "",
        messages=messages,
        request_id=request.request_id,
    )
    world.seq = seq
    view = _view_for(pack, world, session_id=session_id, pack_key=pack_key, version=version, trial=trial)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request.request_id,
        "turn": world.turn,
        "input": request.model_dump(mode="json"),
        "text": request.text or "",
        "messages": messages,
        "models": ModelCalls(calls=outcome.model_calls).model_dump(),
        "problems": problems,
        **_agent_payload(outcome),
    }
    result = ScenarioTurnResult(
        request_id=request.request_id,
        seq=seq,
        committed=True,
        turn=world.turn,
        outcome=AttemptOutcome.HINT,
        block_reason=None,
        messages=_messages_of(view, seq),
        view=view,
    )
    return payload, result


async def _turn(
    pack: ScenarioPack,
    world: World,
    request: ScenarioTurnRequest,
    *,
    session_id: int,
    pack_key: str,
    version: int,
    trial: bool,
    base_seq: int,
    llm: LLMClient,
    user_id: int,
    hooks: TurnHooks | None = None,
) -> tuple[dict[str, Any], ScenarioTurnResult]:
    seq = base_seq + 1
    problems: list[str] = []
    # 结构化动作的多对象歧义 → 平台先问一句（**确定性**，不花模型）
    if request.kind == "action" and request.affordance_id:
        affordance = pack.affordance(request.affordance_id)
        if affordance is not None and affordance.targets and request.target is None:
            if len(affordance.targets) == 1:
                request = request.model_copy(update={"target": affordance.targets[0]})
            else:
                return _clarification(
                    pack,
                    world,
                    request,
                    question="这件事你要对哪一个对象做？请先选定一个对象。",
                    session_id=session_id,
                    pack_key=pack_key,
                    version=version,
                    trial=trial,
                    base_seq=base_seq,
                )

    await _phase(hooks, "resolving")
    echo = _input_echo(request)
    resolved = settle_turn(pack, world, request=echo, request_id=request.request_id, base_seq=base_seq)
    problems += resolved.problems
    notice = notice_for(pack, resolved.outcome, resolved.block_reason, request.text or "")

    await _phase(hooks, "delivering")
    outcome = await run_agent(llm, pack, world, request=echo, resolved=resolved, user_id=user_id, notice=notice)
    problems += outcome.problems

    # 模型可以推进时间（`time_advance`）：时间尺的最终值以它为准，消耗量如实累加。
    resolved.time_cost += outcome.tools.time_advanced
    resolved.turn = world.turn
    # 模型侧的世界改动（工具产生的效果与揭示）与包声明的差量**并进同一份账**：
    # 事件载荷里的 `effects` / `reveals` 就是这一回合世界的全部变化，回放与教师回放读同一份。
    resolved.effects = [*resolved.effects, *outcome.tools.effects]
    resolved.reveals = [*resolved.reveals, *outcome.tools.reveals]
    resolved.facts = sorted({*resolved.facts, *_facts(pack, world)})

    messages = [_message_payload(message) for message in outcome.delivery.messages]
    attach_delivery(
        world,
        messages,
        turn=resolved.turn,
        seq=seq,
        notice_text=notice,
        notice_kind=resolved.outcome.value,
    )
    world.seq = seq
    view = _view_for(pack, world, session_id=session_id, pack_key=pack_key, version=version, trial=trial)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request.request_id,
        "turn": resolved.turn,
        "time_cost": resolved.time_cost,
        "input": request.model_dump(mode="json"),
        "outcome": resolved.outcome.value,
        "block_reason": resolved.block_reason,
        "actions": _actions_of(world, resolved),
        "effects": [item.model_dump(mode="json") for item in resolved.effects],
        "reveals": list(resolved.reveals),
        "messages": messages,
        "notice_text": notice,
        "images": [_image_payload(asset_id) for asset_id in outcome.tools.images],
        "presence": dict(outcome.tools.presence),
        "facts": list(resolved.facts),
        "models": ModelCalls(calls=outcome.model_calls).model_dump(),
        "problems": problems,
        **_agent_payload(outcome),
    }
    result = ScenarioTurnResult(
        request_id=request.request_id,
        seq=seq,
        committed=True,
        turn=resolved.turn,
        time_cost=resolved.time_cost,
        outcome=resolved.outcome,
        block_reason=resolved.block_reason or None,
        messages=_messages_of(view, seq),
        view=view,
    )
    return payload, result


def _facts(pack: ScenarioPack, world: World) -> list[str]:
    from .world import facts_observed

    return sorted(facts_observed(pack, world))


def _require_writable(session: StSession, session_id: int) -> dict[str, Any]:
    """写操作准入：非 active → `SessionClosed`；否则返回会话 meta。"""
    if session.status != "active":
        raise SessionClosed(f"session {session_id} status={session.status}")
    return session_meta(session)


def _stored_or_none(
    db: OrmSession, session_id: int, request: ScenarioTurnRequest, sha: str
) -> ScenarioTurnResult | None:
    """幂等：同 `session_id + request_id` 已有已提交行 → 同输入返回原结果、异输入 409。"""
    stored = find_request(db, session_id, request.request_id)
    if stored is None:
        return None
    result = _stored_turn(stored)
    if result is None or stored.input_sha != sha:
        db.rollback()
        raise RequestConflict(request.request_id)
    db.rollback()
    return result


def _event_kind(request: ScenarioTurnRequest, result: ScenarioTurnResult) -> str:
    """这条事件是哪一类：求提示 / 澄清（都不推进时间）/ 正常回合。"""
    if request.kind == "hint":
        return KIND_HINT
    if result.outcome is AttemptOutcome.CLARIFICATION:
        return KIND_CLARIFY
    return KIND_TURN


async def submit_turn(
    db: OrmSession,
    *,
    session: StSession,
    pack: ScenarioPack,
    request: ScenarioTurnRequest,
    llm: LLMClient,
    user_id: int,
    hooks: TurnHooks | None = None,
) -> ScenarioTurnResult:
    """执行一次学生请求并**原子提交**；失败不推进（调用方负责把异常翻成 HTTP/SSE 语义）。"""
    session_id = session.id
    meta = _require_writable(session, session_id)
    trial = bool(meta.get("trial"))
    pack_key = session.pack_key
    version = session.pack_version
    sha = input_sha(request)

    stored_result = _stored_or_none(db, session_id, request, sha)
    if stored_result is not None:
        return stored_result

    base_seq = current_seq(db, session_id)
    world = replay(db, session_id, pack)
    db.rollback()  # ← 读事务到此结束：模型等待期间不持有任何数据库事务
    if request.expected_seq != base_seq:
        raise SeqConflict(base_seq)

    _live_set(session_id, request.request_id, _Live("in_flight"))
    try:
        # 求提示走**只读模型循环**（不结算、不推进世界），不能落进回合结算
        payload, result = await (
            _hint(
                pack,
                world,
                request,
                session_id=session_id,
                pack_key=pack_key,
                version=version,
                trial=trial,
                base_seq=base_seq,
                llm=llm,
                user_id=user_id,
            )
            if request.kind == "hint"
            else _turn(
                pack,
                world,
                request,
                session_id=session_id,
                pack_key=pack_key,
                version=version,
                trial=trial,
                base_seq=base_seq,
                llm=llm,
                user_id=user_id,
                hooks=hooks,
            )
        )
    except TurnRejected:
        _live_drop(session_id, request.request_id)
        raise
    except AgentFailure as exc:
        retryable = exc.code == "provider_unavailable"
        _live_set(
            session_id,
            request.request_id,
            _Live(
                "failed",
                ScenarioErrorInfo(
                    code=exc.code if retryable else "internal_error",
                    message=(
                        "模型暂时不可用，本次未执行、世界未改变" if retryable else "本回合没有生成成功，世界未改变"
                    ),
                    retryable=retryable,
                ),
            ),
        )
        raise
    except Exception:
        # 内部异常（不是供应商故障）：如实说是服务端自己的问题，且**不可重试**——
        # 同一个请求重发只会再撞一次同样的 bug，把学生引去"再点一次"是不诚实的。
        _live_set(
            session_id,
            request.request_id,
            _Live(
                "failed",
                ScenarioErrorInfo(code="internal_error", message="服务端异常，本次未提交", retryable=False),
            ),
        )
        raise
    else:
        _live_drop(session_id, request.request_id)

    await _phase(hooks, "committing")
    try:
        _commit_event(
            db,
            session_id=session_id,
            request_id=request.request_id,
            kind=_event_kind(request, result),
            kind_label="turn",
            input_sha_value=sha,
            expected_seq=request.expected_seq,
            payload=payload,
            result=result.model_dump(mode="json"),
        )
    except _CommittedElsewhere as exc:
        stored_result = _stored_turn(exc.row)
        if stored_result is None:
            raise RequestConflict(request.request_id) from exc
        return stored_result
    return result


# --------------------------------------------------------------------------- #
# 结束
# --------------------------------------------------------------------------- #


def _tool_rejection_total(db: OrmSession, session_id: int) -> int:
    """本局被工具层拒掉的调用总数（模型越界 / 图片闸门命中）——进 `session_closed` 载荷供聚合。"""
    total = 0
    for payload in db.execute(
        select(StEvent.payload).where(StEvent.session_id == session_id, StEvent.kind == KIND_TURN)
    ).scalars():
        for count in ((payload or {}).get("tool_rejections") or {}).values():
            total += int(count or 0)
    return total


def submit_close(
    db: OrmSession,
    *,
    session: StSession,
    pack: ScenarioPack,
    request_id: str,
    expected_seq: int,
) -> ScenarioCloseResponse:
    """结束并结算判读。**与在途动作按同一会话序号串行**（同一把会话行锁）。"""
    session_id = session.id
    status = session.status
    meta = session_meta(session)
    pack_key = session.pack_key
    version = session.pack_version
    trial = bool(meta.get("trial"))
    sha = input_sha({"request_id": request_id})
    if status != "active":
        stored = find_request(db, session_id, request_id)
        result = _stored_close(stored) if stored is not None else None
        db.rollback()
        if result is not None:
            return result
        raise SessionClosed(f"session {session_id} status={status}")

    stored = find_request(db, session_id, request_id)
    if stored is not None:
        result = _stored_close(stored)
        db.rollback()
        if result is None or stored.input_sha != sha:
            raise RequestConflict(request_id)
        return result

    base_seq = current_seq(db, session_id)
    world = replay(db, session_id, pack)
    rejections = _tool_rejection_total(db, session_id)
    db.rollback()
    del status, meta
    if expected_seq != base_seq:
        raise SeqConflict(base_seq)

    view = _view_for(
        pack,
        world,
        session_id=session_id,
        pack_key=pack_key,
        version=version,
        trial=trial,
        status="completed",
    )
    report = build_report(pack, world, view=view)
    response = ScenarioCloseResponse(session_id=session_id, report=report, view=view)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request_id,
        "summary": report.assessment.summary,
        "lost": report.outcome.lost,
        "outcome": report.outcome.status,
        "turn": report.outcome.turn,
        "time_cost": world.turn,
        "tool_rejections": rejections,
    }
    with unit_of_work(db, conflict_detail="结束情境失败"):
        row = _lock_session(db, session_id)
        existing = _check_request_row(db, session_id, request_id, sha)
        if existing is not None:
            result = _stored_close(existing)
            if result is None:
                raise RequestConflict(request_id)
            return result
        base = current_seq(db, session_id)
        if base != expected_seq:
            raise SeqConflict(base)
        row.status = "completed"
        row.report = report.model_dump(mode="json")
        db.add(StEvent(session_id=session_id, seq=base + 1, kind=KIND_CLOSED, payload=payload))
        db.add(
            StSessionRequest(
                session_id=session_id,
                request_id=request_id,
                kind="close",
                input_sha=sha,
                seq=base + 1,
                result=response.model_dump(mode="json"),
            )
        )
        db.flush()
    return response


# --------------------------------------------------------------------------- #
# 结果查询（断流恢复）
# --------------------------------------------------------------------------- #


def request_lookup(db: OrmSession, *, session_id: int, request_id: str) -> ScenarioRequestLookup:
    """按 `request_id` 取回结果。

    - 有已提交行 → `committed`（原结果）；
    - 本 worker 正在跑 → `in_flight`；本 worker 提交前失败 → `failed`（同 id 重试安全）；
    - 都没有 → `unknown`：**没有已提交记录，本次结果未明**（别的 worker 可能正在提交），
      但这不代表失败——用同一个 `request_id` 重发永远是安全的（提交只会成功一次）。
    """
    row = find_request(db, session_id, request_id)
    if row is not None:
        db.rollback()
        if row.kind == "close":
            return ScenarioRequestLookup(
                request_id=request_id,
                kind="close",
                state="committed",
                seq=row.seq,
                close_result=_stored_close(row),
            )
        result = _stored_turn(row)
        return ScenarioRequestLookup(
            request_id=request_id,
            kind="turn",
            state="committed",
            seq=row.seq,
            turn=result.turn if result else None,
            outcome=result.outcome if result else None,
            result=result,
        )
    live = _live_get(session_id, request_id)
    if live is None:
        return ScenarioRequestLookup(request_id=request_id, state="unknown")
    if live.state == "failed":
        return ScenarioRequestLookup(request_id=request_id, state="failed", error=live.error)
    return ScenarioRequestLookup(request_id=request_id, state="in_flight")


def session_row(session: StSession, pack_title: str, turn: int) -> dict[str, Any]:
    """列表行投影（学生与管理侧共用）。"""
    report = session.report or {}
    meta = session_meta(session)
    outcome = (report.get("outcome") or {}) if isinstance(report, dict) else {}
    return {
        "id": session.id,
        "user_id": session.user_id,
        "pack_key": session.pack_key,
        "pack_title": pack_title,
        "pack_version": session.pack_version,
        "status": session.status,
        "turn": turn or report.get("turn"),
        "lost": report.get("lost") if report.get("lost") is not None else outcome.get("lost"),
        "summary": (
            (report.get("assessment") or {}).get("summary") or report.get("summary")
            if isinstance(report, dict)
            else None
        ),
        "trial": bool(meta.get("trial")),
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


def session_turns(db: OrmSession, session_ids: list[int]) -> dict[int, int]:
    """每个会话**实际跑到第几回合**（一次分组查询；`turn_committed` 的 `turn` 与回放同源）。"""
    if not session_ids:
        return {}
    found: dict[int, int] = {}
    for session_id, turn in db.execute(
        select(StEvent.session_id, func.max(StEvent.payload["turn"].as_integer()))
        .where(StEvent.session_id.in_(session_ids), StEvent.kind == KIND_TURN)
        .group_by(StEvent.session_id)
    ).all():
        found[int(session_id)] = int(turn or 0)
    return {sid: found.get(sid, 0) for sid in session_ids}


__all__ = [
    "RequestConflict",
    "SeqConflict",
    "SessionClosed",
    "TurnHooks",
    "TurnRejected",
    "create_session",
    "current_seq",
    "find_request",
    "input_sha",
    "is_lost",
    "load_events",
    "replay",
    "request_lookup",
    "reset_live_registry",
    "session_row",
    "session_turns",
    "submit_close",
    "submit_turn",
]
