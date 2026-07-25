"""Capability detection — "数据即能力": tool availability is inferred from case_data content.

No more explicit `capabilities` boolean dict in case_data. The system inspects
what data the case actually contains and enables tools accordingly.

Assignment.features can still opt-out (force-disable) a capability, but cannot
opt-in if the case data doesn't support it.

Detection rules are declared declaratively via `DataPredicate` on each
`Capability`. Adding a new capability only requires a new entry — no per-key
if-elif branch in the detection engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

if TYPE_CHECKING:
    from models.training import TrainingRecord

Tier = Literal["builtin", "toggleable"]
PredicateType = Literal["training_type", "data_path", "personality_or"]
DataCheck = Literal["non_empty_dict", "non_empty_list"]


@dataclass(frozen=True)
class DataPredicate:
    """Declares how to detect capability presence from case_data content.

    Three model types:
      - ``training_type``    always-on for types that pass ``_applies`` (mews in triage)
      - ``data_path``        inspect a dotted JSON path against a predicate
      - ``personality_or``   match any of several personality field → value pairs

    ``legacy_key`` enables the old ``capabilities.{key}`` fallback for backward compat.
    """

    type: PredicateType
    data_path: str | None = None
    data_check: DataCheck | None = None
    personality_checks: tuple[tuple[str, str], ...] | None = None
    legacy_key: str | None = None


@dataclass(frozen=True)
class Capability:
    """能力元数据 — 用于文档/UI/代码生成，并为统一检测引擎提供 ``DataPredicate``。"""

    key: str
    label: str
    description: str
    tier: Tier
    training_types: tuple[str, ...] | None = None
    requires: tuple[str, ...] = field(default_factory=tuple)
    detect: DataPredicate | None = None  # None → builtin, always on for applicable types


ALL_CAPABILITIES: dict[str, Capability] = {
    "emotion": Capability(
        key="emotion",
        label="患者情绪状态机",
        description="6态情绪模型，根据学生用语动态变化。",
        tier="builtin",
        training_types=None,
    ),
    "patient_initiative": Capability(
        key="patient_initiative",
        label="患者主动追问",
        description="患者根据性格/情绪/等待时长主动发言。",
        tier="toggleable",
        training_types=("history_taking",),
        requires=("emotion",),
        detect=DataPredicate(
            type="personality_or",
            personality_checks=(("anxiety_trait", "anxious"), ("patience", "low")),
        ),
    ),
    "physical_exam": Capability(
        key="physical_exam",
        label="护理查体",
        description="允许学生触发护理操作（测血压/体温/听诊等）。仅当病例含 exam_anchors 数据时可用。",
        tier="toggleable",
        training_types=("history_taking",),
        detect=DataPredicate(
            type="data_path",
            data_path="exam_anchors",
            data_check="non_empty_dict",
            legacy_key="physical_exam",
        ),
    ),
    "nursing_record": Capability(
        key="nursing_record",
        label="护理评估记录",
        description="结构化护理评估表单填写（ADPIE）。仅当病例含 nursing_record 数据时可用。",
        tier="toggleable",
        training_types=("history_taking",),
        detect=DataPredicate(
            type="data_path",
            data_path="nursing_record",
            data_check="non_empty_dict",
            legacy_key="nursing_record",
        ),
    ),
    "quiz": Capability(
        key="quiz",
        label="引导题目",
        description="训练中穿插病例相关的引导性选择题。不参与评分。",
        tier="toggleable",
        training_types=("history_taking", "triage"),
        detect=DataPredicate(
            type="data_path",
            data_path="quiz.questions",
            data_check="non_empty_list",
        ),
    ),
    "mews": Capability(
        key="mews",
        label="MEWS 评分",
        description="分诊场景下的早期预警评分计算工具。",
        tier="toggleable",
        training_types=("triage",),
        detect=DataPredicate(
            type="training_type",
        ),
    ),
}


def _applies(cap: Capability, training_type: str | None) -> bool:
    if training_type is None or cap.training_types is None:
        return True
    return training_type in cap.training_types


def all_capabilities() -> dict[str, Capability]:
    return dict(ALL_CAPABILITIES)


def capabilities_for_type(training_type: str) -> dict[str, Capability]:
    return {k: c for k, c in ALL_CAPABILITIES.items() if _applies(c, training_type)}


# ── unified data-driven detection engine ────────────────────────────────


def _resolve_path(data: dict, path: str) -> Any:
    """Resolve a dotted JSON path within case_data (e.g. ``"quiz.questions"``)."""
    current: Any = data
    for part in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
        if current is None:
            return None
    return current


def _check_data(case_data: dict, path: str, check: DataCheck) -> bool:
    """Check data at a dotted path against a simple structural predicate."""
    value = _resolve_path(case_data, path)
    if check == "non_empty_dict":
        return isinstance(value, dict) and len(value) > 0
    if check == "non_empty_list":
        return isinstance(value, list) and len(value) > 0
    return False


def _detect(cap: Capability, case_data: dict) -> bool:
    """Generic capability detection driven by ``cap.detect`` DataPredicate."""
    rule = cap.detect
    if rule is None:
        return True  # builtin — always on for applicable types

    if rule.type == "training_type":
        return True  # always-on within types that pass _applies

    if rule.type == "personality_or" and rule.personality_checks:
        personality = case_data.get("personality") or {}
        return any(personality.get(field) == value for field, value in rule.personality_checks)

    if rule.type == "data_path" and rule.data_path and rule.data_check:
        if _check_data(case_data, rule.data_path, rule.data_check):
            return True
        # legacy backward-compat: old cases may have explicit capabilities.{key} flags
        if rule.legacy_key and (case_data.get("capabilities") or {}).get(rule.legacy_key, False):
            return True
        return False

    return False


# ── public API ───────────────────────────────────────────────────────────


def detect_capabilities(
    case_data: dict | None = None,
    training_type: str = "history_taking",
    overrides: dict[str, bool] | None = None,
) -> dict[str, bool]:
    """从 case_data 内容检测可用能力（数据即能力）。

    Detections driven by each Capability's ``DataPredicate``:
      - emotion:             builtin → always on
      - patient_initiative:  personality_or matching anxiety_trait="anxious" or patience="low"
      - physical_exam:       data_path exam_anchors non-empty dict (+ legacy capabilities fallback)
      - nursing_record:      data_path exam_anchors non-empty dict
      - quiz:                data_path quiz.questions non-empty list
      - mews:                training_type → always on for triage

    overrides: 教师 Assignment.features 可选覆盖（只能关闭，不能凭空开启）。
    """
    cd = case_data or {}
    result: dict[str, bool] = {}

    for k, cap in ALL_CAPABILITIES.items():
        if not _applies(cap, training_type):
            continue
        if cap.tier == "builtin":
            result[k] = True
            continue

        # toggleable — detect from data via declarative DataPredicate
        result[k] = _detect(cap, cd)

    # overrides: only allow opt-out for data-detected caps
    if overrides:
        for k, v in overrides.items():
            if k in result and not v:
                result[k] = False

    # requires coupling
    changed = True
    while changed:
        changed = False
        for k, cap in ALL_CAPABILITIES.items():
            if result.get(k):
                for req in cap.requires:
                    if req in result and not result[req]:
                        result[req] = True
                        changed = True
    return result


def is_enabled(record: TrainingRecord, key: str) -> bool:
    """运行时门控：从 record 的快照中重检测能力。"""
    snapshot = getattr(record, "practice_snapshot", None) or {}
    case_snapshot = getattr(record, "case_snapshot", None) or {}
    training_type = getattr(record, "training_type", None) or "history_taking"

    return detect_capabilities(
        case_data=case_snapshot,
        training_type=training_type,
        overrides=snapshot.get("features"),
    ).get(key, False)
