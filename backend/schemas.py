from datetime import datetime
from typing import Any, Optional, List, Generic, TypeVar
from pydantic import BaseModel, Field, ConfigDict, field_validator

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
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
    student_id: Optional[str] = None
    class_id: Optional[int] = None


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
    description: Optional[str]
    patient_summary: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)


class CaseDetail(BaseModel):
    id: int
    name: str
    description: Optional[str]
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
    detail_scores: Optional[dict]
    strengths: Optional[list]
    weaknesses: Optional[list]
    missed_content: Optional[list]
    suggestions: Optional[str]
    rubric_version: Optional[str] = None
    model_name: Optional[str] = None
    prompt_version: Optional[int] = None
    score_scale: Optional[int] = None
    review_status: Optional[str] = None
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    review_comment: Optional[str] = None
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
    user_student_id: Optional[str]
    status: str
    scoring_status: Optional[str] = None
    scoring_error: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime]
    score_total: Optional[float] = None

    model_config = ConfigDict(from_attributes=True)


class TrainingRecordDetail(BaseModel):
    id: int
    case_id: int
    case_name: str
    user_display_name: str
    status: str
    scoring_status: Optional[str] = None
    scoring_error: Optional[str] = None
    start_time: datetime
    end_time: Optional[datetime]
    time_limit: int = 20
    remaining_seconds: Optional[int] = None
    messages: List[MessageItem]
    score: Optional[ScoreItem] = None
    notes: List[NoteItem] = []
    required_inquiries: Optional[list] = None
    patient_info: Optional[dict] = None

    model_config = ConfigDict(from_attributes=True)


class UserBrief(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: Optional[str]
    class_id: Optional[int] = None
    class_name: Optional[str] = None
    grade_name: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class AdminStats(BaseModel):
    total_students: int
    total_records: int
    completed_records: int
    average_score: Optional[float]
    avg_duration_min: Optional[float] = None
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
    avg_score: Optional[float] = None


class StudentDetail(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: Optional[str]
    created_at: datetime
    total_sessions: int = 0
    total_minutes: int = 0
    avg_score: Optional[float] = None
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
    description: Optional[str] = None
    patient_name: str = ""
    patient_age: Optional[int] = None
    patient_gender: str = ""
    chief_complaint: str = ""
    time_limit: int = 20
    difficulty: int = 1
    created_at: datetime
    training_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class UserUpdateRequest(BaseModel):
    display_name: Optional[str] = None
    student_id: Optional[str] = None
    class_id: Optional[int] = None
    role: Optional[str] = None
    password: Optional[str] = None


# ── 批量导入 ──

class BatchUserItem(BaseModel):
    username: str
    password: str = Field(min_length=6)
    display_name: str
    role: str = "student"
    student_id: Optional[str] = None
    class_id: Optional[int] = None


class BatchCreateResult(BaseModel):
    created: int
    skipped: int
    errors: list


# ── LLM 调用监控 ──

class LLMCallLogItem(BaseModel):
    id: int
    user_id: Optional[int] = None
    record_id: Optional[int] = None
    case_id: Optional[int] = None
    purpose: str
    provider_name: str = "deepseek"
    model: str = ""
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    prompt_tokens: Optional[int] = None
    completion_tokens: Optional[int] = None
    total_tokens: Optional[int] = None
    token_estimated: int = 0
    estimated_cost: Optional[float] = None
    cost_currency: Optional[str] = None
    latency_ms: Optional[int] = None
    status: str = "success"
    error_type: Optional[str] = None
    error_message: Optional[str] = None
    request_chars: Optional[int] = None
    response_chars: Optional[int] = None
    request_text: Optional[str] = None
    response_text: Optional[str] = None
    created_at: datetime
    # 聚合字段（v1.17）
    call_count: int = 1
    avg_latency_ms: Optional[int] = None
    error_count: int = 0
    first_called_at: Optional[datetime] = None
    last_called_at: Optional[datetime] = None
    student_name: Optional[str] = None
    case_name: Optional[str] = None
    is_aggregated: bool = False

    model_config = ConfigDict(from_attributes=True)


class LLMStatsResponse(BaseModel):
    today: dict  # {count, success_rate, avg_latency_ms, total_cost}
    week: dict   # same structure
    month: dict = {}  # same structure, current calendar month
    by_purpose: list  # [{purpose, count, avg_latency_ms, error_count}]
    by_provider: list = []  # [{provider, count, cost, error_count}] 最近7天
    daily: list  # [{date, count, success_count, fail_count, total_cost}] 最近30天


# ── 教师复核 ──

class ScoreReviewRequest(BaseModel):
    detail_scores: Optional[dict] = None
    comment: Optional[str] = None


class ScoreReviewResponse(BaseModel):
    score_id: int
    review_status: str
    reviewed_by_name: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    original_detail_scores: Optional[dict] = None
    review_detail_scores: Optional[dict] = None
    review_comment: Optional[str] = None


# ── ApiSecret ──

class ApiSecretCreate(BaseModel):
    label: str = Field(..., max_length=80)
    raw_key: str = Field(..., min_length=10, max_length=500)
    base_url: Optional[str] = Field(None, max_length=200)


class ApiSecretUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=80)
    base_url: Optional[str] = Field(None, max_length=200)


class ApiSecretResponse(BaseModel):
    id: int
    label: str
    key_suffix: str
    base_url: str = ""
    provider: str = ""
    config_count: int = 0
    total_cost_today: float = 0
    monthly_cost_used: float = 0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── LLMConfig ──

class LLMConfigCreate(BaseModel):
    secret_id: int
    label: str = Field(..., max_length=80)
    model: str = Field(..., max_length=80)
    purpose: str = Field(..., max_length=40)
    priority: int = Field(default=100, ge=1, le=10000)
    weight: int = Field(default=1, ge=1, le=100)
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: Optional[float] = None


class LLMConfigUpdate(BaseModel):
    label: Optional[str] = Field(None, max_length=80)
    model: Optional[str] = Field(None, max_length=80)
    purpose: Optional[str] = Field(None, max_length=40)
    priority: Optional[int] = Field(None, ge=1, le=10000)
    weight: Optional[int] = Field(None, ge=1, le=100)
    status: Optional[str] = Field(None, pattern="^(active|disabled)$")
    price_input_per_1m: Optional[float] = None
    price_output_per_1m: Optional[float] = None
    monthly_cost_limit: Optional[float] = None


class LLMConfigResponse(BaseModel):
    id: int
    secret_id: int
    secret_label: str = ""
    secret_suffix: str = ""
    label: str
    base_url: str = ""
    provider: str = ""
    model: str
    purpose: str
    priority: int
    weight: int = 1
    status: str
    degraded_reason: Optional[str] = None
    degraded_until: Optional[datetime] = None
    price_input_per_1m: float
    price_output_per_1m: float
    monthly_cost_limit: Optional[float] = None
    call_count_today: int
    total_tokens_today: int
    total_cost_today: float
    monthly_cost_used: float
    consecutive_failures: int
    last_used_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ── Prompt 管理 ──

class PromptTemplateCreate(BaseModel):
    purpose: str = Field(..., max_length=40)
    name: Optional[str] = Field(None, max_length=80)
    system_prompt: str = Field(..., min_length=10)
    user_prompt: Optional[str] = None
    variables: Optional[list[dict]] = None
    created_by: Optional[str] = None
    remark: Optional[str] = None
    activate: bool = False


class PromptTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=80)
    system_prompt: Optional[str] = Field(None, min_length=10)
    user_prompt: Optional[str] = None
    variables: Optional[list[dict]] = None
    remark: Optional[str] = None


class PromptTemplateResponse(BaseModel):
    id: int
    purpose: str
    version: int
    name: Optional[str]
    system_prompt: str
    user_prompt: Optional[str]
    template_engine: str
    variables: Optional[list]
    is_active: bool
    created_by: Optional[str]
    remark: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PromptValidateRequest(BaseModel):
    purpose: str
    system_prompt: str
    user_prompt: Optional[str] = None
    variables: Optional[list[dict]] = None


class PromptValidateResponse(BaseModel):
    valid: bool
    errors: list[str] = []
    missing_vars: list[str] = []
    warnings: list[str] = []


class PromptPreviewResponse(BaseModel):
    purpose: str
    version: int
    system_prompt_raw: str
    user_prompt_raw: Optional[str]
    system_prompt_rendered: str
    user_prompt_rendered: Optional[str]
    sample_vars: dict
    render_error: Optional[str] = None


# ── 反馈系统 ──

class FeedbackSubmit(BaseModel):
    rating: int = Field(ge=1, le=5)
    tag: str = Field(max_length=20)
    content: Optional[str] = None


class FeedbackItem(BaseModel):
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: Optional[str] = None
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
    reference_case_ids: Optional[list[int]] = None
    reference_text: Optional[str] = Field(None, max_length=16384)
    field: Optional[str] = Field(None, pattern="^(scoring_criteria|hidden_info|required_inquiries)$")
    current_case_data: Optional[dict] = None


class CaseGenerateResponse(BaseModel):
    case_data: Optional[dict] = None
    field_value: Optional[Any] = None
    field: Optional[str] = None


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
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    grade_id: Optional[int] = None

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
    description: Optional[str] = None
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
    latency_ms: Optional[int] = None
    error: Optional[str] = None

class TestResultItem(BaseModel):
    base_url: str
    ok: bool
    status_code: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None

class TestAllResultsResponse(BaseModel):
    results: list[TestResultItem]

# ── Stats item schemas (replace PaginatedResponse[dict]) ──
class TeacherSummaryItem(BaseModel):
    user_id: int
    display_name: str
    student_code: Optional[str] = None
    total_sessions: int = 0
    total_minutes: int = 0

class RankingItem(BaseModel):
    user_id: int
    display_name: str
    student_id: Optional[str] = None
    total_sessions: int = 0
    avg_score: Optional[float] = None
    total_score: float = 0
    total_minutes: int = 0
    rank: int = 0

class ClassSummaryItemSchema(BaseModel):
    class_id: int
    class_name: str
    grade_name: str
    student_count: int = 0
    avg_score: Optional[float] = None
    completion_rate: float = 0
    total_sessions: int = 0
    total_minutes: int = 0
