"""视图投影：把世界投影成**学生可见**的东西。

防泄漏是硬要求：`truth`、`hidden_from_player`、未揭示的线索、没挂在设备上的数值、
判据与任何拒绝原因**一律不进视图**。

消息用**稳定 id**（`m<事件序号><类别><序号>`）标识：客户端按 id 接续与去重，
**不按文案、不猜回合**。排序按「回合 → 回合内因果序」，因此"学生尝试 → 世界回应 → 可见变化"
不会被裁散；后端不再只给最近 5 条。

呈现面（`hud` / `board` / `panels` / `dims`）都由**平台推导**，不由作者声明：
- `board`：已揭示线索 / 已确认事实 / 已处置动作（`runtime/board.py`）；
- `devices`：读数**只**在这里出现（数值归设备面板）；
- `panels`：按"这一局有没有可看的东西"给开关（时间线恒开）；
- `dims`：经历量化的通用三件套（动作数 / 必采事实覆盖 / 情境时间）；
- `hud`：不再有作者声明的槽位（读数归设备面板），平台给空表——线协议字段保留。
"""

from __future__ import annotations

from typing import Any, cast

from ..api_models import (
    ScenarioActor,
    ScenarioAsset,
    ScenarioImage,
    ScenarioMessage,
    ScenarioSituation,
    ScenarioTimelineEntry,
    ScenarioView,
    ScenarioViewPack,
    ScenarioViewSession,
)
from ..schema import ScenarioPack
from ..turns import MessageKind, MessageOrigin, TargetRef
from .board import build_board
from .devices import build_devices
from .world import World, effective_presence, facts_observed, is_lost, student_declaration, visible_affordances

#: 回合内因果序（同回合的消息按它排）：学生 → 引擎直出 → 旁白 → 台词 → 澄清 → 提示。
_RANK = {"student": 0, "system": 1, "scene": 2, "actor": 3, "clarification": 4, "hint": 5}


def _asset_url(pack_key: str | None, asset_id: str) -> str | None:
    return None if not pack_key else f"/api/scenario/assets/{pack_key}/{asset_id}"


def _assets(pack: ScenarioPack, pack_key: str | None) -> list[ScenarioAsset]:
    return [
        ScenarioAsset(
            id=asset.id,
            title=asset.title,
            alt=asset.alt,
            url=_asset_url(pack_key, asset.id),
        )
        for asset in pack.assets
    ]


def _images(pack: ScenarioPack, world: World, pack_key: str | None) -> list[ScenarioImage]:
    out: list[ScenarioImage] = []
    for image in world.images:
        asset_id = str(image.get("asset_id", ""))
        asset = pack.asset(asset_id)
        out.append(
            ScenarioImage(
                asset_id=asset_id,
                url=_asset_url(pack_key, asset_id),
                title=image.get("title") or (asset.title if asset else ""),
                alt=image.get("alt") or (asset.alt if asset else ""),
                caption=image.get("caption", ""),
                origin=image.get("origin", "pack"),
            )
        )
    return out


def _message_id(seq: int, letter: str, index: int) -> str:
    return f"m{seq}{letter}{index}"


def _student_messages(pack: ScenarioPack, world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    for action in world.actions:
        text = action.text or action.label(pack)
        if not text:
            continue
        declaration = student_declaration(action)
        kind: MessageKind = "speech" if declaration == "say" else "action"
        if action.outcome == "unmodeled":
            kind = "action"
        out.append(
            (
                (action.turn, _RANK["student"], action.seq, 0),
                ScenarioMessage(
                    id=_message_id(action.seq, "s", 0),
                    role="student",
                    kind=kind,
                    text=text,
                    turn=action.turn,
                    target=action.target_ref(),
                    declaration=declaration,
                    origin="student",
                    sources=[f"event:{action.seq}", f"action:{action.affordance_id}"] if action.affordance_id else [],
                ),
            )
        )
    return out


def _narration_messages(world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    """环境叙述（`speaker=None`）：kind 只认 narration / clarification / hint。

    载荷是**未类型化的 JSON**：`cast` 只把「已由下面的白名单 / 构造期契约收窄」告诉类型检查器，
    运行行为不变（pydantic 仍会在构造时拒绝非法字面量）。
    """
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    for entry in world.narrations:
        text = str(entry.get("text") or "")
        if not text:
            continue
        kind = str(entry.get("kind") or "narration")
        turn = int(entry.get("turn", 0))
        seq = int(entry.get("seq", 0))
        index = int(entry.get("index", 0))
        out.append(
            (
                (turn, _RANK["scene"], seq, index),
                ScenarioMessage(
                    id=_message_id(seq, "n", index),
                    role="scene",
                    kind=cast("MessageKind", kind if kind in ("narration", "clarification", "hint") else "narration"),
                    text=text,
                    turn=turn,
                    origin=cast("MessageOrigin", str(entry.get("origin") or "dm")),
                    sources=[f"event:{seq}"],
                ),
            )
        )
    return out


def _line_messages(world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    """角色台词：`actor_role` 由调用方按 pack 补（这里只给 id / 临时身份）。"""
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    for entry in world.lines:
        text = str(entry.get("text") or "")
        if not text:
            continue
        actor_id = entry.get("actor")
        actor_id_str = str(actor_id) if actor_id else None
        turn = int(entry.get("turn", 0))
        seq = int(entry.get("seq", 0))
        index = int(entry.get("index", 0))
        as_role = str(entry.get("as_role", "") or "")
        out.append(
            (
                (turn, _RANK["actor"], seq, index),
                ScenarioMessage(
                    id=_message_id(seq, "a", index),
                    role="actor",
                    kind=cast("MessageKind", str(entry.get("kind") or "speech")),
                    text=text,
                    turn=turn,
                    actor=actor_id_str,
                    actor_role=None,  # 由调用方按 pack 补（需要 pack）
                    ephemeral=bool(entry.get("ephemeral")),
                    avatar_seed=as_role or (actor_id_str or ""),
                    origin=cast("MessageOrigin", str(entry.get("origin") or "dm")),
                    sources=[f"event:{seq}"],
                ),
            )
        )
    return out


def _notice_messages(world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    """引擎直出的系统消息（`blocked` / `unmodeled` 兜底），不依赖模型措辞。"""
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    for entry in world.notices:
        text = str(entry.get("text") or "")
        if not text:
            continue
        turn = int(entry.get("turn", 0))
        seq = int(entry.get("seq", 0))
        index = int(entry.get("index", 0))
        out.append(
            (
                (turn, _RANK["system"], seq, index),
                ScenarioMessage(
                    id=_message_id(seq, "y", index),
                    role="system",
                    kind=cast("MessageKind", str(entry.get("kind") or "narration")),
                    text=text,
                    turn=turn,
                    origin="system",
                    sources=[f"event:{seq}"],
                ),
            )
        )
    return out


def _clarification_messages(world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    """澄清交流：学生原话 + 一条具体问题；**不推进时间**。"""
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    for entry in world.clarifications:
        turn = int(entry.get("turn", 0))
        seq = int(entry.get("seq", 0))
        question = str(entry.get("clarification") or "")
        student_text = str(entry.get("text") or "")
        if student_text:
            out.append(
                (
                    (turn, _RANK["student"], seq, 0),
                    ScenarioMessage(
                        id=_message_id(seq, "s", 0),
                        role="student",
                        kind="speech",
                        text=student_text,
                        turn=turn,
                        origin="student",
                        sources=[f"event:{seq}"],
                    ),
                )
            )
        if question:
            out.append(
                (
                    (turn, _RANK["clarification"], seq, 1),
                    ScenarioMessage(
                        id=_message_id(seq, "c", 1),
                        role="scene",
                        kind="clarification",
                        text=question,
                        turn=turn,
                        origin="system",
                        sources=[f"event:{seq}"],
                    ),
                )
            )
    return out


def _hint_messages(world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    """求提示：只读教学交互——学生的诉求 + 提示内容，**不推进世界**。"""
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    for entry in world.hints:
        turn = int(entry.get("turn", 0))
        seq = int(entry.get("seq", 0))
        ask = str(entry.get("text") or "")
        if ask:
            out.append(
                (
                    (turn, _RANK["student"], seq, 0),
                    ScenarioMessage(
                        id=_message_id(seq, "s", 0),
                        role="student",
                        kind="hint",
                        text=ask,
                        turn=turn,
                        origin="student",
                        sources=[f"event:{seq}"],
                    ),
                )
            )
        for index, message in enumerate(entry.get("messages") or []):
            text = str(message.get("text") or "")
            if not text:
                continue
            speaker = message.get("speaker")
            as_role = str(message.get("as_role", "") or "")
            out.append(
                (
                    (turn, _RANK["hint"], seq, index + 1),
                    ScenarioMessage(
                        id=_message_id(seq, "h", index + 1),
                        role="actor" if speaker else "scene",
                        kind="hint",
                        text=text,
                        turn=turn,
                        actor=str(speaker) if speaker else None,
                        actor_role=as_role or None,
                        avatar_seed=as_role or (str(speaker) if speaker else None),
                        origin="hint",
                        sources=[f"event:{seq}"],
                    ),
                )
            )
    return out


def _delivered_messages(world: World) -> list[tuple[tuple[int, int, int, int], ScenarioMessage]]:
    out: list[tuple[tuple[int, int, int, int], ScenarioMessage]] = []
    out += _narration_messages(world)
    out += _line_messages(world)
    out += _notice_messages(world)
    out += _clarification_messages(world)
    out += _hint_messages(world)
    return out


def _messages(pack: ScenarioPack, world: World) -> list[ScenarioMessage]:
    ordered = _student_messages(pack, world) + _delivered_messages(world)
    ordered.sort(key=lambda item: item[0])
    out: list[ScenarioMessage] = []
    for _, message in ordered:
        if message.role == "actor" and message.actor_role is None:
            declared = pack.actor(message.actor) if message.actor else None
            message.actor_role = declared.role if declared is not None else message.actor
        out.append(message)
    return out


def _timeline(pack: ScenarioPack, world: World) -> list[ScenarioTimelineEntry]:
    entries: list[ScenarioTimelineEntry] = [
        ScenarioTimelineEntry(turn=action.turn, kind="student", label=action.label(pack)) for action in world.actions
    ]
    entries.sort(key=lambda item: item.turn)
    return entries


def _panels(pack: ScenarioPack, world: World, dims: list[dict[str, Any]]) -> list[str]:
    """呈现面板开关：按"这一局有没有可看的东西"推导（时间线恒开）。"""
    panels = ["timeline"]
    if dims:
        panels.append("emotion")
    if world.revealed or facts_observed(pack, world):
        panels.append("coverage")
    return panels


def build_view(
    pack: ScenarioPack,
    world: World,
    *,
    session_id: int,
    status: str,
    pack_key: str | None = None,
    version: int = 0,
    dims: list[dict[str, Any]] | None = None,
    trial: bool = False,
) -> ScenarioView:
    """学生可见的完整视图（**不含** problems / 判据 / 隐藏事实）。"""
    affordances = [
        {
            "id": affordance.id,
            "type": affordance.type.value,
            "label": affordance.label,
            "select": affordance.select,
            "options": [
                {"id": str(option.get("id")), "label": str(option.get("label", option.get("id")))}
                for option in affordance.params.get("options", [])
            ],
            "fields": [str(field) for field in affordance.params.get("fields", [])],
            "free_input": affordance.free_input,
            "confirm": affordance.confirm,
            "targets": [TargetRef(kind=item.kind, id=item.id) for item in affordance.targets],
            "time_cost": affordance.time_cost,
        }
        for affordance in visible_affordances(pack, world)
    ]
    actors = [
        ScenarioActor(
            id=actor.id,
            role=actor.role,
            presence=effective_presence(pack, world, actor.id).value,
            present=effective_presence(pack, world, actor.id).value == "on_site",
            contactable=effective_presence(pack, world, actor.id).value != "inaccessible",
        )
        for actor in pack.actors
    ]
    from ..api_models import ScenarioAffordance, ScenarioDim

    dim_rows = list(dims or [])
    return ScenarioView(
        session=ScenarioViewSession(
            id=session_id,
            status=status,
            turn=world.turn,
            lost=is_lost(pack, world),
            seq=world.seq,
            trial=trial,
        ),
        pack=ScenarioViewPack(
            key=pack.key,
            title=pack.title,
            player_role=pack.player.role,
            version=version,
        ),
        situation=ScenarioSituation(
            place=pack.setting.place,
            time_hint=pack.setting.time_hint,
            resources=list(pack.setting.resources),
            visible_cues=[text for _, text in pack.cue_items(world.revealed)],
            noticed=[],
        ),
        actors=actors,
        hud=[],
        messages=_messages(pack, world),
        affordances=[ScenarioAffordance.model_validate(item) for item in affordances],
        free_input=True,
        timeline=_timeline(pack, world),
        dims=[ScenarioDim.model_validate(item) for item in dim_rows],
        assets=_assets(pack, pack_key),
        images=_images(pack, world, pack_key),
        board=build_board(pack, world),
        devices=build_devices(pack, world),
        panels=_panels(pack, world, dim_rows),
    )


__all__ = ["build_view"]
