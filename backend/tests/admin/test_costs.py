from datetime import UTC, datetime

from models import LLMCallLog
from modules.admin.costs import CostService


def _add_log(db, status, cost, created_at=None):
    db.add(
        LLMCallLog(
            purpose="scoring",
            provider_name="deepseek",
            model="deepseek-v4-pro",
            prompt_tokens=10,
            completion_tokens=10,
            total_tokens=20,
            token_estimated=1,
            estimated_cost=cost,
            cost_currency="CNY",
            latency_ms=100,
            status=status,
            created_at=created_at or datetime.now(UTC),
        )
    )
    db.flush()


def test_llm_cost_excludes_failed_calls(db_session):
    _add_log(db_session, "success", 0.5)
    _add_log(db_session, "failed", 0.9)  # 幻影成本
    svc = CostService(db_session)
    total, success, error_count, _avg_latency, total_cost = svc._llm_stats(datetime(2000, 1, 1, tzinfo=UTC))
    assert total == 2
    assert round(total_cost, 6) == 0.5  # 幻影 0.9 不计入


def test_daily_series_buckets_by_shanghai_timezone(db_session):
    # 2026-06-30 20:00 UTC == 北京 2026-07-01 04:00 —— 应归入 07-01 桶。
    _add_log(db_session, "success", 0.3, created_at=datetime(2026, 6, 30, 20, 0, tzinfo=UTC))
    svc = CostService(db_session)
    series = svc._daily_series(days=3650)
    by_date = {p.date: p.llm_cost for p in series}
    assert by_date.get("2026-07-01", 0.0) == 0.3
    assert by_date.get("2026-06-30", 0.0) == 0.0


import pytest

pytestmark = pytest.mark.integration
