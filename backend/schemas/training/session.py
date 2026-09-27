from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class TrainingStartRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    features: dict[str, bool] | None = None
    time_limit_minutes: int | None = None
    #: 实验批次标签（可选）：{batch, arm?, note?}。缺省时用环境变量 EXPERIMENT_BATCH；
    #: 两者都没有则不标记。仅用于把一批数据认出来做对照，不参与评分。
    experiment: dict[str, Any] | None = None


class StartPracticeRequest(BaseModel):
    """复盘后的再练习请求：同例纠正 / 迁移变式（docs/19 §五）。

    目标病例由**服务端**按源记录与病例家族解析，请求体只表达意图，不能指定 case_id。
    """

    model_config = _REQ_CFG
    source_record_id: int
    kind: str = Field(pattern="^(remediation|transfer)$")


class TrainingStartResponse(BaseModel):
    model_config = _RESP_CFG
    record_id: int
    greeting: str
    case_name: str = ""
    pending_questionnaires: int = 0
    #: 再练习记录的目的与来源（普通开始训练时为空）
    practice: dict = Field(default_factory=dict)


class ChatMessageRequest(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)
    # 幂等键（可选）：客户端每次用户动作生成一个；重试复用同一个即可避免重复插入
    # 学生消息并回放同一回合结果。缺省时服务端生成一个（老客户端兼容）。
    request_id: str | None = Field(default=None, max_length=64)


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
