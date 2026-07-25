"""Voice config schemas — TTS configuration, status, and synthesis."""

from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class VoiceConfigUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    provider: str = "volcengine"
    api_key: str | None = Field(default=None, min_length=1)
    tts_resource_id: str = Field(default="seed-tts-2.0", max_length=64)
    tts_speaker: str = Field(default="zh_female_vv_uranus_bigtts", max_length=64)
    tts_model: str = Field(default="seed-tts-2.0-standard", max_length=40)
    tts_sample_rate: int = Field(default=24000, ge=8000, le=48000)
    tts_format: str = Field(default="mp3", max_length=16)
    tts_timeout: int = Field(default=8, ge=3, le=30)
    monthly_budget: float = Field(default=200.0, ge=0)
    is_active: bool = True
    speaker_library: dict[str, str] | None = None


class VoiceConfigResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    provider: str
    api_key_masked: str
    api_key_suffix: str
    tts_resource_id: str
    tts_speaker: str
    tts_model: str
    tts_sample_rate: int
    tts_format: str
    tts_timeout: int
    monthly_budget: float
    is_active: bool
    speaker_library: dict[str, str] | None = None
    created_at: str
    updated_at: str


class VoiceStatusResponse(BaseModel):
    provider: str
    tts_online: bool
    last_error: str | None
    last_error_at: str | None
    tts_pool_size: int | None = None
    tts_pool_total: int | None = None
    tts_pool_idle: int | None = None
    tts_pool_in_use: int | None = None


class TTSSynthesizeRequest(BaseModel):
    model_config = _REQ_CFG
    text: str = Field(min_length=1, max_length=500)
    record_id: int | None = None
    voice_type: str | None = Field(default=None, max_length=40)


class VoiceConfigExportResponse(BaseModel):
    model_config = _RESP_CFG
    provider: str
    tts_resource_id: str
    tts_speaker: str
    tts_model: str
    tts_sample_rate: int
    tts_format: str
    tts_timeout: int
    monthly_budget: float
    exported_at: str
