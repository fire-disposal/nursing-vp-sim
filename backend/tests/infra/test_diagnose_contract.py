"""诊断端点口径契约（schema_version 3）——窗口语义、scope/window 词表、去重不变量。"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from infra import diagnostics
from infra.diagnose import DiagnoseService, ErrorCaptureHandler
from infra.error_archive import ErrorArchive


def _record(message: str, *, created: float) -> logging.LogRecord:
    record = logging.LogRecord("tests.worker", logging.ERROR, "", 0, message, (), None)
    record.created = created
    return record


def _service_with_archive(tmp_path) -> tuple[DiagnoseService, ErrorArchive]:
    archive = ErrorArchive(str(tmp_path / "errors.jsonl"), max_bytes=1024 * 1024, backup_count=1)
    service = DiagnoseService()
    service._archive = archive
    service._handler = ErrorCaptureHandler(archive=archive)
    return service, archive


def test_error_windows_count_occurrences_not_group_totals(tmp_path):
    """窗口计数必须是「窗口内发生次数」：老组的历史累计不得整块漏进 5 分钟窗口。"""
    service, archive = _service_with_archive(tmp_path)
    now = datetime.now(UTC)
    # 档案按写入顺序即时间顺序读取（query 逆序扫描、遇到更老的行即停），故按时间升序写入。
    events = (
        (timedelta(hours=25), "fp-stale", "ancient failure", 9),  # 窗口外，任何计数都不该包含
        (timedelta(minutes=120), "fp-burst", "database timeout", 5),  # 同指纹：2 小时前 5 次
        (timedelta(minutes=1), "fp-burst", "database timeout", 2),  # 1 分钟前 2 次
    )
    for age, fingerprint, message, count in events:
        archive.append(
            {
                "time": (now - age).isoformat(),
                "fingerprint": fingerprint,
                "level": "ERROR",
                "logger": "tests.worker",
                "message": message,
                "count": count,
            }
        )

    windows = service.error_windows(now)
    archive.close()

    assert windows["last_5min"] == 2
    assert windows["last_hour"] == 2
    assert windows["unique_24h"] == 1
    assert windows["total_captured"] == windows["unique_24h"]  # 历史键名与新语义同义


def test_error_windows_include_unpersisted_delta(tmp_path):
    """内存里尚未落盘的增量必须计入，否则窗口计数在落盘间隔内偏低。"""
    service, archive = _service_with_archive(tmp_path)
    now = datetime.now(UTC).timestamp()
    handler = service._handler
    assert handler is not None
    handler.emit(_record("cache miss", created=now))
    handler.emit(_record("cache miss", created=now + 1))

    windows = service.error_windows(datetime.now(UTC))
    archive.close()

    assert windows["last_5min"] == 2
    assert windows["unique_24h"] == 1


class _StubMetrics:
    def snapshot(self) -> dict:
        return {
            "uptime_seconds": 12.0,
            "version": "test-version",
            "requests": {"total": 1},
            "active_sessions": 3,
            "llm": {"calls_total": 0},
            "db": {},
            "queue": {},
            "memory_mb": 1.0,
        }


class _StubService:
    def __init__(self, snapshot: dict, context: dict) -> None:
        self._snapshot = snapshot
        self._context = context

    async def get_diagnose(self) -> dict:
        return self._snapshot

    def get_error_context(self, *, minutes: int = 60, max_groups: int = 20) -> dict:
        return {**self._context, "window_minutes": minutes}


def _stub_request() -> SimpleNamespace:
    state = SimpleNamespace(metrics=_StubMetrics(), scoring_tracker=SimpleNamespace(_store=()))
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _payload(monkeypatch, *, frontend_last_5min: int) -> dict:
    snapshot = {
        "server": {"version": "test-version", "uptime_seconds": 99},
        "database": {"connected": True, "pool_size": 10, "checked_out": 1},
        "llm": {"degraded_providers": 1, "global_degraded": False, "degraded_by_reason": {"timeout": 1}},
        "errors": {
            "last_5min": 2,
            "last_hour": 3,
            "unique_24h": 4,
            "total_captured": 4,
            "recent": [],
        },
        "frontend_errors": {
            "last_5min": frontend_last_5min,
            "last_hour": frontend_last_5min,
            "unique_24h": 1,
            "total_captured": 1,
            "groups": [],
        },
        "cached_at": datetime.now(UTC).isoformat(),
    }
    context = {"total_events": 3, "unique_groups": 2, "truncated": False, "groups": []}
    dashboard = {
        "time": datetime.now(UTC).isoformat(),
        "llm": {
            "total_calls_24h": 0,
            "success_rate": 100.0,
            "error_count_24h": 0,
            "avg_latency_ms": 0.0,
            "recent_errors": [],
        },
        "scoring": {"pending": 0, "completed_24h": 0, "failed_24h": 0, "discarded_24h": 0, "success_rate": 100.0},
        "sessions": {"active": 3},
        "voice": {"tts": {}},
        "voice_budget": {"monthly_budget": 0, "monthly_cost": 0, "usage_pct": 0},
        "business": {"today_users": 0, "today_trainings": 0, "today_completed": 0},
    }
    monkeypatch.setattr(diagnostics, "DIAGNOSE_TOKEN", "test-token")
    monkeypatch.setattr(diagnostics, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))
    monkeypatch.setattr(diagnostics, "build_dashboard", lambda db, now: dict(dashboard))
    monkeypatch.setattr(diagnostics, "get_diagnose_service", lambda: _StubService(snapshot, context))

    return asyncio.run(
        diagnostics.diagnose(
            request=_stub_request(),
            token="test-token",
            error_window_minutes=60,
            error_groups=20,
        )
    )


def test_status_follows_alerts_and_is_healthy_when_quiet(monkeypatch):
    """``summary.status`` 与 ``alerts`` 同源：deploy 冒烟依赖这两个取值。"""
    quiet = _payload(monkeypatch, frontend_last_5min=0)
    assert quiet["summary"]["status"] == "healthy"
    assert quiet["summary"]["alerts"] == [] == quiet["alerts"]

    noisy = _payload(monkeypatch, frontend_last_5min=3)
    assert noisy["summary"]["status"] == "degraded"
    assert noisy["summary"]["alerts"] == noisy["alerts"]  # 同一份告警列表
    assert any("前端" in alert for alert in noisy["alerts"])


def test_diagnose_payload_declares_scope_and_window(monkeypatch):
    payload = _payload(monkeypatch, frontend_last_5min=0)

    assert payload["schema_version"] == 3
    assert "windows" not in payload  # 全局窗口表已由各块自带元数据取代

    vocabulary = {
        diagnostics.SCOPE_PROCESS,
        diagnostics.SCOPE_WORKERS,
        diagnostics.SCOPE_DB,
    }
    for block in (
        "runtime",
        "sessions",
        "errors",
        "frontend_errors",
        "llm",
        "scoring",
        "voice",
        "voice_budget",
        "business",
        "metrics",
    ):
        assert payload[block]["scope"] in vocabulary, block
        assert payload[block]["window"], block

    assert payload["runtime"]["scope"] == diagnostics.SCOPE_PROCESS
    assert payload["runtime"]["cache_ttl_seconds"] == diagnostics.CACHE_TTL_SECONDS
    assert "llm_router" not in payload["runtime"]  # 已移入 llm.router
    assert "active_sessions" not in payload["runtime"]  # 恒 0 死字段已删

    assert payload["sessions"] == {"scope": diagnostics.SCOPE_DB, "window": "now", "active": 3}

    assert payload["errors"]["scope"] == diagnostics.SCOPE_WORKERS
    assert payload["errors"]["window"] == "rolling_60m"
    assert payload["errors"]["count"] == {
        "last_5min": 2,
        "last_hour": 3,
        "total_captured": 4,
        "unique_24h": 4,
    }
    assert "burst_5min" not in payload["errors"]["count"]  # 与 last_5min 重复的旧键已删
    assert payload["errors"]["total_events"] == 3

    # 前端遥测与后端错误同形（keys 一致，便于消费者写一份解析）
    assert set(payload["frontend_errors"]) == set(payload["errors"]) - {
        "total_events",
        "unique_groups",
        "truncated",
        "window_minutes",
    } | {"groups"}
    assert payload["frontend_errors"]["count"]["unique_24h"] == 1
    assert payload["frontend_errors"]["count"]["last_5min"] == 0

    assert payload["llm"]["scope"] == diagnostics.SCOPE_DB
    assert payload["llm"]["router"]["scope"] == diagnostics.SCOPE_PROCESS
    assert payload["llm"]["router"]["degraded_providers"] == 1

    assert payload["scoring"]["in_progress_scope"] == diagnostics.SCOPE_PROCESS
    assert payload["metrics"]["scope"] == diagnostics.SCOPE_PROCESS
    assert payload["metrics"]["active_sessions_scope"] == diagnostics.SCOPE_DB


def test_cached_age_is_reported(monkeypatch):
    """runtime 快照陈旧度必须显式可见（此前只有 cached_at 需调用方自行相减）。"""
    fresh = datetime.now(UTC).isoformat()
    stale = (datetime.now(UTC) - timedelta(seconds=90)).isoformat()
    assert diagnostics._cached_age_seconds(fresh, datetime.now(UTC)) <= 2
    assert diagnostics._cached_age_seconds(stale, datetime.now(UTC)) == pytest.approx(90, abs=2)
    assert diagnostics._cached_age_seconds("", datetime.now(UTC)) == -1


def test_active_trainings_supplier_reads_db(monkeypatch):
    """``metrics.active_sessions`` 必须真的来自 DB 进行中训练数（此前 supplier 未接线，恒 0）。"""
    from infra import bootstrap, ops_queries

    monkeypatch.setattr(ops_queries, "query_sessions", lambda db: 7)
    monkeypatch.setattr(bootstrap, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))

    assert bootstrap._active_trainings() == 7


def test_active_trainings_probe_failure_degrades_to_zero(monkeypatch):
    from infra import bootstrap, ops_queries

    def _boom(db):
        raise RuntimeError("db down")

    monkeypatch.setattr(ops_queries, "query_sessions", _boom)
    monkeypatch.setattr(bootstrap, "SessionLocal", lambda: SimpleNamespace(close=lambda: None))

    assert bootstrap._active_trainings() == 0
