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


class PersonalityConfig(BaseModel):
    model_config = _INNER_CFG

    health_literacy: Literal["low", "normal", "high", "medium"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"
    mood: Literal["neutral", "low", "irritable", "fearful"] = "neutral"
    compliance: Literal["resistant", "normal", "dependent"] = "normal"


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

    #: Activity 声明（docs/15 §四）：``activities.<id>.config``；结构规则见 modules/cases/validator
    activities: dict[str, Any] = {}
    scene: dict[str, Any] = {}
    hidden_info: list[str] = []

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
