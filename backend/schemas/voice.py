"""Voice service schemas — TTS + ASR configuration."""

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG

# ── Config CRUD ──


class VoiceConfigUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    provider: str = "volcengine"
    app_id: str = Field(min_length=1, max_length=80)
    token: str | None = Field(default=None, min_length=1)  # null = keep existing
    tts_voice_type: str = "zh_female_vv"
    tts_timeout: int = Field(default=8, ge=3, le=30)
    asr_sample_rate: int = Field(default=16000, ge=8000, le=48000)
    asr_enable_streaming: bool = True
    monthly_budget: float = Field(default=200.0, ge=0)
    is_active: bool = True


class VoiceConfigResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    provider: str
    app_id: str
    token_masked: str  # "abc****xyz"
    tts_voice_type: str
    tts_timeout: int
    asr_sample_rate: int
    asr_enable_streaming: bool
    monthly_budget: float
    is_active: bool
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


# ── TTS ──


class TTSSynthesizeRequest(BaseModel):
    model_config = _REQ_CFG
    text: str = Field(min_length=1, max_length=500)
    record_id: int = Field(ge=1)
    voice_type: str | None = Field(default=None, max_length=40)


# ── ASR ──


class ASRRecognizeRequest(BaseModel):
    model_config = _REQ_CFG
    audio: str = Field(min_length=1)  # base64-encoded audio
    format: str = "wav"
    sample_rate: int = Field(default=16000, ge=8000, le=48000)


class ASRRecognizeResponse(BaseModel):
    model_config = _RESP_CFG
    text: str
    confidence: float
