from datetime import datetime
from typing import Any

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


class TrainingRecordBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    training_type: str = "history_taking"
    user_display_name: str
    user_student_id: str | None
    status: str
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None
    is_test: bool = False
    assignment_id: str | None = None
    assignment_title: str | None = None


class MessageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    role: str
    content: str
    created_at: datetime


class ScoreReviewItem(BaseModel):
    model_config = _RESP_CFG
    detail_scores: dict[str, Any] | None = None
    total_score: float | None = None
    comment: str | None = None
    reviewed_at: datetime | None = None


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
    review: ScoreReviewItem | None = None
    created_at: datetime


class TrainingRecordDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    case_id: int
    case_name: str
    user_display_name: str
    status: str
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    time_limit: int = 20
    remaining_seconds: int | None = None
    messages: list["MessageItem"]
    score: "ScoreItem | None" = None
    required_inquiries: list | None = None
    patient_info: dict[str, Any] | None = None
    patient_gender: str = ""
    training_type: str = "history_taking"
    features: dict[str, bool] = Field(default_factory=dict)
    patient_name: str = ""
    patient_age: int = 0
    chief_complaint: str = ""
    personality: str = ""
    case_title: str = ""
    from_assignment: bool = False
    pending_questionnaires: int = 0
    exam_anchors: dict[str, Any] = Field(default_factory=dict)
    exam_results: list[dict[str, Any]] = Field(default_factory=list)
    triage_result: dict[str, Any] = Field(default_factory=dict)
    nursing_record_sheet: dict[str, Any] | None = None
    case_data: dict[str, Any] = Field(default_factory=dict)
    profile_info: dict[str, Any] = Field(default_factory=dict)
    emotion: dict[str, Any] | None = None
    initiative_count: int = 0
    is_test: bool = False


class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str


class EmotionStateResponse(BaseModel):
    trust: int
    comfort: int
    state: str
    note: str
    history: list[dict] = Field(default_factory=list)


class InitiativeStateResponse(BaseModel):
    elapsed_seconds: float
    threshold_seconds: float
    percent: float
    should_trigger: bool = False


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


class ExamOperationResult(BaseModel):
    type: str
    label: str = ""
    value: str = ""
    unit: str = ""


class ExamOperationResponse(BaseModel):
    type: str
    data: ExamOperationResult
    all_results: list[ExamOperationResult] = []
