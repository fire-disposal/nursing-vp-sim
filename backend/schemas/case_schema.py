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
from profiles.triage.case_schema import TriageCaseData

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
    hidden_info: list[str] = []

    quiz: QuizConfig | None = None
    voice_type: str = ""

    example_dialogues: list[dict] = []


_TYPE_VALIDATORS: dict[str, type[BaseModel]] = {
    "history_taking": CaseDataSchema,
    "triage": TriageCaseData,
}


def validate_case_data(training_type: str, data: dict, *, strict: bool = False) -> dict:
    """Validate case_data against the schema for the given training_type."""
    schema_cls = _TYPE_VALIDATORS.get(training_type)
    if schema_cls is None:
        log.warning("No validator for training_type=%s, skipping validation", training_type)
        return data
    try:
        validated = schema_cls(**data)
        return validated.model_dump()
    except Exception:
        if strict:
            raise
        log.warning("case_data validation warning for type=%s", training_type, exc_info=True)
        return data


def assert_valid_case_data(data: dict) -> dict:
    return validate_case_data("history_taking", data, strict=True)


def list_valid_training_types() -> list[str]:
    """Return training types that have a registered validator/profile."""
    return list(_TYPE_VALIDATORS.keys())
