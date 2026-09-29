"""情境训练 · 世界状态、确定性结算与事件折叠。

**世界 = 事件流的推导结果**（不另存一份可变状态）。本文件只管两件事：
1. **确定性**：动作的 `effects`/`reveals`、线索揭示、状态记账（旧值/新值/来源/时间单位）；
2. **折叠**：把已提交事件还原成世界（`fold_event` / `world_from_events`）。

模型演绎世界的部分**不在这里**：模型只能用 `runtime/tools.py` 的工具体，逐条校验后落到
这个 `World` 上（暂存），提交时一并写进那一条 `turn_committed` 载荷；未交付则整个世界丢掉。
写集与读集都只有新机制的 5 种事件（旧机制的事件不再被折叠）。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from ..schema import (
    Affordance,
    Clause,
    ClauseKind,
    Effect,
    EffectOp,
    Presence,
    ScenarioPack,
    Trigger,
)
from ..turns import (
    ActionEcho,
    AppliedEffect,
    AttemptOutcome,
    DeclarationKind,
    ResolvedTurn,
    TargetKind,
    TargetRef,
    TurnInput,
)

_DECLARED_TYPES: dict[str, DeclarationKind] = {"say": "say", "act": "act"}

BLOCK_TARGET_UNREACHABLE = "target_unreachable"
BLOCK_AFFORDANCE_UNAVAILABLE = "affordance_unavailable"


class TurnRejected(Exception):
    """请求自身的形状问题（未知目标/动作、目标与动作不匹配、非法选项）——**不消耗回合、不写世界**。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --------------------------------------------------------------------------- #
# 学生做过的一件事
# --------------------------------------------------------------------------- #


@dataclass
class ActionRecord:
    """学生做过的一件事（含**世界的答复**）。旧事件流缺新字段时按缺省值读，逐字兼容。"""

    turn: int
    affordance_id: str | None = None
    type: str = "act"  # say / act / ask（自由通道的声明）
    text: str | None = None
    selected: list[str] = field(default_factory=list)
    custom_text: str | None = None
    target_actor_id: str | None = None  # 旧字段（2026-09-28 之前的自由通道收信人）
    target: dict[str, Any] | None = None  # `TargetRef` 的 dict 形态（新）
    outcome: str = "performed"
    block_reason: str = ""
    request_id: str = ""
    seq: int = 0

    def label(self, pack: ScenarioPack) -> str:
        if self.affordance_id and (affordance := pack.affordance(self.affordance_id)):
            return affordance.label
        return self.text or self.custom_text or self.type

    def target_ref(self) -> TargetRef | None:
        if self.target:
            return TargetRef.model_validate(self.target)
        if self.target_actor_id:
            return TargetRef(kind=TargetKind.ACTOR, id=self.target_actor_id)
        return None


def student_declaration(action: ActionRecord) -> DeclarationKind | None:
    """学生这条是**声明过的对话**还是**自定义行动**；未声明（旧客户端 / 按钮 / 选项）→ None。"""
    if action.affordance_id is not None:
        return None
    return _DECLARED_TYPES.get(action.type)


# --------------------------------------------------------------------------- #
# 世界
# --------------------------------------------------------------------------- #


@dataclass
class World:
    """可从事件流重建的世界状态。"""

    state: dict[str, Any] = field(default_factory=dict)
    turn: int = 0
    seq: int = 0
    actions: list[ActionRecord] = field(default_factory=list)
    revealed: list[str] = field(default_factory=list)
    revealed_turns: dict[str, int] = field(default_factory=dict)  # 线索 id → 揭示回合（回看定位）
    lines: list[dict[str, Any]] = field(default_factory=list)
    narrations: list[dict[str, Any]] = field(default_factory=list)
    notices: list[dict[str, Any]] = field(default_factory=list)  # 引擎直出的 system 消息（blocked / unmodeled）
    clarifications: list[dict[str, Any]] = field(default_factory=list)
    hints: list[dict[str, Any]] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    #: 被 `present_monitor` 摆到学生面前的设备 id（与设备自身的 `visible_when` 取并集）
    presented: list[str] = field(default_factory=list)
    #: 被 `actor_enter` / `actor_leave` 改过的在场状态（作者声明是上限，这里是本场的实际值）
    presence: dict[str, str] = field(default_factory=dict)
    state_history: dict[str, list[Any]] = field(default_factory=dict)
    state_turns: dict[str, list[int]] = field(default_factory=dict)
    closed: bool = False

    def clone(self) -> World:
        return copy.deepcopy(self)

    def used(self, affordance_id: str | None) -> list[ActionRecord]:
        return [a for a in self.actions if a.affordance_id == affordance_id]

    def custom_texts(self) -> list[str]:
        """学生自己打的字（自由表达、document 记录、自填选项）——判读 `accept_custom` 读它。"""
        return [text for a in self.actions if (text := (a.text or a.custom_text))]

    def timeline_pieces(self, pack: ScenarioPack) -> list[tuple[int, str]]:
        pieces: list[tuple[int, str]] = [(a.turn, f"[学生] {a.label(pack)}") for a in self.actions]
        pieces += [(int(i.get("turn", 0)), f"[场景] {i.get('text', '')}") for i in self.narrations if i.get("text")]
        pieces += [(int(i.get("turn", 0)), f"[{i.get('actor', '?')}] {i.get('text', '')}") for i in self.lines]
        return sorted(pieces, key=lambda piece: piece[0])

    def transcript(self, pack: ScenarioPack, limit: int = 14) -> str:
        """按回合时序的精简转录（按**完整回合**截取，不截成只剩台词的零散行）。"""
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
    world.state_turns = {key: [0] for key in world.state}
    world.revealed = [cue.id for cue in pack.setting.cues if cue.visible_from_start]
    world.revealed_turns = dict.fromkeys(world.revealed, 0)
    return world


def effective_presence(pack: ScenarioPack, world: World, actor_id: str) -> Presence:
    """人物**此刻**的在场状态：本场被工具改过就用它，否则用作者声明的。"""
    raw = world.presence.get(actor_id)
    if raw:
        try:
            return Presence(raw)
        except ValueError:
            pass
    actor = pack.actor(actor_id)
    return actor.presence if actor is not None else Presence.INACCESSIBLE


# --------------------------------------------------------------------------- #
# 触发求值（只服务可见性与失败条件这两处**确定性门控**）
# --------------------------------------------------------------------------- #


def _compute(old: Any, effect: Effect) -> Any:
    if effect.op is EffectOp.SET:
        return effect.value
    if isinstance(old, bool) or not isinstance(old, (int, float)):
        return old
    delta = effect.value if isinstance(effect.value, (int, float)) and not isinstance(effect.value, bool) else 0
    return old + delta if effect.op is EffectOp.INCR else old - delta


def apply_effects(pack: ScenarioPack, world: World, effects: list[Effect], *, source: str) -> list[AppliedEffect]:
    """应用效果并记账旧值/新值（可回放、可解释）。未登记的键按校验层要求不该出现。"""
    applied: list[AppliedEffect] = []
    for effect in effects:
        key = namespaced_key(effect)
        if key not in pack.state_keys:
            continue
        old = world.state.get(key)
        new = _compute(old, effect)
        if old == new and effect.op is not EffectOp.SET:
            continue  # 增量动作没推动处境（"同一措施无效"就是这种）
        # 显式 `SET` 即使数值相同也**照记**：它是"把读数登记进世界"（例如复测仍是 88）。
        # 不记的话，学生刚做完测量、拿到线索，设备面却仍显示「未测量」——读数有没有发生过
        # 就没人知道（`measured` / `updated_turn` 都读 state_turns）。
        world.state[key] = new
        world.state_history.setdefault(key, []).append(new)
        world.state_turns.setdefault(key, []).append(world.turn)
        applied.append(
            AppliedEffect(
                key=key,
                op=effect.op.value,
                value=effect.value,
                old=old,
                new=new,
                turn=world.turn,
                source=source,
            )
        )
    return applied


def reveal_cues(pack: ScenarioPack, world: World, cue_ids: list[str]) -> list[str]:
    added: list[str] = []
    for cue_id in cue_ids:
        if cue_id in world.revealed or pack.cue(cue_id) is None:
            continue
        world.revealed.append(cue_id)
        world.revealed_turns[cue_id] = world.turn
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
    if kind is ClauseKind.CUE_REVEALED:
        return clause.cue_id in world.revealed
    if kind is ClauseKind.STATE_CMP:
        return _cmp(world.state.get(clause.key or ""), clause.op, clause.value)
    return False


def trigger_holds(pack: ScenarioPack, world: World, trigger: Trigger | None) -> bool:
    """空触发条件**在加载期就被拒绝**（不能同时被解释成恒真或恒假）；这里空表 → False。"""
    if trigger is None or not trigger.all:
        return False
    return all(clause_holds(pack, world, clause) for clause in trigger.all)


def visible_affordances(pack: ScenarioPack, world: World) -> list[Affordance]:
    """此刻**可用**的动作：只由 affordance 自身条件决定。"""
    return [
        affordance
        for affordance in pack.affordances
        if affordance.visible_when is None or trigger_holds(pack, world, affordance.visible_when)
    ]


def visible_devices(pack: ScenarioPack, world: World) -> list[Any]:
    """此刻**可见**的设备：作者门控成立，或模型用 `present_monitor` 主动摆出来过。"""
    out = []
    for device in pack.presentation.devices:
        if device.id in world.presented:
            out.append(device)
            continue
        if device.visible_when is None or trigger_holds(pack, world, device.visible_when):
            out.append(device)
    return out


def is_measured(world: World, key: str) -> bool:
    """这条读数在本场**真的产生过**（有过一次效果应用）——未测量不得用初值冒充。

    唯一判据：`state_turns` 比初值那一条更长。设备投影与"学生读得到什么"都用它。
    """
    return len(world.state_turns.get(key, [])) > 1


def exposed_state_keys(pack: ScenarioPack, world: World) -> set[str]:
    """**学生此刻读得到数**的状态键：可见设备的通道，**且这条读数真的产生过**。

    这是「可见状态」的唯一口径（读数归设备面板）：没挂在设备上的数值、以及还没测量过的通道，
    学生读到的都是「—」——模型也不能把它说成学生看到的值。
    """
    return {
        channel.ref
        for device in visible_devices(pack, world)
        for channel in device.channels
        if is_measured(world, channel.ref)
    }


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


# --------------------------------------------------------------------------- #
# 目标与可达性（**入口无关**的同一条判据）
# --------------------------------------------------------------------------- #


def target_declared(pack: ScenarioPack, target: TargetRef | None) -> bool:
    if target is None:
        return True
    if target.kind is TargetKind.SCENE:
        return target.id == "scene"
    if target.kind is TargetKind.ACTOR:
        return pack.actor(target.id) is not None
    return pack.device(target.id) is not None


def target_reachable(pack: ScenarioPack, world: World, target: TargetRef | None) -> bool:
    """可达判据只有这一条，与前端对象 chip 的过滤同源。

    - actor：此刻在场且不是 `inaccessible`（看得见、碰不着 → 不可搭话/不可作用）；
    - device：已声明且此刻可见（作者门控成立或已被 present）；
    - scene：恒可达。
    """
    if target is None:
        return True
    if target.kind is TargetKind.SCENE:
        return target.id == "scene"
    if target.kind is TargetKind.ACTOR:
        return effective_presence(pack, world, target.id) is not Presence.INACCESSIBLE
    device = pack.device(target.id)
    if device is None:
        return False
    return any(item.id == device.id for item in visible_devices(pack, world))


def state_label(pack: ScenarioPack, key: str) -> str:
    """给一个状态键取**人话**标签（设备通道 → 键尾），不把内部键名丢给学生/模型。"""
    for device in pack.presentation.devices:
        for channel in device.channels:
            if channel.ref == key:
                return channel.label
    return key.rsplit(".", maxsplit=1)[-1]


# --------------------------------------------------------------------------- #
# 结算：请求校验 → 唯一结算函数
# --------------------------------------------------------------------------- #


def _declared_options(affordance: Affordance | None) -> set[str]:
    if affordance is None:
        return set()
    return {str(option.get("id")) for option in affordance.params.get("options", [])}


def check_request(pack: ScenarioPack, world: World, *, request: TurnInput) -> None:
    """请求自身的形状校验：不合法 → `TurnRejected`（**不消耗回合、不写世界**）。

    可达性**不在**这里：已知但当下不可达的**实际尝试**是 `blocked`（消耗一个回合），
    不是请求错误——自由文本与按钮在这一点上判据完全相同。
    """
    if not target_declared(pack, request.target):
        raise TurnRejected("unknown_target", "这个目标不在当前情境里")
    if request.kind != "action" or request.affordance_id is None:
        return
    affordance = pack.affordance(request.affordance_id)
    if affordance is None:
        raise TurnRejected("unknown_affordance", "这个动作不在当前情境里")
    if affordance.targets and request.target is not None and request.target not in affordance.targets:
        raise TurnRejected("target_mismatch", "这个动作不能作用在这个目标上")
    if affordance.select in ("single", "multi"):
        declared = _declared_options(affordance)
        bad = [item for item in request.selection if item not in declared]
        if bad:
            raise TurnRejected("invalid_selection", "所选内容不属于这个动作")


def _blocked_by(pack: ScenarioPack, world: World, *, target: TargetRef | None, affordance: Affordance) -> str | None:
    if target is not None and not target_reachable(pack, world, target):
        return BLOCK_TARGET_UNREACHABLE
    if affordance.visible_when is not None and not trigger_holds(pack, world, affordance.visible_when):
        return BLOCK_AFFORDANCE_UNAVAILABLE
    return None


def _resolve_outcome(
    pack: ScenarioPack, world: World, *, request: TurnInput, affordance: Affordance | None
) -> tuple[AttemptOutcome, str]:
    """本回合世界的答复：`performed` / `blocked`（带处境原因）/ `unmodeled` / `speech`。"""
    if request.kind == "action":
        if affordance is None:
            return AttemptOutcome.UNMODELED, ""
        blocked = _blocked_by(pack, world, target=request.target, affordance=affordance)
        if blocked is not None:
            return AttemptOutcome.BLOCKED, blocked
        return AttemptOutcome.PERFORMED, ""
    if not target_reachable(pack, world, request.target):
        # **对不可达的人说话也是世界阻止的实际尝试**（消耗一个回合，如实回应"他不在/听不到"），
        # 与"按按钮"同判——不存在入口差异（docs/scenario.md 冻结规则）。
        return AttemptOutcome.BLOCKED, BLOCK_TARGET_UNREACHABLE
    return AttemptOutcome.SPEECH, ""


def _sanitize_selection(affordance: Affordance | None, request: TurnInput) -> list[str]:
    """学生自己选了选项时以他选的为准；不属于该动作的选项丢弃。"""
    if affordance is None:
        return []
    declared = _declared_options(affordance)
    return [item for item in request.selection if item in declared]


def settle_turn(
    pack: ScenarioPack,
    world: World,
    *,
    request: TurnInput,
    request_id: str,
    base_seq: int,
) -> ResolvedTurn:
    """**唯一**的确定性结算：动作自身效果 → 揭示 → 投影。

    调用方负责：先 `check_request`（不合法 → 不写世界），再把 world 的改动落成事件。
    模型循环在此之后运行，**只加不改**：它用工具演绎世界的回应，改不动这里的确定性部分。
    """
    problems: list[str] = []
    check_request(pack, world, request=request)

    affordance = pack.affordance(request.affordance_id) if request.affordance_id else None
    outcome, block_reason = _resolve_outcome(pack, world, request=request, affordance=affordance)

    # **时间的唯一判定**：`world.turn` 是**情境时间单位累计值**，只按包声明的 `time_cost` 增加。
    # 纯交流/观察/测量（`time_cost=0`）不花时间；`unmodeled` 不花；澄清/求提示不花；
    # 耗时动作**被世界阻止也照样花时间**（防"狂点被阻止"白刷）。
    time_cost = (
        affordance.time_cost
        if affordance is not None and outcome in (AttemptOutcome.PERFORMED, AttemptOutcome.BLOCKED)
        else 0
    )
    if time_cost:
        world.turn += time_cost
    turn = world.turn  # 发生的时间单位

    selection = _sanitize_selection(affordance, request)
    label = affordance.label if affordance is not None else (request.text or "（未建模的尝试）")
    world.actions.append(
        ActionRecord(
            turn=turn,
            affordance_id=affordance.id if affordance is not None else None,
            type="say" if request.kind == "speech" else "act",
            text=request.text or None,
            selected=selection,
            target=(request.target.model_dump(mode="json") if request.target else None),
            outcome=outcome.value,
            block_reason=block_reason,
            request_id=request_id,
            seq=0,  # 由落事件时回填
        )
    )

    effects: list[AppliedEffect] = []
    reveals: list[str] = []
    if outcome is AttemptOutcome.PERFORMED and affordance is not None:
        effects += apply_effects(pack, world, affordance.effects, source=f"affordance:{affordance.id}")
        reveals += reveal_cues(pack, world, affordance.reveals)

    return ResolvedTurn(
        request_id=request_id,
        base_seq=base_seq,
        turn=turn,
        time_cost=time_cost,
        outcome=outcome,
        block_reason=block_reason,
        action=ActionEcho(
            kind=request.kind,
            affordance_id=affordance.id if affordance is not None else None,
            label=label,
            target=request.target,
            text=request.text,
            selection=selection,
            outcome=outcome,
            block_reason=block_reason,
        ),
        effects=effects,
        reveals=reveals,
        facts=sorted(facts_observed(pack, world)),
        problems=problems,
    )


# --------------------------------------------------------------------------- #
# 事件折叠
# --------------------------------------------------------------------------- #


def _fold_action(world: World, payload: dict[str, Any], seq: int) -> None:
    world.turn = int(payload.get("turn", world.turn + 1))
    record = ActionRecord(
        **{k: v for k, v in (payload.get("action") or {}).items() if k in ActionRecord.__dataclass_fields__}
    )
    record.seq = seq
    record.turn = int(payload.get("turn", record.turn))
    world.actions.append(record)


def _fold_state_deltas(world: World, items: list[dict[str, Any]], *, default_turn: int) -> None:
    """把本回合的效果差量折进世界。

    未登记的状态键直接忽略（历史折叠**只读**，不重新校验声明）。
    """
    for item in items:
        key = str(item.get("key"))
        if key not in world.state:
            continue
        world.state[key] = item.get("new")
        world.state_history.setdefault(key, []).append(item.get("new"))
        world.state_turns.setdefault(key, []).append(int(item.get("turn", default_turn)))


def _fold_marks(world: World, *, reveals: list[Any], turn: int) -> None:
    """线索揭示：同一 id 只记第一次，`*_turns` 记**发生的时间单位**。"""
    for cue_id in reveals:
        if cue_id not in world.revealed:
            world.revealed.append(str(cue_id))
            world.revealed_turns[str(cue_id)] = turn


def _fold_images(world: World, images: list[Any]) -> None:
    """图片引用：`{asset_id,...}` 与（早期写法）裸 asset id 都折成同一种形状，并去重。"""
    for image in images:
        entry = {"asset_id": image, "caption": "", "origin": "pack"} if isinstance(image, str) else image
        if entry not in world.images:
            world.images.append(entry)


def _fold_presented(world: World, device_ids: list[Any]) -> None:
    for device_id in device_ids:
        if str(device_id) not in world.presented:
            world.presented.append(str(device_id))


def _fold_presence(world: World, changes: dict[str, Any]) -> None:
    for actor_id, presence in (changes or {}).items():
        world.presence[str(actor_id)] = str(presence)


def _fold_session_opened(world: World, payload: dict[str, Any], seq: int) -> None:
    """开场是**独立事件**（`session_opened`），但差量形状与 `turn_committed` 同构，折法共用一份。"""
    world.turn = 0
    _fold_state_deltas(world, list(payload.get("effects", [])), default_turn=0)
    _fold_marks(world, reveals=list(payload.get("reveals", [])), turn=0)
    _fold_images(world, list(payload.get("images", [])))
    _fold_presented(world, list(payload.get("presented", [])))
    _fold_presence(world, dict(payload.get("presence") or {}))
    attach_delivery(world, list(payload.get("messages", [])), turn=0, seq=seq)


def attach_delivery(
    world: World,
    messages: list[dict[str, Any]],
    *,
    turn: int,
    seq: int,
    notice_text: str = "",
    notice_kind: str = "",
) -> None:
    """把一次交付的消息挂到世界上（**落库前的暂存与回放折入用同一份实现**）。"""
    for index, message in enumerate(messages):
        _fold_message(world, message, seq=seq, turn=turn, index=index)
    if notice_text and notice_kind:
        world.notices.append({"turn": turn, "kind": notice_kind, "text": notice_text, "seq": seq, "index": 0})


def _fold_turn_committed(world: World, payload: dict[str, Any], seq: int) -> None:
    """一条 `turn_committed` = 一个完整回合（学生输入 + 结算差量 + 模型演绎 + 最终交付），原子写入。"""
    turn = int(payload.get("turn", world.turn + 1))
    world.turn = turn
    for entry in payload.get("actions") or []:
        _fold_action(world, {"turn": turn, "action": entry}, seq)
    _fold_state_deltas(world, list(payload.get("effects", [])), default_turn=turn)
    _fold_marks(world, reveals=list(payload.get("reveals", [])), turn=turn)
    notice_text = str(payload.get("notice_text") or "")
    notice_kind = str(payload.get("outcome") or "") if notice_text else ""
    attach_delivery(
        world,
        list(payload.get("messages", [])),
        turn=turn,
        seq=seq,
        notice_text=notice_text,
        notice_kind=notice_kind if notice_kind in ("blocked", "unmodeled") else "",
    )
    _fold_images(world, list(payload.get("images", [])))
    _fold_presented(world, list(payload.get("presented", [])))
    _fold_presence(world, dict(payload.get("presence") or {}))


def _fold_message(world: World, message: dict[str, Any], *, seq: int, turn: int, index: int) -> None:
    """把交付的一条消息折进世界：旁白进 `narrations`，角色台词进 `lines`。"""
    kind = str(message.get("kind") or "narration")
    text = str(message.get("text") or "")
    if not text:
        return
    speaker = message.get("speaker")
    origin = str(message.get("origin") or "dm")
    if speaker:
        world.lines.append(
            {
                "actor": speaker,
                "text": text,
                "as_role": message.get("as_role", ""),
                "ephemeral": bool(message.get("ephemeral")),
                "origin": origin,
                "turn": turn,
                "seq": seq,
                "index": index,
                "kind": kind,
            }
        )
    else:
        world.narrations.append(
            {"text": text, "turn": turn, "seq": seq, "index": index, "origin": origin, "kind": kind}
        )


def attach_clarification(world: World, *, turn: int, seq: int, text: str, question: str, request_id: str) -> None:
    """澄清交流：**不产生状态差量、不推进回合**，只在对话流里留下一条问题。"""
    world.clarifications.append(
        {"request_id": request_id, "turn": turn, "text": text, "clarification": question, "seq": seq}
    )


def attach_hint(
    world: World, *, turn: int, seq: int, text: str, messages: list[dict[str, Any]], request_id: str
) -> None:
    """求提示：只读教学交互——记录提示与其来源，**不推进世界**。"""
    world.hints.append({"request_id": request_id, "turn": turn, "text": text, "messages": messages, "seq": seq})


def _fold_clarification(world: World, payload: dict[str, Any], seq: int) -> None:
    attach_clarification(
        world,
        turn=int(payload.get("turn", world.turn)),
        seq=seq,
        text=str(payload.get("text", "")),
        question=str(payload.get("clarification", "")),
        request_id=str(payload.get("request_id", "")),
    )


def _fold_hint(world: World, payload: dict[str, Any], seq: int) -> None:
    attach_hint(
        world,
        turn=int(payload.get("turn", world.turn)),
        seq=seq,
        text=str(payload.get("text", "")),
        messages=list(payload.get("messages", [])),
        request_id=str(payload.get("request_id", "")),
    )


def _fold_closed(world: World, _payload: dict[str, Any], _seq: int) -> None:
    world.closed = True


_FOLDERS = {
    # 唯一写入路径（也是唯一读入路径）：这五种之外的事件不改变世界
    "session_opened": _fold_session_opened,
    "turn_committed": _fold_turn_committed,
    "clarification_exchange": _fold_clarification,
    "hint_requested": _fold_hint,
    "session_closed": _fold_closed,
}


def fold_event(world: World, event: dict[str, Any]) -> None:
    """把**一条**事件折进世界；旧机制的事件不改变世界。"""
    world.seq = int(event.get("seq") or world.seq)
    folder = _FOLDERS.get(str(event.get("kind")))
    if folder is not None:
        folder(world, event.get("payload") or {}, world.seq)


def world_from_events(pack: ScenarioPack, events: list[dict[str, Any]]) -> World:
    """从事件流重建世界（回放、经历页与教师回放共用这一份折法）。"""
    world = initial_world(pack)
    for event in events:
        fold_event(world, event)
    return world


__all__ = [
    "BLOCK_AFFORDANCE_UNAVAILABLE",
    "BLOCK_TARGET_UNREACHABLE",
    "ActionRecord",
    "TurnRejected",
    "World",
    "apply_effects",
    "attach_clarification",
    "attach_delivery",
    "attach_hint",
    "check_request",
    "clause_holds",
    "effective_presence",
    "exposed_state_keys",
    "facts_observed",
    "fold_event",
    "initial_world",
    "is_lost",
    "is_measured",
    "namespaced_key",
    "reveal_cues",
    "settle_turn",
    "state_label",
    "student_declaration",
    "target_declared",
    "target_reachable",
    "trigger_holds",
    "turn_word",
    "visible_affordances",
    "visible_devices",
    "world_from_events",
]
