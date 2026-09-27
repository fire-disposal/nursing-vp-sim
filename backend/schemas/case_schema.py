"""Pydantic validation models for case_data JSONB.

Validation only — never rewrites the payload: unknown keys (``activities.*``,
``_seed_hash``…) pass through untouched, declared keys get coerced/validated.
New data: strict validation (raises HTTP 422).
Existing data: warn-only (strict=False), always passes through.

元数据单源（docs/15 §六）：``name`` / ``difficulty`` / ``time_limit`` 只存在于 ``cases``
列，``case_data`` 落库前由 :func:`strip_case_metadata` 剥离（读路径早已统一到列）。
"""

from __future__ import annotations

import logging
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from core.gender import normalize_gender  # noqa: F401 — re-export for existing callers
from core.jsonb import JsonbModel
from core.time_limits import (
    DEFAULT_TIME_LIMIT_MINUTES,
    MAX_TIME_LIMIT_MINUTES,
    MIN_TIME_LIMIT_MINUTES,
)

log = logging.getLogger(__name__)

#: 病例元数据键：只落在 ``cases`` 列，``case_data`` 不再重复保存（docs/15 §六）。
#: ``training_type`` 不在此列：该字段整体退场（列已 drop，docs/15 §九），不再是任何
#: 东西的元数据。它若出现在入参里就按未知键原样往返，并由病例审计
#: （``modules/cases/validator.LEGACY_FIELDS``）点名 —— 宁可被报告，也不静默丢弃。
#: 对存量旧值的唯一解释路径是数据迁移 ``e6b2c3d4e5f6``（单向，冻结副本）。
CASE_METADATA_KEYS: tuple[str, ...] = ("name", "difficulty", "time_limit")


def strip_case_metadata(data: dict) -> dict:
    """剥离元数据键后的 case_data 载荷（纯函数，不修改入参）。"""
    return {k: v for k, v in data.items() if k not in CASE_METADATA_KEYS}


# 嵌套声明模型与顶层 CaseDataSchema 同策：extra="allow"。
# 写路径落库的是 model_dump() 的结果，校验器绝不能顺带改写数据 —— 在已声明
# 对象（patient_info / personality / quiz…）里新增的未知子键必须原样往返，
# 否则会被静默丢弃。未声明的顶层键由 CaseDataSchema 的 extra="allow" 兜住。
_INNER_CFG = ConfigDict(extra="allow")


class PatientInfo(BaseModel):
    model_config = _INNER_CFG

    name: str = Field(min_length=1, max_length=20)
    age: int = Field(ge=0, le=150)
    gender: Literal["男", "女"]
    visible_symptoms: list[str] = []
    expression: str = "neutral"
    #: 体征参考人群，缺省按 ``age`` 推定（≤12 儿科 / ≥65 老年 / 其余成人）。
    #: **照护者代诉型病例**必须显式声明：儿科病例的对话者是家长，体征属于患儿，
    #: 不声明就会拿家长年龄套成人参考范围，向学生输出错误的"低于/高于参考范围"。
    vitals_age_group: Literal["pediatric", "adult", "elderly"] | None = None


class PersonalityConfig(BaseModel):
    model_config = _INNER_CFG

    health_literacy: Literal["low", "normal", "high", "medium"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"
    mood: Literal["neutral", "low", "irritable", "fearful"] = "neutral"
    compliance: Literal["resistant", "normal", "dependent"] = "normal"


# ── 临床判断训练（``workflow: "clinical_reasoning"``）病例内容 ─────────────
# docs/15 §十六：Clinical Judgment Drill 是独立 workflow，不是第二套聊天/RPG。它的病例
# 由六个声明组成：scenario（场景）/ findings（可获取证据目录）/ initial（初始可见与隐藏）/
# progression（未处置的状态变化）/ objectives（must_notice/must_act/must_communicate）/
# rubric（确定性锚点与权重）。
#
# 分层：这里只声明**结构**（类型、闭集取值、id 形状、非空文本），保证写路径保存的就是
# 作者能表达的形状；跨字段语义（证据可达性、引用完整性、锚点覆盖）属于发布门禁
# （``modules/cases/validator``），因为只有那里能给作者可见的 JSON 路径 + 修复建议，
# 并且对库内既有内容同样生效。
#
# ``extra="forbid"``：这个面是全新键（内置病例已核验零使用），拼错键名 = 作者想表达的
# 东西静默失效 —— 保存时 422 报出路径，比发布时由门禁猜更直接。外层 ``CaseDataSchema``
# 仍是 ``extra="allow"``（存量未知键必须原样往返）。
_CLINICAL_CFG = ConfigDict(extra="forbid")
#: id 是对外引用键（objective / rubric / progression trigger 靠它互指）：
#: 非空、不含空白、≤64 字符。允许中文（作者可读），不允许整句散文。
_ID_PATTERN = r"^\S{1,64}$"


class ClinicalFindingKind(StrEnum):
    """证据种类 —— 学生从哪种途径拿到它（Slice 2 的证据获取入口按此分组）。"""

    VITAL_SIGN = "vital_sign"
    EXAM = "exam"
    LAB = "lab"
    HISTORY = "history"
    OBSERVATION = "observation"


class ClinicalTriggerKind(StrEnum):
    """未处置推进的触发条件（确定性，不由 LLM 判）。"""

    TIME = "time"
    FINDING = "finding"
    OBJECTIVE = "objective"


class ClinicalRubricRule(StrEnum):
    """确定性锚点判定规则 —— 能算的不用 LLM 判（docs/15 §十六）。"""

    FINDING_OBSERVED = "finding_observed"
    OBJECTIVE_MET = "objective_met"
    ACTION_TAKEN = "action_taken"
    COMMUNICATED = "communicated"


class ClinicalScenario(BaseModel):
    """场景：学生在一次训练里面对什么（患者/环境摘要 + 任务简报）。"""

    model_config = _CLINICAL_CFG

    title: str = Field(min_length=1, max_length=120)
    setting: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=2000)
    learner_brief: str = ""


class ClinicalFinding(BaseModel):
    """可获取证据目录里的一条证据。"""

    model_config = _CLINICAL_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    label: str = Field(min_length=1, max_length=300)
    kind: ClinicalFindingKind
    #: 关键证据：遗漏它 = 判断不可能正确。必须在 initial 里可获取（发布门禁强制）。
    critical: bool = False
    #: 获取途径（非空 token，如 "exam:胸部听诊"、"lab:CBC"）；隐藏证据必须声明非空。
    obtainable_via: list[str] = []
    note: str = ""


class ClinicalInitial(BaseModel):
    """开场状态：哪些证据一开始就看得见，哪些必须主动获取。"""

    model_config = _CLINICAL_CFG

    visible_findings: list[str] = []
    hidden_findings: list[str] = []


class ClinicalProgressionTrigger(BaseModel):
    """推进触发条件：``time`` 用 after_minutes，``finding``/``objective`` 用 ref。"""

    model_config = _CLINICAL_CFG

    kind: ClinicalTriggerKind
    ref: str = ""
    after_minutes: int | None = Field(default=None, ge=1)


class ClinicalProgression(BaseModel):
    """未处置时的状态变化（学生不作为 → 患者按声明推进）。"""

    model_config = _CLINICAL_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    trigger: ClinicalProgressionTrigger
    #: 声明式的状态变化（键 = 状态字段，值 = 目标值）；非空 = 这条推进真的改了什么。
    state_changes: dict[str, Any] = {}
    description: str = ""


class ClinicalMustNotice(BaseModel):
    """必须发现的线索（引用证据 id）。"""

    model_config = _CLINICAL_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    label: str = Field(min_length=1, max_length=300)
    finding: str = Field(min_length=1, pattern=_ID_PATTERN)


class ClinicalMustAct(BaseModel):
    """必须完成的行动（``action`` 是学生要做的关键动作，非空）。"""

    model_config = _CLINICAL_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    label: str = Field(min_length=1, max_length=300)
    action: str = Field(min_length=1, max_length=300)


class ClinicalMustCommunicate(BaseModel):
    """必须传达的信息（``cue`` 是必须出现的沟通内容，非空）。"""

    model_config = _CLINICAL_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    label: str = Field(min_length=1, max_length=300)
    cue: str = Field(min_length=1, max_length=300)


class ClinicalObjectives(BaseModel):
    """训练目标三类：发现 / 行动 / 沟通。三类都必须有（发布门禁强制）。"""

    model_config = _CLINICAL_CFG

    must_notice: list[ClinicalMustNotice] = []
    must_act: list[ClinicalMustAct] = []
    must_communicate: list[ClinicalMustCommunicate] = []


class ClinicalRubricAnchor(BaseModel):
    """确定性评分锚点：规则 + 证据/目标引用 + 权重。"""

    model_config = _CLINICAL_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    label: str = Field(min_length=1, max_length=300)
    rule: ClinicalRubricRule
    weight: float = Field(gt=0)
    #: 该锚点判定的目标 id（``objectives.*[].id``）；``objective_met`` 等规则必须指向目标。
    objectives: list[str] = []
    #: 该锚点引用的证据 id（``findings[].id``）；``finding_observed`` 必须有。
    findings: list[str] = []


class ClinicalRubric(BaseModel):
    """确定性 rubric：锚点集合；权重是相对值（不要求归一）。"""

    model_config = _CLINICAL_CFG

    anchors: list[ClinicalRubricAnchor] = []


# ── 教学蓝图（docs/19 §3.2）─────────────────────────────────────────────────
# ``history_taking`` 病例的教学蓝图：本次训练能评什么、关键线索怎么拿到、哪些条目
# 本次不适用、有没有观察干预结果的机会，以及练习病例/迁移变式的家族关系。
#
# 分层同 clinical_* 面：这里只声明**结构**；跨字段语义（引用完整性、rubric 条目 id
# 是否存在、family 关系自洽）属于发布门禁（``modules/cases/validator``）。
#
# ``extra="forbid"``：这是全新键（存量病例零使用），拼错键名 = 作者想表达的东西
# 静默失效 —— 保存时 422 报出路径比发布时猜更直接。
_BLUEPRINT_CFG = ConfigDict(extra="forbid")


class BlueprintClueSource(StrEnum):
    """关键线索的获取途径 —— 学生通过哪条路径能拿到它。"""

    INITIAL = "initial"  # 开场即可得（患者主动陈述/可见体征）
    INQUIRY = "inquiry"  # 经合理提问可得（含等价问法）
    EXAM = "exam"  # 床旁检查可得
    RECORD = "record"  # 由学生提交的护理评估/诊断产物体现


class BlueprintVariantRole(StrEnum):
    """本病例在家族内的角色。"""

    PRACTICE = "practice"  # 练习病例
    TRANSFER = "transfer"  # 迁移变式（改变线索表达/位置或相关背景）


class BlueprintEditorialState(StrEnum):
    """教学蓝图的临床审阅状态。

    ``draft`` = 开发者/维护者起草，尚未经护理教师审阅；``teacher_reviewed`` = 教师已审阅。
    只有教师能宣布后者（docs/19 §3.2「临床事实、关键项、等第判例由护理教师审阅」）。
    """

    DRAFT = "draft"
    TEACHER_REVIEWED = "teacher_reviewed"


class BlueprintReview(BaseModel):
    """蓝图的审阅留痕（谁在何时确认了临床事实与关键项）。"""

    model_config = _BLUEPRINT_CFG

    editorial_state: BlueprintEditorialState = BlueprintEditorialState.DRAFT
    reviewer: str = ""
    reviewed_at: str = ""
    note: str = ""


class BlueprintClue(BaseModel):
    """一条关键线索及其评估意义。"""

    model_config = _BLUEPRINT_CFG

    id: str = Field(min_length=1, pattern=_ID_PATTERN)
    label: str = Field(min_length=1, max_length=300)
    source: BlueprintClueSource = BlueprintClueSource.INQUIRY
    #: 为什么这条线索对评估有意义（引导模式披露的「意义」，不是问句本身）。
    significance: str = Field(default="", max_length=300)


class CaseBlueprint(BaseModel):
    """训练能力边界与病例家族关系（docs/19 §3.2）。"""

    model_config = _BLUEPRINT_CFG

    #: 本次训练能评什么、不能评什么（前置能力写在 prerequisites）。
    learning_objectives: list[str] = []
    prerequisites: str = ""
    clues: list[BlueprintClue] = []
    #: 必须覆盖项（引用 required_inquiries 条目文本或 clue id）
    must_cover: list[str] = []
    #: 情境相关项：出现则评、不出现不算遗漏
    situational: list[str] = []
    #: 关键遗漏项：缺失必须独立呈现，不得被其他维度补偿掩盖
    key_omissions: list[str] = []
    #: 可接受的证据整合路径与典型错误
    acceptable_evidence: list[str] = []
    typical_errors: list[str] = []
    #: 本次任务**不适用**的 rubric 条目 id（由病例预先声明；不得由评分模型随意缩小分母）
    not_applicable_items: list[str] = []
    #: 本次任务是否存在「实施干预并观察效果」的机会；False 时评价计划与评价方法，
    #: 不奖励编造结局，也不因无法观察而扣分。
    intervention_observable: bool = False
    #: 家族关系：同一 family_id 内的练习病例与迁移变式共享训练目标。
    family_id: str = ""
    variant_role: BlueprintVariantRole | None = None
    #: 迁移变式指向的练习病例名（同家族内的 ``Case.name``）。
    transfer_of: str = ""
    review: BlueprintReview = BlueprintReview()


class CaseDataSchema(JsonbModel):
    # extra="allow"：写路径以 model_dump() 的结果落库（service.create/update），
    # 校验器绝不能顺带改写数据 —— 未声明的配置（voice_override、各 Activity 自定义的
    # config 子键、种子指纹 _seed_hash 等）必须原样往返，否则教师一保存就丢配置。
    model_config = ConfigDict(extra="allow")

    # 元数据三键：写路径读进 cases 列后即剥离（CASE_METADATA_KEYS），不留在 case_data。
    name: str = Field(min_length=1, max_length=100)
    difficulty: int = Field(default=1, ge=1, le=3)
    time_limit: int = Field(default=DEFAULT_TIME_LIMIT_MINUTES, ge=MIN_TIME_LIMIT_MINUTES, le=MAX_TIME_LIMIT_MINUTES)
    description: str = ""

    patient_info: PatientInfo | None = None
    chief_complaint: str = ""
    opening_line: str = ""

    personality: PersonalityConfig = PersonalityConfig()
    communication_style: str = ""

    present_illness: str = ""
    past_history: str = ""
    medication_history: str = ""
    allergy_history: str = ""
    family_history: str = ""
    social_history: str = ""

    deep_background: dict[str, str] = {}

    required_inquiries: list[str] = []

    #: 教学蓝图（docs/19 §3.2）：能力边界、关键线索、适用性声明与家族/变式关系。
    #: 未声明时不影响任何既有字段；运行时消费见 ``modules/training/blueprint.py``。
    blueprint: CaseBlueprint | None = None

    #: Activity 声明（docs/15 §四）：``activities.<id>.config``；结构规则见 modules/cases/validator
    activities: dict[str, Any] = {}
    #: 该病例内容所属 workflow（docs/15 §二）：训练入口按它冻结到训练记录，请求体无法选择。
    #: 只有一条**可开始**的 workflow 时可省略（= history_taking）；登记第二条可开始的
    #: workflow 后病例门禁要求必填。``clinical_reasoning`` 病例必须显式声明自己。
    workflow: str = ""
    scene: dict[str, Any] = {}
    hidden_info: list[str] = []

    # 临床判断训练（docs/15 §十六）的六个声明面。history_taking 病例不使用它们；
    # 未声明时不影响任何既有字段（``exclude_unset`` 不注入默认值）。
    scenario: ClinicalScenario | None = None
    findings: list[ClinicalFinding] = []
    initial: ClinicalInitial | None = None
    progression: list[ClinicalProgression] = []
    objectives: ClinicalObjectives | None = None
    rubric: ClinicalRubric | None = None

    # 同名患者跨病例去重声明（校验器要求）：如 quiz 变体指向 case2
    variant_of: str = ""

    voice_override: str = ""

    example_dialogues: list[dict] = []


def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    """Validate case_data against CaseDataSchema.

    Returns the payload with the fields the caller actually supplied validated
    and coerced, plus every undeclared key verbatim (see ``extra="allow"``).
    Fields that were not supplied are NOT re-injected as defaults: validation
    must never rewrite the payload, and a save round-trip has to stay
    content-identical (seed fingerprint, no metadata residue).
    """
    try:
        validated = CaseDataSchema(**data)
    except Exception:
        if strict:
            raise
        log.warning("case_data validation warning", exc_info=True)
        return data
    return {**data, **validated.model_dump(exclude_unset=True)}


def assert_valid_case_data(data: dict) -> dict:
    return validate_case_data(data, strict=True)
