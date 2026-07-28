"""Cross-worker realtime event hub via PostgreSQL LISTEN/NOTIFY.

Architecture
------------
- ``publish()`` delivers locally to same-worker subscribers (fast path),
  then enqueues a PG NOTIFY for cross-worker fan-out.
- ``subscribe()`` creates a local ``asyncio.Queue`` and ensures the per-worker
  PG listener thread is watching that user's channel.
- Dedicated background threads hold sync psycopg connections: one for
  ``LISTEN``/``UNLISTEN``, one for queued ``NOTIFY`` writes.  Incoming payloads
  fan out to local subscriber queues via ``loop.call_soon_threadsafe``.

This replaces the old process-local ``RealtimeHub`` and makes WebSocket event
delivery safe with ``uvicorn --workers N`` (N > 1).
"""

import asyncio
import json
import logging
import queue
import threading
import time
from collections import defaultdict
from typing import Any

import psycopg
from psycopg import sql

from core.config import DATABASE_URL

log = logging.getLogger(__name__)

_CHANNEL_PREFIX = "realtime"
_NOTIFY_QUEUE_SIZE = 1000


def _channel_for(user_id: int) -> str:
    return f"{_CHANNEL_PREFIX}_{user_id}"


def _user_from_channel(channel: str) -> int | None:
    if channel.startswith(f"{_CHANNEL_PREFIX}_"):
        try:
            return int(channel[len(_CHANNEL_PREFIX) + 1 :])
        except ValueError:
            return None
    return None


class PgRealtimeHub:
    """PostgreSQL-backed fan-out of realtime events to a user's active WS connections.

    Thread-safe.  One instance per uvicorn worker.  The listener thread is shared
    across all local subscribers within a single worker process.
    """

    def __init__(self, dsn: str = DATABASE_URL):
        self._dsn = dsn
        self._subscribers: dict[int, list[asyncio.Queue[dict[str, Any]]]] = defaultdict(list)
        self._lock = threading.Lock()
        # Channels the listener thread should be watching.
        self._channels: set[str] = set()
        self._pending_listens: set[str] = set()
        self._pending_unlistens: set[str] = set()
        self._listener_thread: threading.Thread | None = None
        self._notify_thread: threading.Thread | None = None
        self._notify_queue: queue.Queue[tuple[str, str]] = queue.Queue(maxsize=_NOTIFY_QUEUE_SIZE)
        self._notify_dropped = 0
        self._running = False

    # ── public API (preserves old RealtimeHub contract) ──────────────

    async def subscribe(self, user_id: int) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=50)
        channel = _channel_for(user_id)
        with self._lock:
            self._subscribers[user_id].append(queue)
            if channel not in self._channels:
                self._channels.add(channel)
                self._pending_listens.add(channel)
        log.debug(
            "realtime subscriber: user_id=%d channel=%s total=%d", user_id, channel, len(self._subscribers[user_id])
        )
        return queue

    def unsubscribe(self, user_id: int, queue: asyncio.Queue[dict[str, Any]]) -> None:
        channel = _channel_for(user_id)
        with self._lock:
            try:
                self._subscribers[user_id].remove(queue)
                if not self._subscribers[user_id]:
                    del self._subscribers[user_id]
                    # No more local subscribers for this user → UNLISTEN
                    if channel in self._channels:
                        self._channels.discard(channel)
                        self._pending_unlistens.add(channel)
                        self._pending_listens.discard(channel)
            except (ValueError, KeyError):
                pass

    async def publish(self, user_id: int, event_type: str, data: dict[str, Any]) -> None:
        event = {"type": event_type, **data}
        # 1. Local delivery (same worker — fast path, no PG round-trip)
        self._publish_local(user_id, event)
        # 2. Cross-worker delivery via PG NOTIFY.  Queue only: no sync DB I/O
        # on the caller's event loop.
        self._enqueue_remote(user_id, event)

    @property
    def stats(self) -> dict[str, int]:
        """Connection stats for ops diagnostics."""
        with self._lock:
            total = sum(len(qs) for qs in self._subscribers.values())
            return {
                "total_connections": total,
                "unique_users": len(self._subscribers),
                "notify_queue": self._notify_queue.qsize(),
                "notify_dropped": self._notify_dropped,
            }

    # ── lifecycle ───────────────────────────────────────────────────

    def start(self, loop: asyncio.AbstractEventLoop) -> None:
        """Start the background PG listener thread.

        Must be called once per worker during bootstrap.
        """
        if self._running:
            return
        self._running = True
        self._listener_thread = threading.Thread(
            target=self._listen_loop,
            args=(loop,),
            name="pg-realtime-listener",
            daemon=True,
        )
        self._notify_thread = threading.Thread(
            target=self._notify_loop,
            name="pg-realtime-notifier",
            daemon=True,
        )
        self._listener_thread.start()
        self._notify_thread.start()
        log.info("PgRealtimeHub listener/notifier started")

    def stop(self) -> None:
        """Signal background threads to exit and wait briefly for shutdown."""
        self._running = False
        if self._listener_thread and self._listener_thread.is_alive():
            self._listener_thread.join(timeout=3.0)
        if self._notify_thread and self._notify_thread.is_alive():
            self._notify_thread.join(timeout=3.0)
        log.info("PgRealtimeHub listener/notifier stopped")

    # ── internal ────────────────────────────────────────────────────

    def _publish_local(self, user_id: int, event: dict[str, Any]) -> None:
        """Deliver event to all local subscriber queues for *user_id*."""
        with self._lock:
            subscriber_queues = list(self._subscribers.get(user_id, []))
        for subscriber_queue in subscriber_queues:
            try:
                subscriber_queue.put_nowait(event)
            except asyncio.QueueFull:
                try:
                    subscriber_queue.get_nowait()
                    subscriber_queue.put_nowait(event)
                except (asyncio.QueueEmpty, asyncio.QueueFull):
                    log.warning("realtime queue overflow: user_id=%d type=%s", user_id, event.get("type"))

    def _enqueue_remote(self, user_id: int, event: dict[str, Any]) -> None:
        """Queue a PG NOTIFY payload for cross-worker delivery.

        Best-effort by design: local delivery has already succeeded, so a full
        remote queue drops only cross-worker fan-out instead of blocking scoring
        progress or WebSocket handlers.
        """
        channel = _channel_for(user_id)
        payload = json.dumps(event)
        try:
            self._notify_queue.put_nowait((channel, payload))
        except queue.Full:
            with self._lock:
                self._notify_dropped += 1
            log.warning("PG NOTIFY queue full; dropping cross-worker event channel=%s", channel)

    def _publish_remote(self, conn: psycopg.Connection, channel: str, payload: str) -> None:
        """Send a PG NOTIFY through an existing autocommit connection."""
        conn.execute("NOTIFY %s, %s", (channel, payload))

    def _notify_loop(self) -> None:
        """Run in dedicated thread.  Hold a sync psycopg connection and flush
        queued NOTIFY writes without blocking the asyncio event loop.
        """
        conn = None
        while self._running or not self._notify_queue.empty():
            try:
                if conn is None:
                    conn = psycopg.connect(self._dsn, autocommit=True, connect_timeout=10)
                try:
                    channel, payload = self._notify_queue.get(timeout=0.5)
                except queue.Empty:
                    continue
                try:
                    self._publish_remote(conn, channel, payload)
                finally:
                    self._notify_queue.task_done()
            except Exception:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = None
                if self._running:
                    log.debug("PG NOTIFY worker reconnecting after failure", exc_info=True)
                    time.sleep(1)
        if conn:
            try:
                conn.close()
            except Exception:
                pass

    def _listen_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Run in dedicated thread.  Maintain a sync psycopg connection,
        LISTEN on active channels, and fan-out incoming NOTIFY payloads
        to local subscriber queues via the asyncio event loop.
        """
        while self._running:
            conn = None
            try:
                conn = psycopg.connect(
                    self._dsn,
                    autocommit=True,
                    connect_timeout=10,
                    options="-c statement_timeout=0",  # no timeout for LISTEN
                )
                # Re-register all known channels after (re)connect
                with self._lock:
                    for channel in self._channels:
                        conn.execute(sql.SQL("LISTEN {}").format(sql.Identifier(channel)))

                while self._running:
                    # Apply pending listen/unlisten requests
                    self._sync_channels(conn)
                    # Wait for notifications (1s polling interval)
                    for notify in conn.notifies(timeout=1.0):
                        self._dispatch_notify(notify, loop)
            except Exception:
                if self._running:
                    log.warning("PG listener disconnected, reconnecting in 1s", exc_info=True)
                    time.sleep(1)
            finally:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass

    def _sync_channels(self, conn: psycopg.Connection) -> None:
        """Apply any queued LISTEN/UNLISTEN commands on the live connection."""
        with self._lock:
            pending_add = self._pending_listens.copy()
            self._pending_listens.clear()
            pending_del = self._pending_unlistens.copy()
            self._pending_unlistens.clear()

        for channel in pending_add:
            try:
                conn.execute(sql.SQL("LISTEN {}").format(sql.Identifier(channel)))
            except Exception:
                log.debug("LISTEN failed: channel=%s", channel, exc_info=True)
        for channel in pending_del:
            try:
                conn.execute(sql.SQL("UNLISTEN {}").format(sql.Identifier(channel)))
            except Exception:
                log.debug("UNLISTEN failed: channel=%s", channel, exc_info=True)

    def _dispatch_notify(self, notify: psycopg.Notify, loop: asyncio.AbstractEventLoop) -> None:
        """Parse a PG NOTIFY payload and fan out to local subscriber queues."""
        user_id = _user_from_channel(notify.channel)
        if user_id is None:
            return
        try:
            event: dict[str, Any] = json.loads(notify.payload)
        except (json.JSONDecodeError, TypeError):
            log.debug("Invalid NOTIFY payload on channel=%s", notify.channel)
            return
        loop.call_soon_threadsafe(self._publish_local, user_id, event)


# Backwards-compatible alias so existing imports work unmodified.
RealtimeHub = PgRealtimeHub
