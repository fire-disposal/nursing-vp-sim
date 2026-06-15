"""Application metrics collector — counters, gauges, histograms.

Exposes a snapshot dict consumed by /api/metrics and external monitoring.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict
from collections.abc import Callable
from typing import Protocol, cast


class _PoolProtocol(Protocol):
    def size(self) -> int: ...
    def checkedout(self) -> int: ...
    def overflow(self) -> int: ...


log = logging.getLogger(__name__)


class MetricsSnapshot:
    def __init__(self) -> None:
        self.started_at = time.time()

    # ── request tracking (populated by the log-request middleware) ──────────
    _request_lock = threading.Lock()
    _request_total: int = 0
    _request_by_status: dict[str, int] = defaultdict(int)
    _request_latencies: list[float] = []  # last N latencies in ms, circular

    _LATENCY_BUFFER = 2000  # keep last 2k latencies for percentile calc

    def record_request(self, status_code: int, latency_ms: float) -> None:
        with self._request_lock:
            self._request_total += 1
            bucket = f"{status_code // 100}xx"
            self._request_by_status[bucket] += 1
            self._request_latencies.append(latency_ms)
            if len(self._request_latencies) > self._LATENCY_BUFFER:
                self._request_latencies = self._request_latencies[-self._LATENCY_BUFFER :]

    # ── LLM tracking (populated by LLMClient) ──────────────────────────────
    _llm_lock = threading.Lock()
    _llm_calls_total: int = 0
    _llm_calls_success: int = 0
    _llm_calls_error: int = 0
    _llm_tokens_used: int = 0
    _llm_estimated_cost: float = 0.0
    _llm_latencies: list[float] = []  # ms

    def record_llm_call(self, *, status: str, tokens: int, cost: float, latency_ms: float) -> None:
        with self._llm_lock:
            self._llm_calls_total += 1
            if status == "success":
                self._llm_calls_success += 1
            else:
                self._llm_calls_error += 1
            self._llm_tokens_used += tokens
            self._llm_estimated_cost += cost
            self._llm_latencies.append(latency_ms)
            if len(self._llm_latencies) > self._LATENCY_BUFFER:
                self._llm_latencies = self._llm_latencies[-self._LATENCY_BUFFER :]

    # ── active training sessions (set externally from app.state) ───────────
    active_sessions_supplier: Callable[..., int] = lambda _self: 0

    # ── queue sizes (set externally) ───────────────────────────────────────
    task_queue_size_supplier: Callable[..., int] = lambda _self: 0
    log_queue_size_supplier: Callable[..., int] = lambda _self: 0

    # ── circuit breaker / LLM router status ────────────────────────────────
    degraded_providers_supplier: Callable[..., int] = lambda _self: 0
    global_degraded_supplier: Callable[..., bool] = lambda _self: False

    # ── helpers ────────────────────────────────────────────────────────────
    @staticmethod
    def _percentile(sorted_values: list[float], p: float) -> float:
        if not sorted_values:
            return 0.0
        idx = int(len(sorted_values) * p / 100)
        idx = max(0, min(idx, len(sorted_values) - 1))
        return round(sorted_values[idx], 1)

    def _request_stats(self) -> dict:
        with self._request_lock:
            total = self._request_total
            by_status = dict(self._request_by_status)
            lats = sorted(self._request_latencies[:])
        return dict(
            total=total,
            by_status=by_status,
            latency_ms=dict(
                p50=self._percentile(lats, 50),
                p95=self._percentile(lats, 95),
                p99=self._percentile(lats, 99),
                avg=round(sum(lats) / len(lats), 1) if lats else 0.0,
            ),
        )

    def _llm_stats(self) -> dict:
        with self._llm_lock:
            total = self._llm_calls_total
            success = self._llm_calls_success
            error = self._llm_calls_error
            tokens = self._llm_tokens_used
            cost = round(self._llm_estimated_cost, 4)
            lats = sorted(self._llm_latencies[:])
        return dict(
            calls_total=total,
            calls_success=success,
            calls_error=error,
            tokens_used=tokens,
            estimated_cost=cost,
            latency_ms=dict(
                avg=round(sum(lats) / len(lats), 1) if lats else 0.0,
                p95=self._percentile(lats, 95),
            ),
            degraded_providers=self.degraded_providers_supplier(),
            global_degraded=self.global_degraded_supplier(),
        )

    @staticmethod
    def _db_stats() -> dict:
        try:
            from core.database import engine
        except Exception:
            return {}
        pool = cast("_PoolProtocol", engine.pool)
        if pool is None:
            return {}
        return dict(
            pool_size=pool.size(),
            checked_out=pool.checkedout(),
            overflow=pool.overflow(),
            connections_in_use=pool.checkedout(),
        )

    @staticmethod
    def _memory_mb() -> float:
        try:
            import resource
        except ImportError:
            return 0.0

        import platform

        if platform.system() != "Linux":
            return 0.0
        usage = resource.getrusage(resource.RUSAGE_SELF)  # ty: ignore
        return round(usage.ru_maxrss / 1024, 1)

    def snapshot(self) -> dict:
        return dict(
            uptime_seconds=round(time.time() - self.started_at, 1),
            version=os.getenv("APP_VERSION", "dev"),
            requests=self._request_stats(),
            active_sessions=self.active_sessions_supplier(),
            llm=self._llm_stats(),
            db=self._db_stats(),
            queue=dict(
                task_queue=self.task_queue_size_supplier(),
                log_queue=self.log_queue_size_supplier(),
            ),
            memory_mb=self._memory_mb(),
        )
