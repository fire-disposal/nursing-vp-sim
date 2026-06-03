from datetime import datetime
from typing import Any, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class PaginatedResponse[T](BaseModel):
    items: list[T]
    total: int
    offset: int
    limit: int


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    username: str
    password: str = Field(min_length=6)
    role: str = "student"
    display_name: str
    student_id: str | None = None
    class_id: int | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    display_name: str
    user_id: int


class CaseBrief(BaseModel):
    id: int
    name: str
    difficulty: int = 1
    description: str | None
    patient_summary: dict | None = None

    model_config = ConfigDict(from_attributes=True)


class CaseDetail(BaseModel):
    id: int
    name: str
    description: str | None
    case_data: dict

    model_config = ConfigDict(from_attributes=True)


class TrainingStartRequest(BaseModel):
    case_id: int


class TrainingStartResponse(BaseModel):
    record_id: int
    greeting: str
    case_name: str = ""


class ChatMessageRequest(BaseModel):
    content: str = Field(..., max_length=4096)


class ChatMessageResponse(BaseModel):
    role: str
    content: str


class MessageItem(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ScoreItem(BaseModel):
    id: int
    total_score: float
    detail_scores: dict | None
    strengths: list | None
    weaknesses: list | None
    missed_content: list | None
    suggestions: str | None
    rubric_version: str | None = None
    model_name: str | None = None
    prompt_version: int | None = None
    score_scale: int | None = None
    review_status: str | None = None
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    review_comment: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NoteItem(BaseModel):
    id: int
    content: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class NoteCreateRequest(BaseModel):
    content: str


class TrainingRecordBrief(BaseModel):
    id: int
    case_id: int
    case_name: str
    user_display_name: str
    user_student_id: str | None
    status: str
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None

    model_config = ConfigDict(from_attributes=True)


class TrainingRecordDetail(BaseModel):
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
    notes: list[NoteItem] = []
    required_inquiries: list | None = None
    patient_info: dict | None = None

    model_config = ConfigDict(from_attributes=True)


class UserBrief(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None
    class_id: int | None = None
    class_name: str | None = None
    grade_name: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminStats(BaseModel):
    total_students: int
    total_records: int
    completed_records: int
    average_score: float | None
    avg_duration_min: float | None = None
    today_records: int = 0


# ── QA 多轮对话 ──


class QASessionCreate(BaseModel):
    question: str = Field(..., min_length=1, max_length=4096)


class QASessionItem(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QAMessageItem(BaseModel):
    id: int
    role: str
    content: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class QAAskResponse(BaseModel):
    session_id: int
    answer: str


class QASessionAdminItem(BaseModel):
    id: int
    user_id: int
    student_name: str = ""
    student_code: str = ""
    title: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class DurationStats(BaseModel):
    daily: list  # [{date: "2026-05-20", minutes: 45}, ...]
    total_minutes: int
    total_sessions: int


class TrendStats(BaseModel):
    daily: list  # [{date, sessions, minutes, avg_score}, ...]
    total_sessions: int
    total_minutes: int
    avg_score: float | None = None


class StudentDetail(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None
    created_at: datetime
    total_sessions: int = 0
    total_minutes: int = 0
    avg_score: float | None = None
    recent_records: list = []
    daily: list = []

    model_config = ConfigDict(from_attributes=True)


# ── 病例管理 ──


class CaseCreateRequest(BaseModel):
    case_data: dict


class CaseUpdateRequest(BaseModel):
    case_data: dict


class CaseManageItem(BaseModel):
    id: int
    name: str
    description: str | None = None
    patient_name: str = ""
    patient_age: int | None = None
    patient_gender: str = ""
    chief_complaint: str = ""
    time_limit: int = 20
    difficulty: int = 1
    created_at: datetime
    training_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class UserUpdateRequest(BaseModel):
    display_name: str | None = None
    student_id: str | None = None
    class_id: int | None = None
    role: str | None = None
    password: str | None = None


# ── 批量导入 ──


class BatchUserItem(BaseModel):
    username: str
    password: str = Field(min_length=6)
    display_name: str
    role: str = "student"
    student_id: str | None = None
    class_id: int | None = None


class BatchCreateResult(BaseModel):
    created: int
    skipped: int
    errors: list


# ── LLM 调用监控 ──


class LLMCallLogItem(BaseModel):
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
    # 聚合字段（v1.17）
    call_count: int = 1
    avg_latency_ms: int | None = None
    error_count: int = 0
    first_called_at: datetime | None = None
    last_called_at: datetime | None = None
    student_name: str | None = None
    case_name: str | None = None
    is_aggregated: bool = False

    model_config = ConfigDict(from_attributes=True)


class LLMStatsResponse(BaseModel):
    today: dict  # {count, success_rate, avg_latency_ms, total_cost}
    week: dict  # same structure
    month: dict = {}  # same structure, current calendar month
    by_purpose: list  # [{purpose, count, avg_latency_ms, error_count}]
    by_provider: list = []  # [{provider, count, cost, error_count}] 最近7天
    daily: list  # [{date, count, success_count, fail_count, total_cost}] 最近30天


# ── 教师复核 ──


class ScoreReviewRequest(BaseModel):
    detail_scores: dict | None = None
    comment: str | None = None


class ScoreReviewResponse(BaseModel):
    score_id: int
    review_status: str
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    original_detail_scores: dict | None = None
    review_detail_scores: dict | None = None
    review_comment: str | None = None


# ── ApiSecret (API 档案) ──


class ApiSecretCreate(BaseModel):
    label: str = Field(..., max_length=80)
    raw_key: str = Field(..., min_length=10, max_length=500)
    base_url: str | None = Field(None, max_length=200)
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: float | None = None


class ApiSecretUpdate(BaseModel):
    label: str | None = Field(None, max_length=80)
    base_url: str | None = Field(None, max_length=200)
    price_input_per_1m: float | None = None
    price_output_per_1m: float | None = None
    monthly_cost_limit: float | None = None


class ApiSecretResponse(BaseModel):
    id: int
    label: str
    key_suffix: str
    base_url: str = ""
    provider: str = ""
    status: str = "active"
    degraded_reason: str | None = None
    degraded_until: datetime | None = None
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: float | None = None
    call_count_today: int = 0
    total_tokens_today: int = 0
    total_cost_today: float = 0
    monthly_cost_used: float = 0
    config_count: int = 0
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── LLMConfig (用途指派) ──


class LLMConfigCreate(BaseModel):
    secret_id: int
    model: str = Field(..., max_length=80)
    purpose: str = Field(..., max_length=40)


class LLMConfigUpdate(BaseModel):
    model: str | None = Field(None, max_length=80)
    purpose: str | None = Field(None, max_length=40)
    status: str | None = Field(None, pattern="^(active|disabled)$")


class LLMConfigResponse(BaseModel):
    id: int
    secret_id: int
    secret_label: str = ""
    secret_suffix: str = ""
    base_url: str = ""
    provider: str = ""
    model: str
    purpose: str
    status: str = "active"
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Prompt 管理 ──


class PromptTemplateCreate(BaseModel):
    purpose: str = Field(..., max_length=40)
    name: str | None = Field(None, max_length=80)
    system_prompt: str = Field(..., min_length=10)
    user_prompt: str | None = None
    variables: list[dict] | None = None
    created_by: str | None = None
    remark: str | None = None
    activate: bool = False


class PromptTemplateUpdate(BaseModel):
    name: str | None = Field(None, max_length=80)
    system_prompt: str | None = Field(None, min_length=10)
    user_prompt: str | None = None
    variables: list[dict] | None = None
    remark: str | None = None


class PromptTemplateResponse(BaseModel):
    id: int
    purpose: str
    version: int
    name: str | None
    system_prompt: str
    user_prompt: str | None
    template_engine: str
    variables: list | None
    is_active: bool
    created_by: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PromptValidateRequest(BaseModel):
    purpose: str
    system_prompt: str
    user_prompt: str | None = None
    variables: list[dict] | None = None


class PromptValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = []
    missing_vars: list[str] = []
    warnings: list[str] = []


class PromptPreviewResponse(BaseModel):
    purpose: str
    version: int
    system_prompt_raw: str
    user_prompt_raw: str | None
    system_prompt_rendered: str
    user_prompt_rendered: str | None
    sample_vars: dict
    render_error: str | None = None


# ── 反馈系统 ──


class FeedbackSubmit(BaseModel):
    rating: int = Field(ge=1, le=5)
    tag: str = Field(max_length=20)
    content: str | None = None


class FeedbackItem(BaseModel):
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: str | None = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class FeedbackListResponse(BaseModel):
    items: list[FeedbackItem]
    total: int
    offset: int
    limit: int


# ── AI 病例生成 ──


class CaseGenerateRequest(BaseModel):
    mode: str = Field(default="quick", pattern="^(quick|reference)$")
    description: str = Field(..., min_length=1, max_length=4096)
    reference_case_ids: list[int] | None = None
    reference_text: str | None = Field(None, max_length=16384)
    field: str | None = Field(None, pattern="^(scoring_criteria|hidden_info|required_inquiries)$")
    current_case_data: dict | None = None


class CaseGenerateResponse(BaseModel):
    case_data: dict | None = None
    field_value: Any | None = None
    field: str | None = None


# ── 年级管理 ──


class GradeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)


class GradeUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)


class GradeResponse(BaseModel):
    id: int
    name: str
    class_count: int = 0
    student_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── 班级管理 ──


class ClassCreate(BaseModel):
    grade_id: int
    name: str = Field(..., min_length=1, max_length=60)


class ClassUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    grade_id: int | None = None


class ClassResponse(BaseModel):
    id: int
    grade_id: int
    grade_name: str = ""
    name: str
    student_count: int = 0
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Model Presets (Provider Catalog) ──


class ModelPresetItem(BaseModel):
    name: str
    price_input: float = 0
    price_output: float = 0


class ProviderPresetResponse(BaseModel):
    provider: str = ""
    display_name: str = ""
    base_url: str = ""
    models: list[ModelPresetItem] = []


class CatalogResponse(BaseModel):
    providers: list[ProviderPresetResponse] = []


# ── Generic responses ──
class MessageResponse(BaseModel):
    message: str


class OkResponse(BaseModel):
    ok: bool = True


class ToggleStatusResponse(BaseModel):
    ok: bool = True
    status: str


# ── Create short responses ──
class SecretCreateResponse(BaseModel):
    id: int
    key_suffix: str


class ConfigCreateResponse(BaseModel):
    id: int


class FeedbackSubmitResponse(BaseModel):
    id: int
    created_at: datetime


# ── Training trigger ──
class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str


# ── Feedback stats ──
class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0


# ── Rubric ──
class RubricDimensionItem(BaseModel):
    name: str = ""
    weight: int = 0
    criteria: str = ""


class RubricResponse(BaseModel):
    id: int
    name: str
    version: str = ""
    description: str | None = None
    total_max: int = 100
    raw_max: int = 57
    raw_scale: int = 3
    dimensions: list = []
    is_active: bool = False
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class RubricBrief(BaseModel):
    id: int
    name: str
    is_active: bool = False
    model_config = ConfigDict(from_attributes=True)


# ── Prompt misc ──
class SampleVarsResponse(BaseModel):
    purpose: str
    vars: dict


# ── Health / Test ──
class HealthCheckItem(BaseModel):
    base_url: str
    status: str
    latency_ms: int | None = None
    error: str | None = None


class TestResultItem(BaseModel):
    base_url: str
    ok: bool
    status_code: int | None = None
    latency_ms: int | None = None
    error: str | None = None


class TestAllResultsResponse(BaseModel):
    results: list[TestResultItem]


# ── Stats item schemas (replace PaginatedResponse[dict]) ──
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
