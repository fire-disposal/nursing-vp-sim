"""pack 的**加载期**校验：形状由 pydantic 管，这里管引用闭合、词表闭合与可达性。

原则：坏包在**加载时**失败，不在会话中途炸（docs/20 §九）。校验只报问题、不修改内容；
本轨的包校验是**检查器**不是门禁（`state="experimental"` 允许犯错，仅记录风险）。
"""

from __future__ import annotations

from typing import Any

from .dm.contract import banned_terms
from .runtime.world import namespaced_key
from .schema import AffordanceType, Clause, EffectOp, JudgeRuleKind, ScenarioPack, Trigger

_RULE_AFFORDANCE_KEYS: dict[JudgeRuleKind, tuple[str, ...]] = {
    JudgeRuleKind.FIRST_ACTION: ("affordances",),
    JudgeRuleKind.AVOID_REPEAT: ("affordance_id",),
    JudgeRuleKind.REQUIRE_WITHIN: ("affordances",),
    JudgeRuleKind.ACTION_SET_COVERS: ("affordances",),
    JudgeRuleKind.ACTION_ORDER: ("first", "then"),
    JudgeRuleKind.OPTION_CHOICE: ("affordances",),
}

_NEEDS_AFFORDANCE = frozenset({"action_used", "action_count_gte", "turns_without_action"})


class _Index:
    """一次算好的引用集合（避免每处重复推导）。"""

    def __init__(self, pack: ScenarioPack) -> None:
        self.actors = {a.id for a in pack.actors}
        self.cues = {c.id for c in pack.setting.cues}
        self.facts = {f.id for f in pack.facts}
        self.affordances = {a.id for a in pack.affordances}
        self.state_keys = set(pack.state_keys)

    @property
    def targets(self) -> set[str]:
        return self.actors | {"scene"}


def validate_pack(pack: ScenarioPack) -> list[str]:
    """返回问题清单；空列表 = 可加载。"""
    index = _Index(pack)
    problems: list[str] = []
    problems += _check_ids(pack)
    problems += _check_state_keys(pack, index)
    problems += _check_affordances(pack, index)
    problems += _check_reactions(pack, index)
    problems += _check_leaks(pack)
    problems += _check_assets(pack)
    problems += _check_hud(pack, index)
    problems += _check_board(pack, index)
    problems += _check_devices(pack, index)
    problems += _check_cues(pack, index)
    problems += _check_facts(pack, index)
    problems += _check_judgment(pack, index)
    problems += _check_failure(pack, index)
    problems += _check_anchors(pack, index)
    return problems


def _duplicates(label: str, ids: list[str]) -> list[str]:
    seen: set[str] = set()
    dupes: list[str] = []
    for item in ids:
        if item in seen:
            dupes.append(f"{label} id 重复：{item}")
        seen.add(item)
    return dupes


def _check_ids(pack: ScenarioPack) -> list[str]:
    problems: list[str] = []
    for label, ids in (
        ("actor", [a.id for a in pack.actors]),
        ("affordance", [a.id for a in pack.affordances]),
        ("cue", [c.id for c in pack.setting.cues]),
        ("reaction", [r.id for r in pack.reactions]),
        ("fact", [f.id for f in pack.facts]),
        ("criterion", [d.id for d in pack.rubric]),
        ("dim", [d.id for d in pack.dims]),
        ("asset", [a.id for a in pack.assets]),
    ):
        problems += _duplicates(label, ids)
    return problems


def _check_state_keys(pack: ScenarioPack, index: _Index) -> list[str]:
    problems: list[str] = []
    for key in pack.state_keys:
        if "." not in key:
            problems.append(f"状态键必须为 <target>.<key> 形式：{key}")
            continue
        target = key.split(".", 1)[0]
        if target not in index.targets:
            problems.append(f"状态键目标未知：{key}")
    return problems


def _check_effects(pack: ScenarioPack, index: _Index, effects: list[Any], where: str) -> list[str]:
    problems: list[str] = []
    for effect in effects:
        key = namespaced_key(effect)
        if key not in index.state_keys:
            problems.append(f"{where}: 未登记状态键 {key}")
        if effect.target not in index.targets:
            problems.append(f"{where}: 未知效果目标 {effect.target}")
        if effect.op is not EffectOp.SET and not isinstance(effect.value, (int, float)):
            problems.append(f"{where}: {effect.op.value} 需要数值，收到 {effect.value!r}")
    return problems


def _check_affordances(pack: ScenarioPack, index: _Index) -> list[str]:
    problems: list[str] = []
    for affordance in pack.affordances:
        where = f"affordance {affordance.id}"
        if affordance.type not in pack.player.can:
            problems.append(f"{where}: 类型 {affordance.type} 不在 player.can 中")
        for cue_id in affordance.reveals:
            if cue_id not in index.cues:
                problems.append(f"{where}: 揭示了未知线索 {cue_id}")
        for actor_id in affordance.perceptible_by:
            if actor_id not in index.actors:
                problems.append(f"{where}: 感知者未知 {actor_id}")
        problems += _check_effects(pack, index, affordance.effects, where)
        if affordance.select in ("single", "multi") and not affordance.params.get("options"):
            problems.append(f"{where}: select={affordance.select} 但缺少 params.options")
        if affordance.type is AffordanceType.DOCUMENT and not affordance.params.get("fields"):
            problems.append(f"{where}: document 缺少 params.fields")
    return problems


def _check_reactions(pack: ScenarioPack, index: _Index) -> list[str]:
    problems: list[str] = []
    for reaction in pack.reactions:
        where = f"reaction {reaction.id}"
        if reaction.by not in index.actors:
            problems.append(f"{where}: 未知行为者 {reaction.by}")
        for cue_id in reaction.reveals:
            if cue_id not in index.cues:
                problems.append(f"{where}: 揭示了未知线索 {cue_id}")
        problems += _check_effects(pack, index, reaction.effects, where)
        problems += _check_trigger(pack, index, reaction.when, where)
    return problems


def _check_leaks(pack: ScenarioPack) -> list[str]:
    """开场就可见的文案不得泄底（按钮文案的运行期检查见 §十三 验收句 2）。"""
    banned = banned_terms(pack)
    visible: list[tuple[str, str]] = [
        (f"pack.title={pack.title}", pack.title),
        (f"pack.one_line={pack.one_line}", pack.one_line),
    ]
    visible += [(f"affordance {a.id}", a.label) for a in pack.affordances]
    visible += [(f"asset {a.id}", f"{a.title} {a.alt}") for a in pack.assets]
    visible += [(f"cue {c.id}", c.text) for c in pack.setting.cues if c.visible_from_start]
    problems: list[str] = []
    for where, text in visible:
        hit = next((term for term in banned if term in text), None)
        if hit is not None:
            problems.append(f"{where}: 文案含禁用词 {hit}（会向学生泄底）")
    return problems


def _check_cues(pack: ScenarioPack, index: _Index) -> list[str]:
    problems: list[str] = []
    mentioned = {cue_id for aff in pack.affordances for cue_id in aff.reveals}
    mentioned |= {cue_id for reaction in pack.reactions for cue_id in reaction.reveals}
    for cue in pack.setting.cues:
        if not cue.visible_from_start and cue.id not in mentioned:
            problems.append(f"cue {cue.id}: 既非开场可见、也无人揭示（死线索）")
    return problems


def _check_assets(pack: ScenarioPack) -> list[str]:
    """资源声明必须可用；**字节是否已上传不在加载期判断**（不做 IO，由管理侧/安装时报告）。"""
    problems: list[str] = []
    for asset in pack.assets:
        if asset.kind != "image":
            problems.append(f"asset {asset.id}: 暂不支持的资源类型 {asset.kind}")
        if not asset.alt:
            problems.append(f"asset {asset.id}: 缺 alt（无图也要可读）")
    return problems


def _check_hud(pack: ScenarioPack, index: _Index) -> list[str]:
    """HUD 槽位的门控必须指向本包内的线索/动作/状态（与反应共用同一套封闭词汇）。"""
    problems: list[str] = []
    for position, slot in enumerate(pack.presentation.hud):
        where = f"hud slot {position}:{slot.slot}"
        if slot.source == "state" and not slot.ref:
            problems.append(f"{where}: source=state 需要 ref")
        if slot.ref is not None and slot.source == "state" and slot.ref not in index.state_keys:
            problems.append(f"{where}: 未登记状态键 {slot.ref}")
        problems += _check_trigger(pack, index, slot.visible_when, where)
    return problems


def _check_board(pack: ScenarioPack, index: _Index) -> list[str]:
    """线索板版块：来源合法、state 的 refs 必须已登记、门控引用有效、id 不重复。"""
    problems: list[str] = _duplicates("board section", [section.id for section in pack.presentation.board])
    for section in pack.presentation.board:
        where = f"board {section.id}"
        if section.source == "state":
            if not section.refs:
                problems.append(f"{where}: source=state 需要 refs")
            for ref in section.refs:
                if ref not in index.state_keys:
                    problems.append(f"{where}: 未登记状态键 {ref}")
        elif section.refs:
            problems.append(f"{where}: 只有 source=state 才用 refs")
        problems += _check_trigger(pack, index, section.visible_when, where)
    return problems


def _check_devices(pack: ScenarioPack, index: _Index) -> list[str]:
    """设备面：键已登记、同一读数不在两台设备上重复、区间顺序正确、门控引用有效。"""
    problems: list[str] = _duplicates("device", [device.id for device in pack.presentation.devices])
    seen: set[str] = set()
    for device in pack.presentation.devices:
        where = f"device {device.id}"
        for channel in device.channels:
            spot = f"{where}/{channel.ref}"
            if channel.ref not in index.state_keys:
                problems.append(f"{spot}: 未登记状态键")
            if channel.ref in seen:
                problems.append(f"{spot}: 同一读数出现在多台设备上")
            seen.add(channel.ref)
            for name, span in (("normal", channel.normal), ("critical", channel.critical)):
                if span is not None and span[0] > span[1]:
                    problems.append(f"{spot}: {name} 区间顺序不对")
            problems += _check_trigger(pack, index, channel.visible_when, spot)
        problems += _check_trigger(pack, index, device.visible_when, where)
    return problems


def _check_facts(pack: ScenarioPack, index: _Index) -> list[str]:
    """事实的"可观测判据"必须指向本包内的线索与动作（判读只读世界事实）。"""
    problems: list[str] = []
    for fact in pack.facts:
        for cue_id in fact.cue_ids:
            if cue_id not in index.cues:
                problems.append(f"fact {fact.id}: 未知线索 {cue_id}")
        for affordance_id in fact.affordance_ids:
            if affordance_id not in index.affordances:
                problems.append(f"fact {fact.id}: 未知动作 {affordance_id}")
    return problems


def _check_judgment(pack: ScenarioPack, index: _Index) -> list[str]:
    problems: list[str] = []
    for point in pack.rubric:
        for anchor in ("strong", "adequate", "missed"):
            if anchor not in point.anchors:
                problems.append(f"criterion {point.id}: 缺锚点 {anchor}")
        problems += _check_rule_params(point, index)
        if not point.title.strip():
            problems.append(f"criterion {point.id}: 缺 title（一句话说清这条在评什么）")
        for anchor, value in point.score_map.items():
            if not 0 <= value <= 1:
                problems.append(f"criterion {point.id}: 锚点得分须在 0..1（{anchor}）")
    return problems


def _check_rule_params(point: Any, index: _Index) -> list[str]:
    problems: list[str] = []
    for key in _RULE_AFFORDANCE_KEYS.get(point.rule, ()):
        value = point.params.get(key)
        if value is None:
            problems.append(f"criterion {point.id}: 规则 {point.rule} 缺参数 {key}")
            continue
        for item in value if isinstance(value, list) else [value]:
            if item not in index.affordances:
                problems.append(f"criterion {point.id}: 未知动作 {item}")
    if "accept_custom" in point.params and not isinstance(point.params["accept_custom"], list):
        problems.append(f"criterion {point.id}: accept_custom 必须是列表")
    return problems


def _check_anchors(pack: ScenarioPack, index: _Index) -> list[str]:
    """叙事锚点：id 唯一；`requires`/`blocked_by`/`unlocks` 只能引用本包已登记的事实与动作。

    判据语言只有一套（与 `effects`/affordance 同一注册表）——锚点不引入第二套。
    """
    problems = _duplicates("anchor", [anchor.id for anchor in pack.anchors])
    known = index.facts | index.affordances
    for anchor in pack.anchors:
        where = f"anchor {anchor.id}"
        if not anchor.cue.strip():
            problems.append(f"{where}: 缺 cue（世界必须以叙事内手段呈现它）")
        if anchor.deadline_turns < 0:
            problems.append(f"{where}: deadline_turns 不得为负（{anchor.deadline_turns}）")
        for field_name in ("requires", "blocked_by"):
            for ref in getattr(anchor, field_name):
                if ref not in known:
                    problems.append(f"{where}: {field_name} 引用未登记的事实/动作 {ref}")
        for ref in anchor.unlocks:
            if ref not in index.affordances:
                problems.append(f"{where}: unlocks 引用未登记的动作 {ref}")
    return problems


def _check_failure(pack: ScenarioPack, index: _Index) -> list[str]:
    if pack.failure == "irreversible" and pack.failure_when is None:
        return ["failure=irreversible 但未声明 failure_when"]
    return _check_trigger(pack, index, pack.failure_when, "failure_when")


def _check_trigger(pack: ScenarioPack, index: _Index, trigger: Trigger | None, where: str) -> list[str]:
    if trigger is None:
        return []
    problems: list[str] = []
    for position, clause in enumerate(trigger.all):
        spot = f"{where} 子句#{position}"
        problems += [f"{spot}: {message}" for message in _clause_requirements(clause)]
        if clause.affordance_id and clause.affordance_id not in index.affordances:
            problems.append(f"{spot}: 未知动作 {clause.affordance_id}")
        if clause.cue_id and clause.cue_id not in index.cues:
            problems.append(f"{spot}: 未知线索 {clause.cue_id}")
        if clause.fact_id and clause.fact_id not in index.facts:
            problems.append(f"{spot}: 未知事实 {clause.fact_id}")
        if clause.key and clause.key not in index.state_keys:
            problems.append(f"{spot}: 未登记状态键 {clause.key}")
    return problems


def _clause_requirements(clause: Clause) -> list[str]:
    kind = clause.kind.value
    problems: list[str] = []
    if kind in _NEEDS_AFFORDANCE and not clause.affordance_id:
        problems.append("缺少 affordance_id")
    if kind == "action_count_gte" and not clause.count:
        problems.append("缺少 count")
    if kind == "turns_without_action" and not clause.turns:
        problems.append("缺少 turns")
    if kind == "cue_revealed" and not clause.cue_id:
        problems.append("缺少 cue_id")
    if kind == "fact_declared" and not clause.fact_id:
        problems.append("缺少 fact_id")
    if kind == "turn_gte" and not clause.count:
        problems.append("缺少 count")
    if kind == "state_cmp":
        if not clause.key:
            problems.append("缺少 key")
        if clause.op is None:
            problems.append("缺少 op")
    return problems
