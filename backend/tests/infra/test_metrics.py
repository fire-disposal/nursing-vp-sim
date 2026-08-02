"""Unit tests for MetricsSnapshot — pure counters, gauges, percentiles."""

from infra.metrics import MetricsSnapshot, _route_key


class TestRouteKey:
    def test_collapses_numeric_ids(self):
        assert _route_key("get", "/api/training/123") == "GET /api/training/:id"

    def test_collapses_hex_ids(self):
        assert _route_key("get", "/api/cases/abc123def456") == "GET /api/cases/:id"

    def test_keeps_named_segments(self):
        assert _route_key("post", "/api/training/score") == "POST /api/training/score"

    def test_root_path(self):
        assert _route_key("get", "/") == "GET /"


class TestRecordRequest:
    def test_totals_and_status_buckets(self):
        with _isolated():
            m = MetricsSnapshot()
            m.record_request(200, 12.0, method="GET", path="/api/training/1")
            m.record_request(404, 5.0, method="GET", path="/api/training/2")
            stats = m._request_stats()
            assert stats["total"] == 2
            assert stats["by_status"] == {"2xx": 1, "4xx": 1}
            assert stats["by_status_code"] == {"200": 1, "404": 1}

    def test_top_4xx_lists_route(self):
        with _isolated():
            m = MetricsSnapshot()
            for _ in range(3):
                m.record_request(404, 1.0, method="GET", path="/api/records/77")
            top = m._request_stats()["top_4xx"]
            assert top, "应有 4xx 记录"
            assert top[0]["route"] == "GET /api/records/:id"
            assert top[0]["status"] == 404
            assert top[0]["count"] == 3

    def test_top_5xx_empty_when_none(self):
        with _isolated():
            m = MetricsSnapshot()
            m.record_request(200, 1.0)
            assert m._request_stats()["top_5xx"] == []

    def test_latency_percentiles(self):
        with _isolated():
            m = MetricsSnapshot()
            for i in range(1, 101):
                m.record_request(200, float(i))
            stats = m._request_stats()
            assert stats["latency_ms"]["p50"] == 51.0  # 0 基索引: idx=50 → 值 51
            assert stats["latency_ms"]["p95"] == 96.0
            assert stats["latency_ms"]["avg"] == 50.5


class TestRecordLlmCall:
    def test_success_error_split(self):
        with _isolated():
            m = MetricsSnapshot()
            m.record_llm_call(status="success", tokens=100, cost=0.01, latency_ms=200.0)
            m.record_llm_call(status="success", tokens=50, cost=0.005, latency_ms=100.0)
            m.record_llm_call(status="error", tokens=0, cost=0.0, latency_ms=50.0)
            stats = m._llm_stats()
            assert stats["calls_total"] == 3
            assert stats["calls_success"] == 2
            assert stats["calls_error"] == 1
            assert stats["tokens_used"] == 150
            assert stats["estimated_cost"] == 0.015


class TestSnapshot:
    def test_includes_suppliers_and_uptime(self):
        with _isolated():
            m = MetricsSnapshot()
            m.active_sessions_supplier = lambda: 7
            m.degraded_providers_supplier = lambda: 2
            m.global_degraded_supplier = lambda: True
            snap = m.snapshot()
            assert snap["active_sessions"] == 7
            assert snap["llm"]["degraded_providers"] == 2
            assert snap["llm"]["global_degraded"] is True
            assert snap["version"]
            assert snap["uptime_seconds"] >= 0

    def test_supplier_exception_safe(self):
        with _isolated():
            m = MetricsSnapshot()
            m.active_sessions_supplier = lambda: (_ for _ in ()).throw(RuntimeError("boom"))
            snap = m.snapshot()
            assert snap["active_sessions"] == 0  # default fallback, no crash

    def test_queue_sizes(self):
        with _isolated():
            m = MetricsSnapshot()
            m.task_queue_size_supplier = lambda: 3
            m.log_queue_size_supplier = lambda: 1
            snap = m.snapshot()
            assert snap["queue"] == {"task_queue": 3, "log_queue": 1}


class TestPercentile:
    def test_empty_list_returns_zero(self):
        assert MetricsSnapshot._percentile([], 50) == 0.0

    def test_single_value(self):
        assert MetricsSnapshot._percentile([42.0], 95) == 42.0


def _isolated():
    """Reset shared class-level counters so tests are deterministic."""

    class _Ctx:
        def __enter__(self):
            with MetricsSnapshot._request_lock:
                MetricsSnapshot._request_total = 0
                MetricsSnapshot._request_by_status.clear()
                MetricsSnapshot._request_by_status_code.clear()
                MetricsSnapshot._request_by_route_status.clear()
                MetricsSnapshot._request_latencies.clear()
            with MetricsSnapshot._llm_lock:
                MetricsSnapshot._llm_calls_total = 0
                MetricsSnapshot._llm_calls_success = 0
                MetricsSnapshot._llm_calls_error = 0
                MetricsSnapshot._llm_tokens_used = 0
                MetricsSnapshot._llm_estimated_cost = 0.0
                MetricsSnapshot._llm_latencies.clear()
            return self

        def __exit__(self, *args):
            return False

    return _Ctx()
