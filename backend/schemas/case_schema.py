"""Pydantic validation models for case_data JSONB.

Read-time validation only — does NOT change storage format.
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


class PatientInfo(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    age: int = Field(ge=0, le=150)
    gender: Literal["男", "女"]
    visible_symptoms: list[str] = []
    expression: str = "neutral"


class PersonalityConfig(BaseModel):
    health_literacy: Literal["low", "normal", "high", "medium"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"
    mood: Literal["neutral", "low", "irritable", "fearful"] = "neutral"
    compliance: Literal["resistant", "normal", "dependent"] = "normal"


class PhaseTransition(BaseModel):
    auto: bool = False
    manual_label: str | None = None
    min_messages: int = 0
    min_operations: int = 0
    auto_after_messages: int = 0


class QuizOption(BaseModel):
    key: str
    text: str


class QuizQuestion(BaseModel):
    id: str
    stem: str
    options: list[QuizOption] = []
    answer: str
    explanation: str = ""


class QuizConfig(BaseModel):
    title: str = "引导题目"
    questions: list[QuizQuestion] = []


class PhaseConfig(BaseModel):
    id: str
    name: str
    order: int
    operations: list[str] = []
    prompt_profile: str = "patient_chat"
    transition: PhaseTransition = PhaseTransition()


class CaseDataSchema(JsonbModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    difficulty: int = Field(default=1, ge=1, le=3)
    time_limit: int = Field(default=20, ge=5, le=120)
    description: str = ""

    capabilities: dict[str, bool] = {}

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
    """Validate case_data against CaseDataSchema."""
    try:
        validated = CaseDataSchema(**data)
        return validated.model_dump()
    except Exception:
        if strict:
            raise
        log.warning("case_data validation warning", exc_info=True)
        return data


def assert_valid_case_data(data: dict) -> dict:
    return validate_case_data(data, strict=True)
