"""Unit tests for alert derivation in ``infra.ops_queries.compute_alerts``."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from core.statuses import LLMCallStatus
from infra.ops_queries import compute_alerts, query_llm, query_llm_errors

# LLM 调用明细表的最小 SQLite 结构（只含被测查询用到的列；JSONB 只出现在 meta，
# 不影响这些聚合查询，故无需（也无法）在 SQLite 上建全量表）。
_LLM_CALL_LOGS_DDL = """
CREATE TABLE llm_call_logs (
    id INTEGER PRIMARY KEY,
    status VARCHAR(20) NOT NULL DEFAULT 'success',
    latency_ms INTEGER,
    error_type VARCHAR(80),
    total_tokens INTEGER,
    estimated_cost FLOAT,
    created_at TIMESTAMP NOT NULL
)
"""

_INSERT_ROW = text(
    "INSERT INTO llm_call_logs (id, status, latency_ms, error_type, total_tokens, estimated_cost, created_at) "
    "VALUES (:id, :status, :latency_ms, :error_type, :total_tokens, :estimated_cost, :created_at)"
)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.exec_driver_sql(_LLM_CALL_LOGS_DDL)
    with Session(engine) as session:
        yield session


def _add_call(db, row_id: int, status: str, *, error_type=None, at=None, cost=0.0, tokens=0):
    db.execute(
        _INSERT_ROW,
        {
            "id": row_id,
            "status": status,
            "latency_ms": 100,
            "error_type": error_type,
            "total_tokens": tokens,
            "estimated_cost": cost,
            "created_at": at or datetime.now(UTC),
        },
    )


class TestLlmErrorWindow:
    """回归：错误数必须按 ``status != LLMCallStatus.SUCCESS`` 统计。

    DB 只写 success/failed（LLMCallStatus），历史上的查询却用了永远不存在的字面量
    ``"error"``，导致 /api/diagnose、运维仪表盘与 LLM 错误告警**恒为 0**。
    """

    def test_failed_rows_are_counted_as_errors(self, db):
        now = datetime.now(UTC)
        _add_call(db, 1, LLMCallStatus.SUCCESS, cost=0.5, tokens=10, at=now)
        _add_call(db, 2, LLMCallStatus.FAILED, error_type="provider_500", at=now)
        _add_call(db, 3, LLMCallStatus.FAILED, error_type="rate_limited", at=now)
        db.commit()

        window = query_llm(db, now - timedelta(hours=24))

        assert window["total"] == 3
        assert window["success"] == 1
        assert window["error"] == 2
        # 成本/用量只算成功调用（失败行的成本是估值噪声）
        assert window["cost"] == 0.5
        assert window["tokens"] == 10

    def test_error_breakdown_lists_failed_rows(self, db):
        now = datetime.now(UTC)
        _add_call(db, 1, LLMCallStatus.SUCCESS, at=now)
        _add_call(db, 2, LLMCallStatus.FAILED, error_type="provider_500", at=now)
        _add_call(db, 3, LLMCallStatus.FAILED, error_type="provider_500", at=now)
        db.commit()

        errors = query_llm_errors(db, now - timedelta(hours=24))

        assert errors == [{"type": "provider_500", "count": 2}]

    def test_rows_outside_window_are_excluded(self, db):
        now = datetime.now(UTC)
        _add_call(db, 1, LLMCallStatus.FAILED, error_type="old", at=now - timedelta(hours=30))
        _add_call(db, 2, LLMCallStatus.FAILED, error_type="new", at=now)
        db.commit()

        window = query_llm(db, now - timedelta(hours=24))

        assert window["error"] == 1


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

    def test_llm_error_count_threshold_alerts(self):
        """错误数 > 50 必须产出告警 —— 该规则此前因状态值写错而结构上不可能触发。"""
        quiet = _dashboard(llm={"total_calls_24h": 100, "success_rate": 90, "error_count_24h": 50, "recent_errors": []})
        assert not any("LLM 错误" in a for a in compute_alerts(quiet))

        loud = _dashboard(llm={"total_calls_24h": 100, "success_rate": 50, "error_count_24h": 51, "recent_errors": []})
        assert any("近 24h LLM 错误 51 次" in a for a in compute_alerts(loud))
