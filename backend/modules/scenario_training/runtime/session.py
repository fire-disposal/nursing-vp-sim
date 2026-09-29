"""会话：**唯一回合管线**（解析 → 结算 → 演出 → 提交）+ 开启 / 澄清 / 求提示 / 结束 / 结果查询。

三条纪律（docs/23 §4.1/§4.5）：
1. **固定顺序**：`check_request` → 结算 → 演出 → 校验 → 原子提交；按钮与自由表达走同一条路；
2. **事务只包提交**：模型等待期间**不持有数据库事务**——读完立刻 `rollback()` 结束隐式事务，
   此后只使用纯值（id / 序号 / World 快照），绝不触碰已过期 ORM 实例的属性（那会触发懒加载重新占事务）；
3. **原子提交**：一个业务回合只追加**一条**事件；提交时锁会话行、复核 `request_id` 幂等与
   `expected_seq` 基线；失败不推进、不留半个世界。
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
from ..dm.contract import notice_for
from ..dm.stages import StageFailure, run_delivery, run_hint, run_intent
from ..judge.rules import dims_snapshot
from ..schema import ScenarioPack
from ..turns import (
    ActionEcho,
    AttemptOutcome,
    IntentKind,
    IntentResolution,
    ModelsUsed,
    ResolvedTurn,
    TurnPhase,
    VisibleEvent,
)
from ..turns import TurnInput as TurnInputModel
from .report import build_report
from .view import build_view
from .world import (
    TurnRejected,
    World,
    attach_clarification,
    attach_delivery,
    attach_hint,
    fire_reactions,
    initial_world,
    is_lost,
    project_focus,
    settle_turn,
    state_label,
    visible_refs,
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


class SessionArchived(RuntimeError):
    """旧机制会话只读（机制切换后仅可回看）。"""


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
    on_delivery: Any = None  # Callable[[SceneDelivery, int], Awaitable[None]]


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


def session_read_only(session: StSession) -> bool:
    """只读 = 机制切换时被封存的旧局（`meta.read_only`），**或**已有归档的旧局。"""
    if session_meta(session).get("read_only"):
        return True
    return has_archive(session)


def has_archive(session: StSession) -> bool:
    """该会话是否已有归档（机制切换前落下的旧局）。"""
    from sqlalchemy.orm import object_session

    from models.scenario_training import StSessionArchive

    db = object_session(session)
    if db is None:
        return False
    return db.execute(select(StSessionArchive.id).where(StSessionArchive.session_id == session.id)).first() is not None


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
# 开启
# --------------------------------------------------------------------------- #


def _message_payload(message: Any) -> dict[str, Any]:
    return {
        "speaker": message.speaker,
        "as_role": message.as_role,
        "ephemeral": message.ephemeral,
        "text": message.text,
        "sources": list(message.sources),
        "kind": "narration" if message.speaker is None else "speech",
        "origin": "dm",
    }


def _visible_events(
    pack: ScenarioPack,
    world: World,
    *,
    effects: list[Any],
    reveals: list[str],
    fired: list[str],
    turn: int,
) -> list[VisibleEvent]:
    out: list[VisibleEvent] = []
    for item in effects:
        out.append(
            VisibleEvent(
                kind="effect",
                ref=f"effect:{item.key}",
                text=f"{state_label(pack, item.key)}：{item.old} → {item.new}",
                turn=turn,
            )
        )
    for cue_id in reveals:
        cue = pack.cue(cue_id)
        if cue is not None:
            out.append(VisibleEvent(kind="reveal", ref=f"cue:{cue_id}", text=cue.text, turn=turn))
    for reaction_id in fired:
        reaction = next((item for item in pack.reactions if item.id == reaction_id), None)
        if reaction is not None:
            out.append(VisibleEvent(kind="reaction", ref=f"reaction:{reaction_id}", text=reaction.intent, turn=turn))
    del world
    return out


async def create_session(
    db: OrmSession,
    *,
    user_id: int,
    revision_id: int,
    pack: ScenarioPack,
    llm: LLMClient,
    trial: bool = False,
) -> tuple[StSession, list[str]]:
    """开启一次情境：**先**在事务外做开场演出，**再**用一个短事务落行与开场事件。

    开场基线按「尚未评估」处理：初始就成立的反应在这里结算一次（docs/23 §4.3.5）。
    """
    world = initial_world(pack)
    fired, effects, reveals = fire_reactions(pack, world, world.clone(), initial=True)
    resolved = ResolvedTurn(
        request_id="",
        base_seq=0,
        turn=0,
        outcome=AttemptOutcome.SPEECH,
        action=ActionEcho(kind="speech", label="（开场）", outcome=AttemptOutcome.SPEECH),
        effects=effects,
        reveals=reveals,
        reactions=fired,
        visible_events=_visible_events(pack, world, effects=effects, reveals=reveals, fired=fired, turn=0),
        focus=project_focus(pack, world),
    )
    delivery, problems = await run_delivery(
        llm,
        pack,
        world,
        request_text="",
        request_mode="speech",
        target=None,
        resolved=resolved,
        notice="",
        allowed_refs=visible_refs(pack, world),
        user_id=user_id,
        mode="opening",
    )
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "pack_key": pack.key,
        "revision_id": revision_id,
        "player_role": pack.player.role,
        "trial": trial,
        "effects": [item.model_dump(mode="json") for item in effects],
        "reveals": reveals,
        "reactions": fired,
        "messages": [_message_payload(message) for message in delivery.messages],
        "images": list(delivery.assets),
        "models": ModelsUsed(delivery=1).model_dump(),
        "problems": problems,
    }
    with unit_of_work(db, conflict_detail="开启情境失败"):
        session = StSession(
            user_id=user_id,
            pack_revision_id=revision_id,
            pack_key=pack.key,
            status="active",
            meta={"pack_schema_version": pack.pack_schema_version, **({"trial": True} if trial else {})},
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
    revision_id: int,
    trial: bool,
    status: str = "active",
    read_only: bool = False,
):
    return build_view(
        pack,
        world,
        session_id=session_id,
        status=status,
        revision_id=revision_id,
        dims=dims_snapshot(pack, world),
        read_only=read_only,
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


def _action_payload(record: Any, *, turn: int, seq: int) -> dict[str, Any]:
    payload = asdict(record)
    payload["turn"] = turn
    payload["seq"] = seq
    return payload


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
    intent: IntentResolution,
    *,
    session_id: int,
    revision_id: int,
    trial: bool,
    base_seq: int,
    models: ModelsUsed,
    problems: list[str],
) -> tuple[dict[str, Any], ScenarioTurnResult]:
    seq = base_seq + 1
    attach_clarification(
        world,
        turn=world.turn,
        seq=seq,
        text=request.text or "",
        question=intent.clarification,
        request_id=request.request_id,
    )
    world.seq = seq
    view = _view_for(pack, world, session_id=session_id, revision_id=revision_id, trial=trial)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request.request_id,
        "turn": world.turn,
        "input": request.model_dump(mode="json"),
        "intent": intent.model_dump(mode="json"),
        "text": request.text or "",
        "clarification": intent.clarification,
        "models": models.model_dump(),
        "problems": problems,
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
    revision_id: int,
    trial: bool,
    base_seq: int,
    llm: LLMClient,
    user_id: int,
) -> tuple[dict[str, Any], ScenarioTurnResult]:
    seq = base_seq + 1
    delivery, problems = await run_hint(
        llm, pack, world, text=request.text or "", allowed_refs=visible_refs(pack, world), user_id=user_id
    )
    messages = [_message_payload(message) for message in delivery.messages]
    attach_hint(
        world,
        turn=world.turn,
        seq=seq,
        text=request.text or "",
        messages=messages,
        request_id=request.request_id,
    )
    world.seq = seq
    view = _view_for(pack, world, session_id=session_id, revision_id=revision_id, trial=trial)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request.request_id,
        "turn": world.turn,
        "input": request.model_dump(mode="json"),
        "text": request.text or "",
        "messages": messages,
        "hints": list(delivery.hints),
        "models": ModelsUsed(delivery=1).model_dump(),
        "problems": problems,
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
    revision_id: int,
    trial: bool,
    base_seq: int,
    llm: LLMClient,
    user_id: int,
    hooks: TurnHooks | None = None,
) -> tuple[dict[str, Any], ScenarioTurnResult]:
    seq = base_seq + 1
    models = ModelsUsed()
    problems: list[str] = []
    echo = _input_echo(request)
    if request.kind == "action" and request.affordance_id:
        # 结构化动作：平台直接构造同一份解析结果（**不走解析模型**）
        intent = IntentResolution(
            kind=IntentKind.ACTION,
            target=request.target,
            affordance_id=request.affordance_id,
            selection=list(request.selection),
            utterance=request.text or "",
        )
    else:
        await _phase(hooks, "parsing")
        intent, parse_problems = await run_intent(
            llm,
            pack,
            world,
            mode=request.kind,
            text=request.text or "",
            target=request.target.model_dump(mode="json") if request.target else None,
            user_id=user_id,
        )
        models.parse = 1
        problems += parse_problems
    if intent.kind is IntentKind.ACTION and intent.affordance_id:
        affordance = pack.affordance(intent.affordance_id)
        if affordance is not None and affordance.targets:
            if intent.target is None:
                if len(affordance.targets) == 1:
                    # 唯一目标 → 平台自动绑定（不增加操作负担）
                    intent = intent.model_copy(update={"target": affordance.targets[0]})
                else:
                    # 多对象歧义 → **先澄清**（不消耗回合，不静默换人）
                    intent = IntentResolution(
                        kind=IntentKind.CLARIFICATION,
                        target=None,
                        utterance=request.text or "",
                        clarification="这件事你要对哪一个对象做？请先选定一个对象。",
                    )
    if intent.kind is IntentKind.CLARIFICATION:
        return _clarification(
            pack,
            world,
            request,
            intent,
            session_id=session_id,
            revision_id=revision_id,
            trial=trial,
            base_seq=base_seq,
            models=models,
            problems=problems,
        )

    await _phase(hooks, "resolving")
    resolved = settle_turn(pack, world, request=echo, intent=intent, request_id=request.request_id, base_seq=base_seq)
    problems += resolved.problems
    record = world.actions[-1]
    record.seq = seq
    allowed_refs = visible_refs(pack, world) | {event.ref for event in resolved.visible_events if event.ref}
    notice = notice_for(pack, resolved.outcome, resolved.block_reason, request.text or "")
    await _phase(hooks, "delivering")
    delivery, delivery_problems = await run_delivery(
        llm,
        pack,
        world,
        request_text=request.text or "",
        request_mode=request.kind,
        target=request.target.model_dump(mode="json") if request.target else None,
        resolved=resolved,
        notice=notice,
        allowed_refs=allowed_refs,
        user_id=user_id,
        mode="turn",
    )
    models.delivery = 1
    problems += delivery_problems
    await _phase(hooks, "validating")
    if hooks is not None and hooks.on_delivery is not None:
        await hooks.on_delivery(delivery, seq)
    messages = [_message_payload(message) for message in delivery.messages]
    attach_delivery(
        world,
        messages,
        turn=resolved.turn,
        seq=seq,
        notice_text=notice,
        notice_kind=resolved.outcome.value,
    )
    images = [{"asset_id": asset_id, "caption": "", "origin": "pack"} for asset_id in delivery.assets]
    for image in images:
        if image not in world.images:
            world.images.append(image)
    world.seq = seq
    view = _view_for(pack, world, session_id=session_id, revision_id=revision_id, trial=trial)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request.request_id,
        "turn": resolved.turn,
        "time_cost": resolved.time_cost,
        "input": request.model_dump(mode="json"),
        "intent": intent.model_dump(mode="json"),
        "outcome": resolved.outcome.value,
        "block_reason": resolved.block_reason,
        "actions": [_action_payload(record, turn=resolved.turn, seq=seq)],
        "effects": [item.model_dump(mode="json") for item in resolved.effects],
        "reveals": list(resolved.reveals),
        "reactions": list(resolved.reactions),
        "social": [item.model_dump(mode="json") for item in resolved.social],
        "messages": messages,
        "notice_text": notice,
        "images": images,
        "noticed": [],
        "focus": [item.model_dump(mode="json") for item in resolved.focus],
        "facts": list(resolved.facts),
        "models": models.model_dump(),
        "problems": problems,
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


def _require_writable(session: StSession, session_id: int) -> tuple[int, dict[str, Any]]:
    """写操作准入：只读旧局 → `SessionArchived`；非 active → `SessionClosed`。

    **只读判定先于状态判定**：机制切换时封存的旧局是 `abandoned + read_only`，
    它该得到 `session_archived`（旧局只能回看），而不是"这次情境已经结束"。
    """
    meta = session_meta(session)
    if meta.get("read_only") or has_archive(session):
        raise SessionArchived(f"session {session_id} is read-only")
    if session.status != "active":
        raise SessionClosed(f"session {session_id} status={session.status}")
    return session.pack_revision_id, meta


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
    revision_id, meta = _require_writable(session, session_id)
    trial = bool(meta.get("trial"))
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
        # 求提示走**只读交付路径**（不结算、不推进世界），不能落进回合结算
        payload, result = await (
            _hint(
                pack,
                world,
                request,
                session_id=session_id,
                revision_id=revision_id,
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
                revision_id=revision_id,
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
    except StageFailure as exc:
        _live_set(
            session_id,
            request.request_id,
            _Live("failed", ScenarioErrorInfo(code=exc.code, message="本回合没有生成成功，世界未改变", retryable=True)),
        )
        raise
    except Exception:
        _live_set(
            session_id,
            request.request_id,
            _Live(
                "failed",
                ScenarioErrorInfo(code="delivery_failed", message="本回合没有生成成功，世界未改变", retryable=True),
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
    revision_id = session.pack_revision_id
    if meta.get("read_only") or has_archive(session):
        raise SessionArchived(f"session {session_id} is read-only")
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
    db.rollback()
    del status, meta
    if expected_seq != base_seq:
        raise SeqConflict(base_seq)

    view = _view_for(pack, world, session_id=session_id, revision_id=revision_id, trial=trial, status="completed")
    report = build_report(pack, world, view=view)
    response = ScenarioCloseResponse(session_id=session_id, report=report, view=view)
    from .world import project_focus

    focus = project_focus(pack, world)
    payload = {
        "schema": EVENT_SCHEMA_VERSION,
        "request_id": request_id,
        "summary": report.assessment.summary,
        "lost": report.outcome.lost,
        "outcome": report.outcome.status,
        "turn": report.outcome.turn,
        # 关注点**只给管理侧**聚合用（学生响应里没有它）：存计数而不是列表，省得再解析
        "focus_relevant": sum(1 for item in focus if item.relevant),
        "focus_addressed": sum(1 for item in focus if item.relevant and item.addressed),
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
        "pack_revision_id": session.pack_revision_id,
        "status": session.status,
        "turn": turn or report.get("turn"),
        "lost": report.get("lost") if report.get("lost") is not None else outcome.get("lost"),
        "summary": (
            (report.get("assessment") or {}).get("summary") or report.get("summary")
            if isinstance(report, dict)
            else None
        ),
        "read_only": bool(meta.get("read_only")),
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
        .where(StEvent.session_id.in_(session_ids), StEvent.kind.in_((KIND_TURN, "dm_turn", "student_action")))
        .group_by(StEvent.session_id)
    ).all():
        found[int(session_id)] = int(turn or 0)
    return {sid: found.get(sid, 0) for sid in session_ids}


__all__ = [
    "RequestConflict",
    "SeqConflict",
    "SessionArchived",
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
    "session_read_only",
    "session_row",
    "session_turns",
    "submit_close",
    "submit_turn",
]
