"""Workflow 内置特性开关（emotion / patient_initiative / inquiry_progress）。

它们不是 Activity：没有病例配置、没有产物，由 Workflow 内核直接驱动
（情绪事件、主动追问计时、问诊进度提示）。与 Activity 的「病例声明即开启」
相反，内置特性默认开启，只允许显式**关闭**（作业配置 / 开始请求的 features）。

旧 ``capabilities.detect_capabilities`` 把内置开关、病例字段反推与任意 override
混在一张表里；这里只保留内置部分，Activity 开关见 ``activities.py``。
"""

from __future__ import annotations

from collections.abc import Mapping

#: 内置特性键（不在 ACTIVITY_IDS 里，前端也不再为它们渲染面板开关）
BUILTIN_FEATURES: tuple[str, ...] = ("emotion", "patient_initiative", "inquiry_progress")


def _overrides(overrides: Mapping[str, object] | None) -> Mapping[str, object]:
    return overrides if isinstance(overrides, Mapping) else {}


def resolve_builtin_features(overrides: Mapping[str, object] | None = None) -> dict[str, bool]:
    """内置特性的开关投影：显式布尔值生效，其余默认开启。"""
    src = _overrides(overrides)
    resolved: dict[str, bool] = {}
    for key in BUILTIN_FEATURES:
        value = src.get(key)
        resolved[key] = value if isinstance(value, bool) else True
    return resolved


def is_feature_enabled(record, key: str) -> bool:
    """运行时门 — 只读 ``practice_snapshot.features``（开启训练时固化的覆盖）。"""
    if key not in BUILTIN_FEATURES:
        return False
    return resolve_builtin_features((getattr(record, "practice_snapshot", None) or {}).get("features"))[key]
