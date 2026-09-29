"""设备面（监护仪 / 值班电话…）：读数与趋势由平台算，「危急」只改视觉与音调（不是警报）。

通则：**同一读数优先由设备展示，白板让位**。
"""

from __future__ import annotations

import pytest

from modules.scenario_training.pack_loader import load_pack_file
from modules.scenario_training.runtime.board import build_board
from modules.scenario_training.runtime.devices import build_devices
from modules.scenario_training.runtime.view import build_view
from modules.scenario_training.runtime.world import ActionRecord, initial_world, reveal_cues
from modules.scenario_training.schema import (
    BoardSection,
    Device,
    DeviceChannel,
    Presentation,
    ScenarioPack,
    Trigger,
)
from modules.scenario_training.validation import validate_pack


@pytest.fixture(scope="module")
def sputum() -> ScenarioPack:
    return load_pack_file("sputum-ineffective")


@pytest.fixture(scope="module")
def two_beds() -> ScenarioPack:
    return load_pack_file("two-beds-priority")


@pytest.fixture(scope="module")
def night() -> ScenarioPack:
    return load_pack_file("night-call-decision")


def _channels(devices: list[dict]) -> dict[str, dict]:
    return {channel.ref: channel for device in devices for channel in device.channels}


def test_unmeasured_monitor_does_not_leak_hidden_severity(sputum: ScenarioPack) -> None:
    """未测量的通道**不得**用包里的初始值冒充读数（回归：2026-09-29 视觉验收）。

    88% 落在 `critical` 区间，但学生这一局**还没测过**；开局就渲染「血氧 · 未测量 · 危急」
    等于把隐匿的低氧直接告诉他，也违背「未测量不得用值冒充」自己的规矩。
    """
    devices = build_devices(sputum, initial_world(sputum))
    assert [device.kind for device in devices] == ["monitor"]
    assert devices[0].title == "床旁监护仪"
    assert devices[0].sound == "beep"  # 提示音（前端默认静音，用户可开）
    channel = _channels(devices)["scene.spo2"]
    assert channel.label == "血氧"
    assert channel.unit == "%"
    assert channel.measured is False
    assert channel.value is None
    assert channel.display == "—"
    assert channel.status == "unknown"
    assert channel.history == []
    assert channel.delta is None
    assert channel.updated_turn is None


def test_status_thresholds_and_trend(sputum: ScenarioPack) -> None:
    world = initial_world(sputum)

    from modules.scenario_training.runtime.world import apply_effects
    from modules.scenario_training.schema import Effect, EffectOp

    for value, expected in ((96, "normal"), (88, "critical"), (93, "low")):
        apply_effects(
            sputum,
            world,
            [Effect(target="scene", key="spo2", op=EffectOp.SET, value=value)],
            source="test",
        )
        channel = _channels(build_devices(sputum, world))["scene.spo2"]
        assert channel.status == expected, value

    channel = _channels(build_devices(sputum, world))["scene.spo2"]
    assert channel.delta == 93 - 88  # 与上一次取值相比
    assert len(channel.history) >= 3


def test_device_is_hidden_until_sought(two_beds: ScenarioPack) -> None:
    """⑤：B 床监护仪要等你真的去看那床（否则等于免费看到藏起来的答案）。"""
    assert build_devices(two_beds, initial_world(two_beds)) == []

    world = initial_world(two_beds)
    reveal_cues(two_beds, world, ["c_b_low_sat"])
    devices = build_devices(two_beds, world)
    assert [device.id for device in devices] == ["monitor_b"]
    # 线索揭示≠测到了：通道可见，但没有权威读数，仍然不给值/状态
    channel = _channels(devices)["scene.bed_b_sat"]
    assert channel.measured is False
    assert channel.value is None
    assert channel.status == "unknown"


def test_channel_appears_after_the_students_action(night: ScenarioPack) -> None:
    """②：值班手机上"乳酸"这条，要等检查真下过才出现（通道级门控）；而且**回报之前没有读数**。"""
    assert build_devices(night, initial_world(night)) == []

    world = initial_world(night)
    world.actions.append(ActionRecord(turn=1, affordance_id="order_tests", type="act"))
    devices = build_devices(night, world)
    assert devices
    assert devices[0].kind == "phone"
    channel = _channels(devices)["scene.lactate"]
    assert channel.unit == "mmol/L"
    assert channel.measured is False
    assert channel.display == "—"  # 还没回报：不给初值 0
    assert channel.history == []
    assert channel.updated_turn is None

    # 回报写入真实值之后，通道才有读数（值 / 显示 / 更新回合都跟上）
    from modules.scenario_training.runtime.world import apply_effects
    from modules.scenario_training.schema import Effect, EffectOp

    world.turn = 3
    apply_effects(night, world, [Effect(target="scene", key="lactate", op=EffectOp.SET, value=4.2)], source="test")
    channel = _channels(build_devices(night, world))["scene.lactate"]
    assert channel.measured is True
    assert channel.value == 4.2
    assert channel.display == "4.2"
    assert channel.updated_turn == 3
    assert channel.status == "unknown"  # 包没声明 normal/critical 区间 → 不替它报"正常"


def test_measuring_records_the_reading_on_the_device(sputum: ScenarioPack) -> None:
    """学生**测过之后**设备面必须显示那个数（不然刚做完测量却看不到读数，界面就不诚实）。

    `measure_spo2` 的 effect 把 `scene.spo2` 设成包里那个真实读数（88）：数值本身没变，
    但显式 SET 是"把读数登记进世界"，`measured` 因此翻真、`updated_turn` 记下时间单位。
    """
    from modules.scenario_training.runtime.world import apply_effects

    world = initial_world(sputum)
    world.turn = 1
    affordance = sputum.affordance("measure_spo2")
    apply_effects(sputum, world, affordance.effects, source="affordance:measure_spo2")

    channel = _channels(build_devices(sputum, world))["scene.spo2"]
    assert channel.measured is True
    assert channel.value == 88
    assert channel.display == "88"
    assert channel.status == "critical"  # 88 落在包声明的 critical [0, 90]
    assert channel.updated_turn == 1


def test_board_yields_readings_shown_on_a_device(two_beds: ScenarioPack) -> None:
    """通则：同一读数优先由设备展示——白板不再重复列它。"""
    pack = two_beds.model_copy(
        update={
            "presentation": Presentation(
                board=[
                    BoardSection(id="b_read", title="读数", source="state", refs=["scene.bed_b_sat"]),
                ],
                devices=[
                    Device(
                        id="m",
                        kind="monitor",
                        title="监护仪",
                        channels=[DeviceChannel(ref="scene.bed_b_sat", label="血氧", unit="%")],
                    )
                ],
            )
        }
    )
    world = initial_world(pack)
    board = build_board(pack, world)
    assert board.sections[0].entries == []  # 让位给设备

    # 若把设备换成"不覆盖该键"，白板照常显示
    other = pack.model_copy(
        update={
            "presentation": Presentation(
                board=pack.presentation.board,
                devices=[
                    Device(
                        id="m",
                        kind="monitor",
                        title="监护仪",
                        channels=[DeviceChannel(ref="scene.a_pain", label="疼痛")],
                    )
                ],
            )
        }
    )
    assert build_board(other, world).sections[0].entries


def test_view_exposes_devices(sputum: ScenarioPack) -> None:
    view = build_view(sputum, initial_world(sputum), session_id=1, status="active", revision_id=1)
    assert view.devices[0].id == "bedside_monitor"
    assert "monitor" not in view  # 旧的单例字段已移除


def test_validation_catches_bad_devices(sputum: ScenarioPack) -> None:
    broken = sputum.model_copy(
        update={
            "presentation": Presentation(
                devices=[
                    Device(
                        id="m",
                        kind="monitor",
                        title="M",
                        channels=[DeviceChannel(ref="scene.nope", label="X", normal=(10, 1))],
                        visible_when=Trigger.model_validate({"all": [{"kind": "cue_revealed", "cue_id": "nope"}]}),
                    )
                ]
            )
        }
    )
    problems = " ".join(validate_pack(broken))
    assert "未登记状态键" in problems
    assert "区间顺序" in problems
    assert "nope" in problems
