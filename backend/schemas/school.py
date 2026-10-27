"""院校（租户）的请求/响应模型。"""

from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class SchoolCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=80)


class SchoolUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=80)


class SchoolResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    class_count: int = 0
    user_count: int = 0
    created_at: datetime


class DeleteSchoolResponse(BaseModel):
    model_config = _RESP_CFG
    ok: bool = True
    message: str = ""
