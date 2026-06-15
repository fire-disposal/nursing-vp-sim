"""In-memory scoring progress tracker with auto-cleanup."""

import logging
import time
from dataclasses import dataclass, field
from typing import Literal

log = logging.getLogger(__name__)

Phase = Literal["loading", "scoring", "feedback", "saving", "completed", "failed"]


@dataclass
class ScoringProgress:
    phase: Phase
    percentage: int
    message: str
    updated_at: float = field(default_factory=time.time)


class ScoringProgressTracker:
    """In-memory store for per-record scoring progress.

    Thread-safe for asyncio (single-threaded event loop).
    Entries older than TTL are cleaned up on get().
    Completed/failed entries are kept for 60s after completion for final polling.
    """

    def __init__(self, ttl: int = 600):
        self._store: dict[int, ScoringProgress] = {}
        self._ttl = ttl

    def start(self, record_id: int) -> None:
        self._store[record_id] = ScoringProgress(phase="loading", percentage=0, message="开始评分")

    def update(self, record_id: int, phase: Phase, pct: int, msg: str) -> None:
        self._store[record_id] = ScoringProgress(phase=phase, percentage=pct, message=msg, updated_at=time.time())

    def get(self, record_id: int) -> ScoringProgress | None:
        self._cleanup()
        entry = self._store.get(record_id)
        if entry is None:
            return None
        # Keep completed/failed entries for 60s so frontend can poll them
        if entry.phase in ("completed", "failed") and time.time() - entry.updated_at > 60:
            self._store.pop(record_id, None)
            return None
        return entry

    def remove(self, record_id: int) -> None:
        self._store.pop(record_id, None)

    def _cleanup(self) -> None:
        now = time.time()
        expired = [rid for rid, p in self._store.items() if now - p.updated_at > self._ttl]
        for rid in expired:
            self._store.pop(rid, None)
            log.debug("Cleaned up stale scoring progress: record_id=%d", rid)
