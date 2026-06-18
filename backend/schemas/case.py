from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class CaseBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    difficulty: int = 1
    description: str | None = None
    patient_summary: dict[str, Any] | None = None


class CaseDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    case_data: dict[str, Any]


class CaseCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_data: dict[str, Any]


class CaseUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    case_data: dict[str, Any]


class CaseNameRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=100)


class CaseManageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    patient_name: str = ""
    patient_age: int | None = None
    patient_gender: str = ""
    chief_complaint: str = ""
    time_limit: int = 20
    difficulty: int = 1
    patient_personality: str = ""
    created_at: datetime
    training_count: int = 0


class CaseGenerateRequest(BaseModel):
    model_config = _REQ_CFG
    mode: str = Field(default="quick", pattern="^(quick|reference)$")
    description: str = Field(min_length=1, max_length=4096)
    reference_case_ids: list[int] | None = None
    reference_text: str | None = Field(default=None, max_length=16384)
    field: str | None = Field(default=None, pattern="^(scoring_criteria|hidden_info|required_inquiries)$")
    current_case_data: dict[str, Any] | None = None


class CaseGenerateResponse(BaseModel):
    model_config = _RESP_CFG
    case_data: dict[str, Any] | None = None
    field_value: Any | None = None
    field: str | None = None
