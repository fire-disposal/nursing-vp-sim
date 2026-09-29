"""工具集的硬边界：拒绝只作用于**那一次调用**，世界一个字节都不落地。

只留三条消费者可见不变量：
- `world_set`：未登记键 / 类型不符 / 越界 → 记一次**具名**拒绝，状态不变（合规的值照写）；
- `cue_reveal`：未声明线索同理，且重复揭示不重复记；
- `present_image`：不满足 `reveal_with` 时只拒那一次，揭示后同一张图能发出去。
"""

from __future__ import annotations

import json

import pytest

from modules.scenario_training.pack_loader import load_case
from modules.scenario_training.runtime.tools import ToolRuntime
from modules.scenario_training.runtime.world import initial_world, reveal_cues
from modules.scenario_training.schema import ScenarioPack


@pytest.fixture(scope="module")
def sputum() -> ScenarioPack:
    return load_case("sputum-ineffective")[0]


def _runtime(pack: ScenarioPack) -> ToolRuntime:
    return ToolRuntime(pack=pack, world=initial_world(pack), mode="turn")


def _call(runtime: ToolRuntime, name: str, **args: object) -> dict:
    return json.loads(runtime.call(name, dict(args)))


@pytest.mark.parametrize(
    ("args", "reason"),
    [
        ({"key": "scene.o2_flow", "value": 6}, None),  # 合规：照写
        ({"key": "scene.nope", "value": 1}, "key_unregistered"),
        ({"key": "scene.spo2", "value": "88"}, "type_mismatch"),
        ({"key": "scene.spo2", "value": 101}, "out_of_range"),
    ],
)
def test_world_set_rejects_only_that_one_call(sputum: ScenarioPack, args: dict, reason: str | None) -> None:
    runtime = _runtime(sputum)
    before = dict(runtime.world.state)
    result = _call(runtime, "world_set", **args)

    if reason is None:
        assert result["ok"] is True
        assert runtime.world.state["scene.o2_flow"] == 6
        return

    assert result["ok"] is False
    assert result["reason"] == reason
    assert runtime.rejections[reason] == 1
    assert runtime.steps[-1].ok is False
    assert runtime.steps[-1].detail  # 交回模型的原因是人话，不是只有 code
    assert runtime.world.state == before  # 被拒的写一个字节都没落地


def test_cue_reveal_rejects_undeclared_and_never_records_twice(sputum: ScenarioPack) -> None:
    runtime = _runtime(sputum)
    assert _call(runtime, "cue_reveal", id="nope")["reason"] == "cue_unknown"
    assert runtime.reveals == []  # 未声明的线索不落地

    assert _call(runtime, "cue_reveal", id="c_left_absent")["already"] is False
    assert _call(runtime, "cue_reveal", id="c_left_absent")["already"] is True
    assert runtime.reveals == ["c_left_absent"]


def test_image_gate_rejects_one_call_and_opens_after_the_reveal(sputum: ScenarioPack) -> None:
    pack = sputum.model_copy(update={"assets": [sputum.assets[0].model_copy(update={"reveal_with": ["c_low_spo2"]})]})
    runtime = _runtime(pack)

    assert _call(runtime, "present_image", asset_id="a_room")["reason"] == "image_gated"
    assert runtime.images == []

    reveal_cues(pack, runtime.world, ["c_low_spo2"])
    assert _call(runtime, "present_image", asset_id="a_room")["ok"] is True
    assert runtime.images == ["a_room"]
