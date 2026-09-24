"""前端遥测缓冲与跨 worker 归档的回归测试。

2026-09-24 机房崩溃取证暴露的问题：uvicorn ``--workers 2`` 下只读进程内缓冲，
/api/diagnose 的前端错误计数按 worker 分裂（同一端点连续调用返回两套互斥计数），
且快照丢弃了上报里已有的 ``ua``，无法判断是环境（机房旧浏览器）还是代码问题。
这里锁定修复后的跨 worker 口径与取证字段。
"""

from datetime import UTC, datetime, timedelta

from infra.error_archive import ErrorArchive
from infra.telemetry import FrontendErrorBuffer

_UA_EDGE92 = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/92.0.4515.131 Safari/537.36 Edg/92.0.902.67"
)


def _entry(**overrides) -> dict:
    entry = {
        "type": "TypeError",
        "message": "Object.hasOwn is not a function",
        "url": "/training/538",
        "user_id": 67,
        "ua": _UA_EDGE92,
        "source": "ErrorBoundary",
        "component_stack": "at Ga (markdown.js:14:12727)",
    }
    entry.update(overrides)
    return entry


def _buffer(tmp_path, name: str = "frontend-errors.jsonl") -> FrontendErrorBuffer:
    archive = ErrorArchive(str(tmp_path / name), max_bytes=1024 * 1024, backup_count=1)
    return FrontendErrorBuffer(archive=archive)


def test_counts_merge_across_workers(tmp_path):
    """同一签名由两个 worker 分别上报时，任一 worker 的快照都要看到合并后的次数。"""
    worker_a = _buffer(tmp_path)
    worker_b = _buffer(tmp_path)

    worker_a.ingest(_entry())
    worker_b.ingest(_entry())

    snapshot = worker_a.aggregate_snapshot()

    assert snapshot["last_5min"] == 2
    assert snapshot["last_hour"] == 2
    assert snapshot["total_captured"] == 1
    assert len(snapshot["groups"]) == 1
    assert snapshot["groups"][0]["count"] == 2


def test_group_carries_browser_and_page_of_affected_client(tmp_path):
    """取证关键：分组要带出事端 UA / 页面 / ErrorBoundary 组件栈。"""
    buffer = _buffer(tmp_path)
    buffer.ingest(_entry())

    group = buffer.aggregate_snapshot()["groups"][0]

    assert "Edg/92" in group["ua"]
    assert group["url"] == "/training/538"
    assert group["user_id"] == 67
    assert group["source"] == "ErrorBoundary"
    assert group["fingerprint"]
    assert group["first_seen"]


def test_repeats_deduplicate_within_window(tmp_path):
    buffer = _buffer(tmp_path)
    for _ in range(12):
        buffer.ingest(_entry())

    snapshot = buffer.aggregate_snapshot()

    assert snapshot["last_5min"] == 12
    assert len(snapshot["groups"]) == 1
    assert snapshot["groups"][0]["count"] == 12


def test_window_counts_and_groups_are_scoped_separately(tmp_path):
    """24h 的 total_captured 与 60 分钟 groups 窗口是两套口径。"""
    buffer = _buffer(tmp_path)
    stale = datetime.now(UTC) - timedelta(hours=2)
    buffer.archive.append(
        {
            "fingerprint": "stale0000000000",
            "time": stale.isoformat(),
            "first_seen": stale.isoformat(),
            "type": "WindowError",
            "message": "ResizeObserver loop limit exceeded",
            "url": "/training/570",
            "user_id": 74,
            "ua": _UA_EDGE92,
            "source": "window.error",
            "component_stack": "",
            "count": 3,
        }
    )
    buffer.ingest(_entry())

    snapshot = buffer.aggregate_snapshot()

    assert snapshot["last_5min"] == 1
    assert snapshot["last_hour"] == 1
    assert snapshot["total_captured"] == 2
    assert all(group["fingerprint"] != "stale0000000000" for group in snapshot["groups"])
