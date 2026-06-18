from datetime import datetime
from typing import Any, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")

_REQ_CFG = ConfigDict(extra="forbid", str_strip_whitespace=True)
_RESP_CFG = ConfigDict(from_attributes=True)


# ── Generic ──


class PaginatedResponse[T](BaseModel):
    items: list[T]
    total: int
    offset: int
    limit: int


# ── Auth ──


class LoginRequest(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=1)


class RegisterRequest(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    role: str = Field(default="student", min_length=1, max_length=20)
    display_name: str = Field(min_length=1, max_length=50)
    student_id: str | None = None
    class_id: int | None = None
    gender: str | None = Field(default=None, max_length=4)


class TokenResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str
    token_type: str = "bearer"
    role: str
    display_name: str
    user_id: int
    school_id: int | None = None
    school_name: str | None = None
    permissions: list[str] = []
    gender: str | None = None
    avatar: str | None = None


class ChangePasswordRequest(BaseModel):
    model_config = _REQ_CFG
    old_password: str = Field(min_length=1)
    new_password: str = Field(min_length=6, max_length=128)


# ── WeChat ──


class WechatLoginRequest(BaseModel):
    model_config = _REQ_CFG
    code: str = Field(min_length=1)


class WechatBindRequest(BaseModel):
    model_config = _REQ_CFG
    code: str = Field(min_length=1)


class WechatRegisterRequest(BaseModel):
    model_config = _REQ_CFG
    code: str = Field(min_length=1)
    display_name: str = Field(min_length=1, max_length=50)


class WechatLoginResponse(BaseModel):
    model_config = _RESP_CFG
    access_token: str | None = None
    token_type: str = "bearer"
    role: str | None = None
    display_name: str | None = None
    user_id: int | None = None
    school_id: int | None = None
    school_name: str | None = None
    permissions: list[str] = []
    need_bind: bool = False


# ── Case ──


class CaseBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    difficulty: int = 1
    description: str | None = None
    patient_summary: dict[str, Any] | None = None


class CaseDetail(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    case_data: dict[str, Any]


class CaseCreateRequest(BaseModel):
    model_config = _REQ_CFG
    case_data: dict[str, Any]


class CaseUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    case_data: dict[str, Any]


class CaseNameRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=100)


class CaseManageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    patient_name: str = ""
    patient_age: int | None = None
    patient_gender: str = ""
    chief_complaint: str = ""
    time_limit: int = 20
    difficulty: int = 1
    patient_personality: str = ""
    created_at: datetime
    training_count: int = 0


class CaseGenerateRequest(BaseModel):
    model_config = _REQ_CFG
    mode: str = Field(default="quick", pattern="^(quick|reference)$")
    description: str = Field(min_length=1, max_length=4096)
    reference_case_ids: list[int] | None = None
    reference_text: str | None = Field(default=None, max_length=16384)
    field: str | None = Field(default=None, pattern="^(scoring_criteria|hidden_info|required_inquiries)$")
    current_case_data: dict[str, Any] | None = None


class CaseGenerateResponse(BaseModel):
    model_config = _RESP_CFG
    case_data: dict[str, Any] | None = None
    field_value: Any | None = None
    field: str | None = None


# ── Assignment ──


class AssignmentCreateRequest(BaseModel):
    model_config = _REQ_CFG
    practice_id: int
    class_id: int
    title: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    start_time: datetime
    end_time: datetime


class AssignmentUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    practice_id: int | None = None
    class_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    start_time: datetime | None = None
    end_time: datetime | None = None


class AssignmentListItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    practice_name: str = ""
    class_name: str = ""
    start_time: datetime
    end_time: datetime
    student_count: int = 0
    completed_count: int = 0
    created_at: datetime


class AssignmentStudentItem(BaseModel):
    model_config = _RESP_CFG
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False


class AssignmentDetail(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    description: str | None = None
    practice_id: int
    practice_name: str = ""
    class_id: int
    class_name: str = ""
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
    student_count: int = 0
    completed_count: int = 0
    scored_count: int = 0
    students: list["AssignmentStudentItem"] = Field(default_factory=list)


class StudentAssignmentItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    title: str
    practice_name: str
    start_time: datetime
    end_time: datetime
    status: str = "pending"
    record_id: int | None = None
    score_total: float | None = None


# ── Training ──


class TrainingStartRequest(BaseModel):
    model_config = _REQ_CFG
    case_id: int
    practice_id: int | None = None


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
    user_display_name: str
    user_student_id: str | None
    status: str
    current_phase: str | None = None
    scoring_status: str | None = None
    scoring_error: str | None = None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None = None


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
    features: dict[str, bool] = Field(default_factory=dict)
    from_assignment: bool = False
    exam_anchors: dict[str, Any] = Field(default_factory=dict)


class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str


class PhaseAdvanceResponse(BaseModel):
    model_config = _RESP_CFG
    current_phase: str
    name: str
    order: int


# ── Messages / Scores / Notes ──


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


# ── Score Review ──


class ScoreReviewRequest(BaseModel):
    model_config = _REQ_CFG
    detail_scores: dict[str, Any] | None = None
    comment: str | None = None


class ScoreReviewResponse(BaseModel):
    model_config = _RESP_CFG
    score_id: int
    review_status: str
    reviewed_by_name: str | None = None
    reviewed_at: datetime | None = None
    original_detail_scores: dict[str, Any] | None = None
    review_detail_scores: dict[str, Any] | None = None
    review_comment: str | None = None


# ── User ──


class UserBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    username: str
    role: str
    role_display_name: str
    display_name: str
    student_id: str | None
    gender: str | None = None
    avatar: str | None = None
    class_id: int | None = None
    class_name: str | None = None
    grade_name: str | None = None
    created_at: datetime


class UserProfileUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    student_id: str | None = None
    gender: str | None = Field(default=None, max_length=4)
    avatar: str | None = Field(default=None, max_length=255)


class UserUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    display_name: str | None = None
    student_id: str | None = None
    class_id: int | None = None
    role: str | None = None
    password: str | None = Field(default=None, min_length=6)
    gender: str | None = Field(default=None, max_length=4)
    avatar: str | None = Field(default=None, max_length=255)


class StudentDetail(BaseModel):
    model_config = _RESP_CFG
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


# ── Batch Import ──


class BatchUserItem(BaseModel):
    model_config = _REQ_CFG
    username: str = Field(min_length=1, max_length=50)
    password: str = Field(min_length=6)
    display_name: str = Field(min_length=1, max_length=50)
    role: str = Field(default="student", min_length=1, max_length=20)
    student_id: str | None = None
    class_id: int | None = None


class RegisterResponse(BaseModel):
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None = None


class BatchCreateResult(BaseModel):
    created: int
    skipped: int
    errors: list[str]


# ── Admin Stats ──


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


# ── LLM Monitoring ──


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


# ── ApiSecret ──


class ApiSecretCreate(BaseModel):
    model_config = _REQ_CFG
    label: str = Field(min_length=1, max_length=80)
    raw_key: str = Field(min_length=10, max_length=500)
    base_url: str | None = Field(default=None, max_length=200)
    price_input_per_1m: float = Field(default=0, ge=0)
    price_output_per_1m: float = Field(default=0, ge=0)
    monthly_cost_limit: float | None = Field(default=None, ge=0)


class ApiSecretUpdate(BaseModel):
    model_config = _REQ_CFG
    label: str | None = Field(default=None, max_length=80)
    base_url: str | None = Field(default=None, max_length=200)
    price_input_per_1m: float | None = Field(default=None, ge=0)
    price_output_per_1m: float | None = Field(default=None, ge=0)
    monthly_cost_limit: float | None = Field(default=None, ge=0)


class ApiSecretResponse(BaseModel):
    model_config = _RESP_CFG
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


class SecretCreateResponse(BaseModel):
    id: int
    key_suffix: str


# ── LLMConfig ──


class LLMConfigCreate(BaseModel):
    model_config = _REQ_CFG
    secret_id: int = Field(gt=0)
    model: str = Field(min_length=1, max_length=80)
    purpose: str = Field(min_length=1, max_length=40)
    label: str = Field(default="", max_length=80)
    priority: int = Field(default=10, ge=0)
    weight: int = Field(default=10, ge=0, le=100)
    price_input_per_1m: float = Field(default=0, ge=0)
    price_output_per_1m: float = Field(default=0, ge=0)
    monthly_cost_limit: float | None = Field(default=None, ge=0)


class LLMConfigUpdate(BaseModel):
    model_config = _REQ_CFG
    secret_id: int | None = None
    model: str | None = Field(default=None, max_length=80)
    purpose: str | None = Field(default=None, max_length=40)
    label: str | None = Field(default=None, max_length=80)
    priority: int | None = Field(default=None, ge=0)
    weight: int | None = Field(default=None, ge=0, le=100)
    price_input_per_1m: float | None = Field(default=None, ge=0)
    price_output_per_1m: float | None = Field(default=None, ge=0)
    monthly_cost_limit: float | None = Field(default=None, ge=0)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")


class LLMConfigResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    secret_id: int
    secret_label: str = ""
    secret_suffix: str = ""
    base_url: str = ""
    provider: str = ""
    label: str = ""
    model: str
    purpose: str
    priority: int = 10
    weight: int = 10
    status: str = "active"
    price_input_per_1m: float = 0
    price_output_per_1m: float = 0
    monthly_cost_limit: float | None = None
    created_at: datetime
    updated_at: datetime


class ConfigCreateResponse(BaseModel):
    id: int


# ── Prompt Management ──


class PromptTemplateCreate(BaseModel):
    model_config = _REQ_CFG
    purpose: str = Field(min_length=1, max_length=40)
    name: str | None = Field(default=None, max_length=80)
    system_prompt: str = Field(min_length=10)
    user_prompt: str | None = None
    variables: list[dict[str, Any]] | None = None
    created_by: str | None = None
    remark: str | None = None
    activate: bool = False


class PromptTemplateUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, max_length=80)
    system_prompt: str | None = Field(default=None, min_length=10)
    user_prompt: str | None = None
    variables: list[dict[str, Any]] | None = None
    remark: str | None = None


class PromptTemplateResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    purpose: str
    version: int
    name: str | None
    system_prompt: str
    user_prompt: str | None
    template_engine: str
    variables: list[dict[str, Any]] | None
    is_active: bool
    created_by: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime
    is_builtin: bool = False
    locked: bool = False


class PromptValidateRequest(BaseModel):
    model_config = _REQ_CFG
    purpose: str
    system_prompt: str
    user_prompt: str | None = None
    variables: list[dict[str, Any]] | None = None


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
    sample_vars: dict[str, Any]
    render_error: str | None = None


class SampleVarsResponse(BaseModel):
    purpose: str
    vars: dict[str, Any]


# ── QA ──


class QASessionCreate(BaseModel):
    model_config = _REQ_CFG
    question: str = Field(min_length=1, max_length=4096)


QAAskRequest = QASessionCreate


class QASessionItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class QAMessageItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    role: str
    content: str
    created_at: datetime


class QAAskResponse(BaseModel):
    session_id: int
    answer: str


class QASessionAdminItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    student_name: str = ""
    student_code: str = ""
    title: str
    message_count: int = 0
    created_at: datetime
    updated_at: datetime


# ── Feedback ──


class FeedbackSubmit(BaseModel):
    model_config = _REQ_CFG
    rating: int = Field(ge=1, le=5)
    tag: str = Field(max_length=20)
    content: str | None = None


class FeedbackSubmitResponse(BaseModel):
    id: int
    created_at: datetime


class FeedbackItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    user_id: int
    user_name: str = ""
    rating: int
    tag: str
    content: str | None = None
    created_at: datetime


class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0


# ── Grade / Class ──


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


# ── Rubric ──


class RubricDimensionItem(BaseModel):
    name: str = ""
    weight: int = 0
    criteria: str = ""


class RubricCreateRequest(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=200)
    dimensions: list[dict[str, Any]] = Field(default=[], min_length=1)
    version: str = "1.0"
    description: str | None = Field(default=None, max_length=2000)
    total_max: int = 100
    raw_max: int = 57
    raw_scale: int = 3


class RubricResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    version: str = ""
    description: str | None = None
    total_max: int = 100
    raw_max: int = 57
    raw_scale: int = 3
    dimensions: list[dict[str, Any]] = []
    is_active: bool = False
    created_at: datetime
    updated_at: datetime


class RubricBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    is_active: bool = False


# ── Provider Catalog ──


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


# ── School ──


class SchoolCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=80)
    admin_username: str = Field(min_length=1, max_length=50)
    admin_password: str = Field(min_length=6)
    admin_display_name: str = Field(min_length=1, max_length=50)


class SchoolResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    teacher_count: int = 0
    student_count: int = 0
    created_at: datetime


# ── Role ──


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


# ── Generic ──


class DeleteResponse(BaseModel):
    ok: bool = True
    message: str = "删除成功"


class MessageResponse(BaseModel):
    message: str


class OkResponse(BaseModel):
    ok: bool = True
    message: str | None = None


class ToggleStatusResponse(BaseModel):
    ok: bool = True
    status: str


# ── Practice ──


class PracticeCreate(BaseModel):
    model_config = _REQ_CFG
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    case_id: int
    mode: str = Field(default="training", pattern="^(training|assessment|free_play)$")
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)
    assessment: dict[str, Any] | None = None


class PracticeUpdate(BaseModel):
    model_config = _REQ_CFG
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    case_id: int | None = None
    mode: str | None = Field(default=None, pattern="^(training|assessment|free_play)$")
    features: dict[str, bool] | None = None
    behavior: dict[str, Any] | None = None
    assessment: dict[str, Any] | None = None
    is_active: bool | None = None


class PracticeItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    description: str | None = None
    case_id: int
    case_name: str = ""
    mode: str
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)
    assessment: dict[str, Any] | None = None
    is_active: bool = True
    training_count: int = 0
    created_at: datetime
    updated_at: datetime


PracticeResponse = PracticeItem


class PracticeBrief(BaseModel):
    model_config = _RESP_CFG
    id: int
    name: str
    mode: str
    features: dict[str, bool] = Field(default_factory=dict)
    behavior: dict[str, Any] = Field(default_factory=dict)


# ── Questionnaire ──


class QuestionnaireQuestionCreate(BaseModel):
    model_config = _REQ_CFG
    content: str = Field(min_length=1, max_length=2000)
    question_type: str = Field(min_length=1, max_length=20)
    required: bool = True
    sort_order: int = 0
    options: list[str] | None = None


class QuestionnaireQuestionUpdate(BaseModel):
    model_config = _REQ_CFG
    content: str | None = Field(default=None, max_length=2000)
    question_type: str | None = Field(default=None, max_length=20)
    required: bool | None = None
    sort_order: int | None = None
    options: list[str] | None = None


class QuestionnaireQuestionResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    template_id: int
    content: str
    question_type: str
    required: bool
    sort_order: int
    options: list[str] | None = None


class QuestionnaireTemplateCreate(BaseModel):
    model_config = _REQ_CFG
    title: str = Field(min_length=1, max_length=120)
    type: str = Field(min_length=1, max_length=20)
    description: str | None = None
    is_active: bool = True
    questions: list[QuestionnaireQuestionCreate] = []


class QuestionnaireTemplateUpdate(BaseModel):
    model_config = _REQ_CFG
    title: str | None = Field(default=None, max_length=120)
    type: str | None = Field(default=None, max_length=20)
    description: str | None = None
    is_active: bool | None = None


class QuestionnaireTemplateResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    title: str
    type: str
    description: str | None = None
    is_active: bool
    question_count: int = 0
    response_count: int = 0
    school_id: int | None = None
    created_at: datetime
    updated_at: datetime


class QuestionnaireTemplateDetailResponse(QuestionnaireTemplateResponse):
    questions: list[QuestionnaireQuestionResponse] = []
    case_ids: list[int] = []


class CaseAssignmentRequest(BaseModel):
    model_config = _REQ_CFG
    case_ids: list[int]
    is_required: bool = True
    trigger_event: str = Field(default="before_training", max_length=30)


class QuestionnaireAnswerSubmit(BaseModel):
    model_config = _REQ_CFG
    question_id: int
    answer_value: str | None = None


class QuestionnaireSubmitRequest(BaseModel):
    model_config = _REQ_CFG
    template_id: int
    case_id: int | None = None
    record_id: int | None = None
    answers: list[QuestionnaireAnswerSubmit]


class QuestionnaireCheckResponse(BaseModel):
    has_pending: bool
    template_id: int | None = None
    response_id: int | None = None
    template: QuestionnaireTemplateDetailResponse | None = None
    is_required: bool = True
    trigger_event: str = "before_training"


class QuestionnaireAnswerItem(BaseModel):
    model_config = _RESP_CFG
    question_id: int
    question_content: str = ""
    question_type: str = ""
    options: list[str] | None = None
    answer_value: str | None = None


class QuestionnaireResponseItem(BaseModel):
    model_config = _RESP_CFG
    id: int
    template_id: int
    template_title: str = ""
    user_id: int
    user_name: str = ""
    case_id: int | None = None
    record_id: int | None = None
    status: str
    answers: list[QuestionnaireAnswerItem] = []
    completed_at: datetime | None = None
    created_at: datetime


class QuestionnaireStatsResponse(BaseModel):
    template_id: int
    template_title: str = ""
    total_assigned: int = 0
    total_completed: int = 0
    completion_rate: float = 0.0
    questions: list["QuestionStatsItem"] = []


class QuestionStatsItem(BaseModel):
    question_id: int
    content: str = ""
    question_type: str = ""
    response_count: int = 0
    avg_likert: float | None = None
    choice_distribution: dict[str, int] = Field(default_factory=dict)
    text_answers: list[str] = Field(default_factory=list)


# ── Training State (debug) ──


class EmotionStateResponse(BaseModel):
    trust: int
    comfort: int
    state: str
    note: str
    history: list[dict] = Field(default_factory=list)


class FeatureConfigResponse(BaseModel):
    id: str | None = None
    mode: str | None = None
    features: dict[str, bool] = Field(default_factory=dict)


class InitiativeStateResponse(BaseModel):
    elapsed_seconds: float
    threshold_seconds: float
    percent: float
    should_trigger: bool = False


class TrainingStateResponse(BaseModel):
    record_id: int
    case_id: int
    emotion: EmotionStateResponse
    personality: dict[str, str] = Field(default_factory=dict)
    deep_background_keys: list[str] = Field(default_factory=list)
    exam_anchors: dict = Field(default_factory=dict)
    config: FeatureConfigResponse
    initiative: InitiativeStateResponse
    current_phase: str = "history_taking"
    feature_flags: dict[str, bool] = Field(default_factory=dict)


class InitiativeTriggerResponse(BaseModel):
    triggered: bool
    message: str | None = None
    id: int | None = None


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


# ── System Notification ──


class SystemNotificationCreateRequest(BaseModel):
    model_config = _REQ_CFG
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    level: str = Field(default="info", pattern=r"^(info|warning|success)$")
    is_active: bool = True
    published_at: datetime | None = None


class SystemNotificationUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1)
    level: str | None = Field(default=None, pattern=r"^(info|warning|success)$")
    is_active: bool | None = None
    published_at: datetime | None = None


class SystemNotificationResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    title: str
    content: str
    level: str
    is_active: bool
    created_by: int | None = None
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
