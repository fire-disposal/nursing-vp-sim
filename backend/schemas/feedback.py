from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class FeedbackSubmitResponse(BaseModel):
    id: int
    image_count: int = 0
    created_at: datetime


class FeedbackItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: str | None = None
    version: str = ""
    image_count: int = 0
    image_ids: list[int] = []
    developer_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime
    auto_fix_attempted: bool = False
    auto_fix_at: datetime | None = None


class FeedbackReplyRequest(BaseModel):
    model_config = _REQ_CFG
    reply: str = Field(min_length=1, max_length=2000)


class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0
