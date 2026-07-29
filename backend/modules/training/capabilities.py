"""Tool binding — "数据即能力": tools are enabled by the presence of their config fields in case_data.

No explicit boolean flags. The system inspects what data the case actually contains
and enables tools accordingly.

Assignment.features can still opt-out (force-disable) a capability, but cannot
opt-in if the case data doesn't support it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class ToolBinding:
    """Maps a case_data field to a tool — field exists → tool enabled.

    ``field`` is the canonical dotted path (e.g. ``tools.physical_exam``).
    ``legacy_field`` is the old top-level key for backward compat (e.g. ``exam_anchors``).
    """

    tool: str
    field: str
    label: str = ""
    description: str = ""
    legacy_field: str | None = None

    @property
    def key(self) -> str:
        return self.tool


# ── Registry ──

TOOL_BINDINGS: list[ToolBinding] = [
    ToolBinding(
        tool="quiz",
        field="tools.quiz",
        label="随堂测验",
        description="训练过程中弹出选择题/判断题，检测学生知识掌握情况",
    ),
    ToolBinding(
        tool="physical_exam",
        field="tools.physical_exam",
        legacy_field="exam_anchors",
        label="护理查体",
        description="学生可进行虚拟体格检查（测量生命体征）",
    ),
    ToolBinding(
        tool="nursing_record",
        field="tools.nursing_record",
        label="护理记录",
        description="生成结构化护理记录（ADPIE 格式）",
    ),
    ToolBinding(
        tool="nursing_diagnosis",
        field="tools.nursing_diagnosis",
        label="护理诊断",
        description="NANDA 护理诊断制定与优先级排序",
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
            if val is None:
                if b.legacy_field:
                    val = case_data.get(b.legacy_field)
                elif "." in b.field:
                    val = case_data.get(b.field.rsplit(".", 1)[-1])
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
    """Data-driven runtime gate — same detection as API response.

    Fully driven by case_data content: field exists → tool enabled.
    ``practice_snapshot.features`` only provides opt-out overrides
    (teacher-assigned force-disables).
    """
    case_data = record.case_snapshot or {}
    features = (record.practice_snapshot or {}).get("features") or {}
    return detect_capabilities(case_data, training_type=record.training_type, overrides=features).get(key, False)


# ── Internal helpers ──


def _resolve_path(data: dict, path: str) -> Any:
    """Resolve a dotted JSON path within a dict."""
    current: Any = data
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
        if current is None:
            return None
    return current


def _is_non_empty(val: Any) -> bool:
    """Check if a value is structurally non-empty."""
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return True
    if isinstance(val, str):
        return len(val) > 0
    if isinstance(val, (list, tuple)):
        return len(val) > 0
    if isinstance(val, dict):
        return len(val) > 0
    return True
