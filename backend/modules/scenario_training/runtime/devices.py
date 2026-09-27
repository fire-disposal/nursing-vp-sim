"""设备面：场景里的设备（监护仪 / 值班电话 / 输液泵…）。

与白板同级、互补——**设备展示实时读数，白板展示已确立的事**；
通则：同一读数**优先由设备展示**，白板自动让位（`device_refs` 供白板过滤）。

设计要点：
- 数值、状态（正常/偏低/偏高/危急）与**趋势**一律由平台从事件流算出（`state_history`），不由 LLM 编；
- 「危急」只改**视觉与音调**，**不是警报**——前端据此做柔和的滴滴提示，不做高频报警；
- 设备与通道都可按需求出现（`visible_when`），例如"化验回报"要等检查下过。
"""

from __future__ import annotations

from typing import Any

from ..schema import DeviceChannel, ScenarioPack
from .world import World

HISTORY_LEN = 12


def _status(value: Any, channel: DeviceChannel) -> str:
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
    return "normal"


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


def build_devices(pack: ScenarioPack, world: World) -> list[dict[str, Any]]:
    """投影出场景里的设备与通道读数（含状态与趋势）。"""
    from .world import trigger_holds

    devices: list[dict[str, Any]] = []
    for device in pack.presentation.devices:
        if device.visible_when is not None and not trigger_holds(pack, world, device.visible_when):
            continue
        channels: list[dict[str, Any]] = []
        for channel in device.channels:
            if channel.visible_when is not None and not trigger_holds(pack, world, channel.visible_when):
                continue
            if channel.ref not in world.state:
                continue
            history = _numbers(world.state_history.get(channel.ref, [world.state[channel.ref]])[-HISTORY_LEN:])
            value = world.state[channel.ref]
            channels.append(
                {
                    "ref": channel.ref,
                    "label": channel.label,
                    "unit": channel.unit,
                    "display": _display(value, channel),
                    "value": value,
                    "status": _status(value, channel),
                    "delta": _delta(history) if channel.trend else None,
                    "history": history if channel.trend else [],
                    "normal": list(channel.normal) if channel.normal else None,
                    "critical": list(channel.critical) if channel.critical else None,
                }
            )
        if channels:
            devices.append(
                {
                    "id": device.id,
                    "kind": device.kind,
                    "title": device.title,
                    "sound": device.sound,
                    "channels": channels,
                }
            )
    return devices


def device_refs(pack: ScenarioPack) -> set[str]:
    """所有设备通道覆盖的状态键——白板据此让位（同一读数不出现两次）。"""
    return {channel.ref for device in pack.presentation.devices for channel in device.channels}
