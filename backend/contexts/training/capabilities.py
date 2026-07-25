"""Tool binding — "数据即能力": tools are enabled by the presence of their config fields in case_data.

No more DataPredicate rules, no more capabilities dict.  Each ToolBinding declares which
case_data field activates it.  The detection engine is a one-liner: field exists + non-empty.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from models.training import TrainingRecord


@dataclass(frozen=True)
class ToolBinding:
    """Maps a case_data field to a tool — field exists → tool enabled."""

    tool: str
    field: str
    label: str = ""
    description: str = ""
    tier: str = "toggleable"  # "builtin" | "toggleable"

    @property
    def key(self) -> str:
        return self.tool


# ── Registry ──

TOOL_BINDINGS: list[ToolBinding] = [
    ToolBinding(
        tool="quiz",
        field="quiz",
        label="随堂测验",
        description="训练过程中弹出选择题/判断题，检测学生知识掌握情况",
    ),
    ToolBinding(
        tool="physical_exam",
        field="exam_anchors",
        label="护理查体",
        description="学生可进行虚拟体格检查（测量生命体征）",
    ),
    ToolBinding(
        tool="nursing_record",
        field="record_config",
        label="护理记录",
        description="生成结构化护理记录（ADPIE 格式）",
    ),
    ToolBinding(
        tool="mews",
        field="mews_config",
        label="MEWS 评分",
        description="早期预警评分计算工具",
    ),
]

# Builtin tools — always available
_BUILTIN_KEYS = {"emotion", "patient_initiative", "inquiry_progress"}


# ── Public API ──


def all_bindings() -> list[ToolBinding]:
    return list(TOOL_BINDINGS)


def detect_capabilities(
    case_data: dict | None, *, training_type: str | None = None, overrides: dict | None = None
) -> dict[str, bool]:
    """Scan case_data for tool config fields.  Field exists + non-empty → tool enabled.

    ``overrides`` takes precedence for explicit enable/disable (teacher assignment features).
    """
    if not case_data:
        result = {b.tool: False for b in TOOL_BINDINGS}
    else:
        result = {}
        for b in TOOL_BINDINGS:
            val = _resolve_path(case_data, b.field)
            result[b.tool] = _is_non_empty(val)

    # Builtins: always on unless explicitly disabled via features
    features = (overrides or {}) if overrides is not None else case_data.get("features", {}) if case_data else {}
    for key in _BUILTIN_KEYS:
        result[key] = features.get(key, result.get(key, True)) if isinstance(features, dict) else True

    # overrides take precedence
    if overrides:
        for k, v in overrides.items():
            if isinstance(v, bool):
                result[k] = v

    return result


def is_enabled(record, key: str) -> bool:
    """Runtime gate: re-detect from the record's snapshot."""
    snapshot = record.practice_snapshot or {}
    case_data = snapshot.get("case_data") or {}
    features = snapshot.get("features") or {}
    return detect_capabilities(case_data, training_type=record.training_type, overrides=features).get(key, False)


# ── Internal helpers ──


def _resolve_path(data: dict, path: str) -> Any:
    """Resolve a dotted JSON path within a dict."""
    current: Any = data
    for part in path.split("."):
        if isinstance(current, dict):
            current = current.get(part)
        else:
            return None
    return current


def _is_non_empty(val: Any) -> bool:
    """Check if a value is structurally non-empty."""
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, (dict, list)):
        return len(val) > 0
    if isinstance(val, str):
        return bool(val.strip())
    return True
