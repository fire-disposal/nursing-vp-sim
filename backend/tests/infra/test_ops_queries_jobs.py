"""持久化 Job 的运维读面（`query_jobs`）。

为什么需要它：`SCORING_EXECUTION=job` 时评分不走进程内 TaskQueue，
`metrics.queue.task_queue` 恒为 0 —— 队列可见性只能从这里来。形状必须是确定的
（无作业行时也有 `by_kind.scoring == {}`），否则看板/冒烟要到处判空。

SQL 本身在真实 PostgreSQL 上验证过（一次性行插入 → 断言 oldest_pending_seconds 取值），
这里只钉**形状与聚合**逻辑。
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from infra.ops_queries import query_jobs

NOW = datetime(2026, 9, 26, 10, 0, tzinfo=UTC)


def _row(kind: str, status: str, n: int, oldest: float = 0, expired: int = 0) -> SimpleNamespace:
    return SimpleNamespace(kind=kind, status=status, n=n, oldest_pending_s=oldest, expired_leases=expired)


def _db(rows: list[SimpleNamespace]) -> SimpleNamespace:
    return SimpleNamespace(execute=lambda *_a, **_k: SimpleNamespace(all=lambda: rows))


class TestQueryJobs:
    def test_empty_table_has_deterministic_shape(self):
        result = query_jobs(_db([]), NOW)

        assert result == {"by_kind": {"scoring": {}}, "oldest_pending_seconds": 0, "expired_leases": 0}

    def test_groups_counts_by_kind_and_status(self):
        rows = [_row("scoring", "pending", 3, oldest=42.7), _row("scoring", "succeeded", 17)]

        result = query_jobs(_db(rows), NOW)

        assert result["by_kind"] == {"scoring": {"pending": 3, "succeeded": 17}}
        assert result["oldest_pending_seconds"] == 42

    def test_oldest_pending_is_max_across_kinds(self):
        rows = [_row("scoring", "pending", 1, oldest=10), _row("export", "pending", 1, oldest=300)]

        assert query_jobs(_db(rows), NOW)["oldest_pending_seconds"] == 300

    def test_expired_leases_are_summed(self):
        """租约过期 = 执行者消失但尚未被重领；运维要能一眼看到这个数。"""
        rows = [_row("scoring", "running", 2, expired=2), _row("export", "running", 1, expired=1)]

        assert query_jobs(_db(rows), NOW)["expired_leases"] == 3
