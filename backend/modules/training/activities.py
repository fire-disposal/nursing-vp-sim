"""Activity 协约 —— 服务端唯一的 Activity 登记表（docs/15 §三、§四）。

取代「数据即能力」：能力不再由病例字段的存在反推（``case_data.tools.*`` → 布尔表），
病例改为显式声明 ``activities.<id>.config``，可用性由服务端解析
（Workflow 白名单 ∩ 病例声明 ∩ 作业覆盖 ∩ 会话状态），
HTTP 工具面 / 会话 manifest / 病例能力投影全部消费同一份解析结果。

禁止（docs/15 §三）：Activity 不声明状态迁移、完成判定、总评分、组织权限；
不自建前端能力开关（可用性一律来自服务端 manifest）；不直接拼 system prompt。
"""

from __future__ import annotations

from collections.abc import Collection, Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, ConfigDict

from modules.training.tools.base import ToolHandler
from modules.training.tools.nursing_diagnosis import NursingDiagnosisHandler
from modules.training.tools.nursing_record import NursingRecordHandler
from modules.training.tools.physical_exam import PhysicalExamHandler
from modules.training.tools.quiz import QuizHandler

# ── 病例声明命名空间 ──────────────────────────────────────────────────────
#: 病例里的声明容器：``{"activities": {"<activity_id>": {"config": <配置>}}}``
CASE_ACTIVITIES_FIELD = "activities"
#: 声明信封里的配置键（每个 activity 自带形状，由 Handler / 规则模块消费）
ACTIVITY_CONFIG_KEY = "config"

# ── availability 取值 ─────────────────────────────────────────────────────

STATE_AVAILABLE = "available"
STATE_UNAVAILABLE = "unavailable"

REASON_NOT_CONFIGURED = "case_not_configured"
REASON_DISABLED = "disabled_by_override"
REASON_WORKFLOW_DENIED = "workflow_not_allowed"
REASON_SESSION_ENDED = "session_not_active"


# ── 请求 / 结果 schema（强类型；形状由 ACTIVITY_BINDINGS 声明）──────────────


class _ActivityModel(BaseModel):
    """Activity 请求/结果模型的共同配置：未知键原样透传。

    Activity 的 params/result 是协议载荷而非完整领域模型（例如 quiz 结果会
    随题目类型扩展），校验只负责结构，不负责裁剪。
    """

    model_config = ConfigDict(extra="allow")


class PhysicalExamInput(_ActivityModel):
    """床旁检查命令入参（command=measure）。"""

    op_type: str = ""


class PhysicalExamOutput(_ActivityModel):
    op_type: str
    result: dict[str, Any] = {}
    all_results: list[dict[str, Any]] = []


class NursingRecordInput(_ActivityModel):
    """护理记录命令入参（load / save / submit / reopen）。"""

    sheet_data: dict[str, Any] | None = None


class NursingRecordOutput(_ActivityModel):
    sheet_data: dict[str, Any] = {}
    status: str = "draft"
    submitted_at: str | None = None
    editable: bool = True
    missing_fields: list[str] = []


class QuizInput(_ActivityModel):
    """随堂测验命令入参（load / submit）。"""

    question_id: str = ""
    answer: str = ""


class QuizOutput(_ActivityModel):
    question_id: str = ""
    correct: bool = False
    correct_answer: str = ""
    explanation: str = ""


class NursingDiagnosisInput(_ActivityModel):
    """护理诊断命令入参（load / save）。"""

    diagnoses: list[dict[str, Any]] = []


class NursingDiagnosisOutput(_ActivityModel):
    diagnoses: list[dict[str, Any]] = []
    stems: list[str] = []
    factor_options: list[str] = []
    characteristic_options: list[str] = []


# ── 契约 ─────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ContextContribution:
    """Activity 可注入 LLM 上下文的结构化片段（docs/15 §八）。

    只声明「我贡献什么类型的数据」，选择/排序/裁剪/预算由 ContextAssembler 决定
    （本切片尚未接入装配器，声明先于消费落地）。
    """

    key: str
    kind: str  # evidence | state | instruction
    description: str


@dataclass(frozen=True)
class Availability:
    """可用性规则 —— 声明式，由 :func:`activity_availability` 统一求值。

    ``requires_case_config`` 是当前唯一的病例侧开关（病例声明即可用）；
    会话状态与作业覆盖由解析器统一叠加。产物「已提交」不构成不可用条件：
    已提交内容仍要能被回放/重开，否则护理评估的 ``reopen`` 会失去入口。
    """

    #: 病例必须声明 ``activities.<id>.config``（唯一开关来源）
    requires_case_config: bool = True


@dataclass(frozen=True)
class ActivityDefinition:
    """一个受控可执行能力（docs/15 §三）。"""

    id: str
    label: str
    inputs_schema: type[BaseModel]
    outputs_schema: type[BaseModel]
    availability: Availability
    handler: ToolHandler
    ui_renderer: str
    evidence_kind: str | None = None
    artifact_kind: str | None = None
    context_contribution: tuple[ContextContribution, ...] = ()
    #: 该 Activity 的产物是否阻塞「学生主动完成训练」
    requires_submission_for_completion: bool = False
    description: str = ""
    ui_placement: str = "side_panel"
    ui_order: int = 0

    @property
    def commands(self) -> frozenset[str]:
        """命令白名单 —— 与 handler 的 actions 同一份声明，不另立第二个列表。"""
        return frozenset(self.handler.actions)


# ── 唯一登记表 ────────────────────────────────────────────────────────────
#: 允许存在的 Activity id（新增能力 = 先在这里登记，再谈病例配置）
ACTIVITY_IDS: tuple[str, ...] = (
    "physical_exam",
    "nursing_record",
    "quiz",
    "nursing_diagnosis",
)

ACTIVITY_BINDINGS: dict[str, ActivityDefinition] = {
    binding.id: binding
    for binding in (
        ActivityDefinition(
            id="physical_exam",
            label="床旁检查",
            description="虚拟查体：生命体征测量与视触叩听（确定性规则，配置来自病例声明）",
            inputs_schema=PhysicalExamInput,
            outputs_schema=PhysicalExamOutput,
            availability=Availability(),
            handler=PhysicalExamHandler(),
            ui_renderer="physical_exam",
            evidence_kind="exam_results",
            artifact_kind=None,
            context_contribution=(
                ContextContribution(
                    key="exam_results",
                    kind="evidence",
                    description="学生已完成的查体结果（生命体征与查体发现）",
                ),
            ),
            ui_order=20,
        ),
        ActivityDefinition(
            id="nursing_record",
            label="护理记录",
            description="ADPIE 结构化护理记录：草稿保存、提交冻结、显式重开",
            inputs_schema=NursingRecordInput,
            outputs_schema=NursingRecordOutput,
            availability=Availability(),
            handler=NursingRecordHandler(),
            ui_renderer="nursing_record",
            evidence_kind="nursing_record",
            artifact_kind="nursing_record",
            context_contribution=(
                ContextContribution(
                    key="nursing_record.submitted",
                    kind="evidence",
                    description="已提交（冻结）的护理记录内容，未提交草稿不参与评分",
                ),
                ContextContribution(
                    key="nursing_record.draft",
                    kind="state",
                    description="草稿进度（缺失字段），仅用于学生端提示",
                ),
            ),
            requires_submission_for_completion=True,
            ui_order=10,
        ),
        ActivityDefinition(
            id="quiz",
            label="随堂测验",
            description="训练中弹出选择题/判断题并判题（当前只落 runtime_state）",
            inputs_schema=QuizInput,
            outputs_schema=QuizOutput,
            availability=Availability(),
            handler=QuizHandler(),
            ui_renderer="quiz",
            evidence_kind=None,
            artifact_kind=None,
            context_contribution=(),
            ui_order=30,
        ),
        ActivityDefinition(
            id="nursing_diagnosis",
            label="护理诊断",
            description="NANDA 护理诊断制定与优先级排序（尚未产物化，仅写 runtime_state）",
            inputs_schema=NursingDiagnosisInput,
            outputs_schema=NursingDiagnosisOutput,
            availability=Availability(),
            handler=NursingDiagnosisHandler(),
            ui_renderer="nursing_diagnosis",
            # 只写 runtime_state、无正式产物 → 不得声称进评分证据（docs/15 §三/§十）
            evidence_kind=None,
            artifact_kind=None,
            context_contribution=(),
            ui_order=40,
        ),
    )
}

# 登记表与允许 id 集合必须一致 —— 少一个 id 就是「配了但不可达」的源头（docs/15 §四）
assert tuple(ACTIVITY_BINDINGS) == ACTIVITY_IDS, "ACTIVITY_BINDINGS 与 ACTIVITY_IDS 不一致"
assert len(set(ACTIVITY_IDS)) == len(ACTIVITY_IDS), "ACTIVITY_IDS 存在重复 id"


# ── 病例声明解析 ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ActivityAvailability:
    state: str
    reason_code: str | None = None

    @property
    def available(self) -> bool:
        return self.state == STATE_AVAILABLE


def _declarations(case_data: Mapping[str, Any] | None) -> Mapping[str, Any]:
    if not isinstance(case_data, Mapping):
        return {}
    raw = case_data.get(CASE_ACTIVITIES_FIELD)
    return raw if isinstance(raw, Mapping) else {}


def declared_activity_ids(case_data: Mapping[str, Any] | None) -> tuple[str, ...]:
    """病例声明的 Activity id（按病例文件里的顺序）。"""
    return tuple(str(k) for k in _declarations(case_data))


def activity_config(case_data: Mapping[str, Any] | None, activity_id: str) -> Any:
    """``activities.<id>.config`` 的原始配置值；未声明返回 ``None``。

    配置形状由各 Activity 自己定义（physical_exam = 查体锚点、quiz = 题面…），
    这里只做「声明 → 配置」的定位，不做业务解释。
    """
    declaration = _declarations(case_data).get(activity_id)
    if not isinstance(declaration, Mapping):
        return None
    return declaration.get(ACTIVITY_CONFIG_KEY)


def _overrides(overrides: Mapping[str, Any] | None) -> Mapping[str, Any]:
    return overrides if isinstance(overrides, Mapping) else {}


def is_activity_enabled(
    case_data: Mapping[str, Any] | None,
    activity_id: str,
    *,
    allowed: Collection[str] | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> bool:
    """病例是否为该 Activity 提供了可用配置（作业覆盖只能关、不能凭空开）。"""
    return activity_availability(case_data, activity_id, allowed=allowed, overrides=overrides).available


def activity_availability(
    case_data: Mapping[str, Any] | None,
    activity_id: str,
    *,
    allowed: Collection[str] | None = None,
    overrides: Mapping[str, Any] | None = None,
    session_active: bool = True,
) -> ActivityAvailability:
    """解析单个 Activity 的可用性（服务端唯一判定入口）。"""
    if activity_id not in ACTIVITY_BINDINGS:
        return ActivityAvailability(STATE_UNAVAILABLE, REASON_NOT_CONFIGURED)
    if allowed is not None and activity_id not in allowed:
        return ActivityAvailability(STATE_UNAVAILABLE, REASON_WORKFLOW_DENIED)
    if _overrides(overrides).get(activity_id) is False:
        return ActivityAvailability(STATE_UNAVAILABLE, REASON_DISABLED)
    definition = ACTIVITY_BINDINGS[activity_id]
    if definition.availability.requires_case_config and activity_config(case_data, activity_id) is None:
        return ActivityAvailability(STATE_UNAVAILABLE, REASON_NOT_CONFIGURED)
    if not session_active:
        return ActivityAvailability(STATE_UNAVAILABLE, REASON_SESSION_ENDED)
    return ActivityAvailability(STATE_AVAILABLE, None)


def resolve_activity_flags(
    case_data: Mapping[str, Any] | None,
    *,
    allowed: Collection[str] | None = None,
    overrides: Mapping[str, Any] | None = None,
) -> dict[str, bool]:
    """全部已登记 Activity 的开关投影（病例能力表 / rubric 维度开关共用）。

    键集合恒等于 :data:`ACTIVITY_IDS` —— 前端与评分都能拿到稳定的完整集合，
    不会因为病例少声明一个 activity 就出现「键不存在」的二值语义漂移。
    """
    return {
        activity_id: is_activity_enabled(case_data, activity_id, allowed=allowed, overrides=overrides)
        for activity_id in ACTIVITY_IDS
    }


@dataclass(frozen=True)
class ResolvedActivity:
    """manifest 投影用的 Activity 解析结果。"""

    definition: ActivityDefinition
    availability: ActivityAvailability
    config: Any = field(default=None)


def artifact_definition(artifact_kind: str | None) -> ActivityDefinition | None:
    """产出该产物的 Activity（产物 → Activity 反查，供 manifest/completion 使用）。"""
    if not artifact_kind:
        return None
    for definition in ACTIVITY_BINDINGS.values():
        if definition.artifact_kind == artifact_kind:
            return definition
    return None


def resolve_activities(
    case_data: Mapping[str, Any] | None,
    *,
    allowed: Collection[str] | None = None,
    overrides: Mapping[str, Any] | None = None,
    session_active: bool = True,
) -> tuple[ResolvedActivity, ...]:
    """按 Workflow 白名单解析病例的 Activity 集合（顺序 = 面板顺序）。"""
    ids = ACTIVITY_IDS if allowed is None else [i for i in ACTIVITY_IDS if i in set(allowed)]
    return tuple(
        ResolvedActivity(
            definition=ACTIVITY_BINDINGS[activity_id],
            availability=activity_availability(
                case_data,
                activity_id,
                allowed=allowed,
                overrides=overrides,
                session_active=session_active,
            ),
            config=activity_config(case_data, activity_id),
        )
        for activity_id in ids
    )
