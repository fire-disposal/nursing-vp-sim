"""Pydantic schemas for ops, diagnose, health, and metrics endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str = "ok"
    version: str


class MetricBuckets(BaseModel):
    two_xx: int = Field(default=0, alias="2xx")
    four_xx: int = Field(default=0, alias="4xx")
    five_xx: int = Field(default=0, alias="5xx")


class LatencyStats(BaseModel):
    p50: float
    p95: float
    p99: float
    avg: float


class RequestMetrics(BaseModel):
    total: int
    by_status: MetricBuckets
    latency_ms: LatencyStats


class LLMMetrics(BaseModel):
    calls_total: int
    calls_success: int
    calls_error: int
    tokens_used: int
    estimated_cost: float
    latency_ms: LatencyStats
    degraded_providers: int
    global_degraded: bool


class DBMetrics(BaseModel):
    pool_size: int
    checked_out: int
    overflow: int = 0
    connections_in_use: int


class QueueMetrics(BaseModel):
    task_queue: int
    log_queue: int


class MetricsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    uptime_seconds: float
    version: str
    requests: RequestMetrics
    active_sessions: int
    llm: LLMMetrics
    db: DBMetrics
    queue: QueueMetrics
    memory_mb: float = 0.0


class DiagnoseServerInfo(BaseModel):
    version: str
    uptime_seconds: int


class DiagnoseDBInfo(BaseModel):
    connected: bool
    pool_size: int = 0
    checked_out: int = 0
    error: str | None = None


class DiagnoseLLMInfo(BaseModel):
    degraded_providers: int = 0
    global_degraded: bool = False
    degraded_by_reason: dict[str, int] = {}
    status: str | None = None
    detail: str | None = None


class DiagnoseErrorEntry(BaseModel):
    time: str
    level: str
    logger: str
    message: str


class DiagnoseErrorsInfo(BaseModel):
    last_5min: int
    last_hour: int
    total_captured: int
    unique_24h: int = 0
    burst_5min: int = 0
    recent: list[DiagnoseErrorEntry]


class DiagnoseResponse(BaseModel):
    server: DiagnoseServerInfo
    database: dict[str, Any]
    llm: dict[str, Any]
    errors: DiagnoseErrorsInfo
    active_sessions: int
    cached_at: str


class OpsLLMInfo(BaseModel):
    total_calls_24h: int = 0
    success_rate: float = 100.0
    error_count_24h: int = 0
    avg_latency_ms: float = 0.0
    recent_errors: list[dict[str, Any]] = []


class OpsScoringInfo(BaseModel):
    pending: int = 0
    in_progress: int = 0
    completed_24h: int = 0
    failed_24h: int = 0
    success_rate: float = 100.0


class OpsSessionsInfo(BaseModel):
    active: int = 0


class OpsNotificationsInfo(BaseModel):
    unread: int = 0


class OpsDashboardResponse(BaseModel):
    health: dict[str, Any]
    time: str
    uptime_hours: float
    llm: OpsLLMInfo
    scoring: OpsScoringInfo
    sessions: OpsSessionsInfo
    notifications: OpsNotificationsInfo
    metrics: dict[str, Any]
    diagnostic: dict[str, Any]
    system_errors: dict[str, Any]


class OpsErrorsResponse(BaseModel):
    count: dict[str, Any]
    recent: list[dict[str, Any]]


class OpsReportSummary(BaseModel):
    time: str
    uptime_hours: float
    status: str = "healthy"


class OpsReportResponse(BaseModel):
    summary: OpsReportSummary
    llm: OpsLLMInfo
    scoring: OpsScoringInfo
    sessions: OpsSessionsInfo
    notifications: OpsNotificationsInfo
    alerts: list[str]


class FallbackStateResponse(BaseModel):
    available: bool
    label: str
    key_suffix: str
    base_url: str
    model_flash: str
    model_pro: str
    latency_ms: int | None = None
    error: str | None = None
    call_count: int = 0
    total_tokens: int = 0
    total_cost: float = 0.0
    degraded_reason: str | None = None
    degraded_until: datetime | None = None
    consecutive_failures: int = 0

    model_config = ConfigDict(extra="allow")
