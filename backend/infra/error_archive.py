"""Small rotating JSONL archive for ERROR+ diagnostic events."""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any


class ErrorArchive:
    """Append-only error archive with a hard disk-size ceiling."""

    def __init__(self, path: str, *, max_bytes: int, backup_count: int) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handler = RotatingFileHandler(
            self.path,
            maxBytes=max_bytes,
            backupCount=backup_count,
            encoding="utf-8",
            delay=True,
        )
        self._handler.setFormatter(logging.Formatter("%(message)s"))

    def append(self, event: dict[str, Any]) -> None:
        line = json.dumps(event, ensure_ascii=False, separators=(",", ":"), default=str)
        record = logging.LogRecord("diagnostic.archive", logging.INFO, "", 0, line, (), None)
        self._handler.emit(record)

    def query(self, *, since: datetime, limit: int = 1000) -> list[dict[str, Any]]:
        """Return events newer than ``since``, newest first, with a hard row limit."""
        since = _as_utc(since)
        result: list[dict[str, Any]] = []
        paths = [self.path, *(Path(f"{self.path}.{i}") for i in range(1, self._handler.backupCount + 1))]

        for path in paths:
            if not path.exists():
                continue
            try:
                lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
            except OSError:
                continue
            for line in reversed(lines):
                try:
                    event = json.loads(line)
                    event_time = _parse_time(event.get("time"))
                except (json.JSONDecodeError, TypeError, ValueError):
                    continue
                if event_time < since:
                    break
                result.append(event)
                if len(result) >= limit:
                    return result
        return result

    def close(self) -> None:
        self._handler.close()


def _parse_time(value: Any) -> datetime:
    return _as_utc(datetime.fromisoformat(str(value).replace("Z", "+00:00")))


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)
