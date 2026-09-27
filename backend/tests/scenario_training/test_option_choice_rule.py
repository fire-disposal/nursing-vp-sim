"""反填 `option_choice` 规则：评“学生做了/选了哪一个”（扁平按钮与多选项都吃）。"""

from __future__ import annotations

import pytest

from modules.scenario_training.judge.rules import evaluate
from modules.scenario_training.pack_loader import load_pack_file
from modules.scenario_training.runtime.world import ActionRecord, initial_world
from modules.scenario_training.schema import Anchor, ScenarioPack


@pytest.fixture(scope="module")
def triage() -> ScenarioPack:
    return load_pack_file("triage-hidden-bleed")


@pytest.fixture(scope="module")
def night() -> ScenarioPack:
    return load_pack_file("night-call-decision")


def _results(pack: ScenarioPack, actions: list[ActionRecord]) -> dict[str, object]:
    world = initial_world(pack)
    world.actions = actions
    world.turn = len(actions)
    return {result.criterion_id: result for result in evaluate(pack, world)}


def _act(turn: int, affordance_id: str, **kwargs: object) -> ActionRecord:
    return ActionRecord(turn=turn, affordance_id=affordance_id, type="act", **kwargs)  # type: ignore[arg-type]


def test_flat_button_choice_anchors(triage: ScenarioPack) -> None:
    """① 的分区是扁平按钮：红区 strong、黄区 adequate、骨科/回家 missed。"""
    strong = _results(triage, [_act(1, "triage_red")])["dp_zone"]
    adequate = _results(triage, [_act(1, "triage_yellow")])["dp_zone"]
    missed_ortho = _results(triage, [_act(1, "triage_ortho")])["dp_zone"]
    missed_home = _results(triage, [_act(1, "triage_home")])["dp_zone"]
    missed_none = _results(triage, [_act(1, "measure_vitals")])["dp_zone"]

    assert strong.anchor is Anchor.STRONG  # type: ignore[attr-defined]
    assert adequate.anchor is Anchor.ADEQUATE  # type: ignore[attr-defined]
    assert missed_ortho.anchor is Anchor.MISSED  # type: ignore[attr-defined]
    assert missed_home.anchor is Anchor.MISSED  # type: ignore[attr-defined]
    assert missed_none.anchor is Anchor.MISSED  # type: ignore[attr-defined]
    assert "骨科" in missed_ortho.detail  # type: ignore[attr-defined]


def test_custom_text_can_claim_the_correct_choice(triage: ScenarioPack) -> None:
    """自输入写对了，也认——但不能既选错又靠自输入刷分（取同一次动作的文本）。"""
    claimed = _results(
        triage,
        [_act(1, "triage_ortho", custom_text="我觉得像内出血，得进红区")],
    )["dp_zone"]
    assert claimed.anchor is Anchor.STRONG  # type: ignore[attr-defined]
    assert "自输入命中" in claimed.detail  # type: ignore[attr-defined]

    unrelated = _results(triage, [_act(1, "triage_ortho", custom_text="先去拍个片子")])["dp_zone"]
    assert unrelated.anchor is Anchor.MISSED  # type: ignore[attr-defined]


def test_multi_select_options_are_read(night: ScenarioPack) -> None:
    """② 的下医嘱是多选：选了关键项 strong，选“明早再说” missed。"""
    key = _results(night, [_act(1, "order_tests", selected=["lactate"])])["dp_next_test"]
    both = _results(night, [_act(1, "order_tests", selected=["lactate", "ultrasound"])])["dp_next_test"]
    secondary = _results(night, [_act(1, "order_tests", selected=["ecg"])])["dp_next_test"]
    idle = _results(night, [_act(1, "order_tests", selected=["wait"])])["dp_next_test"]
    empty = _results(night, [_act(1, "order_tests")])["dp_next_test"]

    assert key.anchor is Anchor.STRONG  # type: ignore[attr-defined]
    assert both.anchor is Anchor.STRONG  # type: ignore[attr-defined]
    assert secondary.anchor is Anchor.ADEQUATE  # type: ignore[attr-defined]
    assert idle.anchor is Anchor.MISSED  # type: ignore[attr-defined]
    assert empty.anchor is Anchor.MISSED  # type: ignore[attr-defined]
    assert "急查乳酸" in both.detail  # type: ignore[attr-defined]
