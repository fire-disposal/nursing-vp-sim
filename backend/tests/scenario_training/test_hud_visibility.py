"""HUD 按需具现：**声明潜力、条件决定出现**，而不是焊死在界面上。

语义要点：
- 不写 `visible_when` = 一直可见（病房里本就有的监护仪）；
- 写了触发器 = "做过那件事才出现"（学生的动作、已揭示的线索、状态阈值）——
  这正是"信息随寻求而具现"，且**⑤ 的 B 床血氧因此不再免费泄露**。
"""

from __future__ import annotations

import pytest

from modules.scenario_training.pack_loader import load_pack_file
from modules.scenario_training.runtime.view import build_view
from modules.scenario_training.runtime.world import ActionRecord, initial_world, reveal_cues
from modules.scenario_training.schema import HudSlot, Presentation, ScenarioPack, Trigger
from modules.scenario_training.validation import validate_pack


@pytest.fixture(scope="module")
def sputum() -> ScenarioPack:
    return load_pack_file("sputum-ineffective")


@pytest.fixture(scope="module")
def two_beds() -> ScenarioPack:
    return load_pack_file("two-beds-priority")


def _slots(pack: ScenarioPack, world=None) -> list[dict]:
    view = build_view(pack, world or initial_world(pack), session_id=1, status="active", revision_id=1)
    return view.hud


def test_hud_keeps_only_non_reading_slots(sputum: ScenarioPack) -> None:
    """读数改由**设备面**展示后，HUD 只留现场线索与可做动作（同一读数不出现两次）。"""
    slots = {slot.slot: slot for slot in _slots(sputum)}
    assert set(slots) == {"现场线索", "可做动作"}
    assert all(slot.source != "state" for slot in slots.values())


def test_gated_hud_slot_appears_only_after_seeking(two_beds: ScenarioPack) -> None:
    """HUD 槽位的门控语义：没满足条件就不出现（用合成包避免依赖具体场景配置）。"""
    gated = two_beds.model_copy(
        update={
            "presentation": Presentation(
                hud=[
                    HudSlot(
                        slot="血氧",
                        source="state",
                        ref="scene.bed_b_sat",
                        visible_when=Trigger.model_validate(
                            {"all": [{"kind": "cue_revealed", "cue_id": "c_b_low_sat"}]}
                        ),
                    )
                ]
            )
        }
    )
    assert _slots(gated) == []

    world = initial_world(gated)
    reveal_cues(gated, world, ["c_b_low_sat"])
    slots = {slot.slot: slot for slot in _slots(gated, world)}
    assert slots["血氧"].value == 88


def test_gate_can_be_the_students_own_action(two_beds: ScenarioPack) -> None:
    """门控也可以直接写成"学生做过某动作"——做之前不出现，做完才出现。"""
    gated = two_beds.model_copy(
        update={
            "presentation": Presentation(
                hud=[
                    HudSlot(
                        slot="B 床血氧",
                        source="state",
                        ref="scene.bed_b_sat",
                        visible_when=Trigger.model_validate(
                            {"all": [{"kind": "action_used", "affordance_id": "measure_b"}]}
                        ),
                    )
                ]
            )
        }
    )
    assert _slots(gated) == []

    world = initial_world(gated)
    world.actions.append(ActionRecord(turn=1, affordance_id="measure_b", type="measure"))
    assert [slot.slot for slot in _slots(gated, world)] == ["B 床血氧"]


def test_validation_rejects_unknown_reference_in_hud_gate(two_beds: ScenarioPack) -> None:
    broken = two_beds.model_copy(
        update={
            "presentation": Presentation(
                hud=[
                    HudSlot(
                        slot="X",
                        source="cue",
                        visible_when=Trigger.model_validate({"all": [{"kind": "cue_revealed", "cue_id": "nope"}]}),
                    )
                ]
            )
        }
    )
    problems = validate_pack(broken)
    assert any("nope" in problem for problem in problems)


def test_bp_hud_reading_slot_appears_only_after_measuring() -> None:
    """bp-contradiction：血压槽位由 `c_bp_high` 门控——**量之前** HUD 里没有这个读数。

    回归（2026-09-29 视觉验收）：初始值 168 是引擎内部真值，不是"已经量到"；作者用包里已有的
    线索自己门控，平台不替作者猜哪些开局可见（见 `HudSlot` docstring 的作者规矩）。
    """
    pack = load_pack_file("bp-contradiction")
    assert "血压（收缩压）" not in [slot.slot for slot in _slots(pack)]

    world = initial_world(pack)
    reveal_cues(pack, world, ["c_bp_high"])
    slots = {slot.slot: slot for slot in _slots(pack, world)}
    assert slots["血压（收缩压）"].value == 168
    assert slots["血压（收缩压）"].ref == "scene.bp_sys"
