"""会话：开启 → 学生动作 → pack 反应 → DM 回合 → 事件流 → 判读。

一切状态改动都进**事件流**（append-only）：世界状态由事件推导（`runtime/world.py`），
因此判读、经历页与坏实验回放共享同一份事实。

回合语义（无时钟，docs/20 §五/§十）：
- **一次学生动作 = 一回合**；世界不会因为"时间流逝"而改变。
- pack 的反应是**边沿触发**：条件从"不成立"变为"成立"的那一回合才发生。
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass, field
from functools import partial
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select

from infra.llm.client import LLMClient
from models.scenario_training import StEvent, StSession

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from ..assets import (
    ImageProvider,
    find_generated_by_prompt,
    generated_asset_id,
    store_generated_asset,
)
from ..dm.contract import DMImageRequest, DMInterpretation, DMTurn, validate_anchor_proposals, validate_turn
from ..dm.entity import run_entity
from ..dm.runner import run_dm
from ..judge.rules import dims_snapshot, evaluate, score_report, summarize
from ..schema import ScenarioPack
from .anchors import compute_anchors
from .view import build_view
from .world import (
    ActionRecord,
    World,
    apply_effects,
    due_reactions,
    is_lost,
    reveal_cues,
    world_from_events,
)


class SessionClosed(RuntimeError):
    """会话已结束，不能再提交动作。"""


@dataclass
class StudentAction:
    """学生做的一件事。`text` 用于自由发问；`selected`/`custom_text` 用于选择型动作。"""

    affordance_id: str | None = None
    type: str = "ask"
    text: str | None = None
    selected: list[str] = field(default_factory=list)
    custom_text: str | None = None


@dataclass
class TurnOutcome:
    view: dict[str, Any]
    problems: list[str]


def append_event(db: Session, session_id: int, kind: str, payload: dict[str, Any]) -> StEvent:
    current = db.execute(select(func.max(StEvent.seq)).where(StEvent.session_id == session_id)).scalar()
    event = StEvent(session_id=session_id, seq=int(current or 0) + 1, kind=kind, payload=payload)
    db.add(event)
    db.flush()
    return event


def load_events(db: Session, session_id: int) -> list[dict[str, Any]]:
    rows = db.execute(select(StEvent).where(StEvent.session_id == session_id).order_by(StEvent.seq)).scalars().all()
    return [{"kind": row.kind, "payload": row.payload} for row in rows]


def replay(db: Session, session: StSession, pack: ScenarioPack) -> World:
    return world_from_events(pack, load_events(db, session.id))


def open_session(
    db: Session,
    *,
    user_id: int,
    revision_id: int,
    pack: ScenarioPack,
    meta: dict[str, Any] | None = None,
) -> StSession:
    session = StSession(
        user_id=user_id,
        pack_revision_id=revision_id,
        pack_key=pack.key,
        status="active",
        meta={"pack_schema_version": pack.pack_schema_version, **(meta or {})},
    )
    db.add(session)
    db.flush()
    append_event(
        db,
        session.id,
        "session_opened",
        {"pack_key": pack.key, "revision_id": revision_id, "player_role": pack.player.role},
    )
    return session


def _record_deltas(
    db: Session,
    session_id: int,
    applied: list[dict[str, Any]],
    revealed: list[str],
    *,
    ad_hoc: list[str] | None = None,
    images: list[dict[str, Any]] | None = None,
) -> None:
    """可见物变化（线索 / 即兴细节 / 图片）与状态变化分别入流，便于回放与经历量化。"""
    if applied:
        append_event(db, session_id, "effects_applied", {"items": applied})
    if revealed or ad_hoc or images:
        append_event(
            db,
            session_id,
            "cues_revealed",
            {"cue_ids": revealed, "ad_hoc": ad_hoc or [], "images": images or []},
        )


async def _generate_image(
    provider: ImageProvider | None,
    db: Session,
    session: StSession,
    pack: ScenarioPack,
    request: DMImageRequest,
) -> dict[str, Any] | None:
    """预留：绘画者 AI 可用时生成并**入库**；不可用时**诚实跳过**（不生成占位假图）。

    同一会话同一提示词命中已有行就不再花钱重画；字节按 `sha256` 去重（`st_generated_assets`）。
    """
    if provider is None:
        return None
    row = find_generated_by_prompt(db, session_id=session.id, prompt=request.prompt)
    if row is None:
        data = await provider.generate(request.prompt)
        row = store_generated_asset(
            db,
            session_id=session.id,
            pack_key=pack.key,
            pack_revision_id=session.pack_revision_id,
            prompt=request.prompt,
            data=data,
        )
    return {
        "asset_id": generated_asset_id(row.id),
        "caption": request.caption,
        "origin": "generated",
        "prompt": request.prompt,
    }


async def _shown_images(
    provider: ImageProvider | None,
    db: Session,
    session: StSession,
    pack: ScenarioPack,
    world: World,
    check: Any,
    problems: list[str],
) -> list[dict[str, Any]]:
    """落地本回合要展示的图片：资源包内的预定义图 + 预留的绘画者 AI。"""
    shown: list[dict[str, Any]] = []
    for image in check.turn.images:
        entry = {"asset_id": image.asset_id, "caption": image.caption, "origin": "pack"}
        world.images.append(entry)
        shown.append(entry)
    if check.turn.image_request is not None:
        generated = await _generate_image(provider, db, session, pack, check.turn.image_request)
        if generated is None:
            problems.append("image_generation_unavailable")
        else:
            world.images.append(generated)
            shown.append(generated)
    return shown


def _fire_reactions(
    db: Session,
    session_id: int,
    pack: ScenarioPack,
    before: World,
    world: World,
    *,
    skip: frozenset[str] = frozenset(),
) -> list[dict[str, Any]]:
    """边沿触发的 pack 反应；返回给 DM 的"本回合必然发生"。

    `skip` 用于**同回合的第二次求值**（归属回填之后）：本回合已经发过的反应跳过，
    只补"因为刚认领了动作才成立"的那几条——幂等，不会重复触发。
    """
    beats: list[dict[str, Any]] = []
    for reaction in due_reactions(pack, before, world):
        if reaction.id in skip:
            continue
        applied = apply_effects(pack, world, reaction.effects, source=f"reaction:{reaction.id}")
        revealed = reveal_cues(pack, world, reaction.reveals)
        _record_deltas(db, session_id, applied, revealed)
        world.fired.append(reaction.id)
        beats.append({"reaction": reaction.id, "by": reaction.by, "does": reaction.does, "intent": reaction.intent})
    return beats


def _clean_selection(affordance: Any, selected: list[str]) -> tuple[list[str], list[str]]:
    """选择型动作只能选 pack 声明过的选项（未声明的丢弃并记账）。"""
    if affordance is None or not selected:
        return [], []
    declared = {str(option.get("id")) for option in affordance.params.get("options", [])}
    kept = [option_id for option_id in selected if option_id in declared]
    problems = [f"unknown_option:{option_id}" for option_id in selected if option_id not in declared]
    return kept, problems


def _attribute_free_action(
    db: Session,
    session_id: int,
    record: ActionRecord,
    interpretation: DMInterpretation | None,
) -> bool:
    """把 DM 对学生**自由表达**的解读回填到动作记录上（判读/白板/维度因此不必各自认词）。

    - 只在学生**没点按钮**时回填：学生自己选的 affordance 以他选的为准，DM 不得覆盖；
    - 记录已随 `student_action` 入流，回填**另发一条 `action_attributed` 事件**（append-only），
      回放时把它补到对应回合的记录上——历史事件不改写；
    - 返回是否真的回填了（调用方据此再求值一次 pack 反应的边沿）。
    """
    if interpretation is None or interpretation.affordance_id is None or record.affordance_id is not None:
        return False
    record.affordance_id = interpretation.affordance_id
    append_event(
        db,
        session_id,
        "action_attributed",
        {"turn": record.turn, "affordance_id": record.affordance_id, "source": "dm"},
    )
    return True


def _remember_dm_turn(world: World, check: Any) -> list[dict[str, Any]]:
    if check.turn.narration:
        world.narrations.append({"turn": world.turn, "text": check.turn.narration})
    for line in check.turn.lines:
        world.lines.append({"actor": line.actor, "text": line.text, "origin": line.origin, "turn": world.turn})
    if check.turn.options:
        world.options = [option.model_dump(mode="json") for option in check.turn.options]
    for fact in check.turn.facts_declared:
        world.declared_facts.append(fact.model_dump(mode="json"))
    stamped: list[dict[str, Any]] = []
    for index, note in enumerate(check.turn.notes):
        entry = {
            "id": f"note:{world.turn}:{index}",
            "text": note.text,
            "section": note.section,
            "supersedes": note.supersedes,
            "turn": world.turn,
        }
        world.notes.append(entry)
        stamped.append(entry)
    return stamped


def _record_anchor_proposals(
    db: Session, session_id: int, pack: ScenarioPack, dm_turn: DMTurn, *, turn: int
) -> list[str]:
    """裁决 DM 的锚点提案并落事件；返回问题清单（会进 `dm_turn` 事件与回声串）。

    重算在**本回合末尾**（学生动作与 DM 的效果都已入流）——提案与它比，不一致就整条丢弃。
    """
    proposals = validate_anchor_proposals(
        pack, compute_anchors(pack, load_events(db, session_id)), dm_turn, turn_no=turn
    )
    for kind, payload in proposals.events:
        append_event(db, session_id, kind, payload)
    return list(proposals.problems)


async def _emit_dm_step(db: Session, session_id: int, payload: dict[str, Any]) -> None:
    """多步循环的每一步都落一条 `dm_step`（教师回放可见、学生不可见；步数进 `/api/diagnose`）。"""
    append_event(db, session_id, "dm_step", payload)


def dm_step_reporter(db: Session, session_id: int) -> Callable[[dict[str, Any]], Awaitable[None]]:
    """`dm_step` 上报器：落地路径与**流式路径**共用（流式在 router 里先拿到回合，也要落步）。"""
    return partial(_emit_dm_step, db, session_id)


async def opening_turn(
    db: Session,
    *,
    session: StSession,
    pack: ScenarioPack,
    llm: LLMClient,
    user_id: int,
    image_provider: ImageProvider | None = None,
) -> list[str]:
    """**开场回合**：DM 先立场景、让在场者按状态开口，再等学生动手（不走学生动作）。"""
    world = replay(db, session, pack)
    dm_turn, dm_problems = await run_dm(
        llm,
        pack,
        world,
        None,
        [],
        user_id=user_id,
        opening=True,
        on_step=dm_step_reporter(db, session.id),
        anchors=compute_anchors(pack, load_events(db, session.id)),
    )
    check = validate_turn(pack, dm_turn, world)
    problems = [*dm_problems, *check.problems]

    applied = apply_effects(pack, world, check.turn.effects, source="dm")
    revealed = reveal_cues(pack, world, check.turn.reveals)
    noticed = [text for text in check.turn.ad_hoc_cues if text not in world.ad_hoc_cues]
    world.ad_hoc_cues.extend(noticed)
    shown = await _shown_images(image_provider, db, session, pack, world, check, problems)
    _record_deltas(db, session.id, applied, revealed, ad_hoc=noticed, images=shown)
    stamped_notes = _remember_dm_turn(world, check)

    # 锚点提案：引擎只采纳与事件流重算一致者（不一致 → 拒绝 + 落事件 + 下回合纠偏）
    problems.extend(_record_anchor_proposals(db, session.id, pack, check.turn, turn=0))

    append_event(
        db,
        session.id,
        "dm_turn",
        {
            "turn": 0,
            "opening": True,
            "narration": check.turn.narration,
            "lines": [{**line.model_dump(mode="json"), "turn": 0} for line in check.turn.lines],
            "options": [option.model_dump(mode="json") for option in check.turn.options],
            "facts_declared": [fact.model_dump(mode="json") for fact in check.turn.facts_declared],
            "board_notes": stamped_notes,
            "ad_hoc_cues": check.turn.ad_hoc_cues,
            "fired": [],
            "problems": problems,
        },
    )
    return problems


async def submit_action(
    db: Session,
    *,
    session: StSession,
    pack: ScenarioPack,
    action: StudentAction,
    llm: LLMClient,
    user_id: int,
    image_provider: ImageProvider | None = None,
    dm_turn: DMTurn | None = None,
    dm_problems: list[str] | None = None,
) -> TurnOutcome:
    """执行一回合。调用方负责事务提交（`unit_of_work`）。"""
    world = replay(db, session, pack)
    if session.status != "active" or world.closed:
        raise SessionClosed(f"session {session.id} status={session.status}")

    before = world.clone()
    turn = world.turn + 1
    affordance = pack.affordance(action.affordance_id) if action.affordance_id else None
    selected, action_problems = _clean_selection(affordance, action.selected)
    record = ActionRecord(
        turn=turn,
        affordance_id=action.affordance_id,
        type=action.type,
        text=action.text,
        selected=selected,
        custom_text=action.custom_text,
    )
    world.turn = turn
    world.actions.append(record)
    append_event(
        db, session.id, "student_action", {"turn": turn, "action": asdict(record), "problems": action_problems}
    )

    # 1) 动作自身的声明式效果与揭示
    applied: list[dict[str, Any]] = []
    revealed: list[str] = []
    if affordance is not None:
        applied = apply_effects(pack, world, affordance.effects, source=f"affordance:{affordance.id}")
        revealed = reveal_cues(pack, world, affordance.reveals)
        _record_deltas(db, session.id, applied, revealed)

    # 2) pack 的反应（边沿触发）
    beats = _fire_reactions(db, session.id, pack, before, world)

    # 3) DM 回合（让学生做的每件事都被世界看见）
    #    `dm_turn` 已给出（流式路径先拿到结果）→ 不再重复调用，直接进校验与落地。
    if dm_turn is not None:
        turn_result, dm_problems = dm_turn, list(dm_problems or [])
    else:
        turn_result, dm_problems = await run_dm(
            llm,
            pack,
            world,
            record,
            beats,
            user_id=user_id,
            on_step=dm_step_reporter(db, session.id),
            anchors=compute_anchors(pack, load_events(db, session.id)),
        )
    check = validate_turn(pack, turn_result, world)
    problems = [*action_problems, *dm_problems, *check.problems]

    # 3a) 归属回填：学生这句话是**自由表达**时，DM 已把它解读成某个已解锁的动作 → 写进记录
    #     （越权/未声明已在 `validate_turn` 里丢弃；学生自己点的按钮不被覆盖）
    if _attribute_free_action(db, session.id, record, check.turn.interpretation):
        # 3b) 归属让某条 pack 反应**此刻**才成立（第一次求值在它之前，记录里还没有 id）→
        #     以同一个 `before` 再求值一次：只有"新成立"的会发，本回合已发过的按 id 跳过（幂等）。
        #     这样"自由表达"与"点按钮"对世界是同一件事，且补发的反应与它的同伴同一因果位置。
        beats.extend(
            _fire_reactions(db, session.id, pack, before, world, skip=frozenset(beat["reaction"] for beat in beats))
        )

    dm_applied = apply_effects(pack, world, check.turn.effects, source="dm")
    dm_revealed = reveal_cues(pack, world, check.turn.reveals)
    new_noticed = [text for text in check.turn.ad_hoc_cues if text not in world.ad_hoc_cues]
    world.ad_hoc_cues.extend(new_noticed)

    # 3b) 图片：资源包内的预定义图（作者准备）+ 预留的绘画者 AI
    shown = await _shown_images(image_provider, db, session, pack, world, check, problems)

    _record_deltas(db, session.id, dm_applied, dm_revealed, ad_hoc=new_noticed, images=shown)

    stamped_notes = _remember_dm_turn(world, check)

    # 3c) 锚点提案：引擎只采纳与事件流重算一致者（不一致 → 拒绝 + 落事件 + 下回合纠偏）
    problems.extend(_record_anchor_proposals(db, session.id, pack, check.turn, turn=turn))

    append_event(
        db,
        session.id,
        "dm_turn",
        {
            "turn": turn,
            "narration": check.turn.narration,
            "lines": [{**line.model_dump(mode="json"), "turn": turn} for line in check.turn.lines],
            "options": [option.model_dump(mode="json") for option in check.turn.options],
            "facts_declared": [fact.model_dump(mode="json") for fact in check.turn.facts_declared],
            "board_notes": stamped_notes,
            "ad_hoc_cues": check.turn.ad_hoc_cues,
            "fired": [beat["reaction"] for beat in beats],
            "problems": problems,
        },
    )

    # 4) 预留：独立角色实体代言台词（状态改动仍只来自 DM 的声明）
    for item in check.turn.delegate:
        text = await run_entity(llm, pack, world, item.actor, item.intent, user_id=user_id)
        if not text:
            continue
        line = {"actor": item.actor, "text": text, "origin": "entity"}
        world.lines.append(line)
        append_event(db, session.id, "entity_line", {"line": line})

    dims = dims_snapshot(pack, world)
    view = build_view(
        pack,
        world,
        session_id=session.id,
        status=session.status,
        revision_id=session.pack_revision_id,
        problems=problems,
        dims=dims_snapshot(pack, world),
    )
    return TurnOutcome(view=view, problems=problems)


def close_session(
    db: Session, *, session: StSession, pack: ScenarioPack, problems: list[str] | None = None
) -> dict[str, Any]:
    """结束会话并结算判读：锚点分布 + **得分率**（逐条权重与得分可查；不启用能力等第）。"""
    world = replay(db, session, pack)
    results = evaluate(pack, world)
    score = score_report(results)
    report = {
        "pack": {"key": pack.key, "title": pack.title},
        "turn": world.turn,
        "lost": is_lost(pack, world),
        "summary": summarize(results),
        "score": score,
        "criteria": score["criteria"],
        "dims": dims_snapshot(pack, world),
        "timeline": build_view(
            pack,
            world,
            session_id=session.id,
            status=session.status,
            revision_id=session.pack_revision_id,
        )["timeline"],
        "problems": problems or [],
    }
    session.status = "completed"
    session.report = report
    append_event(db, session.id, "session_closed", {"summary": report["summary"], "lost": report["lost"]})
    return report
