from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class TrainingStartRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    practice_id: int | None = None
    features: dict[str, bool] | None = None
    time_limit_minutes: int | None = None


class TrainingStartResponse(BaseModel):
    model_config = _RESP_CFG
    record_id: int
    greeting: str
    case_name: str = ""


class ChatMessageRequest(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)


class ChatMessageResponse(BaseModel):
    model_config = _RESP_CFG
    role: str
    content: str
    operation: dict | None = None


class TrainingRecordBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    training_type: str = "history_taking"
    user_display_name: str
    user_student_id: str | None
    status: str
    current_phase: str | None = None
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None


class MessageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    role: str
    content: str
    created_at: datetime


class ScoreItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    total_score: float
    detail_scores: dict[str, Any] | None = None
    strengths: list[str] | None = None
    weaknesses: list[str] | None = None
    missed_content: list[str] | None = None
    suggestions: str | None = None
    rubric_version: str | None = None
    model_name: str | None = None
    prompt_version: int | None = None
    score_scale: int | None = None
    review_status: str | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    created_at: datetime


class NoteItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    content: str
    created_at: datetime
    updated_at: datetime


class NoteCreateRequest(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1)


class TrainingRecordDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    user_display_name: str
    status: str
    current_phase: str | None = None
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    time_limit: int = 20
    remaining_seconds: int | None = None
    messages: list["MessageItem"]
    score: "ScoreItem | None" = None
    notes: list["NoteItem"] = []
    required_inquiries: list | None = None
    patient_info: dict[str, Any] | None = None
    patient_gender: str = ""
    training_type: str = "history_taking"
    features: dict[str, bool] = Field(default_factory=dict)
    from_assignment: bool = False
    exam_anchors: dict[str, Any] = Field(default_factory=dict)
    exam_results: list[dict[str, Any]] = Field(default_factory=list)
    case_data: dict[str, Any] = Field(default_factory=dict)
    profile_info: dict[str, Any] = Field(default_factory=dict)


class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str


class PhaseAdvanceResponse(BaseModel):
    model_config = _RESP_CFG
    current_phase: str
    name: str
    order: int


class EmotionStateResponse(BaseModel):
    trust: int
    comfort: int
    state: str
    note: str
    history: list[dict] = Field(default_factory=list)


class FeatureConfigResponse(BaseModel):
    id: str | None = None
    features: dict[str, bool] = Field(default_factory=dict)


class InitiativeStateResponse(BaseModel):
    elapsed_seconds: float
    threshold_seconds: float
    percent: float
    should_trigger: bool = False


class TrainingStateResponse(BaseModel):
    record_id: int
    case_id: int
    emotion: "EmotionStateResponse"
    personality: dict[str, str] = Field(default_factory=dict)
    deep_background_keys: list[str] = Field(default_factory=list)
    exam_anchors: dict = Field(default_factory=dict)
    config: "FeatureConfigResponse"
    initiative: "InitiativeStateResponse"
    current_phase: str = "history_taking"


class InitiativeTriggerResponse(BaseModel):
    triggered: bool
    message: str | None = None
    id: int | None = None
    emotion: dict | None = None


class NursingRecordSave(BaseModel):
    model_config = _REQ_CFG
    sheet_data: dict = Field(default_factory=dict)
    status: str = "draft"


class NursingRecordResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    record_id: int
    sheet_data: dict
    status: str
    updated_at: datetime


class ScoringStatusResponse(BaseModel):
    scoring_status: str | None = None
    scoring_error: str | None = None
    score: dict[str, Any] | None = None
    progress: dict[str, Any] | None = None


class TrainingNotificationItem(BaseModel):
    id: int
    type: str
    title: str
    body: str | None = None
    record_id: int | None = None
    is_read: bool = False
    created_at: datetime


class EmotionHistoryEntry(BaseModel):
    trust: int
    comfort: int
    state: str
    intent: str
    timestamp: str


class EmotionHistoryResponse(BaseModel):
    history: list[EmotionHistoryEntry]


class InitiativeMessageEntry(BaseModel):
    id: int
    content: str
    created_at: str


class InitiativeHistoryResponse(BaseModel):
    history: list[InitiativeMessageEntry]


class ExamOperationResult(BaseModel):
    type: str
    label: str = ""
    value: str = ""
    unit: str = ""


class ExamOperationResponse(BaseModel):
    type: str
    data: ExamOperationResult
    all_results: list[ExamOperationResult] = []


class FeaturesResponse(BaseModel):
    ok: bool = True
    features: dict[str, bool] = {}
