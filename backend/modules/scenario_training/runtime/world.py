"""情境训练 · 世界状态与触发求值。

**世界 = 事件流的推导结果**（不另存一份可变状态）。触发器只有两类来源：
**学生的动作**与**状态谓词**——不由墙钟驱动（docs/20 §四/§十）。

反应（reaction）是**边沿触发**：条件从"不成立"变为"成立"的那一回合才发生；
`once=true` 的反应此后永不再发。因此"持续恶化"要靠阈值/计数型子句分段声明，
而不是靠时间流逝——这正是"无时钟"下的正确表达方式。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from ..schema import Affordance, Clause, ClauseKind, Effect, EffectOp, Reaction, ScenarioPack, Trigger


@dataclass
class ActionRecord:
    """学生做过的一件事。"""

    turn: int
    affordance_id: str | None
    type: str
    text: str | None = None
    selected: list[str] = field(default_factory=list)
    custom_text: str | None = None

    def label(self, pack: ScenarioPack) -> str:
        if self.affordance_id and (aff := pack.affordance(self.affordance_id)):
            return aff.label
        return self.text or self.custom_text or self.type


@dataclass
class World:
    """可从事件流重建的世界状态。"""

    state: dict[str, Any] = field(default_factory=dict)
    turn: int = 0
    actions: list[ActionRecord] = field(default_factory=list)
    revealed: list[str] = field(default_factory=list)
    ad_hoc_cues: list[str] = field(default_factory=list)
    lines: list[dict[str, Any]] = field(default_factory=list)
    narrations: list[dict[str, Any]] = field(default_factory=list)  # 每回合的叙述（带回合号：观察窗口要时序）
    options: list[dict[str, Any]] = field(default_factory=list)
    declared_facts: list[dict[str, Any]] = field(default_factory=list)
    notes: list[dict[str, Any]] = field(default_factory=list)  # DM 写在白板上的判断/订正
    dm_notes: list[str] = field(default_factory=list)  # DM 的草稿纸（`dm_step` 里的 note.write；学生看不到）
    state_history: dict[str, list[Any]] = field(default_factory=dict)  # 键 → 历次取值（趋势用）
    images: list[dict[str, Any]] = field(default_factory=list)  # 已展示的图片（资源包 / 生成）
    fired: list[str] = field(default_factory=list)
    closed: bool = False

    def clone(self) -> World:
        return copy.deepcopy(self)

    def used(self, affordance_id: str | None) -> list[ActionRecord]:
        return [a for a in self.actions if a.affordance_id == affordance_id]

    def last_turn_used(self, affordance_id: str | None) -> int | None:
        turns = [a.turn for a in self.used(affordance_id)]
        return max(turns) if turns else None

    def custom_texts(self) -> list[str]:
        return [a.custom_text for a in self.actions if a.custom_text]

    def timeline_pieces(self, pack: ScenarioPack) -> list[tuple[int, str]]:
        """(回合, 文案) 的**时序**列表：学生做了什么 → 场景叙述 → 谁说了什么。

        同回合内保持"动作 → 叙述 → 台词"的因果序（Python 的排序是稳定的）。
        """
        pieces: list[tuple[int, str]] = [(action.turn, f"[学生] {action.label(pack)}") for action in self.actions]
        pieces += [
            (int(item.get("turn", 0)), f"[场景] {item.get('text', '')}") for item in self.narrations if item.get("text")
        ]
        pieces += [
            (int(line.get("turn", 0)), f"[{line.get('actor', '?')}] {line.get('text', '')}") for line in self.lines
        ]
        return sorted(pieces, key=lambda piece: piece[0])

    def transcript(self, pack: ScenarioPack, limit: int = 14) -> str:
        """给学生消息与叙述的**按回合时序**精简转录（供 DM 上下文与 `history.lastN`）。

        每回合：学生做了什么 → 场景/在场者说了什么。顺序错了会误导判断——
        旧实现按"动作/叙述/台词"分组后再截取，最近一屏常常只剩台词。
        """
        pieces = self.timeline_pieces(pack)
        rows: list[str] = []
        shown_turn: int | None = None
        for turn, text in pieces[-limit:]:
            if turn != shown_turn:
                rows.append(f"{'开场' if turn == 0 else turn_word(turn)}：{text}")
                shown_turn = turn
            else:
                rows.append(text)
        return "\n".join(rows)


def turn_word(turn: int) -> str:
    return f"第{turn}回合"


def namespaced_key(effect: Effect) -> str:
    return effect.key if "." in effect.key else f"{effect.target}.{effect.key}"


def initial_world(pack: ScenarioPack) -> World:
    world = World(state=copy.deepcopy(pack.state_keys))
    world.state_history = {key: [value] for key, value in world.state.items()}
    world.revealed = [cue.id for cue in pack.setting.cues if cue.visible_from_start]
    return world


def _compute(old: Any, effect: Effect) -> Any:
    if effect.op is EffectOp.SET:
        return effect.value
    if isinstance(old, bool) or not isinstance(old, (int, float)):
        return old  # 非数值不做算术（记录原值，避免把字符串算成垃圾）
    delta = effect.value if isinstance(effect.value, (int, float)) else 0
    return old + delta if effect.op is EffectOp.INCR else old - delta


def apply_effects(
    pack: ScenarioPack,
    world: World,
    effects: list[Effect],
    *,
    source: str,
) -> list[dict[str, Any]]:
    """应用效果并把每一步的旧值/新值记账（可回放、可解释）。未登记的键按校验层要求不该出现。"""
    applied: list[dict[str, Any]] = []
    for effect in effects:
        key = namespaced_key(effect)
        if key not in pack.state_keys:
            continue
        old = world.state.get(key)
        new = _compute(old, effect)
        if old == new:
            continue  # 无效动作：处境不变（首片④的"同一措施无效"就是这种）
        world.state[key] = new
        world.state_history.setdefault(key, []).append(new)
        applied.append(
            {"key": key, "op": effect.op.value, "value": effect.value, "old": old, "new": new, "source": source}
        )
    return applied


def reveal_cues(pack: ScenarioPack, world: World, cue_ids: list[str]) -> list[str]:
    added: list[str] = []
    for cue_id in cue_ids:
        if cue_id in world.revealed or pack.cue(cue_id) is None:
            continue
        world.revealed.append(cue_id)
        added.append(cue_id)
    return added


def _cmp(current: Any, op: str | None, expected: Any) -> bool:
    if op is None or current is None:
        return False
    try:
        if op == "<":
            return current < expected
        if op == "<=":
            return current <= expected
        if op == "==":
            return current == expected
        if op == ">=":
            return current >= expected
        if op == ">":
            return current > expected
    except TypeError:
        return False
    return False


def clause_holds(pack: ScenarioPack, world: World, clause: Clause) -> bool:
    kind = clause.kind
    if kind is ClauseKind.ACTION_USED:
        return bool(world.used(clause.affordance_id))
    if kind is ClauseKind.ACTION_COUNT_GTE:
        return len(world.used(clause.affordance_id)) >= (clause.count or 1)
    if kind is ClauseKind.TURNS_WITHOUT_ACTION:
        need = clause.turns or 1
        last = world.last_turn_used(clause.affordance_id)
        return (world.turn - last) >= need if last is not None else world.turn >= need
    if kind is ClauseKind.CUE_REVEALED:
        return clause.cue_id in world.revealed
    if kind is ClauseKind.STATE_CMP:
        return _cmp(world.state.get(clause.key or ""), clause.op, clause.value)
    if kind is ClauseKind.FACT_DECLARED:
        return any(fact.get("fact_id") == clause.fact_id for fact in world.declared_facts)
    if kind is ClauseKind.TURN_GTE:
        return world.turn >= (clause.count or 1)
    return False


def trigger_holds(pack: ScenarioPack, world: World, trigger: Trigger | None) -> bool:
    if trigger is None or not trigger.all:
        return False
    return all(clause_holds(pack, world, clause) for clause in trigger.all)


def visible_affordances(pack: ScenarioPack, world: World) -> list[Affordance]:
    """此刻**已解锁**的动作：无门控 = 一直在；有门控 = 条件成立才可用。

    视图投影（学生能点什么）与 DM 解读的越权守卫（学生这句话能算作什么）共用这**同一条**判定。
    """
    return [
        affordance
        for affordance in pack.affordances
        if affordance.visible_when is None or trigger_holds(pack, world, affordance.visible_when)
    ]


def due_reactions(pack: ScenarioPack, before: World, after: World) -> list[Reaction]:
    """边沿触发：条件在本回合**新成立**才发生；`once=true` 的只发一次。"""
    fired: list[Reaction] = []
    for reaction in pack.reactions:
        if not trigger_holds(pack, after, reaction.when):
            continue
        if reaction.once and reaction.id in after.fired:
            continue
        if trigger_holds(pack, before, reaction.when):
            continue
        fired.append(reaction)
    return fired


def is_lost(pack: ScenarioPack, world: World) -> bool:
    """不可逆失败条件（由 pack 声明，不由平台内置领域判据）。"""
    return pack.failure == "irreversible" and trigger_holds(pack, world, pack.failure_when)


def facts_observed(pack: ScenarioPack, world: World) -> set[str]:
    """判读只读**世界事实**：线索已揭示或动作已使用 → 该事实视为被采集到。"""
    observed: set[str] = set()
    for fact in pack.facts:
        cues_hit = any(cue_id in world.revealed for cue_id in fact.cue_ids)
        actions_hit = any(world.used(affordance_id) for affordance_id in fact.affordance_ids)
        if cues_hit or actions_hit:
            observed.add(fact.id)
    return observed


def fold_event(world: World, event: dict[str, Any]) -> None:
    """把**一条**事件折进世界（`world_from_events` 与逐回合前缀重放共用同一份折法）。"""
    folder = _FOLDERS.get(str(event.get("kind")))
    if folder is not None:
        folder(world, event.get("payload") or {})


def world_from_events(pack: ScenarioPack, events: list[dict[str, Any]]) -> World:
    """从事件流重建世界（回放：判读、经历页、坏实验复盘都靠它）。"""
    world = initial_world(pack)
    for event in events:
        fold_event(world, event)
    return world


def _fold_action(world: World, payload: dict[str, Any]) -> None:
    world.turn = int(payload.get("turn", world.turn + 1))
    world.actions.append(ActionRecord(**(payload.get("action") or {})))


def _fold_attribution(world: World, payload: dict[str, Any]) -> None:
    """把 DM 对学生**自由表达**的解读补回对应回合的动作记录（学生自己选的 id 不被覆盖）。"""
    affordance_id = payload.get("affordance_id")
    if not affordance_id:
        return
    turn = payload.get("turn")
    for action in reversed(world.actions):
        if turn is not None and action.turn != turn:
            continue
        if action.affordance_id is None:
            action.affordance_id = str(affordance_id)
        return


def _fold_effects(world: World, payload: dict[str, Any]) -> None:
    for item in payload.get("items", []):
        world.state[item["key"]] = item["new"]
        world.state_history.setdefault(item["key"], []).append(item["new"])


def _fold_cues(world: World, payload: dict[str, Any]) -> None:
    for cue_id in payload.get("cue_ids", []):
        if cue_id not in world.revealed:
            world.revealed.append(cue_id)
    for text in payload.get("ad_hoc", []):
        if text not in world.ad_hoc_cues:
            world.ad_hoc_cues.append(text)
    for image in payload.get("images", []):
        if image not in world.images:
            world.images.append(image)


def _fold_dm_turn(world: World, payload: dict[str, Any]) -> None:
    turn = int(payload.get("turn", world.turn))
    if payload.get("narration"):
        world.narrations.append({"turn": turn, "text": payload["narration"]})
    world.lines.extend({**line, "turn": turn} for line in payload.get("lines", []))
    if payload.get("options") is not None:
        world.options = payload.get("options", [])
    world.declared_facts.extend(payload.get("facts_declared", []))
    world.notes.extend(payload.get("board_notes", []))
    for reaction_id in payload.get("fired", []):
        if reaction_id not in world.fired:
            world.fired.append(reaction_id)


def _fold_dm_step(world: World, payload: dict[str, Any]) -> None:
    """多步循环的一步：只有 `note.write` 会改变世界的可用信息（DM 的草稿纸）。"""
    if payload.get("tool") != "note.write":
        return
    text = str((payload.get("args") or {}).get("text") or "").strip()
    if text:
        world.dm_notes.append(text)


def _fold_entity_line(world: World, payload: dict[str, Any]) -> None:
    world.lines.append({**payload.get("line", {}), "turn": world.turn})


def _fold_closed(world: World, _payload: dict[str, Any]) -> None:
    world.closed = True


_FOLDERS = {
    "student_action": _fold_action,
    "action_attributed": _fold_attribution,
    "effects_applied": _fold_effects,
    "cues_revealed": _fold_cues,
    "dm_turn": _fold_dm_turn,
    "dm_step": _fold_dm_step,
    "entity_line": _fold_entity_line,
    "session_closed": _fold_closed,
}
