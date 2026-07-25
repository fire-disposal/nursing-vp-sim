
from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class TrainingStartRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    features: dict[str, bool] | None = None
    time_limit_minutes: int | None = None


class TrainingStartResponse(BaseModel):
    model_config = _RESP_CFG
    record_id: int
    greeting: str
    case_name: str = ""
    pending_questionnaires: int = 0


class ChatMessageRequest(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)


class ChatMessageResponse(BaseModel):
    model_config = _RESP_CFG
    role: str
    content: str
    operation: dict | None = None
