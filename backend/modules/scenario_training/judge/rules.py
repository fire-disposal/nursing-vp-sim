"""判读规则：`Criterion.rule`（封闭枚举）的逐条实现，外加经历维度投影。

纯函数：不连库、不调 LLM、不读时钟——只读 `World` 里由动作与效果累积出的事实，
因此结论可复算、可解释、可回放。规则参数一律来自 `Criterion.params` / `DimSpec.params`，
本文件不内置任何领域语义（领域语义只来自 pack 数据）。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..runtime.world import ActionRecord, World, facts_observed, turn_word
from ..schema import Anchor, Criterion, DimAgg, DimSpec, JudgeRuleKind, ScenarioPack


@dataclass(frozen=True)
class DecisionResult:
    """一条 rubric 判据的结论。`detail` 含关键数字，`evidence` 引用回合/动作/自输入。

    `weight` 来自场景自定的**加权 DSL**（平台侧算，**不进任何提示词**），`score` 由锚点经 `score_map` 映射。
    """

    criterion_id: str
    anchor: Anchor
    detail: str
    evidence: list[str]
    title: str = ""
    weight: float = 1.0
    score: float = 0.0


# --------------------------------------------------------------------------- #
# 参数读取与动作时间线小工具
# --------------------------------------------------------------------------- #


def _ids(params: dict[str, Any], key: str) -> list[str]:
    """读一个字符串列表参数；缺失或类型不符时返回空表（不抛错，判读永远给得出结论）。"""
    raw = params.get(key)
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw]


def _int(params: dict[str, Any], key: str, default: int) -> int:
    raw = params.get(key)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return default
    return int(raw)


def _label(pack: ScenarioPack, affordance_id: str) -> str:
    affordance = pack.affordance(affordance_id)
    return affordance.label if affordance is not None else affordance_id


def _first_turn(world: World, wanted: set[str]) -> int | None:
    """集合中任一动作**首次使用**的回合；一次都没用则 None。"""
    turns = [action.turn for action in world.actions if action.affordance_id in wanted]
    return min(turns) if turns else None


def _turn_token(turn: int | None) -> str:
    return turn_word(turn) if turn is not None else "未使用"


def _use_note(world: World, affordance_id: str) -> str:
    turn = _first_turn(world, {affordance_id})
    return f"已使用（{turn_word(turn)}）" if turn is not None else "未使用"


# --------------------------------------------------------------------------- #
# 五条规则
# --------------------------------------------------------------------------- #


def _first_action(pack: ScenarioPack, world: World, point: Criterion) -> DecisionResult:
    """首个动作属于/不属于某集合。无动作时不惩罚（送分给 adequate）。"""
    wanted = set(_ids(point.params, "affordances"))
    expects = bool(point.params.get("belongs", True))
    if not world.actions:
        return DecisionResult(
            point.id,
            Anchor.ADEQUATE,
            "尚无动作，首个动作无从判定，按不惩罚处理",
            ["无动作记录"],
        )
    first = world.actions[0]
    belongs = first.affordance_id in wanted
    anchor = Anchor.STRONG if belongs == expects else Anchor.MISSED
    stance = "属于" if belongs else "不属于"
    detail = f"{turn_word(first.turn)}首个动作「{first.label(pack)}」{stance}目标集合（共 {len(wanted)} 项）"
    return DecisionResult(point.id, anchor, detail, [f"{turn_word(first.turn)} {first.label(pack)}"])


def _avoid_repeat(pack: ScenarioPack, world: World, point: Criterion) -> DecisionResult:
    """某动作累计使用次数是否守住上限：≤max 强、==max+1 合格、再多就漏。

    **一次都没用过 → 合格（不给满分）**：「没做过」不等于「做得对」，不能白拿这条分。
    """
    params = point.params
    affordance_id = str(params.get("affordance_id") or "")
    cap = _int(params, "max", 1)
    records = world.used(affordance_id)
    count = len(records)
    if count == 0:
        detail = f"从未使用「{_label(pack, affordance_id)}」（无法评价是否克制）"
        return DecisionResult(point.id, Anchor.ADEQUATE, detail, ["无该动作记录"])
    if count <= cap:
        anchor = Anchor.STRONG
    elif count == cap + 1:
        anchor = Anchor.ADEQUATE
    else:
        anchor = Anchor.MISSED
    detail = f"「{_label(pack, affordance_id)}」累计使用 {count} 次（上限 {cap} 次）"
    evidence = [f"{turn_word(record.turn)} {record.label(pack)}" for record in records] or ["无该动作记录"]
    return DecisionResult(point.id, anchor, detail, evidence)


def _require_within(pack: ScenarioPack, world: World, point: Criterion) -> DecisionResult:
    """要求在 n 回合窗口内用到集合里的动作：全中强、中一个合格、零中漏。"""
    params = point.params
    wanted = _ids(params, "affordances")
    within = _int(params, "within_turns", 0)
    hits = 0
    evidence: list[str] = []
    for affordance_id in wanted:
        turn = _first_turn(world, {affordance_id})
        if turn is None:
            evidence.append(f"{_label(pack, affordance_id)}：未使用")
        elif turn <= within:
            hits += 1
            evidence.append(f"{_label(pack, affordance_id)}：{turn_word(turn)}（窗口内）")
        else:
            evidence.append(f"{_label(pack, affordance_id)}：{turn_word(turn)}（超出窗口）")
    if hits == len(wanted):
        anchor = Anchor.STRONG
    elif hits >= 1:
        anchor = Anchor.ADEQUATE
    else:
        anchor = Anchor.MISSED
    detail = f"{within} 回合窗口内命中 {hits}/{len(wanted)} 项要求动作"
    return DecisionResult(point.id, anchor, detail, evidence)


def _action_set_covers(pack: ScenarioPack, world: World, point: Criterion) -> DecisionResult:
    """动作集合覆盖度；`accept_custom` 中任一词出现在学生自输入里额外 +1（只加一次）。"""
    params = point.params
    wanted = _ids(params, "affordances")
    minimum = _int(params, "min", 1)
    covered = [affordance_id for affordance_id in wanted if world.used(affordance_id)]
    texts = world.custom_texts()
    hit_term = next((term for term in _ids(params, "accept_custom") if any(term in text for text in texts)), None)
    custom_bonus = 1 if hit_term else 0
    total = len(covered) + custom_bonus
    if total >= minimum:
        anchor = Anchor.STRONG
    elif total >= 1:
        anchor = Anchor.ADEQUATE
    else:
        anchor = Anchor.MISSED
    detail = (
        f"目标动作覆盖 {len(covered)}/{len(wanted)} 项，自输入命中 {custom_bonus} 项，合计 {total}（阈值 ≥{minimum}）"
    )
    evidence = [f"{_label(pack, affordance_id)}：{_use_note(world, affordance_id)}" for affordance_id in wanted]
    if hit_term:
        evidence.append(f"自输入命中词「{hit_term}」（计 1 项）")
    return DecisionResult(point.id, anchor, detail, evidence)


def _action_order(pack: ScenarioPack, world: World, point: Criterion) -> DecisionResult:
    """先评估后处置：first 先于 then（或 then 未出现）为强；then 抢在 first 前为合格。

    first 与 then 同回合（交错）按合格处理；两者都没出现时不惩罚。
    """
    params = point.params
    first_ids = set(_ids(params, "first"))
    then_ids = set(_ids(params, "then"))
    first_turn = _first_turn(world, first_ids)
    then_turn = _first_turn(world, then_ids)
    if first_turn is not None and (then_turn is None or first_turn < then_turn):
        anchor = Anchor.STRONG
    elif first_turn is not None:
        anchor = Anchor.ADEQUATE
    elif then_turn is not None:
        anchor = Anchor.MISSED
    else:
        anchor = Anchor.ADEQUATE
    detail = (
        f"前置集合（{len(first_ids)} 项）首用于 {_turn_token(first_turn)}，"
        f"后续集合（{len(then_ids)} 项）首用于 {_turn_token(then_turn)}"
    )
    evidence = [f"前置集合：{_turn_token(first_turn)}", f"后续集合：{_turn_token(then_turn)}"]
    return DecisionResult(point.id, anchor, detail, evidence)


def _option_choice(pack: ScenarioPack, world: World, point: Criterion) -> DecisionResult:
    """“学生做了/选了哪一个”的统一判定。

    既能评**扁平按钮**（`affordances` 列出的动作），也能评**选择型动作**（`selected` 里的选项 id）；
    自输入命中 `accept_custom` 视同正确。`correct` / `acceptable` 里可以混写动作 id 与选项 id。
    """
    wanted = set(_ids(point.params, "affordances")) or {str(point.params.get("affordance_id", ""))}
    correct = set(_ids(point.params, "correct"))
    acceptable = set(_ids(point.params, "acceptable"))
    custom_terms = _ids(point.params, "accept_custom")

    candidates = [action for action in world.actions if action.affordance_id in wanted]
    if not candidates:
        labels = "、".join(_label(pack, affordance_id) for affordance_id in sorted(wanted))
        return DecisionResult(point.id, Anchor.MISSED, f"未做任何相关处置（{labels}）", ["无相关动作记录"])

    chosen = candidates[0]
    custom_text = (chosen.custom_text or "").strip()
    hit = next((term for term in custom_terms if term and term in custom_text), None)
    evidence = [f"{turn_word(chosen.turn)} {chosen.label(pack)}"]
    if hit is not None:
        return DecisionResult(point.id, Anchor.STRONG, f"自输入命中「{hit}」", [*evidence, custom_text[:60]])

    picked_labels = _picked_labels(pack, chosen)
    picked = set(chosen.selected) | {str(chosen.affordance_id)}
    detail = picked_labels or _label(pack, str(chosen.affordance_id))
    if picked & correct:
        return DecisionResult(point.id, Anchor.STRONG, f"选择「{detail}」", evidence)
    if picked & acceptable:
        return DecisionResult(point.id, Anchor.ADEQUATE, f"选择「{detail}」", evidence)
    return DecisionResult(point.id, Anchor.MISSED, f"选择「{detail}」", evidence)


def _picked_labels(pack: ScenarioPack, action: ActionRecord) -> str:
    """学生在该动作里选中的选项文案（扁平按钮则为空）。"""
    affordance = pack.affordance(str(action.affordance_id)) if action.affordance_id else None
    if affordance is None or not action.selected:
        return ""
    labels = {str(option.get("id")): str(option.get("label", "")) for option in affordance.params.get("options", [])}
    return "、".join(labels.get(option_id, option_id) for option_id in action.selected)


_RULES: dict[JudgeRuleKind, Callable[[ScenarioPack, World, Criterion], DecisionResult]] = {
    JudgeRuleKind.FIRST_ACTION: _first_action,
    JudgeRuleKind.AVOID_REPEAT: _avoid_repeat,
    JudgeRuleKind.REQUIRE_WITHIN: _require_within,
    JudgeRuleKind.ACTION_SET_COVERS: _action_set_covers,
    JudgeRuleKind.ACTION_ORDER: _action_order,
    JudgeRuleKind.OPTION_CHOICE: _option_choice,
}


def evaluate(pack: ScenarioPack, world: World) -> list[DecisionResult]:
    """逐条判读 pack 的 rubric，顺序与声明一致；顺带映射**整数权重**与**锚点得分**。

    权重是场景自写、平台侧用的（1–100 的整数）——**LLM 看不见也不参与**。
    """
    from dataclasses import replace

    results: list[DecisionResult] = []
    for criterion in pack.rubric:
        raw = _RULES[criterion.rule](pack, world, criterion)
        results.append(
            replace(
                raw,
                title=criterion.title,
                weight=float(criterion.weight),
                score=criterion.score_map.get(raw.anchor, 0.0),
            )
        )
    return results


def score_report(results: list[DecisionResult]) -> dict[str, Any]:
    """按**得分率**汇总：Σ(权重×锚点得分) / Σ权重，并给出逐条明细。"""
    total_weight = sum(result.weight for result in results)
    weighted_sum = sum(result.weight * result.score for result in results)
    return {
        "rate": round(weighted_sum / total_weight, 4) if total_weight else None,
        "weighted_sum": round(weighted_sum, 4),
        "total_weight": round(total_weight, 4),
        "criteria": [
            {
                "id": result.criterion_id,
                "title": result.title,
                "anchor": result.anchor.value,
                "score": result.score,
                "weight": result.weight,
                "detail": result.detail,
                "evidence": result.evidence,
            }
            for result in results
        ],
    }


def summarize(results: list[DecisionResult]) -> dict[str, int]:
    """锚点分布；三种锚点恒在（无命中记 0）。"""
    counts: dict[str, int] = {anchor.value: 0 for anchor in Anchor}
    for result in results:
        counts[result.anchor.value] += 1
    return counts


# --------------------------------------------------------------------------- #
# 维度投影：经历量化
# --------------------------------------------------------------------------- #

_UNITS: dict[DimAgg, str] = {
    DimAgg.COUNT: "次",
    DimAgg.LATENCY: "回合",
    DimAgg.COVERAGE: "比例",
    DimAgg.SLOPE: "",
}


def _actions_measure(params: dict[str, Any], world: World) -> tuple[Any, str]:
    wanted = set(_ids(params, "affordances"))
    turn = _first_turn(world, wanted)
    if turn is None:
        return None, f"目标动作集合（{len(wanted)} 项）从未出现"
    return turn, f"目标动作集合（{len(wanted)} 项）首用于{turn_word(turn)}"


def _fact_collected(fact: Any, world: World) -> bool:
    """判读只读**世界事实**：线索是否揭示、动作是否发生；DM 的自述仅作补充证据。"""
    return any(entry.get("fact_id") == fact.id for entry in world.declared_facts)


def _facts_measure(pack: ScenarioPack, world: World) -> tuple[Any, str]:
    critical = [fact for fact in pack.facts if fact.critical]
    if not critical:
        return 1.0, "包未声明必采事实，覆盖率按满值记"
    observed = facts_observed(pack, world)
    covered = [fact for fact in critical if fact.id in observed or _fact_collected(fact, world)]
    return len(covered) / len(critical), f"必采事实已采集 {len(covered)}/{len(critical)} 项"


def _state_measure(pack: ScenarioPack, world: World, params: dict[str, Any]) -> tuple[Any, str]:
    key = params.get("key")
    if not isinstance(key, str) or not key:
        return None, "缺少 params.key，无法取变化量"
    initial = pack.state_keys.get(key)
    current = world.state.get(key)
    initial_num = initial if isinstance(initial, (int, float)) and not isinstance(initial, bool) else None
    current_num = current if isinstance(current, (int, float)) and not isinstance(current, bool) else None
    if initial_num is None or current_num is None:
        return None, f"{key} 缺初值或非数值，无法取变化量"
    delta = current_num - initial_num
    return delta, f"{key} 初值 {initial} → 当前 {current}（变化 {delta:+}）"


def _measure(pack: ScenarioPack, world: World, dim: DimSpec) -> tuple[Any, str]:
    if dim.source == "actions":
        if dim.agg is DimAgg.COUNT:
            count = len(world.actions)
            return count, f"动作累计 {count} 次"
        if dim.agg is DimAgg.LATENCY:
            return _actions_measure(dim.params, world)
    if dim.source == "facts" and dim.agg is DimAgg.COVERAGE:
        return _facts_measure(pack, world)
    if dim.source == "state" and dim.agg is DimAgg.SLOPE:
        return _state_measure(pack, world, dim.params)
    return None, f"暂不支持的维度组合（source={dim.source}, agg={dim.agg.value}）"


def dims_snapshot(pack: ScenarioPack, world: World) -> list[dict[str, Any]]:
    """按 `DimSpec` 输出经历量化投影（逐条对应，缺数据的维度给 None 并注明原因）。"""
    snapshot: list[dict[str, Any]] = []
    for dim in pack.dims:
        value, detail = _measure(pack, world, dim)
        snapshot.append(
            {
                "id": dim.id,
                "label": dim.label,
                "agg": dim.agg.value,
                "value": value,
                "unit": _UNITS[dim.agg],
                "detail": detail,
            }
        )
    return snapshot
