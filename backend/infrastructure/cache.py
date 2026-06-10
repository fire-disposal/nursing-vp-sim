"""In-memory caches — EmotionCache, InitiativeCache.

Replaces module-level dicts that were accessed across modules.
Stores rich state objects from emotion.py and initiative.py.
"""

from __future__ import annotations

import logging
from collections.abc import Set as AbstractSet

log = logging.getLogger(__name__)


class EmotionCache:
    """Per-record emotion state cache. Lives in app.state."""

    def __init__(self) -> None:
        self._store: dict[int, object] = {}

    def cleanup(self, record_id: int) -> None:
        self._store.pop(record_id, None)

    def cleanup_completed(self, completed_ids: AbstractSet[int]) -> int:
        count = 0
        for rid in completed_ids:
            if rid in self._store:
                del self._store[rid]
                count += 1
        if count:
            log.info("Cleaned %d completed emotion cache entries", count)
        return count

    @property
    def all_ids(self) -> AbstractSet[int]:
        return self._store.keys()


class InitiativeCache:
    """Per-record initiative timer cache. Lives in app.state."""

    def __init__(self) -> None:
        self._timers: dict[int, float] = {}
        self._last_triggers: dict[int, float] = {}

    def update_timer(self, record_id: int, timestamp: float) -> None:
        self._timers[record_id] = timestamp
        self._last_triggers.pop(record_id, None)

    def get_timer(self, record_id: int, default: float) -> float:
        return self._timers.get(record_id, default)

    def get_last_trigger(self, record_id: int) -> float:
        return self._last_triggers.get(record_id, 0.0)

    def set_last_trigger(self, record_id: int, timestamp: float) -> None:
        self._last_triggers[record_id] = timestamp

    def cleanup(self, record_id: int) -> None:
        self._timers.pop(record_id, None)
        self._last_triggers.pop(record_id, None)

    def cleanup_completed(self, completed_ids: AbstractSet[int]) -> int:
        count = 0
        for rid in completed_ids:
            if rid in self._timers:
                del self._timers[rid]
                count += 1
            if rid in self._last_triggers:
                del self._last_triggers[rid]
                count += 1
        if count:
            log.info("Cleaned %d completed initiative cache entries", count)
        return count
