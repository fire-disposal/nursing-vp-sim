from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class ApiSecretCreate(BaseModel):
    model_config = _REQ_CFG
    label: str = Field(min_length=1, max_length=80)
    raw_key: str = Field(min_length=10, max_length=500)
    base_url: str | None = Field(default=None, max_length=200)
    price_input_per_1m: float = Field(default=0.5, ge=0)
    price_output_per_1m: float = Field(default=0.5, ge=0)
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


class LLMConfigCreate(BaseModel):
    model_config = _REQ_CFG
    secret_id: int = Field(gt=0)
    purpose: str = Field(min_length=1, max_length=40)
    label: str = Field(default="", max_length=80)
    model_override: str | None = Field(default=None, max_length=80)


class LLMConfigUpdate(BaseModel):
    model_config = _REQ_CFG
    secret_id: int | None = None
    purpose: str | None = Field(default=None, max_length=40)
    label: str | None = Field(default=None, max_length=80)
    model_override: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, pattern="^(active|disabled)$")


class LLMConfigResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    secret_id: int
    secret_label: str = ""
    secret_suffix: str = ""
    base_url: str = ""
    label: str = ""
    purpose: str
    status: str = "active"
    model_override: str | None = None
    created_at: datetime
    updated_at: datetime


class ConfigCreateResponse(BaseModel):
    id: int


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
