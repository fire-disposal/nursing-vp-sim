from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class RubricDimensionItem(BaseModel):
    name: str = ""
    weight: int = 0
    criteria: str = ""


class RubricCreateRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=200)
    dimensions: list[dict[str, Any]] = Field(default=[], min_length=1)
    version: str = "1.0"
    description: str | None = Field(default=None, max_length=2000)
    total_max: int = 100
    raw_max: int = 57
    raw_scale: int = 3


class RubricResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    version: str = ""
    description: str | None = None
    total_max: int = 100
    raw_max: int = 57
    raw_scale: int = 3
    dimensions: list[dict[str, Any]] = []
    is_active: bool = False
    created_at: datetime
    updated_at: datetime


class RubricBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    is_active: bool = False
