"""Volcengine BigASR (SAUC) v3 streaming client — WebSocket.

A thin per-session wrapper around an upstream WebSocket connection. The ASR
router opens one client per browser connection and pumps audio in / text out.
All failures are surfaced as :class:`ASRError` so the caller can degrade.
"""

import logging
from typing import TYPE_CHECKING

import websockets

from infrastructure.asr.fallback import asr_configured
from infrastructure.asr.protocol import (
    ServerResponse,
    build_audio_request,
    build_full_client_request,
    default_full_client_request,
    parse_server_response,
)
from infrastructure.volc.auth import VOLC_WS_BASE_URL, asr_headers

if TYPE_CHECKING:
    from websockets.asyncio.client import ClientConnection

log = logging.getLogger(__name__)


class ASRError(Exception):
    pass


class VolcASRClient:
    def __init__(
        self,
        api_key: str,
        resource_id: str = "volc.bigasr.sauc.duration",
        endpoint_mode: str = "bigmodel_nostream",
        sample_rate: int = 16000,
        connect_timeout: int = 8,
    ):
        self._api_key = api_key
        self._resource_id = resource_id
        self._endpoint_mode = endpoint_mode
        self._sample_rate = sample_rate
        self._connect_timeout = connect_timeout
        self._ws: ClientConnection | None = None

    @property
    def url(self) -> str:
        return f"{VOLC_WS_BASE_URL}/api/v3/sauc/{self._endpoint_mode}"

    def is_configured(self) -> bool:
        return asr_configured(self._api_key, self._resource_id)

    async def connect(self) -> None:
        """Open the upstream WS and send the full-client-request config frame."""
        if not self.is_configured():
            raise ASRError("ASR not configured (missing api_key or resource_id)")
        try:
            self._ws = await websockets.connect(
                self.url,
                additional_headers=asr_headers(self._api_key, self._resource_id),
                open_timeout=self._connect_timeout,
                max_size=None,
            )
        except Exception as e:  # any connect failure must degrade gracefully
            raise ASRError(f"ASR connect failed: {e}") from e

        config = default_full_client_request(sample_rate=self._sample_rate)
        await self._ws.send(build_full_client_request(config))

    async def send_audio(self, chunk: bytes, is_last: bool = False) -> None:
        if self._ws is None:
            raise ASRError("ASR session not connected")
        await self._ws.send(build_audio_request(chunk, is_last=is_last))

    async def recv(self) -> ServerResponse | None:
        """Receive and decode one server frame. Returns None when the stream ends."""
        if self._ws is None:
            raise ASRError("ASR session not connected")
        try:
            raw = await self._ws.recv()
        except websockets.ConnectionClosedOK:
            return None
        except websockets.ConnectionClosed as e:
            raise ASRError(f"ASR connection closed: {e}") from e
        if isinstance(raw, str):
            raw = raw.encode("utf-8")
        resp = parse_server_response(raw)
        if resp.is_error:
            log.error("ASR error frame: code=%s payload=%s", resp.code, resp.payload)
        return resp

    async def close(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
            self._ws = None

    async def health_check(self) -> bool:
        """Probe upstream connectivity: connect, then close. No audio sent."""
        try:
            await self.connect()
            await self.close()
            return True
        except Exception:
            log.warning("ASR health check failed", exc_info=True)
            await self.close()
            return False
