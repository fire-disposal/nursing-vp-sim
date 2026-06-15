"""In-memory caches — EmotionCache, InitiativeCache.

Replaces module-level dicts that were accessed across modules.
Stores rich state objects from emotion.py and initiative.py.
"""

from __future__ import annotations

import logging
import time
from collections import OrderedDict
from collections.abc import Set as AbstractSet
from typing import Set  # noqa: UP035 — name collision with self.set() method

log = logging.getLogger(__name__)


class _TTLOrderedDict:
    """Ordered dict with maxsize eviction and TTL expiry."""

    def __init__(self, maxsize: int = 200, ttl: float = 3600):
        self._maxsize = maxsize
        self._ttl = ttl
        self._store: OrderedDict[int, tuple[float, object]] = OrderedDict()

    def _prune(self) -> None:
        now = time.monotonic()
        stale = [k for k, (ts, _) in self._store.items() if now - ts > self._ttl]
        for k in stale:
            del self._store[k]

    def get(self, key: int) -> object | None:
        self._prune()
        item = self._store.get(key)
        if item is None:
            return None
        ts, val = item
        if time.monotonic() - ts > self._ttl:
            del self._store[key]
            return None
        self._store.move_to_end(key)
        return val

    def set(self, key: int, value: object) -> None:
        self._prune()
        self._store[key] = (time.monotonic(), value)
        self._store.move_to_end(key)
        while len(self._store) > self._maxsize:
            self._store.popitem(last=False)

    def pop(self, key: int, default=None) -> object | None:
        item = self._store.pop(key, default)
        if isinstance(item, tuple):
            return item[1]
        return item

    def __contains__(self, key: int) -> bool:
        self._prune()
        return key in self._store

    def __len__(self) -> int:
        self._prune()
        return len(self._store)

    def keys(self) -> Set[int]:  # noqa: UP006 — `set` collides with self.set() method
        self._prune()
        return set(self._store.keys())


class EmotionCache:
    """Per-record emotion state cache. Lives in app.state."""

    def __init__(self, maxsize: int = 200, ttl: float = 3600) -> None:
        self._store = _TTLOrderedDict(maxsize=maxsize, ttl=ttl)

    def get(self, record_id: int) -> object | None:
        return self._store.get(record_id)

    def set(self, record_id: int, state: object) -> None:
        self._store.set(record_id, state)

    def cleanup(self, record_id: int) -> None:
        self._store.pop(record_id, None)

    def cleanup_completed(self, completed_ids: AbstractSet[int]) -> int:
        count = 0
        for rid in completed_ids:
            if self._store.pop(rid, None) is not None:
                count += 1
        if count:
            log.info("Cleaned %d completed emotion cache entries", count)
        return count

    @property
    def all_ids(self) -> AbstractSet[int]:
        return self._store.keys()


class InitiativeCache:
    """Per-record initiative timer cache. Lives in app.state."""

    def __init__(self, maxsize: int = 200, ttl: float = 3600) -> None:
        self._timers = _TTLOrderedDict(maxsize=maxsize, ttl=ttl)
        self._last_triggers = _TTLOrderedDict(maxsize=maxsize, ttl=ttl)

    def update_timer(self, record_id: int, timestamp: float) -> None:
        self._timers.set(record_id, timestamp)
        self._last_triggers.pop(record_id, None)

    def get_timer(self, record_id: int, default: float) -> float:
        val = self._timers.get(record_id)
        if isinstance(val, (int, float)):
            return float(val)
        return default

    def get_last_trigger(self, record_id: int) -> float:
        val = self._last_triggers.get(record_id)
        if isinstance(val, (int, float)):
            return float(val)
        return 0.0

    def set_last_trigger(self, record_id: int, timestamp: float) -> None:
        self._last_triggers.set(record_id, timestamp)

    def cleanup(self, record_id: int) -> None:
        self._timers.pop(record_id, None)
        self._last_triggers.pop(record_id, None)

    def cleanup_completed(self, completed_ids: AbstractSet[int]) -> int:
        count = 0
        for rid in completed_ids:
            t1 = self._timers.pop(rid, None)
            t2 = self._last_triggers.pop(rid, None)
            if t1 is not None or t2 is not None:
                count += 1
        if count:
            log.info("Cleaned %d completed initiative cache entries", count)
        return count

    @property
    def all_ids(self) -> set[int]:
        return set(self._timers.keys()) | set(self._last_triggers.keys())
