"""Scoring progress tracker — in-memory single source of truth.

Previously backed by a PostgreSQL table (ScoringProgress model), which
created a new DB session on *every update* (~8 per scoring run).  This
is transient UI-facing data that no other service reads — storing it in
the database buys zero durability and costs a connection-open + query +
commit + close per update.

Now a plain dict.  The public API is unchanged, so callers are unaffected.

TTL auto-eviction on get() prevents stale entries from polluting polling
responses after process crashes or unexpected task failures.
"""

from __future__ import annotations

import time


class ScoringProgressTracker:
    def __init__(self, ttl_seconds: float = 900):
        self._store: dict[int, dict] = {}
        self._ttl = ttl_seconds

    def set(self, record_id: int, stage: str, percent: int, message: str = "", thought: str = "") -> None:
        entry = self._store.setdefault(record_id, {"_ts": time.time()})
        entry.update(
            {
                "stage": stage,
                "percent": percent,
                "message": message,
                "_ts": time.time(),
            }
        )
        if thought:
            entry[f"thought_{stage}"] = thought

    def get(self, record_id: int) -> dict | None:
        entry = self._store.get(record_id)
        if entry is None:
            return None
        if time.time() - entry.get("_ts", 0) > self._ttl:
            self._store.pop(record_id, None)
            return None
        return entry

    def get_progress(self, record_id: int) -> dict | None:
        return self.get(record_id)

    def start(self, record_id: int) -> None:
        self.set(record_id, "loading", 0, "开始评分")

    def update(self, record_id: int, stage: str, pct: int, msg: str) -> None:
        self.set(record_id, stage, pct, msg)

    def cleanup(self, record_id: int) -> None:
        """Evict an entry after scoring completes/fails to prevent unbounded growth."""
        self._store.pop(record_id, None)
