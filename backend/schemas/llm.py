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
    priority: int = Field(default=0, ge=0)
    model_override: str | None = Field(default=None, max_length=80)


class ApiSecretUpdate(BaseModel):
    model_config = _REQ_CFG
    label: str | None = Field(default=None, max_length=80)
    base_url: str | None = Field(default=None, max_length=200)
    price_input_per_1m: float | None = Field(default=None, ge=0)
    price_output_per_1m: float | None = Field(default=None, ge=0)
    monthly_cost_limit: float | None = Field(default=None, ge=0)
    priority: int | None = Field(default=None, ge=0)
    model_override: str | None = Field(default=None, max_length=80)


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
    priority: int = 0
    model_override: str | None = None
    last_used_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class SecretCreateResponse(BaseModel):
    id: int
    key_suffix: str


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
