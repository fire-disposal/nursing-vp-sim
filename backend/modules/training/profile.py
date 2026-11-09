"""Workflow 定义 —— 一条完整训练闭包。

原 ``profile.PROFILE`` 单例（prompts + rubric + note_sources）升级为
``history_taking`` Workflow：同一处声明它允许挂载的 Activity 白名单、
完成策略（哪些产物必须已提交）、评分/上下文引用，以及原有的
prompts / rubric / note_sources。

禁止：把具体病例逻辑写进 Workflow；Workflow 直接持有 LLM prompt
文本之外的领域规则；恢复 ``training_type`` 单字段总分派。
"""

from __future__ import annotations

from collections.abc import Mapping
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
    from modules.training.patient_ai.note_source import NoteSource


@dataclass
class PromptCollection:
    system: str = ""
    dynamic: str = ""


@dataclass(frozen=True)
class CompletionPolicy:
    """完成策略：哪些产物必须是「已提交」的冻结版本。

    唯一 owner 是内核 CompletionService；Activity 只能通过
    ``requires_submission_for_completion`` 声明自己的产物是否参与其中。
    """

    required_artifacts: tuple[str, ...] = ()

    def covers(self, artifact_kind: str | None) -> bool:
        return artifact_kind is not None and artifact_kind in self.required_artifacts


#: 病例按**教学任务**声明本次交卷门禁的键：``case_data["completion"]["required_artifacts"]``。
#: 只有需要学生"写完并提交"的病例才把产物列进来 —— 护理评估是评分产物，但不是每个病例的
#: 教学任务都要求先提交它才能交卷。缺省 = 用 workflow 的声明。
COMPLETION_DECLARATION_KEY = "completion"


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
    ui: dict[str, str]
    note_sources: list[type[NoteSource]]
    prompts: PromptCollection
    rubric: dict
    #: 老问诊内置特性不会自动泄漏到新闭包；各 Workflow 显式声明。
    builtin_features: tuple[str, ...] = ("emotion", "patient_initiative", "inquiry_progress")
    #: 产品状态：这条闭包**是否已有真实运行期入口**（学生工作区 + 真实产物/证据 +
    #: 评分/复盘）。``False`` = 只能编写病例、过发布门禁、进目录，训练入口一律拒绝
    #: （``workflows.require_startable`` → 409），绝不落地一条没有 renderer 的训练记录。
    #: 摘掉这个标志的时机由**真实能力**决定，不由排期决定。
    runtime_ready: bool = True

    # ── 解析（服务端唯一入口；前端不得重新推导）──────────────

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

    def required_artifacts_for(self, case_data: Mapping[str, Any] | None) -> tuple[str, ...]:
        """本次训练的**交卷门禁产物**：病例显式声明优先，否则用 workflow 默认。

        病例只能在本 workflow 声明的产物种类里选（未登记的 kind 被忽略并在发布门禁报错），
        因此"要求提交"与"病例真的启用了该产物"两件事不会各说各话。
        """
        declared = (case_data or {}).get(COMPLETION_DECLARATION_KEY)
        if isinstance(declared, Mapping):
            kinds = declared.get("required_artifacts")
            if isinstance(kinds, (list, tuple)):
                return tuple(kind for kind in (str(k) for k in kinds) if kind in self.artifact_kinds)
        return self.completion.required_artifacts

    def resolve_features(
        self,
        case_data: Mapping[str, Any] | None,
        *,
        overrides: Mapping[str, Any] | None = None,
    ) -> dict[str, bool]:
        """内置特性 + 本 Workflow 的 Activity 开关（训练记录上固化的能力投影）。

        运行期未就绪的 workflow 没有任何可投影的能力（``runtime_ready=False``）：它开不了
        训练，目录/管理端就不该显示「这个病例支持情绪事件/主动追问」这类运行期承诺。
        """
        if not self.runtime_ready:
            return {}
        builtins = resolve_builtin_features(overrides)
        return {
            **{key: builtins[key] for key in self.builtin_features},
            **resolve_activity_flags(case_data, allowed=self.activities, overrides=overrides),
        }

    def build_prompt_snapshot(self) -> dict:
        """冻结该训练产品线实际使用的患者提示词模板。"""
        if self.scoring_profile == "clinical_reasoning.base":
            from modules.training.clinical_reasoning.prompts import JSON_CONTRACT, SYSTEM

            return {"schema_version": 2, "segments": {"system": SYSTEM, "dynamic": JSON_CONTRACT}}
        return {
            "schema_version": 2,
            "segments": {"system": self.prompts.system, "dynamic": self.prompts.dynamic},
        }

    def build_rubric_snapshot(
        self,
        case_data: Mapping[str, Any] | None,
        *,
        overrides: Mapping[str, Any] | None = None,
    ) -> dict:
        """构建本次记录冻结的评分域；病例级 anchors 与固定 rubric 共用同一入口。"""
        if self.scoring_profile == "clinical_reasoning.base":
            from modules.training.clinical_reasoning.rubric import build_clinical_rubric

            return build_clinical_rubric(case_data or {})
        from modules.training.scoring.rubric import build_final_rubric

        return build_final_rubric(self.rubric, self.resolve_features(case_data, overrides=overrides))

    def context_sources(
        self,
        case_data: Mapping[str, Any] | None,
        *,
        overrides: Mapping[str, Any] | None = None,
    ) -> frozenset[str]:
        """本轮**被声明**可注入的患者上下文来源。

        = 本 Workflow 的 ``note_sources`` ∪ 本次病例实际启用 Activity 的
        ``context_contribution.key``。来源由 Workflow/病例声明，不由生产者自报：
        病例没启用的 Activity 不能注入，未声明的来源会被 ``compile_patient_prompt`` 拒绝。
        """
        sources = {declared_name(cls) for cls in self.note_sources}
        for activity_id, definition in ACTIVITY_BINDINGS.items():
            if not self.is_enabled(case_data, activity_id, overrides=overrides):
                continue
            sources.update(contribution.key for contribution in definition.context_contribution)
        return frozenset(name for name in sources if name)


#: ``training_records.training_type`` 退场后，「这次训练跑哪条闭包」由**病例 revision 决定、
#: 训练记录冻结**（``training_records.workflow_id``，见 ``modules/training/workflows.py``）。
#: 本文件只负责声明各条闭包。
HISTORY_TAKING = WorkflowDefinition(
    id="history_taking",
    label="病史采集",
    description="护患对话 + 床旁检查 + 护理评估的完整训练闭包",
    activities=("physical_exam", "nursing_record", "quiz"),
    entry_modes=("自由练习", "作业", "考核"),
    artifact_kinds=("nursing_record",),
    # 默认**不设**交卷门禁：护理记录是学生的可选工作产物（写下就会被评分），不是每次都必须交的关卡。
    # 需要"先提交才能结束"的教学任务由病例显式声明。
    completion=CompletionPolicy(required_artifacts=()),
    scoring_profile="history_taking.base",
    ui={"workspace": "patient_interaction", "primary_surface": "conversation"},
    note_sources=[EmotionNoteSource, IdentityGuardSource, OperationNoteSource],
    prompts=PromptCollection(system=PATIENT_SYSTEM, dynamic=PATIENT_DYNAMIC),
    rubric=get_base_rubric(),
)


#: 第二条闭包：证据驱动临床判断训练（内部 V2）。
#: 患者回合、证据状态、工作区与确定性评分均在 clinical_reasoning 模块独立实现；
#: 这里只声明其与老问诊共享的记录生命周期和 Activity 命令面。
CLINICAL_REASONING = WorkflowDefinition(
    id="clinical_reasoning",
    label="证据驱动训练",
    description="发现线索 → 获取证据 → 判断 → 行动 → 沟通；按实际证据事件评分",
    activities=("clinical_judgment",),
    entry_modes=("自由练习", "作业", "考核"),
    artifact_kinds=(),
    completion=CompletionPolicy(required_artifacts=()),
    scoring_profile="clinical_reasoning.base",
    ui={"workspace": "clinical_reasoning", "primary_surface": "evidence"},
    note_sources=[],
    prompts=PromptCollection(),
    rubric={},
    builtin_features=(),
)
