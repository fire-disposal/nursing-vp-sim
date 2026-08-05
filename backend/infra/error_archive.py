"""Bounded JSONL archive for diagnostic error events.

The archive is deliberately small and append-only. It survives process restarts,
rotates at a hard size limit, and only exposes bounded time-window queries for
machine diagnostics.
"""

from __future__ import annotations

import json
import threading
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


class ErrorArchive:
    def __init__(self, path: str, *, max_bytes: int = 10 * 1024 * 1024, backup_count: int = 3) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._writer = RotatingFileHandler(
            self.path,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
            delay=True,
        )
        self._lock = threading.Lock()

    def append(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":"), default=str) + "\n"
        with self._lock:
            stream = self._writer._open() if self._writer.stream is None else self._writer.stream
            self._writer.stream = stream
            stream.seek(0, 2)
            if self._writer.maxBytes > 0 and stream.tell() + len(line.encode("utf-8")) >= self._writer.maxBytes:
                self._writer.doRollover()
                stream = self._writer._open()
                self._writer.stream = stream
            stream.write(line)
            stream.flush()

    def query(
        self,
        *,
        start: datetime,
        end: datetime,
        max_events: int = 500,
    ) -> list[dict[str, Any]]:
        """Read recent events in the requested window, newest first."""
        start = _as_utc(start)
        end = _as_utc(end)
        events: list[dict[str, Any]] = []

        for path in self._paths_newest_first():
            if not path.exists():
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in reversed(lines):
                try:
                    event = json.loads(line)
                    timestamp = _parse_time(event.get("time"))
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
                if timestamp > end:
                    continue
                if timestamp < start:
                    break
                events.append(event)
                if len(events) >= max_events:
                    return events
        return events

    def close(self) -> None:
        with self._lock:
            self._writer.close()

    def _paths_newest_first(self) -> list[Path]:
        return [self.path, *(Path(f"{self.path}.{index}") for index in range(1, self._writer.backupCount + 1))]


def _parse_time(value: Any) -> datetime:
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return _as_utc(parsed)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
