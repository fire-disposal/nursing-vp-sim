"""Fingerprint-deduped error buffer with a shared rotating JSONL archive.

后端 ERROR 日志捕获（``diagnose.ErrorCaptureHandler``）与前端遥测
（``telemetry.FrontendErrorBuffer``）此前各写了一份同构机制：窗口内指纹去重、
增量落共享档案、「档案 + 本进程未落盘增量」的窗口计数与签名分组。差异只有**配置**
（路径 / 容量 / 去重窗口 / 消息前缀长度）与**分组投影形状**，故这里收敛为唯一实现：

- :class:`DedupArchiveBuffer` —— 进程内去重缓冲 + 跨 worker 共享档案；
- :func:`aggregate` —— 由事件列表求窗口计数与按指纹分组的 :class:`ErrorGroup`。

使用点各持一份 :class:`BufferConfig`，并各自把 ``ErrorGroup`` 投影成自己的对外形状。
"""

from __future__ import annotations

import hashlib
import logging
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from infra.error_archive import ErrorArchive

log = logging.getLogger(__name__)

DAY_SECONDS = 86400
# 窗口计数一律按「事件发生时间」求，跨 worker。两套外部契约的命名窗口同义：
# m5 / h1 窗口内发生次数，h24 为 24h 内不同错误签名数（total_captured 为历史键名）。
DEFAULT_WINDOWS: tuple[tuple[str, int], ...] = (("last_5min", 300), ("last_hour", 3600))


def fingerprint(*parts: str, message: str, head: int) -> str:
    """错误签名：``parts``（source+type / logger）+ message 前缀（空白归一化）的哈希。"""
    normalized = " ".join(message[:head].split())
    return hashlib.sha256("\0".join((*parts, normalized)).encode()).hexdigest()[:16]


def event_time(event: dict) -> datetime | None:
    """事件发生时间（``time`` 优先，回退 ``last_seen``）；不可解析返回 None。"""
    raw = event.get("time") or event.get("last_seen")
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


@dataclass(frozen=True)
class BufferConfig:
    """一份缓冲的全部可调参数；实现只有一份，两处使用点各持一份配置。"""

    archive_path: str
    archive_max_bytes: int
    archive_backups: int
    max_entries: int
    dedup_window: float
    hash_head: int
    flush_seconds: float = 30.0
    query_limit: int = 1000
    windows: tuple[tuple[str, int], ...] = DEFAULT_WINDOWS

    def open_archive(self) -> ErrorArchive | None:
        """打开共享归档；不可写时返回 None（退化为纯进程内缓冲，留存不能影响业务）。"""
        try:
            return ErrorArchive(self.archive_path, max_bytes=self.archive_max_bytes, backup_count=self.archive_backups)
        except OSError:
            log.exception("Error archive unavailable at %s; keeping process-local buffer only", self.archive_path)
            return None


@dataclass
class DedupEntry:
    """一次去重后的错误签名；``payload`` 是使用点自定义的描述字段。"""

    key: tuple[str, ...]
    fingerprint: str
    first_seen: float
    last_seen: float
    payload: dict[str, Any]
    count: int = 1
    persisted_count: int = 0
    last_persisted: float = 0.0


# 归档事件构造器：``(entry, count, source)`` → 写入档案 / 快照的 dict。
BuildEvent = Callable[["DedupEntry", int, str], dict]


class DedupArchiveBuffer:
    """进程内指纹去重缓冲 + 跨 worker 共享档案（唯一实现）。"""

    def __init__(self, config: BufferConfig, *, archive: ErrorArchive | None, build_event: BuildEvent):
        self.config = config
        self.archive = archive
        self._build_event = build_event
        self.buffer: deque[DedupEntry] = deque(maxlen=config.max_entries)
        self._entries: dict[tuple[str, ...], DedupEntry] = {}

    def _prune(self) -> None:
        live = {id(entry) for entry in self.buffer}
        for key in [k for k, entry in self._entries.items() if id(entry) not in live]:
            del self._entries[key]

    def _persist(self, entry: DedupEntry) -> None:
        delta = entry.count - entry.persisted_count
        if delta <= 0 or self.archive is None:
            return
        try:
            self.archive.append(self._build_event(entry, delta, "archive"))
        except OSError:
            log.warning("Error archive append failed", exc_info=True)
            return
        entry.persisted_count = entry.count
        entry.last_persisted = entry.last_seen

    def record(self, *, key: tuple[str, ...], fingerprint: str, payload: dict[str, Any], now: float) -> DedupEntry:
        """记一次发生：窗口内同 key 合并计数（节流补记增量），否则新建并立即落盘。"""
        entry = self._entries.get(key)
        if entry is not None and now - entry.last_seen <= self.config.dedup_window:
            entry.count += 1
            entry.last_seen = now
            if now - entry.last_persisted >= self.config.flush_seconds:
                self._persist(entry)
            return entry

        entry = DedupEntry(key=key, fingerprint=fingerprint, first_seen=now, last_seen=now, payload=payload)
        self.buffer.append(entry)
        self._entries[key] = entry
        self._prune()
        self._persist(entry)
        return entry

    def unpersisted(self, since: datetime) -> list[dict]:
        """本进程缓冲里尚未落盘、或落盘后又有增长的增量。"""
        cutoff = since.timestamp()
        return [
            self._build_event(entry, entry.count - entry.persisted_count, "memory")
            for entry in self.buffer
            if entry.count > entry.persisted_count and entry.last_seen >= cutoff
        ]

    def merged_events(self, since: datetime) -> list[dict]:
        """「本进程未落盘增量 + 共享档案」的事件并集（跨 worker 口径的唯一来源）。"""
        events = self.unpersisted(since)
        if self.archive is None:
            return events
        try:
            events.extend(self.archive.query(since=since, limit=self.config.query_limit))
        except OSError:
            log.warning("Error archive read failed", exc_info=True)
        return events


@dataclass
class ErrorGroup:
    """按指纹聚合的一组事件；投影成对外形状由使用点负责。"""

    fingerprint: str
    count: int
    first_seen: str
    last_seen: str
    first_event: dict
    latest_event: dict
    events: list[dict] = field(default_factory=list)


@dataclass
class Aggregate:
    counts: dict[str, int]
    groups: dict[str, ErrorGroup]


def aggregate(
    events: list[dict],
    now: datetime,
    *,
    windows: tuple[tuple[str, int], ...] = DEFAULT_WINDOWS,
    fallback_fingerprint=None,
) -> Aggregate:
    """由事件列表求「窗口内发生次数 + 不同签名数」与按指纹分组的明细。

    ``counts`` 的 ``last_5min`` / ``last_hour`` 是窗口内**发生次数**（非组数），
    ``unique_24h`` / ``total_captured`` 是不同签名数（后者为历史键名）。
    """
    counts = dict.fromkeys([name for name, _ in windows], 0)
    groups: dict[str, ErrorGroup] = {}
    for event in events:
        occurrence = event_time(event)
        if occurrence is None:
            continue
        amount = max(1, int(event.get("count", 1) or 1))
        age = (now - occurrence).total_seconds()
        for name, window in windows:
            if age <= window:
                counts[name] += amount

        fingerprint_value = str(event.get("fingerprint") or "")
        if not fingerprint_value and fallback_fingerprint is not None:
            fingerprint_value = fallback_fingerprint(event)
        if not fingerprint_value:
            continue

        first_seen = str(event.get("first_seen") or event.get("time") or "")
        last_seen = str(event.get("last_seen") or event.get("time") or "")
        group = groups.get(fingerprint_value)
        if group is None:
            group = groups[fingerprint_value] = ErrorGroup(
                fingerprint=fingerprint_value,
                count=0,
                first_seen=first_seen,
                last_seen=last_seen,
                first_event=event,
                latest_event=event,
            )
        group.count += amount
        group.events.append(event)
        if first_seen and (not group.first_seen or first_seen < group.first_seen):
            group.first_seen = first_seen
        if last_seen >= group.last_seen:
            group.last_seen = last_seen
            group.latest_event = event

    return Aggregate(
        counts={**counts, "unique_24h": len(groups), "total_captured": len(groups)},
        groups=groups,
    )
