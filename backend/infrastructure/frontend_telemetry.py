"""In-memory ring buffer for frontend error telemetry.

Same pattern as ``ErrorCaptureHandler`` in ``infrastructure/diagnose.py``:
deduplicated ring buffer, zero disk IO, queryable via ops dashboard.

Payload ~200 bytes per error, delivered via ``navigator.sendBeacon``.
"""

import time
from collections import deque
from dataclasses import dataclass
from datetime import UTC, datetime

_MAX_ERRORS = 2000
_DEDUP_WINDOW = 300  # 5 分钟去重窗口
_DEDUP_HASH_HEAD = 120  # 去重 message 取前 N 字符
_RECENT_N = 20
_MSG_MAX = 1000  # 单条错误消息最大字符数


@dataclass
class FrontendErrorEntry:
    time: str  # ISO 8601
    error_type: str  # AbortError, TypeError, NetworkError, ...
    message: str  # 用户可见消息
    url: str = ""  # 触发页面或 API 路径
    user_id: int = 0  # 0 = 未登录
    ua: str = ""  # 浏览器 UA 摘要
    count: int = 1  # 去重合并计数
    timestamp: float = 0.0


class FrontendErrorBuffer:
    """线程安全的内存环缓冲。"""

    def __init__(self):
        self.buffer: deque[FrontendErrorEntry] = deque(maxlen=_MAX_ERRORS)
        self._dedup: dict[tuple[str, str], tuple[float, int]] = {}

    def _dedup_key(self, error_type: str, message: str) -> tuple[str, str]:
        return (error_type, message[:_DEDUP_HASH_HEAD])

    def _prune_dedup(self, now: float) -> None:
        stale = [k for k, (ts, _) in self._dedup.items() if now - ts > _DEDUP_WINDOW]
        for k in stale:
            del self._dedup[k]

    def ingest(self, *entries: dict) -> None:
        """Ingest one or more error dicts from the telemetry endpoint."""
        now = time.time()
        self._prune_dedup(now)
        for e in entries:
            error_type = str(e.get("type", "") or "")[:_MSG_MAX]
            message = str(e.get("message", "") or "")[:_MSG_MAX]
            url = str(e.get("url", "") or "")[:500]
            user_id = int(e.get("user_id", 0) or 0)
            ua = str(e.get("ua", "") or "")[:200]

            key = self._dedup_key(error_type, message)
            if key in self._dedup:
                _, count = self._dedup[key]
                self._dedup[key] = (now, count + 1)
                # 更新 buffer 中对应条目的 count（找最近一条同 key 的）
                for entry in reversed(self.buffer):
                    if (
                        entry.error_type == error_type
                        and entry.message[:_DEDUP_HASH_HEAD] == message[:_DEDUP_HASH_HEAD]
                    ):
                        entry.count = count + 1
                        entry.timestamp = now
                        break
                continue
            self._dedup[key] = (now, 1)
            self.buffer.append(
                FrontendErrorEntry(
                    time=datetime.now(UTC).isoformat(),
                    error_type=error_type,
                    message=message,
                    url=url,
                    user_id=user_id,
                    ua=ua,
                    timestamp=now,
                )
            )

    def get_recent(self, n: int = _RECENT_N) -> list[dict]:
        entries = list(self.buffer)[-n:]
        return [
            {
                "time": e.time,
                "type": e.error_type,
                "message": e.message,
                "url": e.url,
                "user_id": e.user_id,
                "count": e.count,
            }
            for e in entries
        ]

    @property
    def error_count_last_hour(self) -> int:
        cutoff = time.time() - 3600
        return sum(e.count for e in self.buffer if e.timestamp >= cutoff)

    @property
    def error_count_last_5min(self) -> int:
        cutoff = time.time() - 300
        return sum(e.count for e in self.buffer if e.timestamp >= cutoff)

    @property
    def total_captured(self) -> int:
        return len(self.buffer)

    def snapshot(self) -> dict:
        return {
            "last_5min": self.error_count_last_5min,
            "last_hour": self.error_count_last_hour,
            "total_captured": self.total_captured,
            "recent": self.get_recent(),
        }
