"""Voice cost schemas — usage stats, dashboard, and export."""

from pydantic import BaseModel

from schemas.common import _REQ_CFG


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
    tts_month: VoiceUsageItem
    monthly_budget: float
    monthly_used: float


class CostBreakdown(BaseModel):
    calls: int
    success: int
    error: int
    latency_ms_avg: float
    total_cost: float


class CostSeriesPoint(BaseModel):
    date: str
    llm_cost: float
    tts_cost: float


class CostDashboardResponse(BaseModel):
    today: CostBreakdown
    this_month: CostBreakdown
    llm_today: CostBreakdown
    tts_today: CostBreakdown
    monthly_budget: float
    monthly_used: float
    llm_monthly_budget: float
    voice_monthly_budget: float
    daily_series: list[CostSeriesPoint]
    top_users: list[dict]


class CostExportRequest(BaseModel):
    model_config = _REQ_CFG
    start_date: str | None = None
    end_date: str | None = None
    service: str | None = None
    granularity: str = "daily"
    format: str = "json"
