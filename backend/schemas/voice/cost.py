"""Voice cost schemas — usage stats, dashboard, and export."""

from pydantic import BaseModel, Field

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


class SchoolCostItem(BaseModel):
    """院校维度的成本行。``school_id=None`` 是归因不到院校的“未归属”桶（不会丢）。"""

    school_id: int | None
    school_name: str
    llm_cost: float
    llm_calls: int
    voice_cost: float
    voice_calls: int
    total_cost: float
    calls: int


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
    #: 仅平台角色返回（跨院校视图）；院校账号恒为空——它们本来就只看得到本校。
    by_school: list[SchoolCostItem] = Field(default_factory=list)


class CostExportRequest(BaseModel):
    model_config = _REQ_CFG
    start_date: str | None = None
    end_date: str | None = None
    service: str | None = None
    granularity: str = "daily"
    format: str = "json"
