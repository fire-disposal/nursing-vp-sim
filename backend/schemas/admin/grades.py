from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class GradeCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=40)


class GradeUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=40)


class GradeResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    class_count: int = 0
    student_count: int = 0
    created_at: datetime
