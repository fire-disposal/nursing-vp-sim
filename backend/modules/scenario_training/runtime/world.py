"""情境训练 · 世界状态、唯一结算与事件折叠。

**世界 = 事件流的推导结果**（不另存一份可变状态）。本文件是三条规则唯一的实现处：
1. **动作效果**：`Affordance.effects` 的旧值/新值记账（`apply_effects`）；
2. **反应链**：条件相对本回合基线**由假变真**才触发；每回合每个反应最多一次，链式求值直到没有新反应
   （`fire_reactions`）——因此上界是本包反应数，且可重放；
3. **折叠**：把已提交事件还原成世界（`fold_event` / `world_from_events`），
   历史事件（旧机制的 `dm_turn` / `effects_applied` / `dm_step` …）**只读折叠**，不再有人写它们。

**唯一结算函数**是 `settle_turn`：显式动作与自由表达都先解析成同一个 `IntentResolution`，
再走这一条路——不存在「归属回填后补求一遍」的第二条路径（docs/23 §4.1）。
"""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any

from ..schema import (
    Affordance,
    AffordanceType,
    Clause,
    ClauseKind,
    Effect,
    EffectOp,
    ScenarioPack,
    Trigger,
)
from ..turns import (
    ActionEcho,
    AppliedEffect,
    AttemptOutcome,
    DeclarationKind,
    FocusState,
    IntentResolution,
    ResolvedTurn,
    SocialUpdate,
    TargetKind,
    TargetRef,
    TurnInput,
    VisibleEvent,
)

# 世界推进的三种结局（都会消耗一个情境回合）；`speech` 也推进（学生确实说了话）。
_TURN_OUTCOMES = (
    AttemptOutcome.SPEECH,
    AttemptOutcome.PERFORMED,
    AttemptOutcome.BLOCKED,
    AttemptOutcome.UNMODELED,
)

#: 只有**言语类**动作可以被「说话」意图归属（`say` 绝不等于已完成物理处置）。
_VERBAL = frozenset({AffordanceType.ASK, AffordanceType.SUMMON})

_DECLARED_TYPES: dict[str, DeclarationKind] = {"say": "say", "act": "act"}

BLOCK_TARGET_UNREACHABLE = "target_unreachable"
BLOCK_AFFORDANCE_UNAVAILABLE = "affordance_unavailable"


class TurnRejected(Exception):
    """请求自身的形状问题（未知目标/动作、目标与动作不匹配、非法选项）——**不消耗回合、不写世界**。"""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class WorldClosed(RuntimeError):
    """世界已不可写（会话结束/归档）。"""


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
    ad_hoc_cues: list[str] = field(default_factory=list)
    noticed_turns: dict[str, int] = field(default_factory=dict)  # 已可见细节 → 回合
    lines: list[dict[str, Any]] = field(default_factory=list)
    narrations: list[dict[str, Any]] = field(default_factory=list)
    notices: list[dict[str, Any]] = field(default_factory=list)  # 引擎直出的 system 消息（blocked / unmodeled / hint）
    clarifications: list[dict[str, Any]] = field(default_factory=list)
    hints: list[dict[str, Any]] = field(default_factory=list)
    # 旧机制遗留（只读回放用）：DM 声明的事实 / 白板笔记 / 选项 / 图片
    declared_facts: list[dict[str, Any]] = field(default_factory=list)
    images: list[dict[str, Any]] = field(default_factory=list)
    state_history: dict[str, list[Any]] = field(default_factory=dict)
    state_turns: dict[str, list[int]] = field(default_factory=dict)
    fired: list[str] = field(default_factory=list)
    fired_turns: dict[str, int] = field(default_factory=dict)  # 反应 id → 首次触发回合
    closed: bool = False
    read_only: bool = False

    def clone(self) -> World:
        return copy.deepcopy(self)

    def used(self, affordance_id: str | None) -> list[ActionRecord]:
        return [a for a in self.actions if a.affordance_id == affordance_id]

    def last_turn_used(self, affordance_id: str | None) -> int | None:
        turns = [a.turn for a in self.used(affordance_id)]
        return max(turns) if turns else None

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


# --------------------------------------------------------------------------- #
# 触发求值
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
        # 新机制由引擎判定"事实是否已被采集"（线索已揭示或动作已用过）；
        # 旧会话里 DM 声明过的事实同样算数（历史不被重新解释）。
        return clause.fact_id in facts_observed(pack, world) or any(
            fact.get("fact_id") == clause.fact_id for fact in world.declared_facts
        )
    if kind is ClauseKind.TURN_GTE:
        return world.turn >= (clause.count or 1)
    return False


def trigger_holds(pack: ScenarioPack, world: World, trigger: Trigger | None) -> bool:
    """空触发条件**在加载期就被拒绝**（不能同时被解释成恒真或恒假）；这里空表 → False。"""
    if trigger is None or not trigger.all:
        return False
    return all(clause_holds(pack, world, clause) for clause in trigger.all)


def visible_affordances(pack: ScenarioPack, world: World) -> list[Affordance]:
    """此刻**可用**的动作：只由 affordance 自身条件决定（教学关注点没有推进权）。"""
    return [
        affordance
        for affordance in pack.affordances
        if affordance.visible_when is None or trigger_holds(pack, world, affordance.visible_when)
    ]


def fire_reactions(
    pack: ScenarioPack, world: World, before: World, *, initial: bool = False
) -> tuple[list[str], list[AppliedEffect], list[str]]:
    """**唯一**的反应链算法（docs/23 §4.3）：

    1. 动作效果与揭示**先**应用（调用方已做）；
    2. 找出条件相对本回合基线**由假变真**的反应，按包声明顺序执行；
    3. 每轮求值用上一轮效果应用后的世界，链式继续，直到没有新反应；上界 = 本包反应数；
    4. `once=true` 保持会话内只触发一次；`once=false` 需要后续回合重新形成边沿（条件一直为真不会每轮重复）；
    5. 开场：基线按「尚未评估」处理（`initial=True`），初始就成立的反应结算一次。

    返回 `(fired_ids, effects, reveals)`。
    """
    fired: list[str] = []
    effects: list[AppliedEffect] = []
    reveals: list[str] = []
    baseline = before
    unevaluated = initial
    for _ in range(len(pack.reactions)):
        picked = next(
            (
                reaction
                for reaction in pack.reactions
                if reaction.id not in fired
                and not (reaction.once and reaction.id in world.fired)
                and trigger_holds(pack, world, reaction.when)
                and (unevaluated or not trigger_holds(pack, baseline, reaction.when))
            ),
            None,
        )
        if picked is None:
            break
        effects += apply_effects(pack, world, picked.effects, source=f"reaction:{picked.id}")
        reveals += reveal_cues(pack, world, picked.reveals)
        world.fired.append(picked.id)
        world.fired_turns.setdefault(picked.id, world.turn)
        fired.append(picked.id)
        unevaluated = False
        baseline = world.clone()  # 下一轮基线 = 上一轮效果应用之后
    return fired, effects, reveals


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

    - actor：`presence != inaccessible`（看得见、碰不着 → 不可搭话/不可作用）；
    - device：已声明且其 `visible_when` 成立（例如"化验回报要等检查下过"）；
    - scene：恒可达。
    """
    if target is None:
        return True
    if target.kind is TargetKind.SCENE:
        return target.id == "scene"
    if target.kind is TargetKind.ACTOR:
        actor = pack.actor(target.id)
        return actor is not None and actor.presence.value != "inaccessible"
    device = pack.device(target.id)
    if device is None:
        return False
    return device.visible_when is None or trigger_holds(pack, world, device.visible_when)


def contactable_actor(pack: ScenarioPack, actor_id: str) -> bool:
    actor = pack.actor(actor_id)
    return actor is not None and actor.presence.value != "inaccessible"


def state_label(pack: ScenarioPack, key: str) -> str:
    """给一个状态键取**人话**标签（设备通道 → 白板版块 → 键尾），不把内部键名丢给学生/模型。"""
    for device in pack.presentation.devices:
        for channel in device.channels:
            if channel.ref == key:
                return channel.label
    for section in pack.presentation.board:
        if key in section.refs:
            return section.label_for(key)
    return key.rsplit(".", maxsplit=1)[-1]


# --------------------------------------------------------------------------- #
# 结算：请求校验 → 唯一结算函数
# --------------------------------------------------------------------------- #


def _declared_options(affordance: Affordance | None) -> set[str]:
    if affordance is None:
        return set()
    return {str(option.get("id")) for option in affordance.params.get("options", [])}


def check_request(
    pack: ScenarioPack,
    world: World,
    *,
    request: TurnInput,
    intent: IntentResolution,
) -> None:
    """请求自身的形状校验：不合法 → `TurnRejected`（**不消耗回合、不写世界**）。

    可达性**不在**这里：已知但当下不可达的**实际尝试**是 `blocked`（消耗一个回合），
    不是请求错误——自由文本与按钮在这一点上判据完全相同。
    """
    target = intent.target
    # 请求自己声明的目标同样要校验：模型不回声（或回声丢了）时，未知目标不能因此溜过去
    if not target_declared(pack, request.target):
        raise TurnRejected("unknown_target", "这个目标不在当前情境里")
    if not target_declared(pack, target):
        raise TurnRejected("unknown_target", "这个目标不在当前情境里")
    if request.kind == "action" and intent.affordance_id is not None:
        affordance = pack.affordance(intent.affordance_id)
        if affordance is None:
            raise TurnRejected("unknown_affordance", "这个动作不在当前情境里")
        if affordance.targets and target is not None and target not in affordance.targets:
            raise TurnRejected("target_mismatch", "这个动作不能作用在这个目标上")
        if affordance.select in ("single", "multi") and request.affordance_id is not None:
            declared = _declared_options(affordance)
            bad = [item for item in intent.selection if item not in declared]
            if bad:
                raise TurnRejected("invalid_selection", "所选内容不属于这个动作")


def _effective_affordance(
    pack: ScenarioPack, world: World, *, request: TurnInput, intent: IntentResolution, problems: list[str]
) -> Affordance | None:
    """这次尝试落在哪个动作上（或 None = 未建模）。

    - `speech`：**只有言语类动作**可以被归属（叫医生、发问）；把说话解读成物理处置一律丢弃；
    - `action`：请求自己点名了动作（结构化入口）就用它；自由文本则用解析结果；
    - 解析给出的动作必须是本包已声明的（未声明 → 未建模，并记账）。
    """
    affordance_id = intent.affordance_id
    if affordance_id is None:
        return None
    affordance = pack.affordance(affordance_id)
    if affordance is None:
        problems.append(f"undeclared_affordance:{affordance_id}")
        return None
    if request.kind == "speech" and affordance.type not in _VERBAL:
        problems.append(f"speech_attribution_dropped:{affordance_id}")
        return None
    return affordance


def _blocked_by(pack: ScenarioPack, world: World, *, target: TargetRef | None, affordance: Affordance) -> str | None:
    if target is not None and not target_reachable(pack, world, target):
        return BLOCK_TARGET_UNREACHABLE
    if affordance.visible_when is not None and not trigger_holds(pack, world, affordance.visible_when):
        return BLOCK_AFFORDANCE_UNAVAILABLE
    return None


def _writable_keys(pack: ScenarioPack, actor_id: str) -> dict[str, Any]:
    actor = pack.actor(actor_id)
    if actor is None:
        return {}
    out: dict[str, Any] = {}
    for item in actor.dm_writable:
        key = item.key if "." in item.key else f"{actor_id}.{item.key}"
        out[key] = item
    return out


def _social_next(
    spec: Any,
    update: SocialUpdate,
    old: Any,
    key: str,
    problems: list[str],
) -> tuple[bool, Any]:
    """按声明规格算出提案的新值；不合规 → `(False, None)` 并记账（世界不变）。

    增量只对**数值**旧值有效，且受 `max_delta` 上限；随后统一做类型与 `lo`/`hi` 范围检查
    （增量后的结果同样要过范围）。
    """
    numeric_old = isinstance(old, (int, float)) and not isinstance(old, bool)
    if numeric_old and update.op in (EffectOp.INCR, EffectOp.DECR):
        delta = update.value if isinstance(update.value, (int, float)) and not isinstance(update.value, bool) else 0
        if spec.max_delta is not None and abs(delta) > spec.max_delta:
            problems.append(f"social_delta_too_large:{key}")
            return False, None
        new: Any = old + delta if update.op is EffectOp.INCR else old - delta
    else:
        new = update.value
    if spec.kind == "bool" and not isinstance(new, bool):
        problems.append(f"social_type_mismatch:{key}")
        return False, None
    if spec.kind == "int" and (isinstance(new, bool) or not isinstance(new, (int, float))):
        problems.append(f"social_type_mismatch:{key}")
        return False, None
    if isinstance(new, (int, float)) and not isinstance(new, bool):
        if spec.lo is not None and new < spec.lo:
            problems.append(f"social_out_of_range:{key}")
            return False, None
        if spec.hi is not None and new > spec.hi:
            problems.append(f"social_out_of_range:{key}")
            return False, None
    return True, new


def _apply_social(
    pack: ScenarioPack,
    world: World,
    proposals: list[SocialUpdate],
    *,
    deterministic: set[str],
) -> tuple[list[AppliedEffect], list[str]]:
    """人物状态提案：只允许本 actor 声明过的 `dm_writable` 键。

    冲突以**确定性规则为准**：同一回合里动作/反应已经改过的键，模型提案直接拒绝并记账
    （数值、测量结果、风险结局、设备状态与动作完成状态永远不在写集里——校验层保证）。
    """
    applied: list[AppliedEffect] = []
    problems: list[str] = []
    seen: set[str] = set()
    for update in proposals:
        key = update.key if "." in update.key else f"{update.key}"
        actor_id = key.split(".", 1)[0]
        spec = _writable_keys(pack, actor_id).get(key)
        if spec is None:
            problems.append(f"social_key_not_writable:{key}")
            continue
        if key in deterministic:
            problems.append(f"social_conflict_resolved_deterministically:{key}")
            continue
        if key in seen:
            problems.append(f"social_duplicate_proposal:{key}")
            continue
        old = world.state.get(key)
        ok, new = _social_next(spec, update, old, key, problems)
        if not ok or old == new:
            continue
        world.state[key] = new
        world.state_history.setdefault(key, []).append(new)
        world.state_turns.setdefault(key, []).append(world.turn)
        seen.add(key)
        applied.append(
            AppliedEffect(
                key=key,
                op=update.op.value,
                value=update.value,
                old=old,
                new=new,
                turn=world.turn,
                source=f"social:{key}",
            )
        )
    return applied, problems


def _resolve_outcome(
    pack: ScenarioPack,
    world: World,
    *,
    request: TurnInput,
    intent: IntentResolution,
    affordance: Affordance | None,
) -> tuple[AttemptOutcome, str]:
    """本回合世界的答复：`performed` / `blocked`（带处境原因）/ `unmodeled`。

    「可达」判据与前端对象 chip 同源，**入口无关**：自由文本与按钮同判（docs/23 §5.1）。
    """
    if request.kind == "action":
        if affordance is None:
            return AttemptOutcome.UNMODELED, ""
        blocked = _blocked_by(pack, world, target=intent.target, affordance=affordance)
        if blocked is not None:
            return AttemptOutcome.BLOCKED, blocked
        return AttemptOutcome.PERFORMED, ""
    if affordance is not None:
        blocked = _blocked_by(pack, world, target=intent.target or request.target, affordance=affordance)
        if blocked is not None:
            return AttemptOutcome.BLOCKED, blocked
        return AttemptOutcome.PERFORMED, ""
    if not target_reachable(pack, world, intent.target or request.target):
        # **对不可达的人说话也是世界阻止的实际尝试**（消耗一个回合，如实回应"他不在/听不到"），
        # 与"按按钮"同判——不存在入口差异（docs/23 §5.1 冻结规则）。
        return AttemptOutcome.BLOCKED, BLOCK_TARGET_UNREACHABLE
    return AttemptOutcome.SPEECH, ""


def _sanitize_selection(
    affordance: Affordance | None,
    request: TurnInput,
    intent: IntentResolution,
    problems: list[str],
) -> list[str]:
    """学生自己选了选项时以他选的为准（模型不得改写）；自由文本路径的非法值丢弃并记账。"""
    selection = list(intent.selection)
    if affordance is None:
        return selection
    declared = _declared_options(affordance)
    if request.affordance_id is None:
        dropped = [item for item in selection if item not in declared]
        if dropped:
            problems.append(f"dropped_undeclared_selection:{','.join(dropped)}")
    return [item for item in selection if item in declared]


def _turn_visible_events(
    pack: ScenarioPack,
    *,
    action_ref: str,
    label: str,
    turn: int,
    effects: list[AppliedEffect],
    reveals: list[str],
    fired: list[str],
    social: list[AppliedEffect],
    outcome: AttemptOutcome,
    block_reason: str,
    request: TurnInput,
) -> list[VisibleEvent]:
    """本回合**已经发生**的可见事件：动作、效果、线索、反应、人物状态、被阻止/未建模。"""
    visible: list[VisibleEvent] = [VisibleEvent(kind="action", ref=action_ref, text=label, turn=turn)]
    for item in effects:
        # 数值没变时它是**一次确认的读数**（复测仍 88），不是"变化"——不写 `A → A`
        change = f"{item.old} → {item.new}" if item.old != item.new else f"{item.new}"
        visible.append(
            VisibleEvent(
                kind="effect",
                ref=f"effect:{item.key}",
                text=f"{state_label(pack, item.key)}：{change}",
                turn=turn,
            )
        )
    for cue_id in reveals:
        cue = pack.cue(cue_id)
        if cue is not None:
            visible.append(VisibleEvent(kind="reveal", ref=f"cue:{cue_id}", text=cue.text, turn=turn))
    for reaction_id in fired:
        reaction = next((item for item in pack.reactions if item.id == reaction_id), None)
        if reaction is not None:
            visible.append(
                VisibleEvent(kind="reaction", ref=f"reaction:{reaction_id}", text=reaction.intent, turn=turn)
            )
    for item in social:
        visible.append(
            VisibleEvent(
                kind="social",
                ref=f"effect:{item.key}",
                text=f"{state_label(pack, item.key)}：{item.old} → {item.new}",
                turn=turn,
            )
        )
    if outcome is AttemptOutcome.BLOCKED:
        visible.append(VisibleEvent(kind="blocked", ref=f"blocked:{block_reason}", text=block_reason, turn=turn))
    if outcome is AttemptOutcome.UNMODELED:
        visible.append(VisibleEvent(kind="unmodeled", ref="unmodeled", text=request.text or "", turn=turn))
    return visible


def settle_turn(
    pack: ScenarioPack,
    world: World,
    *,
    request: TurnInput,
    intent: IntentResolution,
    request_id: str,
    base_seq: int,
) -> ResolvedTurn:
    """**唯一**的确定性结算：动作自身效果 → 揭示 → 反应链 → 人物状态提案 → 投影。

    调用方负责：先 `check_request`，再把 world 的改动落成事件；本函数只改 `world` 与返回值。
    """
    problems: list[str] = []
    check_request(pack, world, request=request, intent=intent)  # 不合法 → TurnRejected（不写世界）
    baseline = world.clone()

    affordance = _effective_affordance(pack, world, request=request, intent=intent, problems=problems)
    outcome, block_reason = _resolve_outcome(pack, world, request=request, intent=intent, affordance=affordance)

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

    selection = _sanitize_selection(affordance, request, intent, problems)

    label = affordance.label if affordance is not None else (request.text or "（未建模的尝试）")
    record = ActionRecord(
        turn=turn,
        affordance_id=affordance.id if affordance is not None else None,
        type="say" if request.kind == "speech" else "act",
        text=request.text or None,
        selected=selection,
        target=(intent.target.model_dump(mode="json") if intent.target else None),
        outcome=outcome.value,
        block_reason=block_reason,
        request_id=request_id,
        seq=0,  # 由落事件时回填
    )
    world.actions.append(record)

    effects: list[AppliedEffect] = []
    reveals: list[str] = []
    if outcome is AttemptOutcome.PERFORMED and affordance is not None:
        effects += apply_effects(pack, world, affordance.effects, source=f"affordance:{affordance.id}")
        reveals += reveal_cues(pack, world, affordance.reveals)

    fired, reaction_effects, reaction_reveals = fire_reactions(pack, world, baseline)
    effects += reaction_effects
    reveals += reaction_reveals

    deterministic = {item.key for item in effects}
    social, social_problems = _apply_social(pack, world, intent.social_updates, deterministic=deterministic)
    problems += social_problems

    visible = _turn_visible_events(
        pack,
        action_ref=f"action:{affordance.id}" if affordance is not None else "action:unmodeled",
        label=label,
        turn=turn,
        effects=effects,
        reveals=reveals,
        fired=fired,
        social=social,
        outcome=outcome,
        block_reason=block_reason,
        request=request,
    )

    focus = project_focus(pack, world)
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
            target=intent.target,
            text=request.text,
            selection=selection,
            outcome=outcome,
            block_reason=block_reason,
        ),
        effects=effects,
        reveals=reveals,
        reactions=fired,
        social=social,
        visible_events=visible,
        facts=sorted(facts_observed(pack, world)),
        focus=focus,
        problems=problems,
    )


# --------------------------------------------------------------------------- #
# 教学关注点投影（取代锚点任务机）
# --------------------------------------------------------------------------- #


def project_focus(pack: ScenarioPack, world: World) -> list[FocusState]:
    """关注点只是**投影**：相关/已处理的布尔值 + 证据，不另立状态存储。"""
    out: list[FocusState] = []
    for item in pack.teaching_focus:
        relevant = item.relevant_when is None or trigger_holds(pack, world, item.relevant_when)
        addressed = item.addressed_when is not None and trigger_holds(pack, world, item.addressed_when)
        out.append(
            FocusState(
                id=item.id,
                intent=item.intent,
                relevant=relevant,
                addressed=addressed,
                evidence_refs=list(item.evidence_refs),
            )
        )
    return out


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
    """把本回合的效果/人物状态差量折进世界。

    未登记的状态键直接忽略（历史折叠**只读**，不重新校验声明）。
    """
    for item in items:
        key = str(item.get("key"))
        if key not in world.state:
            continue
        world.state[key] = item.get("new")
        world.state_history.setdefault(key, []).append(item.get("new"))
        world.state_turns.setdefault(key, []).append(int(item.get("turn", default_turn)))


def _fold_marks(world: World, *, reveals: list[Any], reactions: list[Any], turn: int) -> None:
    """线索揭示与反应触发：同一 id 只记第一次，`*_turns` 记**发生的时间单位**。"""
    for cue_id in reveals:
        if cue_id not in world.revealed:
            world.revealed.append(str(cue_id))
            world.revealed_turns[str(cue_id)] = turn
    for reaction_id in reactions:
        if reaction_id not in world.fired:
            world.fired.append(str(reaction_id))
            world.fired_turns[str(reaction_id)] = turn


def _fold_images(world: World, images: list[Any]) -> None:
    """图片引用：`{asset_id,...}` 与（早期写法）裸 asset id 都折成同一种形状，并去重。"""
    for image in images:
        entry = {"asset_id": image, "caption": "", "origin": "pack"} if isinstance(image, str) else image
        if entry not in world.images:
            world.images.append(entry)


def _fold_noticed(world: World, texts: list[Any], *, turn: int) -> None:
    """DM 即兴提到的环境细节（`ad_hoc_cues`）：保留出现的时间单位，去重。"""
    for text in texts:
        if text not in world.ad_hoc_cues:
            world.ad_hoc_cues.append(str(text))
            world.noticed_turns[str(text)] = turn


def _fold_session_opened(world: World, payload: dict[str, Any], seq: int) -> None:
    """开场是**独立事件**（`session_opened`），但差量形状与 `turn_committed` 同构，折法共用一份。"""
    world.turn = 0
    _fold_state_deltas(world, list(payload.get("effects", [])), default_turn=0)
    _fold_marks(world, reveals=list(payload.get("reveals", [])), reactions=list(payload.get("reactions", [])), turn=0)
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
    """一条 `turn_committed` = 一个完整回合（学生输入 + 结算差量 + 最终交付），原子写入。"""
    turn = int(payload.get("turn", world.turn + 1))
    world.turn = turn
    for entry in payload.get("actions") or []:
        _fold_action(world, {"turn": turn, "action": entry}, seq)
    _fold_state_deltas(world, [*payload.get("effects", []), *payload.get("social", [])], default_turn=turn)
    _fold_marks(
        world, reveals=list(payload.get("reveals", [])), reactions=list(payload.get("reactions", [])), turn=turn
    )
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
    _fold_noticed(world, list(payload.get("noticed", [])), turn=turn)


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


# —— 旧机制事件：**只读**折叠（历史回放用，不再有人写它们） ——


def _fold_legacy_attribution(world: World, payload: dict[str, Any], _seq: int) -> None:
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


def _fold_legacy_effects(world: World, payload: dict[str, Any], _seq: int) -> None:
    for item in payload.get("items", []):
        key = str(item.get("key"))
        if key not in world.state:
            continue
        world.state[key] = item.get("new")
        world.state_history.setdefault(key, []).append(item.get("new"))
        world.state_turns.setdefault(key, []).append(world.turn)


def _fold_legacy_cues(world: World, payload: dict[str, Any], _seq: int) -> None:
    for cue_id in payload.get("cue_ids", []):
        if cue_id not in world.revealed:
            world.revealed.append(str(cue_id))
            world.revealed_turns[str(cue_id)] = world.turn
    for text in payload.get("ad_hoc", []):
        if text not in world.ad_hoc_cues:
            world.ad_hoc_cues.append(str(text))
            world.noticed_turns[str(text)] = world.turn
    for image in payload.get("images", []):
        # 事件里可能是 {asset_id,...} 或（早期写法）裸 asset id：两种都折成同一种形状
        entry = {"asset_id": image, "caption": "", "origin": "pack"} if isinstance(image, str) else image
        if entry not in world.images:
            world.images.append(entry)


def _fold_legacy_dm_turn(world: World, payload: dict[str, Any], seq: int) -> None:
    turn = int(payload.get("turn", world.turn))
    index = 0
    if payload.get("narration"):
        world.narrations.append(
            {
                "text": payload["narration"],
                "turn": turn,
                "seq": seq,
                "index": index,
                "origin": "dm",
                "kind": "narration",
            }
        )
        index += 1
    for line in payload.get("lines", []):
        world.lines.append(
            {
                **line,
                "turn": turn,
                "seq": seq,
                "index": index,
                "kind": "speech",
            }
        )
        index += 1
    world.declared_facts.extend(payload.get("facts_declared", []))
    for reaction_id in payload.get("fired", []):
        if reaction_id not in world.fired:
            world.fired.append(str(reaction_id))
            world.fired_turns[str(reaction_id)] = turn


def _fold_legacy_entity_line(world: World, payload: dict[str, Any], seq: int) -> None:
    line = dict(payload.get("line") or {})
    if line:
        world.lines.append({**line, "turn": world.turn, "seq": seq, "index": 0, "kind": "speech"})


_FOLDERS = {
    # 新机制（唯一写入路径）
    "session_opened": _fold_session_opened,
    "turn_committed": _fold_turn_committed,
    "clarification_exchange": _fold_clarification,
    "hint_requested": _fold_hint,
    "session_closed": _fold_closed,
    # 旧机制（只读回放）
    "student_action": _fold_action,
    "action_attributed": _fold_legacy_attribution,
    "effects_applied": _fold_legacy_effects,
    "cues_revealed": _fold_legacy_cues,
    "dm_turn": _fold_legacy_dm_turn,
    "entity_line": _fold_legacy_entity_line,
}


def fold_event(world: World, event: dict[str, Any]) -> None:
    """把**一条**事件折进世界；未知/已废弃的事件（`dm_step` / `anchor_*` / `judge_result`）不改变世界。"""
    world.seq = int(event.get("seq") or world.seq)
    folder = _FOLDERS.get(str(event.get("kind")))
    if folder is not None:
        folder(world, event.get("payload") or {}, world.seq)


def world_from_events(pack: ScenarioPack, events: list[dict[str, Any]]) -> World:
    """从事件流重建世界（回放、经历页、归档与教师回放共用这一份折法）。"""
    world = initial_world(pack)
    for event in events:
        fold_event(world, event)
    return world


def exposed_state_keys(pack: ScenarioPack) -> set[str]:
    """**学生此刻能看到**的状态键：设备通道 + 白板 refs + HUD 的 state 槽。

    这是「可见状态」的唯一口径：演出素材与来源引用都按它收口，别的键一律不算已可见。
    """
    keys: set[str] = set()
    for device in pack.presentation.devices:
        keys |= {channel.ref for channel in device.channels}
    for section in pack.presentation.board:
        keys |= set(section.refs)
    for slot in pack.presentation.hud:
        if slot.source == "state" and slot.ref:
            keys.add(slot.ref)
    return keys


def visible_refs(pack: ScenarioPack, world: World) -> set[str]:
    """学生可见事实的**稳定引用集合**（演出的 `sources` / `highlights` 白名单）。"""
    refs = {f"cue:{cue_id}" for cue_id in world.revealed if pack.cue(cue_id) is not None}
    refs |= {f"action:{action.affordance_id}" for action in world.actions if action.affordance_id}
    refs |= {f"reaction:{reaction_id}" for reaction_id in world.fired}
    exposed = exposed_state_keys(pack)
    refs |= {f"effect:{key}" for key in world.state if key in exposed}
    return refs


__all__ = [
    "BLOCK_AFFORDANCE_UNAVAILABLE",
    "BLOCK_TARGET_UNREACHABLE",
    "ActionRecord",
    "TurnRejected",
    "World",
    "WorldClosed",
    "apply_effects",
    "attach_clarification",
    "attach_delivery",
    "attach_hint",
    "check_request",
    "clause_holds",
    "contactable_actor",
    "exposed_state_keys",
    "facts_observed",
    "fire_reactions",
    "fold_event",
    "initial_world",
    "is_lost",
    "namespaced_key",
    "project_focus",
    "reveal_cues",
    "settle_turn",
    "state_label",
    "student_declaration",
    "target_declared",
    "target_reachable",
    "trigger_holds",
    "turn_word",
    "visible_affordances",
    "visible_refs",
    "world_from_events",
]
