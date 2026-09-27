"""判读规则单测：五条规则的锚点分支、自输入折算、维度投影数值。

只依赖判读模块与 pack 数据，不连库、不调 LLM。
"""

from __future__ import annotations

from typing import Any

import pytest

from modules.scenario_training.judge import DecisionResult, dims_snapshot, evaluate, summarize
from modules.scenario_training.pack_loader import load_pack_file
from modules.scenario_training.runtime.world import ActionRecord, World, initial_world
from modules.scenario_training.schema import Anchor, Criterion, JudgeRuleKind, ScenarioPack

Step = tuple[int, str | None, str | None]


def _pack() -> ScenarioPack:
    return load_pack_file("sputum_ineffective")


def _world(pack: ScenarioPack, steps: list[Step]) -> World:
    world = initial_world(pack)
    for turn, affordance_id, custom_text in steps:
        world.actions.append(ActionRecord(turn=turn, affordance_id=affordance_id, type="act", custom_text=custom_text))
        world.turn = turn
    return world


def _decision(pack: ScenarioPack, world: World, point_id: str) -> DecisionResult:
    return next(result for result in evaluate(pack, world) if result.criterion_id == point_id)


def _probe(pack: ScenarioPack, world: World, rule: JudgeRuleKind, params: dict[str, Any]) -> DecisionResult:
    """用单点 pack 探针跑规则（合成判读点，只替换 rubric）。"""
    point = Criterion(
        id="dp_probe",
        title="probe",
        rule=rule,
        params=params,
        anchors={Anchor.STRONG: "s", Anchor.ADEQUATE: "a", Anchor.MISSED: "m"},
    )
    return evaluate(pack.model_copy(update={"rubric": [point]}), world)[0]


# --------------------------------------------------------------------------- #
# avoid_repeat：吸痰 1 / 2 / 3 次
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("uses", "anchor"),
    [(1, Anchor.STRONG), (2, Anchor.ADEQUATE), (3, Anchor.MISSED)],
)
def test_avoid_repeat_anchor_follows_use_count(uses: int, anchor: Anchor) -> None:
    pack = _pack()
    world = _world(pack, [(turn, "suction", None) for turn in range(1, uses + 1)])
    result = _decision(pack, world, "dp_no_repeat")
    assert result.anchor is anchor
    assert f"累计使用 {uses} 次" in result.detail
    assert "上限 1 次" in result.detail
    assert len(result.evidence) == uses


def test_avoid_repeat_without_any_use_is_only_adequate() -> None:
    """从没做过 → 不给满分：`没做过`不等于`做得对`。"""
    pack = _pack()
    result = _decision(pack, _world(pack, []), "dp_no_repeat")
    assert result.anchor is Anchor.ADEQUATE
    assert result.evidence == ["无该动作记录"]


# --------------------------------------------------------------------------- #
# require_within：三回合窗口内命中一个 vs 两个
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("steps", "anchor"),
    [
        ([(1, "suction", None), (2, "bag_valve", None), (3, "call_doctor", None)], Anchor.STRONG),
        ([(1, "suction", None), (2, "bag_valve", None)], Anchor.ADEQUATE),
        ([(2, "call_doctor", None)], Anchor.ADEQUATE),
        ([(1, "suction", None), (4, "bag_valve", None)], Anchor.MISSED),
        ([], Anchor.MISSED),
    ],
)
def test_require_within_window(steps: list[Step], anchor: Anchor) -> None:
    pack = _pack()
    result = _decision(pack, _world(pack, steps), "dp_escalate")
    assert result.anchor is anchor
    assert "3 回合窗口内命中" in result.detail


# --------------------------------------------------------------------------- #
# action_order：四种顺序分支
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("steps", "anchor"),
    [
        ([(1, "auscultate", None), (2, "bag_valve", None)], Anchor.STRONG),
        ([(1, "measure_spo2", None)], Anchor.STRONG),
        ([(1, "call_doctor", None), (2, "auscultate", None)], Anchor.ADEQUATE),
        ([(2, "auscultate", None), (2, "call_doctor", None)], Anchor.ADEQUATE),
        ([(1, "call_doctor", None)], Anchor.MISSED),
        ([(1, "reposition", None)], Anchor.ADEQUATE),
    ],
)
def test_action_order_branches(steps: list[Step], anchor: Anchor) -> None:
    pack = _pack()
    result = _decision(pack, _world(pack, steps), "dp_sequence")
    assert result.anchor is anchor
    assert "前置集合" in result.detail
    assert len(result.evidence) == 2


# --------------------------------------------------------------------------- #
# action_set_covers：accept_custom 只折算一次
# --------------------------------------------------------------------------- #

CUSTOM_HIT_TEXT = "我觉得是痰栓堵住了"


def test_accept_custom_counts_once_even_if_two_terms_match() -> None:
    pack = _pack()
    # 该文本同时含「痰栓」「堵塞」两个接受词：自输入只折算 1 项，1 < min(2) → adequate
    result = _decision(pack, _world(pack, [(1, None, CUSTOM_HIT_TEXT)]), "dp_recognize")
    assert result.anchor is Anchor.ADEQUATE
    assert result.detail == "目标动作覆盖 0/2 项，自输入命中 1 项，合计 1（阈值 ≥2）"
    assert [line for line in result.evidence if line.startswith("自输入命中词")] == ["自输入命中词「痰栓」（计 1 项）"]


def test_accept_custom_plus_one_action_reaches_strong() -> None:
    pack = _pack()
    world = _world(pack, [(1, "measure_spo2", None), (2, None, CUSTOM_HIT_TEXT)])
    result = _decision(pack, world, "dp_recognize")
    assert result.anchor is Anchor.STRONG
    assert "合计 2（阈值 ≥2）" in result.detail


def test_action_set_covers_missed_without_actions_or_custom_text() -> None:
    pack = _pack()
    result = _decision(pack, _world(pack, [(1, "suction", None)]), "dp_recognize")
    assert result.anchor is Anchor.MISSED
    assert "合计 0（阈值 ≥2）" in result.detail


def test_document_point_uses_custom_free_threshold_one() -> None:
    pack = _pack()
    assert _decision(pack, _world(pack, [(1, "suction", None)]), "dp_document").anchor is Anchor.MISSED
    assert _decision(pack, _world(pack, [(1, "document", None)]), "dp_document").anchor is Anchor.STRONG


# --------------------------------------------------------------------------- #
# first_action：pack 未用到的规则，用探针覆盖
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    ("steps", "params", "anchor"),
    [
        ([(1, "measure_spo2", None)], {"affordances": ["measure_spo2"]}, Anchor.STRONG),
        ([(1, "measure_spo2", None)], {"affordances": ["auscultate"]}, Anchor.MISSED),
        ([(1, "measure_spo2", None)], {"affordances": ["measure_spo2"], "belongs": False}, Anchor.MISSED),
        ([(1, "auscultate", None)], {"affordances": ["measure_spo2"], "belongs": False}, Anchor.STRONG),
        ([], {"affordances": ["measure_spo2"]}, Anchor.ADEQUATE),
    ],
)
def test_first_action_probe(steps: list[Step], params: dict[str, Any], anchor: Anchor) -> None:
    pack = _pack()
    result = _probe(pack, _world(pack, steps), JudgeRuleKind.FIRST_ACTION, params)
    assert result.anchor is anchor
    assert result.criterion_id == "dp_probe"


# --------------------------------------------------------------------------- #
# dims_snapshot：四个维度的数值
# --------------------------------------------------------------------------- #


def test_dims_snapshot_values() -> None:
    pack = _pack()
    world = _world(pack, [(1, "measure_spo2", None), (2, "suction", None), (3, "bag_valve", None)])
    world.state["scene.spo2"] = 84
    world.declared_facts.extend([{"fact_id": "f_low_spo2"}, {"fact_id": "f_bloody_sputum"}])

    snapshot = dims_snapshot(pack, world)
    assert [entry["id"] for entry in snapshot] == [dim.id for dim in pack.dims]
    assert all(set(entry) == {"id", "label", "agg", "value", "unit", "detail"} for entry in snapshot)

    dims = {entry["id"]: entry for entry in snapshot}
    assert dims["d_actions"]["value"] == 3  # 动作总数
    assert dims["d_actions"]["agg"] == "count"
    assert dims["d_escalation"]["value"] == 3  # 升级集合首次命中的回合
    assert dims["d_escalation"]["agg"] == "latency"
    assert dims["d_observation"]["value"] == 0.5  # 1 / 2 条 critical 事实
    assert dims["d_observation"]["agg"] == "coverage"
    assert dims["d_spo2"]["value"] == -4  # 84 - 88（pack 初值）
    assert dims["d_spo2"]["detail"] == "scene.spo2 初值 88 → 当前 84（变化 -4）"
    assert dims["d_spo2"]["unit"] == ""


def test_dims_snapshot_latency_none_and_full_coverage_without_critical_facts() -> None:
    pack = _pack()
    empty = dims_snapshot(pack, _world(pack, []))
    dims = {entry["id"]: entry for entry in empty}
    assert dims["d_escalation"]["value"] is None
    assert "从未出现" in dims["d_escalation"]["detail"]
    assert dims["d_observation"]["value"] == 0.0
    assert dims["d_actions"]["value"] == 0
    assert dims["d_spo2"]["value"] == 0

    no_critical = pack.model_copy(update={"facts": [fact for fact in pack.facts if not fact.critical]})
    coverage = {entry["id"]: entry for entry in dims_snapshot(no_critical, _world(pack, []))}["d_observation"]
    assert coverage["value"] == 1.0


# --------------------------------------------------------------------------- #
# evaluate / summarize
# --------------------------------------------------------------------------- #


def test_evaluate_covers_every_declared_point_in_order_and_summarize_counts() -> None:
    pack = _pack()
    world = _world(
        pack,
        [
            (1, "measure_spo2", None),
            (2, "auscultate", None),
            (3, "bag_valve", None),
            (4, "call_doctor", None),
            (5, "document", None),
        ],
    )
    results = evaluate(pack, world)
    assert [result.criterion_id for result in results] == [point.id for point in pack.rubric]
    counts = summarize(results)
    assert set(counts) == {"strong", "adequate", "missed"}
    # 识别强（两项齐）、未重复合格（**没吸过痰 = 不给满分**）、升级合格（仅 bag_valve 在三回合内）、
    # 顺序强（先评估后升级）、记录强
    assert counts == {"strong": 3, "adequate": 2, "missed": 0}


def test_summarize_counts_all_anchors_when_everything_is_missed() -> None:
    pack = _pack()
    world = _world(pack, [(turn, "suction", None) for turn in range(1, 5)])
    results = evaluate(pack, world)
    counts = summarize(results)
    assert counts["missed"] >= 1
    assert sum(counts.values()) == len(results)
