"""pack 的**加载期**校验：形状由 pydantic 管，这里管引用闭合、词表闭合与可达性。

原则：坏包在**加载时**失败，不在会话中途炸（docs/scenario.md九）。校验只报问题、不修改内容；
本轨的包校验是**检查器**不是门禁（`state="experimental"` 允许犯错，仅记录风险）。
"""

from __future__ import annotations

import re
from typing import Any

from .runtime.world import namespaced_key
from .schema import Affordance, AffordanceType, Clause, EffectOp, JudgeRuleKind, ScenarioPack, Trigger

_RULE_AFFORDANCE_KEYS: dict[JudgeRuleKind, tuple[str, ...]] = {
    JudgeRuleKind.FIRST_ACTION: ("affordances",),
    JudgeRuleKind.AVOID_REPEAT: ("affordance_id",),
    JudgeRuleKind.REQUIRE_WITHIN: ("affordances",),
    JudgeRuleKind.ACTION_SET_COVERS: ("affordances",),
    JudgeRuleKind.ACTION_ORDER: ("first", "then"),
    JudgeRuleKind.OPTION_CHOICE: ("affordances",),
}

_NEEDS_AFFORDANCE = frozenset({"action_used"})


class _Index:
    """一次算好的引用集合（避免每处重复推导）。"""

    def __init__(self, pack: ScenarioPack) -> None:
        self.actors = {a.id for a in pack.actors}
        self.cues = {c.id for c in pack.setting.cues}
        self.facts = {f.id for f in pack.facts}
        self.affordances = {a.id for a in pack.affordances}
        self.state_keys = set(pack.state_keys)
        self.devices = {d.id for d in pack.presentation.devices}
        self.assets = {a.id for a in pack.assets}

    @property
    def targets(self) -> set[str]:
        return self.actors | {"scene"}


def validate_pack(pack: ScenarioPack) -> list[str]:
    """返回问题清单；空列表 = 可加载。"""
    index = _Index(pack)
    problems: list[str] = []
    problems += _check_ids(pack)
    problems += _check_state_keys(pack, index)
    problems += _check_bounds(pack, index)
    problems += _check_affordances(pack, index)
    problems += _check_leaks(pack)
    problems += _check_assets(pack, index)
    problems += _check_devices(pack, index)
    problems += _check_facts(pack, index)
    problems += _check_judgment(pack, index)
    problems += _check_failure(pack, index)
    problems += _check_targets(pack, index)
    problems += _check_triggers(pack)
    return problems


def _check_failure(pack: ScenarioPack, index: _Index) -> list[str]:
    if pack.failure == "irreversible" and pack.failure_when is None:
        return ["failure=irreversible 但未声明 failure_when"]
    return _check_trigger(pack, index, pack.failure_when, "failure_when")


def _presentation_trigger_sites(pack: ScenarioPack) -> list[tuple[Trigger | None, str]]:
    """演示面（设备与通道）里全部可省略的触发条件及定位前缀。"""
    sites: list[tuple[Trigger | None, str]] = []
    for device in pack.presentation.devices:
        sites.append((device.visible_when, f"device {device.id}"))
        for channel in device.channels:
            sites.append((channel.visible_when, f"device {device.id}/{channel.ref}"))
    return sites


def _trigger_sites(pack: ScenarioPack) -> list[tuple[Trigger | None, str]]:
    """本包所有"可省略、但一旦显式写就必须非空"的触发条件，**按问题报告顺序**排列。"""
    sites: list[tuple[Trigger | None, str]] = []
    for affordance in pack.affordances:
        sites.append((affordance.visible_when, f"affordance {affordance.id}"))
    sites += _presentation_trigger_sites(pack)
    sites.append((pack.failure_when, "failure_when"))
    return sites


def _check_triggers(pack: ScenarioPack) -> list[str]:
    """**空触发条件禁止保存**（docs/scenario.md）：不能同时被文档解释成恒真、代码解释成恒假。

    省略整个 `visible_when`（= 一直在）是允许的；显式写一个 `all: []` 不行。
    """
    problems: list[str] = []
    for trigger, where in _trigger_sites(pack):
        if trigger is not None and not trigger.all:
            problems.append(f"{where}: 触发条件为空（省略整个条件表示『一直成立』，不要写空 all）")
    return problems


def _check_targets(pack: ScenarioPack, index: _Index) -> list[str]:
    """目标引用的类型与命名空间：`TargetRef` 必须命中本包；actor/device/scene **不得同名**。

    `Affordance.targets` 用的是带 kind 的引用，但仍禁止三个命名空间出现重复 id——
    两层一起兜住"裸 id 跨类型碰撞"（docs/scenario.md）。
    """
    problems: list[str] = []
    seen: dict[str, str] = {}
    for label, ids in (("actor", index.actors), ("device", index.devices), ("scene", {"scene"})):
        for item in ids:
            other = seen.get(item)
            if other is not None and other != label:
                problems.append(f"id 命名空间冲突：{item} 同时是 {other} 与 {label}")
            seen[item] = label
    for affordance in pack.affordances:
        for target in affordance.targets:
            if target.kind.value == "actor" and target.id not in index.actors:
                problems.append(f"affordance {affordance.id}: targets 引用未知 actor {target.id}")
            elif target.kind.value == "device" and target.id not in index.devices:
                problems.append(f"affordance {affordance.id}: targets 引用未知 device {target.id}")
            elif target.kind.value == "scene" and target.id != "scene":
                problems.append(f"affordance {affordance.id}: scene 目标只能是 'scene'（收到 {target.id}）")
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
        ("fact", [f.id for f in pack.facts]),
        ("criterion", [d.id for d in pack.rubric]),
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


def _check_bounds(pack: ScenarioPack, index: _Index) -> list[str]:
    """`state_bounds`：只能约束已登记的**数值**键，且区间顺序正确（模型的 `world_set` 按它拒）。"""
    problems: list[str] = []
    for key, bound in pack.state_bounds.items():
        where = f"state_bounds {key}"
        if key not in index.state_keys:
            problems.append(f"{where}: 未登记状态键")
            continue
        if not isinstance(pack.state_keys[key], (int, float)) or isinstance(pack.state_keys[key], bool):
            problems.append(f"{where}: 只能给数值键声明边界")
        if bound.lo is not None and bound.hi is not None and bound.lo > bound.hi:
            problems.append(f"{where}: lo/hi 顺序不对")
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


def _check_affordance_refs(index: _Index, affordance: Affordance, where: str) -> list[str]:
    """揭示的线索必须在本包内。"""
    problems: list[str] = []
    for cue_id in affordance.reveals:
        if cue_id not in index.cues:
            problems.append(f"{where}: 揭示了未知线索 {cue_id}")
    return problems


def _check_affordance(pack: ScenarioPack, index: _Index, affordance: Affordance) -> list[str]:
    where = f"affordance {affordance.id}"
    params = affordance.params or {}
    problems: list[str] = []
    problems += _check_affordance_refs(index, affordance, where)
    problems += _check_effects(pack, index, affordance.effects, where)
    problems += _check_trigger(pack, index, affordance.visible_when, where)
    if affordance.select in ("single", "multi") and not params.get("options"):
        problems.append(f"{where}: select={affordance.select} 但缺少 params.options")
    if affordance.type is AffordanceType.DOCUMENT and not affordance.params.get("fields"):
        problems.append(f"{where}: document 缺少 params.fields")
    return problems


def _check_affordances(pack: ScenarioPack, index: _Index) -> list[str]:
    problems: list[str] = []
    for affordance in pack.affordances:
        problems += _check_affordance(pack, index, affordance)
    return problems


def _banned_terms(pack: ScenarioPack) -> list[str]:
    """按钮/选项/提示文案里不得出现的术语：由 facts 派生（作者可用 `banned_phrases` 显式补充）。"""
    terms: list[str] = []
    for fact in pack.facts:
        for token in re.split(r"[^\w\u4e00-\u9fff]+", f"{fact.id} {fact.intent}"):
            if len(token) >= 2:
                terms.append(token)
        terms.extend(fact.banned_phrases)
    return sorted(set(terms))


def _check_leaks(pack: ScenarioPack) -> list[str]:
    """开场就可见的文案不得泄底（按钮文案的运行期检查由模型的 `char_say`/`deliver` 承担）。"""
    banned = _banned_terms(pack)
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


def _check_assets(pack: ScenarioPack, index: _Index) -> list[str]:
    """资源声明必须可用；**字节是否已上传不在加载期判断**（不做 IO，由管理侧/安装时报告）。"""
    problems: list[str] = []
    for asset in pack.assets:
        if not asset.alt:
            problems.append(f"asset {asset.id}: 缺 alt（无图也要可读）")
        for cue_id in asset.reveal_with:
            if cue_id not in index.cues:
                problems.append(f"asset {asset.id}: reveal_with 引用未知线索 {cue_id}")
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


def _check_trigger(pack: ScenarioPack, index: _Index, trigger: Trigger | None, where: str) -> list[str]:
    """触发子句的引用闭合。

    问题串一律以 `<定位前缀>:` 开头（`where` 自带 `affordance <id>` / `device <id>/<ref>`），
    子句序号写在原因里——这样 `pack_loader.problem_path` 能把每条问题映射回**字段路径**。
    """
    if trigger is None:
        return []
    problems: list[str] = []
    for position, clause in enumerate(trigger.all):
        problems += [f"{where}: 子句 #{position} {message}" for message in _clause_requirements(clause)]
        if clause.affordance_id and clause.affordance_id not in index.affordances:
            problems.append(f"{where}: 子句 #{position} 引用未知动作 {clause.affordance_id}")
        if clause.cue_id and clause.cue_id not in index.cues:
            problems.append(f"{where}: 子句 #{position} 引用未知线索 {clause.cue_id}")
        if clause.fact_id and clause.fact_id not in index.facts:
            problems.append(f"{where}: 子句 #{position} 引用未知事实 {clause.fact_id}")
        if clause.key and clause.key not in index.state_keys:
            problems.append(f"{where}: 子句 #{position} 引用未登记状态键 {clause.key}")
    return problems


def _clause_requirements(clause: Clause) -> list[str]:
    kind = clause.kind.value
    problems: list[str] = []
    if kind in _NEEDS_AFFORDANCE and not clause.affordance_id:
        problems.append("缺少 affordance_id")
    if kind == "cue_revealed" and not clause.cue_id:
        problems.append("缺少 cue_id")
    if kind == "fact_declared" and not clause.fact_id:
        problems.append("缺少 fact_id")
    if kind == "state_cmp":
        if not clause.key:
            problems.append("缺少 key")
        if clause.op is None:
            problems.append("缺少 op")
    return problems
