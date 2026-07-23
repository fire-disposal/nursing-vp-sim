"""Voice service schemas — TTS + ASR configuration."""

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

# ── Config CRUD ──


class VoiceConfigUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    provider: str = "volcengine"
    api_key: str | None = Field(default=None, min_length=1)  # null = keep existing
    tts_resource_id: str = Field(default="seed-tts-2.0", max_length=64)
    tts_speaker: str = Field(default="zh_female_vv_uranus_bigtts", max_length=64)
    tts_model: str = Field(default="seed-tts-2.0-standard", max_length=40)
    tts_sample_rate: int = Field(default=24000, ge=8000, le=48000)
    tts_format: str = Field(default="mp3", max_length=16)
    tts_timeout: int = Field(default=8, ge=3, le=30)
    asr_resource_id: str = Field(default="volc.bigasr.sauc.duration", max_length=64)
    asr_sample_rate: int = Field(default=16000, ge=8000, le=48000)
    asr_endpoint_mode: str = Field(default="bigmodel_nostream", max_length=24)
    monthly_budget: float = Field(default=200.0, ge=0)
    is_active: bool = True
    speaker_library: dict[str, str] | None = None


class VoiceConfigResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    provider: str
    api_key_masked: str  # "abc****xyz"
    api_key_suffix: str  # last 8 chars for integrity check
    tts_resource_id: str
    tts_speaker: str
    tts_model: str
    tts_sample_rate: int
    tts_format: str
    tts_timeout: int
    asr_resource_id: str
    asr_sample_rate: int
    asr_endpoint_mode: str
    monthly_budget: float
    is_active: bool
    speaker_library: dict[str, str] | None = None
    created_at: str
    updated_at: str


# ── Usage stats ──


class VoiceUsageItem(BaseModel):
    calls_total: int
    calls_success: int
    calls_fallback: int
    calls_error: int
    total_chars: int
    total_latency_ms: int
    cost_estimated: float


class VoiceUsageResponse(BaseModel):
    tts_today: VoiceUsageItem
    asr_today: VoiceUsageItem
    tts_month: VoiceUsageItem
    asr_month: VoiceUsageItem
    monthly_budget: float
    monthly_used: float


class VoiceStatusResponse(BaseModel):
    provider: str
    tts_online: bool
    asr_online: bool
    last_error: str | None
    last_error_at: str | None
    tts_pool_size: int | None = None
    tts_pool_total: int | None = None
    tts_pool_idle: int | None = None
    tts_pool_in_use: int | None = None


# ── TTS ──


class TTSSynthesizeRequest(BaseModel):
    model_config = _REQ_CFG
    text: str = Field(min_length=1, max_length=500)
    record_id: int = Field(ge=1)
    voice_type: str | None = Field(default=None, max_length=40)


# ── ASR ──


class ASRStatusResponse(BaseModel):
    model_config = _RESP_CFG
    available: bool


# ── Unified Cost Dashboard ──


class CostBreakdown(BaseModel):
    calls: int
    success: int
    error: int
    latency_ms_avg: float
    total_cost: float


class CostSeriesPoint(BaseModel):
    date: str  # "2026-06-22"
    llm_cost: float
    tts_cost: float
    asr_cost: float


class CostDashboardResponse(BaseModel):
    today: CostBreakdown
    this_month: CostBreakdown
    llm_today: CostBreakdown
    tts_today: CostBreakdown
    asr_today: CostBreakdown
    monthly_budget: float
    monthly_used: float
    llm_monthly_budget: float
    voice_monthly_budget: float
    daily_series: list[CostSeriesPoint]  # last 30 days
    top_users: list[dict]  # [{user_name, total_cost, calls}]


class CostExportRequest(BaseModel):
    model_config = _REQ_CFG
    start_date: str | None = None  # "2026-06-01"
    end_date: str | None = None  # "2026-06-22"
    service: str | None = None  # "llm" | "tts" | "asr" | None=all
    granularity: str = "daily"  # "daily" | "monthly"
    format: str = "json"  # "json" | "csv"


# ── Voice Config Export ──


class VoiceConfigExportResponse(BaseModel):
    model_config = _RESP_CFG
    provider: str
    tts_resource_id: str
    tts_speaker: str
    tts_model: str
    tts_sample_rate: int
    tts_format: str
    tts_timeout: int
    asr_resource_id: str
    asr_sample_rate: int
    asr_endpoint_mode: str
    monthly_budget: float
    exported_at: str
