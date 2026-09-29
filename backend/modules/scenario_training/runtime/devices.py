"""设备面：场景里的设备（监护仪 / 值班电话 / 输液泵…）。

数值、状态（正常/偏低/偏高/危急）与趋势一律由平台从事件流算出（`state_history` / `state_turns`），
**不由 LLM 编**。「危急」只改视觉与音调，不是警报。

`measured` / `updated_turn`（docs/scenario.md）：这条读数在本场里**是否真的产生过**（有过效果应用）、
最近一次变化发生在哪一回合。未测量、未知、未连接**不得用 0 或初始值代替**——没测过就
`status="unknown"`、`value=None`、`display="—"`、无趋势、无更新回合（初始值只供引擎内部判定）；
有值才是真的测过，回合数是模拟推进近似，**不是真实分钟**。
"""

from __future__ import annotations

from typing import Any, Literal

from ..api_models import ScenarioDevice, ScenarioDeviceChannel
from ..schema import DeviceChannel, ScenarioPack
from .world import World, trigger_holds

HISTORY_LEN = 12

# 与 `ScenarioDeviceChannel.status` 同源：状态只有这五种，没有「未连接」之外的自由值
DeviceStatus = Literal["normal", "low", "high", "critical", "unknown"]


def _status(value: Any, channel: DeviceChannel) -> DeviceStatus:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return "unknown"
    if channel.critical and channel.critical[0] <= value <= channel.critical[1]:
        return "critical"
    if channel.normal:
        low, high = channel.normal
        if value < low:
            return "low"
        if value > high:
            return "high"
        return "normal"
    # 没声明区间就不报"正常"：那是包没做过的断言（值照常显示，状态留 unknown）
    return "unknown"


def _numbers(history: list[Any]) -> list[float]:
    return [float(item) for item in history if isinstance(item, (int, float)) and not isinstance(item, bool)]


def _delta(history: list[float]) -> float | None:
    if len(history) < 2:
        return None
    change = round(history[-1] - history[-2], 2)
    return change or None


def _display(value: Any, channel: DeviceChannel) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and channel.decimals:
        return f"{value:.{channel.decimals}f}"
    return f"{value}"


def build_devices(pack: ScenarioPack, world: World) -> list[ScenarioDevice]:
    """投影出场景里的设备与通道读数（含状态、趋势、是否测量过与最近更新回合）。"""
    devices: list[ScenarioDevice] = []
    for device in pack.presentation.devices:
        if device.visible_when is not None and not trigger_holds(pack, world, device.visible_when):
            continue
        channels: list[ScenarioDeviceChannel] = []
        for channel in device.channels:
            if channel.visible_when is not None and not trigger_holds(pack, world, channel.visible_when):
                continue
            if channel.ref not in world.state:
                continue  # 没这个读数就不给通道——不用 0 冒充
            turns = world.state_turns.get(channel.ref, [])
            if len(turns) <= 1:
                # **没测过就没有读数**：初始值只供引擎内部判定，不得投影成学生的"读数"——
                # 否则等于在测量之前就把隐匿的危重程度（`critical` 区间）告诉学生。
                # 状态/值/趋势/更新回合一律为空，显示 `—`（docs/scenario.md：不得用 0 或初始值冒充）。
                channels.append(
                    ScenarioDeviceChannel(
                        ref=channel.ref,
                        label=channel.label,
                        unit=channel.unit,
                        display="—",
                        value=None,
                        status="unknown",
                        delta=None,
                        history=[],
                        normal=list(channel.normal) if channel.normal else None,
                        critical=list(channel.critical) if channel.critical else None,
                        measured=False,
                        updated_turn=None,
                    )
                )
                continue
            history = _numbers(world.state_history.get(channel.ref, [world.state[channel.ref]])[-HISTORY_LEN:])
            value = world.state[channel.ref]
            channels.append(
                ScenarioDeviceChannel(
                    ref=channel.ref,
                    label=channel.label,
                    unit=channel.unit,
                    display=_display(value, channel),
                    value=value,
                    status=_status(value, channel),
                    delta=_delta(history) if channel.trend else None,
                    history=history if channel.trend else [],
                    normal=list(channel.normal) if channel.normal else None,
                    critical=list(channel.critical) if channel.critical else None,
                    measured=True,
                    updated_turn=turns[-1],
                )
            )
        if channels:
            devices.append(
                ScenarioDevice(
                    id=device.id,
                    kind=device.kind,
                    title=device.title,
                    sound=device.sound,
                    channels=channels,
                )
            )
    return devices


def device_refs(pack: ScenarioPack) -> set[str]:
    """所有设备通道覆盖的状态键——白板据此让位（同一读数不出现两次）。"""
    return {channel.ref for device in pack.presentation.devices for channel in device.channels}
