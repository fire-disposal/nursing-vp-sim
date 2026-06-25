"""Pydantic validation models for case_data JSONB.

Read-time validation only — does NOT change storage format.
New data: strict validation (raises HTTP 422).
Existing data: warn-only (strict=False), always passes through.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from core.capabilities import ALL_CAPABILITY_KEYS
from core.jsonb import JsonbModel

log = logging.getLogger(__name__)


class PatientInfo(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    age: int = Field(ge=0, le=150)
    gender: Literal["男", "女"]


class PersonalityConfig(BaseModel):
    health_literacy: Literal["low", "normal", "high", "medium"] = "normal"
    verbosity: Literal["terse", "normal", "verbose"] = "normal"
    anxiety_trait: Literal["calm", "normal", "anxious"] = "normal"
    patience: Literal["low", "normal", "high"] = "normal"


class PhaseTransition(BaseModel):
    auto: bool = False
    manual_label: str | None = None
    min_messages: int = 0
    min_operations: int = 0
    auto_after_messages: int = 0


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
    time_limit: int = Field(default=20, ge=1, le=180)

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
    rubric_ref: str = "active"

    supported_plugins: list[str] = []

    @field_validator("supported_plugins")
    @classmethod
    def filter_supported_plugins(cls, v: list[str]) -> list[str]:
        return [pid for pid in v if pid in ALL_CAPABILITY_KEYS]

    exam_anchors: dict[str, Any] = {}

    example_dialogues: list[dict] = []


GENDER_MAP = {"男": "male", "女": "female"}


def normalize_gender(gender: str) -> str:
    return GENDER_MAP.get(gender, gender)


def validate_case_data(data: dict, *, strict: bool = False) -> dict:
    try:
        CaseDataSchema(**data)
    except ValidationError as e:
        if strict:
            raise
        log.warning("case_data validation warning: %s", e)
    return data


def assert_valid_case_data(data: dict) -> dict:
    return validate_case_data(data, strict=True)
