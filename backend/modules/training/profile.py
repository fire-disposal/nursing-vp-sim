"""Workflow 定义 —— 一条完整训练闭包（docs/15 §二、§九）。

原 ``profile.PROFILE`` 单例（prompts + rubric + note_sources）升级为
``history_taking`` Workflow：同一处声明它允许挂载的 Activity 白名单、
完成策略（哪些产物必须已提交）、评分/上下文引用，以及原有的
prompts / rubric / note_sources。

禁止（docs/15 §二）：把具体病例逻辑写进 Workflow；Workflow 直接持有 LLM prompt
文本之外的领域规则；恢复 ``training_type`` 单字段总分派。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from modules.training.activities import (
    ACTIVITY_BINDINGS,
    ActivityAvailability,
    activity_availability,
    is_activity_enabled,
    resolve_activity_flags,
)
from modules.training.features import resolve_builtin_features
from modules.training.patient_ai.note_source import OperationNoteSource, declared_name
from modules.training.patient_ai.notes import EmotionNoteSource, IdentityGuardSource
from modules.training.prompts.patient import PATIENT_DYNAMIC, PATIENT_SYSTEM
from modules.training.scoring.rubric_loader import get_base_rubric

if TYPE_CHECKING:
    from collections.abc import Mapping

    from modules.training.patient_ai.note_source import NoteSource


@dataclass
class PromptCollection:
    system: str = ""
    dynamic: str = ""


@dataclass(frozen=True)
class CompletionPolicy:
    """完成策略：哪些产物必须是「已提交」的冻结版本（docs/15 §五）。

    唯一 owner 是内核 CompletionService；Activity 只能通过
    ``requires_submission_for_completion`` 声明自己的产物是否参与其中。
    """

    required_artifacts: tuple[str, ...] = ()

    def covers(self, artifact_kind: str | None) -> bool:
        return artifact_kind is not None and artifact_kind in self.required_artifacts


@dataclass(frozen=True)
class WorkflowDefinition:
    id: str
    label: str
    description: str
    #: 允许挂载的 Activity id 白名单（不是无限扩展点）
    activities: tuple[str, ...]
    #: 可用入口形态：自由练习 / 作业 / 考核
    entry_modes: tuple[str, ...]
    artifact_kinds: tuple[str, ...]
    completion: CompletionPolicy
    scoring_profile: str
    context_profile: str
    ui: dict[str, str]
    note_sources: list[type[NoteSource]]
    prompts: PromptCollection
    rubric: dict

    # ── 解析（服务端唯一入口；前端不得重新推导，docs/15 §四）──────────────

    def is_enabled(
        self,
        case_data: Mapping[str, Any] | None,
        activity_id: str,
        *,
        overrides: Mapping[str, Any] | None = None,
    ) -> bool:
        """病例 + 作业覆盖是否让该 Activity 在这个 Workflow 下可用。"""
        return is_activity_enabled(case_data, activity_id, allowed=self.activities, overrides=overrides)

    def availability(
        self,
        case_data: Mapping[str, Any] | None,
        activity_id: str,
        *,
        overrides: Mapping[str, Any] | None = None,
        session_active: bool = True,
    ) -> ActivityAvailability:
        return activity_availability(
            case_data,
            activity_id,
            allowed=self.activities,
            overrides=overrides,
            session_active=session_active,
        )

    def resolve_features(
        self,
        case_data: Mapping[str, Any] | None,
        *,
        overrides: Mapping[str, Any] | None = None,
    ) -> dict[str, bool]:
        """内置特性 + 本 Workflow 的 Activity 开关（训练记录上固化的能力投影）。"""
        return {
            **resolve_builtin_features(overrides),
            **resolve_activity_flags(case_data, allowed=self.activities, overrides=overrides),
        }

    def context_sources(
        self,
        case_data: Mapping[str, Any] | None,
        *,
        overrides: Mapping[str, Any] | None = None,
    ) -> frozenset[str]:
        """本轮**被声明**可注入的患者上下文来源（docs/15 §八「谁有权注入什么」）。

        = 本 Workflow 的 ``note_sources`` ∪ 本次病例实际启用 Activity 的
        ``context_contribution.key``。来源由 Workflow/病例声明，不由生产者自报：
        病例没启用的 Activity 不能注入，未声明的来源会被 ContextAssembler 拒绝。
        """
        sources = {declared_name(cls) for cls in self.note_sources}
        for activity_id, definition in ACTIVITY_BINDINGS.items():
            if not self.is_enabled(case_data, activity_id, overrides=overrides):
                continue
            sources.update(contribution.key for contribution in definition.context_contribution)
        return frozenset(name for name in sources if name)


#: 目前只有一个生产 Workflow。``training_records.training_type`` 退场后，
#: 「这次训练跑哪条闭包」由**病例 revision 决定、训练记录冻结**（``training_records.workflow_id``，
#: 见 ``modules/training/workflows.py`` 的注册表与解析器）；本文件只负责**声明**一条闭包。
HISTORY_TAKING = WorkflowDefinition(
    id="history_taking",
    label="病史采集",
    description="护患对话 + 床旁检查 + 护理评估的完整训练闭包",
    activities=("physical_exam", "nursing_record", "quiz", "nursing_diagnosis"),
    entry_modes=("自由练习", "作业", "考核"),
    artifact_kinds=("nursing_record",),
    completion=CompletionPolicy(required_artifacts=("nursing_record",)),
    scoring_profile="history_taking.base",
    context_profile="history_taking.session",
    ui={"workspace": "patient_interaction", "primary_surface": "conversation"},
    note_sources=[EmotionNoteSource, IdentityGuardSource, OperationNoteSource],
    prompts=PromptCollection(system=PATIENT_SYSTEM, dynamic=PATIENT_DYNAMIC),
    rubric=get_base_rubric(),
)
