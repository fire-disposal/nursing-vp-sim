"""视图投影：把世界投影成**学生可见**的东西。

防泄漏是硬要求：`truth`、`hidden_from_player`、未揭示的线索、未被 HUD 声明的状态键
**一律不进视图**。状态只按 `presentation.hud` 声明逐个露出。
"""

from __future__ import annotations

from typing import Any

from ..schema import ScenarioPack
from .board import build_board
from .devices import build_devices
from .world import World, is_lost, visible_affordances


def _hud(pack: ScenarioPack, world: World) -> list[dict[str, Any]]:
    from .world import trigger_holds

    slots: list[dict[str, Any]] = []
    for item in pack.presentation.hud:
        if item.visible_when is not None and not trigger_holds(pack, world, item.visible_when):
            continue  # 条件未满足 → 这一读数此刻不该出现（按需具现）；不写门控 = 一直在
        entry: dict[str, Any] = {"slot": item.slot, "source": item.source}
        if item.source == "state" and item.ref:
            entry["label"] = item.slot
            entry["value"] = world.state.get(item.ref)
            entry["ref"] = item.ref
        elif item.source == "cue":
            entry["items"] = [text for _, text in pack.cue_items(world.revealed)]
        elif item.source == "actor":
            entry["items"] = [actor.role for actor in pack.actors if actor.presence.value == "on_site"]
        elif item.source == "affordance":
            entry["count"] = len(visible_affordances(pack, world))
        slots.append(entry)
    return slots


def _nudges(pack: ScenarioPack, world: World) -> list[str]:
    from .world import trigger_holds

    return [nudge.direction for nudge in pack.presentation.nudges if trigger_holds(pack, world, nudge.when)]


def _asset_url(revision_id: int | None, asset_id: str) -> str | None:
    return None if revision_id is None else f"/api/scenario/assets/{revision_id}/{asset_id}"


def _assets(pack: ScenarioPack, revision_id: int | None) -> list[dict[str, Any]]:
    return [
        {
            "id": asset.id,
            "title": asset.title,
            "alt": asset.alt,
            "suggest_when": asset.suggest_when,
            "url": _asset_url(revision_id, asset.id),
        }
        for asset in pack.assets
    ]


def _images(pack: ScenarioPack, world: World, revision_id: int | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for image in world.images:
        asset_id = str(image.get("asset_id", ""))
        asset = next((item for item in pack.assets if item.id == asset_id), None)
        out.append(
            {
                "asset_id": asset_id,
                "url": _asset_url(revision_id, asset_id),
                "title": image.get("title") or (asset.title if asset else ""),
                "alt": image.get("alt") or (asset.alt if asset else ""),
                "caption": image.get("caption", ""),
                "origin": image.get("origin", "pack"),
            }
        )
    return out


def build_view(
    pack: ScenarioPack,
    world: World,
    *,
    session_id: int,
    status: str,
    revision_id: int | None = None,
    problems: list[str] | None = None,
    dims: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """学生可见的完整视图（前端按词汇表通用渲染）。"""
    # 对话流必须**按时序**：先按回合，再按"回合内 旁白 → 台词"（与 DM 的信封顺序一致）。
    # 旧实现把所有旁白铺完再铺所有台词（按类型归类），学生会看到"先一堆旁白、再一堆台词"——
    # 与真实对话的因果顺序不符（2026-09-28 修正）。
    ordered: list[tuple[int | None, int, dict[str, Any]]] = []
    for index, narration in enumerate(world.narrations):
        turn = narration.get("turn")
        resolved = int(turn) if turn is not None else index + 1
        ordered.append(
            (
                turn if turn is not None else None,
                0,
                {"role": "scene", "text": narration.get("text", ""), "turn": resolved},
            )
        )
    for line in world.lines:
        actor_id = line.get("actor")
        declared = pack.actor(str(actor_id)) if actor_id else None
        as_role = str(line.get("as_role", "") or "")
        turn = line.get("turn")
        ordered.append(
            (
                turn if turn is not None else None,
                1,
                {
                    "role": "actor",
                    "actor": actor_id,
                    "actor_role": declared.role if declared is not None else as_role,
                    "ephemeral": bool(line.get("ephemeral")),
                    "avatar_seed": as_role or str(actor_id or ""),
                    "text": line.get("text", ""),
                    "origin": line.get("origin", "dm"),
                    "turn": int(turn) if turn is not None else 0,
                },
            )
        )
    # 全部条目都带回合号 → 按时序（回合，回合内 旁白→台词）；
    # 只要有一条缺回合号（2026-09-28 之前的旧会话），就**不做臆测**，退回原有顺序（旁白在前、台词在后）。
    if all(turn is not None for turn, _, _ in ordered):
        ordered.sort(key=lambda item: (item[0], item[1]))
    else:
        ordered.sort(key=lambda item: item[1])
    messages: list[dict[str, Any]] = [item[2] for item in ordered]

    options: list[dict[str, Any]] = []
    for option in world.options:
        options.append(
            {
                "label": option.get("label"),
                "type": option.get("type"),
                "affordance_id": option.get("affordance_id"),
                "params": option.get("params", {}),
                "free_input": True,
            }
        )

    affordances: list[dict[str, Any]] = []
    for affordance in visible_affordances(pack, world):
        affordances.append(
            {
                "id": affordance.id,
                "type": affordance.type.value,
                "label": affordance.label,
                "select": affordance.select,
                "options": affordance.params.get("options", []),
                "fields": affordance.params.get("fields", []),
                "free_input": affordance.free_input,
                "confirm": affordance.confirm,
            }
        )

    timeline: list[dict[str, Any]] = []
    for action in world.actions:
        timeline.append({"turn": action.turn, "kind": "student", "label": action.label(pack)})
    for reaction_id in world.fired:
        reaction = next((r for r in pack.reactions if r.id == reaction_id), None)
        if reaction is not None:
            timeline.append({"turn": world.turn, "kind": "world", "label": reaction.intent, "by": reaction.by})

    actors: list[dict[str, Any]] = []
    for actor in pack.actors:
        actors.append(
            {
                "id": actor.id,
                "role": actor.role,
                "presence": actor.presence.value,
                "present": actor.presence.value == "on_site",
            }
        )

    return {
        "session": {
            "id": session_id,
            "status": status,
            "turn": world.turn,
            "lost": is_lost(pack, world),
        },
        "pack": {"key": pack.key, "title": pack.title, "player_role": pack.player.role, "revision_id": revision_id},
        "situation": {
            "place": pack.setting.place,
            "time_hint": pack.setting.time_hint,
            "resources": pack.setting.resources,
            "visible_cues": [text for _, text in pack.cue_items(world.revealed)],
            "noticed": list(world.ad_hoc_cues),
        },
        "actors": actors,
        "hud": _hud(pack, world),
        "messages": messages,
        "options": options,
        "affordances": affordances,
        "free_input": True,
        "timeline": timeline,
        "dims": dims or [],
        "nudges": _nudges(pack, world),
        "assets": _assets(pack, revision_id),
        "images": _images(pack, world, revision_id),
        "board": build_board(pack, world),
        "devices": build_devices(pack, world),
        "panels": [panel.value for panel in pack.presentation.panels],
        "problems": problems or [],
    }
