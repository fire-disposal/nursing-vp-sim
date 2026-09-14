"""Pydantic validation models for case_data JSONB.

Validation only — never rewrites the payload: unknown keys (``tools.*``,
``_seed_hash``…) pass through untouched, declared keys get coerced/validated.
New data: strict validation (raises HTTP 422).
Existing data: warn-only (strict=False), always passes through.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from core.gender import normalize_gender  # noqa: F401 — re-export for existing callers
from core.jsonb import JsonbModel

log = logging.getLogger(__name__)

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


class PersonalityConfig(BaseModel):
    model_config = _INNER_CFG

    health_literacy: Literal["low", "normal", "high", "medium"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"
    mood: Literal["neutral", "low", "irritable", "fearful"] = "neutral"
    compliance: Literal["resistant", "normal", "dependent"] = "normal"


class PhaseTransition(BaseModel):
    model_config = _INNER_CFG

    auto: bool = False
    manual_label: str | None = None
    min_messages: int = 0
    min_operations: int = 0
    auto_after_messages: int = 0


class QuizOption(BaseModel):
    model_config = _INNER_CFG

    key: str
    text: str


class QuizQuestion(BaseModel):
    model_config = _INNER_CFG

    id: str
    stem: str
    options: list[QuizOption] = []
    answer: str
    explanation: str = ""


class QuizConfig(BaseModel):
    model_config = _INNER_CFG

    title: str = "引导题目"
    questions: list[QuizQuestion] = []


class PhaseConfig(BaseModel):
    model_config = _INNER_CFG

    id: str
    name: str
    order: int
    operations: list[str] = []
    prompt_profile: str = "patient_chat"
    transition: PhaseTransition = PhaseTransition()


class CaseDataSchema(JsonbModel):
    # extra="allow"：写路径以 model_dump() 的结果落库（service.create/update），
    # 校验器绝不能顺带改写数据 —— 未声明的配置（tools.physical_exam / tools.nursing_record、
    # 种子指纹 _seed_hash 等）必须原样往返，否则教师一保存就丢掉工具配置。
    model_config = ConfigDict(extra="allow")

    name: str = Field(min_length=1, max_length=100)
    difficulty: int = Field(default=1, ge=1, le=3)
    time_limit: int = Field(default=20, ge=5, le=120)
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

    phases: list[PhaseConfig] | None = None
    required_inquiries: list[str] = []

    exam_anchors: dict[str, Any] = {}
    scene: dict[str, Any] = {}
    nursing_record: dict[str, Any] = {}
    hidden_info: list[str] = []

    # 同名患者跨病例去重声明（校验器要求）：如 quiz 变体指向 case2
    variant_of: str = ""

    quiz: QuizConfig | None = None
    voice_type: str = ""
    voice_override: str = ""

    example_dialogues: list[dict] = []


def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    """Validate case_data against CaseDataSchema.

    Returns the payload with the fields the caller actually supplied validated
    and coerced, plus every undeclared key verbatim (see ``extra="allow"``).
    Fields that were not supplied are NOT re-injected as defaults: validation
    must never rewrite the payload, and a save round-trip has to stay
    content-identical (seed fingerprint, no ``phases``/``voice_*`` residue).
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
