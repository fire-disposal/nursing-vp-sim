"""演出交付的引用契约（`sources` / `highlights`）与纠偏反馈。

回归（2026-09-29 五包演练）：`night-call-decision` 的 `order_tests` 回合曾被
`delivery_unknown_source:c_results` 6/6 拒掉——模型把引用写成了**裸 id**，而校验只认带命名空间的形式，
于是一个本来完全正常的回合被整条丢弃，学生永远看到「本回合没有生成成功，世界未改变」。

平台**说模型的方言**（同 `op` 的 `add`/`incr` 归一）：裸 id 只要能唯一对上某个已声明、已可见的引用，
就按那个命名空间采纳；安全边界不变（能对上的 id 本来就在白名单里）。对不上就照旧整条拒绝，
歧义（同一 id 在多个命名空间都可见）也不替模型猜。
"""

from __future__ import annotations

import pytest

from modules.scenario_training import pack_loader
from modules.scenario_training.dm.contract import StageError, validate_delivery
from modules.scenario_training.dm.prompt import ref_fix_hint
from modules.scenario_training.runtime.world import initial_world, reveal_cues
from modules.scenario_training.schema import ScenarioPack
from modules.scenario_training.turns import DeliveryMessage, SceneDelivery


@pytest.fixture(scope="module")
def sputum() -> ScenarioPack:
    return pack_loader.load_pack_file("sputum-ineffective")


def _delivery(*, sources: list[str], text: str = "监护仪还在响。") -> SceneDelivery:
    return SceneDelivery(messages=[DeliveryMessage(speaker=None, text=text, sources=sources)])


def test_bare_id_is_normalized_to_its_namespace(sputum: ScenarioPack) -> None:
    """裸 `c_low_spo2` → `cue:c_low_spo2`（真实事故就是这个形状）。"""
    world = initial_world(sputum)
    reveal_cues(sputum, world, ["c_low_spo2"])
    allowed = {"cue:c_low_spo2", "action:measure_spo2"}
    clean = validate_delivery(sputum, world, _delivery(sources=["c_low_spo2"]), allowed_refs=allowed)
    assert clean.messages[0].sources == ["cue:c_low_spo2"]


def test_duplicate_refs_are_deduped_keeping_order(sputum: ScenarioPack) -> None:
    """重复 token（模型常写两遍）去重且保持首次出现顺序。"""
    world = initial_world(sputum)
    reveal_cues(sputum, world, ["c_low_spo2"])
    allowed = {"cue:c_low_spo2", "reaction:r_suction_first"}
    clean = validate_delivery(
        sputum,
        world,
        _delivery(sources=["r_suction_first", "c_low_spo2", "c_low_spo2", "r_suction_first"]),
        allowed_refs=allowed,
    )
    assert clean.messages[0].sources == ["reaction:r_suction_first", "cue:c_low_spo2"]


def test_undeclared_ref_is_still_rejected(sputum: ScenarioPack) -> None:
    """真正未声明的 id（对不上任何命名空间）照旧整条拒绝。"""
    world = initial_world(sputum)
    allowed = {"cue:c_low_spo2"}
    with pytest.raises(StageError) as excinfo:
        validate_delivery(sputum, world, _delivery(sources=["c_not_declared"]), allowed_refs=allowed)
    assert "delivery_unknown_source:c_not_declared" in str(excinfo.value)


def test_ambiguous_bare_id_is_rejected_with_readable_problem(sputum: ScenarioPack) -> None:
    """同一 id 在多个命名空间都可见 → 歧义，不猜，问题串要点明候选。"""
    world = initial_world(sputum)
    allowed = {"cue:x", "reaction:x"}
    with pytest.raises(StageError) as excinfo:
        validate_delivery(sputum, world, _delivery(sources=["x"]), allowed_refs=allowed)
    message = str(excinfo.value)
    assert message.startswith("delivery_ambiguous_source:x")
    assert "cue:x" in message
    assert "reaction:x" in message


def test_highlights_are_normalized_too(sputum: ScenarioPack) -> None:
    """`highlights` 与 `sources` 同一套归一（否则同一类事故会在另一处复发）。"""
    world = initial_world(sputum)
    reveal_cues(sputum, world, ["c_low_spo2"])
    delivery = SceneDelivery(
        messages=[DeliveryMessage(speaker=None, text="监护仪还在响。")], highlights=["c_low_spo2", "c_low_spo2"]
    )
    clean = validate_delivery(sputum, world, delivery, allowed_refs={"cue:c_low_spo2"})
    assert clean.highlights == ["cue:c_low_spo2"]


def test_ref_fix_hint_teaches_the_required_form() -> None:
    """纠偏反馈要能教模型照做：说清命名空间并给出本回合可用引用；非引用错误原样返回。"""
    hint = ref_fix_hint("delivery_unknown_source:c_results", {"cue:c_results", "reaction:r_results_back"})
    assert "cue:<线索 id>" in hint
    assert "`cue:c_results`" in hint
    assert ref_fix_hint("delivery_empty", {"cue:x"}) == "delivery_empty"
