from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class AdminStats(BaseModel):
    total_students: int
    total_records: int
    completed_records: int
    average_score: float | None
    avg_duration_min: float | None = None
    today_records: int = 0


class DurationStats(BaseModel):
    daily: list[dict[str, Any]]
    total_minutes: int
    total_sessions: int


class TrendStats(BaseModel):
    daily: list[dict[str, Any]]
    total_sessions: int
    total_minutes: int
    avg_score: float | None = None


class TeacherSummaryItem(BaseModel):
    user_id: int
    display_name: str
    student_code: str | None = None
    total_sessions: int = 0
    total_minutes: int = 0


class RankingItem(BaseModel):
    user_id: int
    display_name: str
    student_id: str | None = None
    total_sessions: int = 0
    avg_score: float | None = None
    total_score: float = 0
    total_minutes: int = 0
    rank: int = 0


class ClassSummaryItemSchema(BaseModel):
    class_id: int
    class_name: str
    grade_name: str
    student_count: int = 0
    avg_score: float | None = None
    completion_rate: float = 0
    total_sessions: int = 0
    total_minutes: int = 0


class LLMCallLogItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int | None = None
    record_id: int | None = None
    case_id: int | None = None
    purpose: str
    provider_name: str = "deepseek"
    model: str = ""
    temperature: float | None = None
    max_tokens: int | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None
    token_estimated: int = 0
    estimated_cost: float | None = None
    cost_currency: str | None = None
    latency_ms: int | None = None
    status: str = "success"
    error_type: str | None = None
    error_message: str | None = None
    request_chars: int | None = None
    response_chars: int | None = None
    request_text: str | None = None
    response_text: str | None = None
    created_at: datetime
    call_count: int = 1
    avg_latency_ms: int | None = None
    error_count: int = 0
    first_called_at: datetime | None = None
    last_called_at: datetime | None = None
    student_name: str | None = None
    case_name: str | None = None
    is_aggregated: bool = False


class LLMStatsResponse(BaseModel):
    today: dict[str, Any]
    week: dict[str, Any]
    month: dict[str, Any] = {}
    by_purpose: list[dict[str, Any]]
    by_provider: list[dict[str, Any]] = []
    daily: list[dict[str, Any]]


class GradeCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=40)


class GradeUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=40)


class GradeResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    class_count: int = 0
    student_count: int = 0
    created_at: datetime


class ClassCreate(BaseModel):
    model_config = _REQ_CFG
    grade_id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=60)


class ClassUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=60)
    grade_id: int | None = Field(default=None, gt=0)


class ClassResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    grade_id: int
    grade_name: str = ""
    name: str
    student_count: int = 0
    created_at: datetime


class RoleCreateRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=40)
    permissions: list[str] = Field(default_factory=list)


class RoleUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = Field(default=None, max_length=40)
    permissions: list[str] | None = None


class RoleResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    display_name: str
    is_system: bool = False
    school_id: int | None = None
    permissions: list[str] = []
    user_count: int = 0
