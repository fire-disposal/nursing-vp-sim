"""每场景自写的 rubric + **整数权重（1–100）** + 按 Σw 归一化的**得分率**。

权重的口径（用户裁定 2026-09-27 简化）：只允许正整数 1–100；**不要求合计 100**——
`20 20 80` 同样合法，平台按 Σw 归一化后再给得分率；加权部分 **LLM 看不见也不处理**。
"""

from __future__ import annotations

import pytest

from modules.scenario_training.dm.prompt import build_dm_messages
from modules.scenario_training.judge.rules import evaluate, score_report
from modules.scenario_training.pack_loader import load_pack_file
from modules.scenario_training.runtime.world import ActionRecord, initial_world
from modules.scenario_training.schema import (
    Anchor,
    Criterion,
    JudgeRuleKind,
    ScenarioPack,
)
from modules.scenario_training.validation import validate_pack


@pytest.fixture(scope="module")
def sputum() -> ScenarioPack:
    return load_pack_file("sputum-ineffective")


@pytest.fixture(scope="module")
def triage() -> ScenarioPack:
    return load_pack_file("triage-hidden-bleed")


def _report(pack: ScenarioPack, world) -> dict:
    return score_report(evaluate(pack, world))


def _criterion(cid: str, weight: int, *, covers: str = "document", min_hits: int = 1) -> Criterion:
    return Criterion(
        id=cid,
        title=f"判据 {cid}",
        rule=JudgeRuleKind.ACTION_SET_COVERS,
        params={"affordances": [covers], "min": min_hits},
        anchors={Anchor.STRONG: "强", Anchor.ADEQUATE: "合格", Anchor.MISSED: "漏"},
        weight=weight,
    )


def test_packs_carry_their_own_rubric_with_integer_weights(sputum: ScenarioPack, triage: ScenarioPack) -> None:
    """不同场景写自己的 rubric（不是通用方案），权重是正整数、每包合计 100（作者心算口径）。"""
    assert [c.id for c in sputum.rubric][:2] == ["dp_recognize", "dp_no_repeat"]
    assert [c.weight for c in sputum.rubric] == [25, 30, 30, 10, 5]
    assert [c.weight for c in triage.rubric] == [50, 30, 20]  # 分诊"分到哪儿"最重
    assert sum(c.weight for c in sputum.rubric) == 100


def test_rate_is_weighted_sum_over_total_weight(sputum: ScenarioPack) -> None:
    """得分率 = Σ(权重×锚点得分) / Σ权重（用不变量断言，不写死魔数）。"""
    world = initial_world(sputum)
    world.actions.append(ActionRecord(turn=1, affordance_id="bag_valve", type="act"))
    report = _report(sputum, world)

    expected_sum = sum(row["weight"] * row["score"] for row in report["criteria"])
    expected_weight = sum(row["weight"] for row in report["criteria"])
    assert report["weighted_sum"] == pytest.approx(round(expected_sum, 4))
    assert report["total_weight"] == pytest.approx(round(expected_weight, 4))
    assert report["rate"] == pytest.approx(round(expected_sum / expected_weight, 4))
    assert all(
        {"id", "title", "anchor", "score", "weight", "detail", "evidence"} <= set(row) for row in report["criteria"]
    )


def test_weights_need_not_sum_to_hundred(sputum: ScenarioPack) -> None:
    """`20 20 80` 这种也合法：权重合计不是 100 时照样按 Σw 归一化。"""
    pack = sputum.model_copy(
        update={
            "rubric": [
                _criterion("c1", 20, covers="suction"),  # 没用过 → missed(0)
                _criterion("c2", 20, covers="auscultate"),  # 没用过 → missed(0)
                _criterion("c3", 80, covers="document"),  # 做过 → strong(1)
            ]
        }
    )
    assert validate_pack(pack) == []

    world = initial_world(pack)
    world.actions.append(ActionRecord(turn=1, affordance_id="document", type="document"))
    report = _report(pack, world)
    assert report["total_weight"] == 120
    assert report["weighted_sum"] == 80
    assert report["rate"] == pytest.approx(round(80 / 120, 4))  # 0.6667


def test_weight_must_be_positive_integer_within_range(sputum: ScenarioPack) -> None:
    """只允许 1–100 的正整数：0、101、非整数一律拒绝。"""
    for bad in (0, 101):
        with pytest.raises(ValueError):
            _criterion("bad", bad)
    assert validate_pack(sputum) == []


def test_unreached_restraint_is_not_full_credit(sputum: ScenarioPack) -> None:
    """④：从没吸过痰 → "是否停止重复无效的吸痰"只算**合格**，不能白拿满分。"""
    fresh = _report(sputum, initial_world(sputum))
    row = next(item for item in fresh["criteria"] if item["id"] == "dp_no_repeat")
    assert row["anchor"] == "adequate"
    assert row["score"] == 0.5

    world = initial_world(sputum)
    world.actions.append(ActionRecord(turn=1, affordance_id="suction", type="act"))
    row = next(item for item in _report(sputum, world)["criteria"] if item["id"] == "dp_no_repeat")
    assert row["anchor"] == "strong"
    assert row["score"] == 1.0


def test_weights_are_invisible_to_the_llm(sputum: ScenarioPack) -> None:
    """加权部分 LLM **看不见也不处理**：权重数值与判据 id 都不进 DM 提示词。"""
    world = initial_world(sputum)
    messages = build_dm_messages(sputum, world, None, [], opening=True)
    text = "\n".join(message["content"] for message in messages)
    for criterion in sputum.rubric:
        assert criterion.id not in text
        assert criterion.title not in text
    assert "权重" not in text
    assert "得分率" not in text


def test_validation_rejects_bad_anchor_score_map(sputum: ScenarioPack) -> None:
    broken = sputum.model_copy(
        update={
            "rubric": [
                Criterion(
                    id="bad",
                    title="",
                    rule=JudgeRuleKind.ACTION_SET_COVERS,
                    params={"affordances": ["document"], "min": 1},
                    anchors={Anchor.STRONG: "s", Anchor.ADEQUATE: "a", Anchor.MISSED: "m"},
                    weight=5,
                    score_map={Anchor.STRONG: 1.5, Anchor.ADEQUATE: 0.5, Anchor.MISSED: 0.0},
                )
            ]
        }
    )
    problems = " ".join(validate_pack(broken))
    assert "锚点得分须在 0..1" in problems
    assert "缺 title" in problems


def test_report_shape_contract(sputum: ScenarioPack) -> None:
    """报告形状契约：得分率三件套 + 逐条明细（端到端断言在 API 测试里）。"""
    report = score_report(evaluate(sputum, initial_world(sputum)))
    assert set(report) == {"rate", "weighted_sum", "total_weight", "criteria"}
    assert 0.0 <= report["rate"] <= 1.0  # type: ignore[operator]
