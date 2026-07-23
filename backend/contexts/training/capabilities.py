"""Capability detection — "数据即能力": tool availability is inferred from case_data content.

No more explicit `capabilities` boolean dict in case_data. The system inspects
what data the case actually contains and enables tools accordingly.

Assignment.features can still opt-out (force-disable) a capability, but cannot
opt-in if the case data doesn't support it.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from models.training import TrainingRecord

Tier = Literal["builtin", "toggleable"]


@dataclass(frozen=True)
class Capability:
    """能力元数据 — 用于文档/UI/代码生成，不参与运行时检测。"""

    key: str
    label: str
    description: str
    tier: Tier
    training_types: tuple[str, ...] | None = None
    requires: tuple[str, ...] = field(default_factory=tuple)


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
    ),
    "physical_exam": Capability(
        key="physical_exam",
        label="护理查体",
        description="允许学生触发护理操作（测血压/体温/听诊等）。",
        tier="toggleable",
        training_types=("history_taking",),
    ),
    "nursing_record": Capability(
        key="nursing_record",
        label="护理评估记录",
        description="结构化护理评估表单填写（ADPIE）。",
        tier="toggleable",
        training_types=("history_taking",),
    ),
    "quiz": Capability(
        key="quiz",
        label="引导题目",
        description="训练中穿插病例相关的引导性选择题。不参与评分。",
        tier="toggleable",
        training_types=("history_taking", "triage"),
    ),
    "mews": Capability(
        key="mews",
        label="MEWS 评分",
        description="分诊场景下的早期预警评分计算工具。",
        tier="toggleable",
        training_types=("triage",),
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


def detect_capabilities(
    case_data: dict | None = None,
    training_type: str = "history_taking",
    overrides: dict[str, bool] | None = None,
) -> dict[str, bool]:
    """从 case_data 内容检测可用能力（数据即能力）。

    检测规则（按能力）:
      - emotion:         始终开启（builtin）
      - patient_initiative: personality.{anxiety_trait="anxious" or patience="low"}
      - physical_exam:   triage 下始终开启；history_taking 下有 exam_anchors 数据
      - nursing_record:  history_taking 下始终开启（空白表单即可用）
      - quiz:            case_data.quiz.questions 非空数组
      - mews:            triage 下始终开启

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

        # toggleable — detect from data
        enabled = _detect_one(k, cd, training_type)
        result[k] = enabled

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


def _detect_one(key: str, case_data: dict, training_type: str) -> bool:
    """单个能力的检测逻辑。"""
    if key == "patient_initiative":
        personality = case_data.get("personality") or {}
        return personality.get("anxiety_trait") == "anxious" or personality.get("patience") == "low"

    if key == "physical_exam":
        if training_type == "triage":
            return True
        anchors = case_data.get("exam_anchors")
        return isinstance(anchors, dict) and len(anchors) > 0

    if key == "nursing_record":
        return training_type == "history_taking"

    if key == "quiz":
        quiz = case_data.get("quiz") or {}
        questions = quiz.get("questions") if isinstance(quiz, dict) else None
        return isinstance(questions, list) and len(questions) > 0

    if key == "mews":
        return training_type == "triage"

    return False


def is_enabled(record: TrainingRecord, key: str) -> bool:
    """运行时门控：从 record 的快照中重检测能力。"""
    snapshot = getattr(record, "practice_snapshot", None) or {}
    case_snapshot = getattr(record, "case_snapshot", None) or {}
    training_type = getattr(record, "training_type", None) or "history_taking"

    return detect_capabilities(
        case_data=case_snapshot,
        training_type=training_type,
        overrides=snapshot.get("feature_overrides"),
    ).get(key, False)
