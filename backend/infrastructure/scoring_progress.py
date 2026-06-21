"""Scoring progress tracker — in-memory single source of truth.

Previously backed by a PostgreSQL table (ScoringProgress model), which
created a new DB session on *every update* (~8 per scoring run).  This
is transient UI-facing data that no other service reads — storing it in
the database buys zero durability and costs a connection-open + query +
commit + close per update.

Now a plain dict.  The public API is unchanged, so callers are unaffected.
"""

from __future__ import annotations


class ScoringProgressTracker:
    def __init__(self):
        self._store: dict[int, dict] = {}

    def set(self, record_id: int, stage: str, percent: int, message: str = "") -> None:
        self._store[record_id] = {"stage": stage, "percent": percent, "message": message}

    def get(self, record_id: int) -> dict | None:
        return self._store.get(record_id)

    def get_progress(self, record_id: int) -> dict | None:
        return self.get(record_id)

    def start(self, record_id: int) -> None:
        self.set(record_id, "loading", 0, "开始评分")

    def update(self, record_id: int, stage: str, pct: int, msg: str) -> None:
        self.set(record_id, stage, pct, msg)

    def cleanup(self, record_id: int) -> None:
        """Evict an entry after scoring completes/fails to prevent unbounded growth."""
        self._store.pop(record_id, None)
