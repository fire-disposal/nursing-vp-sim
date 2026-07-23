"""TTS Connection Pool — warm Volcengine WebSocket connections.

The v3 bidirectional protocol is designed for long-lived connections carrying
many sequential sessions. This pool keeps a small number of warm connections
so per-sentence synthesis never pays the handshake + StartConnection cost.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from infrastructure.tts.client import VolcTTSConnection

log = logging.getLogger(__name__)

# Connections idle longer than this are ping-validated before reuse.
_IDLE_PING_SECONDS = 30.0
_PING_TIMEOUT = 2.0


class TTSConnectionPool:
    def __init__(self, api_key: str, resource_id: str, size: int = 4):
        self._api_key = api_key
        self._resource_id = resource_id
        self._size = size
        self._idle: asyncio.Queue[VolcTTSConnection] = asyncio.Queue()
        self._total = 0
        self._closed = False
        self._lock = asyncio.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None

    @property
    def stats(self) -> dict:
        """Pool occupancy snapshot for admin status display."""
        idle = self._idle.qsize()
        return {
            "size": self._size,
            "total": self._total,
            "idle": idle,
            "in_use": max(0, self._total - idle),
        }

    async def _new_connection(self) -> VolcTTSConnection:
        conn = VolcTTSConnection(api_key=self._api_key, resource_id=self._resource_id)
        await conn.connect()
        self._total += 1
        return conn

    async def _validate(self, conn: VolcTTSConnection) -> VolcTTSConnection | None:
        """Return conn if usable, else close+discard and return None."""
        if not conn.is_alive:
            return None
        if time.monotonic() - conn.last_used_at > _IDLE_PING_SECONDS:
            try:
                await asyncio.wait_for(conn.ping(), timeout=_PING_TIMEOUT)
            except Exception:
                log.info("TTS pool: idle connection failed ping, discarding")
                return None
        return conn

    async def _discard(self, conn: VolcTTSConnection) -> None:
        self._total -= 1
        try:
            await conn.close()
        except Exception:
            pass

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[VolcTTSConnection]:
        if self._closed:
            raise RuntimeError("TTS pool is closed")
        self._loop = asyncio.get_running_loop()

        conn: VolcTTSConnection | None = None
        async with self._lock:
            while conn is None:
                try:
                    candidate = self._idle.get_nowait()
                except asyncio.QueueEmpty:
                    if self._total < self._size:
                        conn = await self._new_connection()
                        break
                    candidate = await self._idle.get()
                if candidate.is_alive:
                    conn = candidate
                else:
                    await self._discard(candidate)

        assert conn is not None
        if (await self._validate(conn)) is None:
            await self._discard(conn)
            # Retry once with a fresh connection.
            async with self._lock:
                conn = await self._new_connection()
        try:
            yield conn
        finally:
            if self._closed or not conn.is_alive:
                await self._discard(conn)
            else:
                conn.last_used_at = time.monotonic()
                self._idle.put_nowait(conn)

    async def aclose(self) -> None:
        self._closed = True
        while True:
            try:
                conn = self._idle.get_nowait()
            except asyncio.QueueEmpty:
                break
            try:
                await conn.close()
            except Exception:
                pass
        self._total = 0

    def close_sync(self) -> None:
        """Best-effort close from sync contexts (config reload)."""
        self._closed = True
        loop = self._loop
        while True:
            try:
                conn = self._idle.get_nowait()
            except asyncio.QueueEmpty:
                break
            if loop is not None and loop.is_running():
                asyncio.run_coroutine_threadsafe(conn.close(), loop)
        self._total = 0
