"""Pydantic schemas for the health endpoint and the admin LLM fallback state.

``/api/diagnose`` 与 ``/api/metrics`` 返回裸 dict：它们是人机共读的运维快照，
字段口径由 ``infra/diagnostics.py`` 的 scope/window 词表 + ``docs/ops/diagnostics.md``
定义（唯一契约）。此处曾经并排放着第二份 Diagnose*/Metrics*/Ops* pydantic 模型，
既不参与校验也不出现在 openapi.json 里，只会在口径变更时漂移，已删除。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    status: str = "ok"
    version: str


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
