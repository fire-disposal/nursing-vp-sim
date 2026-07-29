from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG
from schemas.training.records import PatientPublicInfo


class TrainingStartRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    features: dict[str, bool] | None = None
    time_limit_minutes: int | None = None


class TrainingSessionData(BaseModel):
    """训练会话数据 — 在 TrainingStartResponse 中返回，前端可直接缓存跳过初始 GET /records/{id} 请求。

    包含训练页首次渲染所需的全部数据，但排除评分/护理记录等记录回顾专有字段。
    """

    model_config = _RESP_CFG
    id: int
    status: str = "in_progress"
    training_type: str = "history_taking"
    case_id: int
    time_limit: int = 20
    remaining_seconds: int
    patient_name: str = ""
    patient_age: int = 0
    patient_gender: str = ""
    case_title: str = ""
    chief_complaint: str = ""
    patient_info: PatientPublicInfo | None = None
    features: dict[str, bool] = Field(default_factory=dict)
    from_assignment: bool = False
    messages: list = Field(default_factory=list)
    scene: dict | None = None
    pending_questionnaires: int = 0


class TrainingStartResponse(BaseModel):
    model_config = _RESP_CFG
    record_id: int
    greeting: str
    case_name: str = ""
    pending_questionnaires: int = 0
    session: TrainingSessionData | None = None


class ChatMessageRequest(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)


class ChatCorrectionRequest(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)


class MessageCorrectionStatus(BaseModel):
    model_config = _RESP_CFG
    used: int = 0
    limit: int = 3
    remaining: int = 3
    eligible_last_message_id: int | None = None


class ChatMessageResponse(BaseModel):
    model_config = _RESP_CFG
    role: str
    content: str
    operation: dict | None = None
