from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _RESP_CFG


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


class PatientPublicInfo(BaseModel):
    name: str = ""
    age: int = 0
    gender: str = ""


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
    messages: list[MessageItem]
    score: ScoreItem | None = None
    patient_info: PatientPublicInfo | None = None
    patient_gender: str = ""
    training_type: str = "history_taking"
    features: dict[str, bool] = Field(default_factory=dict)
    patient_name: str = ""
    patient_age: int = 0
    chief_complaint: str = ""
    case_title: str = ""
    from_assignment: bool = False
    pending_questionnaires: int = 0
    exam_results: list[dict[str, Any]] = Field(default_factory=list)
    nursing_record_sheet: dict[str, Any] | None = None
    emotion: dict[str, Any] | None = None
    initiative_count: int = 0
    message_correction: dict[str, Any] = Field(default_factory=dict)
    scene: dict[str, Any] | None = None
    required_inquiries: list[str] = Field(default_factory=list)
    is_test: bool = False
