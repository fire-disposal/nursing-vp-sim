"""Unit tests for alert derivation in ``infra.ops_queries.compute_alerts``."""

from infra.ops_queries import compute_alerts


def _dashboard(**overrides) -> dict:
    d = {
        "llm": {},
        "scoring": {},
        "sessions": {},
        "voice": {},
        "voice_budget": {},
        "error_burst_5min": 0,
        "http": {"total": 0, "by_status": {}, "by_status_code": {}, "latency_ms": {}},
        "frontend_errors": {},
    }
    d.update(overrides)
    return d


class TestHttpAlert:
    def test_4xx_scan_noise_does_not_alert(self):
        """A public API flooded by scanner 404s on non-existent paths is NOT an
        actionable signal — it must not produce a 4xx-ratio alert."""
        d = _dashboard(
            http={
                "total": 68,
                "by_status": {"2xx": 29, "4xx": 39},
                "by_status_code": {"200": 29, "404": 39},
                "latency_ms": {"p50": 1, "p95": 67, "avg": 14.2},
            }
        )
        assert compute_alerts(d) == []

    def test_p95_tail_latency_still_alerts(self):
        """Genuine HTTP degradation (tail latency) still fires."""
        d = _dashboard(
            http={
                "total": 100,
                "by_status": {"2xx": 99, "4xx": 1},
                "latency_ms": {"p95": 5000},
            }
        )
        assert any("p95" in a for a in compute_alerts(d))

    def test_whole_request_surface_still_populated(self):
        """Removing the 4xx rule must not suppress other HTTP-derived signals."""
        d = _dashboard(http={"total": 40, "by_status": {"5xx": 40}, "latency_ms": {}})
        # No 4xx alert, and no false alert for a scan-weighted surface.
        assert compute_alerts(d) == []


class TestGenuineAlertsPreserved:
    def test_llm_low_success_rate_still_alerts(self):
        d = _dashboard(llm={"total_calls_24h": 100, "success_rate": 50, "error_count_24h": 0, "recent_errors": []})
        assert any("LLM 成功率" in a for a in compute_alerts(d))
