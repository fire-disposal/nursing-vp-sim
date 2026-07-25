from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class ClassCreate(BaseModel):
    model_config = _REQ_CFG
    grade_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=60)


class ClassUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=60)
    grade_id: int | None = Field(default=None, gt=0)


class ClassResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    grade_id: int
    grade_name: str = ""
    name: str
    student_count: int = 0
    created_at: datetime
