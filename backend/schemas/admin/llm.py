from datetime import datetime
from typing import Any

from pydantic import BaseModel

from schemas.common import _RESP_CFG


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
