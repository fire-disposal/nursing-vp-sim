from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class FeedbackSubmit(BaseModel):
    model_config = _REQ_CFG
    rating: int = Field(ge=1, le=5)
    tag: str = Field(max_length=20)
    content: str | None = None


class FeedbackSubmitResponse(BaseModel):
    id: int
    created_at: datetime


class FeedbackItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: str | None = None
    created_at: datetime


class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0
