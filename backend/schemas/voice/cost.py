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


class SchoolBudgetItem(BaseModel):
    school_id: int
    school_name: str
    llm_monthly_limit: float = 0.0
    tts_monthly_limit: float = 0.0
    default_daily_llm_limit: float | None = None
    default_daily_tts_limit: float | None = None
    llm_used: float = 0.0
    tts_used: float = 0.0


class UserBudgetItem(BaseModel):
    user_id: int
    username: str
    display_name: str
    school_id: int | None = None
    daily_llm_limit: float = 0.0
    daily_tts_limit: float = 0.0
    is_default: bool = True
    source: str = "platform"
    llm_used_today: float = 0.0
    tts_used_today: float = 0.0
    school_name: str | None = None
    school_llm_limit: float = 0.0
    school_tts_limit: float = 0.0
    school_llm_used: float = 0.0
    school_tts_used: float = 0.0


class BudgetUpdateRequest(BaseModel):
    llm_limit: float = 0.0
    tts_limit: float = 0.0


class SchoolBudgetUpdateRequest(BaseModel):
    llm_monthly_limit: float = 0.0
    tts_monthly_limit: float = 0.0
    default_daily_llm_limit: float | None = None
    default_daily_tts_limit: float | None = None


class MyQuotaBucket(BaseModel):
    limit: float
    used: float
    source: str = "platform"


class MyQuotaResponse(BaseModel):
    llm: MyQuotaBucket
    tts: MyQuotaBucket
    school_name: str | None = None
    school_llm_limit: float = 0.0
    school_tts_limit: float = 0.0
    school_llm_used: float = 0.0
    school_tts_used: float = 0.0
    day_reset_at: str
    month_reset_at: str
