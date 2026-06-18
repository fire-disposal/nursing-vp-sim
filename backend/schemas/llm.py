from datetime import datetime

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


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
