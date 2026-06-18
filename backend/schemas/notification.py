from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class SystemNotificationCreateRequest(BaseModel):
    model_config = _REQ_CFG
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    level: str = Field(default="info", pattern=r"^(info|warning|success)$")
    is_active: bool = True
    published_at: datetime | None = None


class SystemNotificationUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1)
    level: str | None = Field(default=None, pattern=r"^(info|warning|success)$")
    is_active: bool | None = None
    published_at: datetime | None = None


class SystemNotificationResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    title: str
    content: str
    level: str
    is_active: bool
    created_by: int | None = None
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
