from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class PracticeCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    case_id: int
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)


class PracticeUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    case_id: int | None = None
    features: dict[str, bool] | None = None
    behavior: dict[str, Any] | None = None
    is_active: bool | None = None


class PracticeItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    case_id: int
    case_name: str = ""
    training_type: str = "history_taking"
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)
    is_active: bool = True
    training_count: int = 0
    assignment_count: int = 0
    created_at: datetime
    updated_at: datetime


class PracticeBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    training_type: str = "history_taking"
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)
