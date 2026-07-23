"""Volcengine SeedTTS 2.0 (doubao) TTS client — v3 bidirectional WebSocket protocol.

Connection lifecycle (StartConnection … FinishConnection) is separated from
session lifecycle (StartSession … SessionFinished) so one warm WebSocket can
carry many sequential synthesis sessions — the protocol's intended pattern.
"""

from __future__ import annotations

import asyncio
import json
import logging
import struct
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from enum import IntEnum
from typing import TYPE_CHECKING

import websockets

if TYPE_CHECKING:
    from websockets.asyncio.client import ClientConnection

log = logging.getLogger(__name__)

TTS_WS_URL = "wss://openspeech.bytedance.com/api/v3/tts/bidirection"

HEADER_STRUCT = struct.Struct(">I")


class EventType(IntEnum):
    StartConnection = 1
    StartSession = 2
    TaskRequest = 3
    CancelSession = 4
    FinishSession = 5
    FinishConnection = 6


class ServerEvent(IntEnum):
    ConnectionStarted = 50
    SessionStarted = 51
    TTSSentenceStart = 52
    TTSResponse = 53
    TTSSentenceEnd = 54
    TTSSubtitle = 55
    SessionFinished = 56
    ConnectionFinished = 57
    SessionCanceled = 58
    ConnectionFailed = 59
    SessionFailed = 60


class MsgType(IntEnum):
    FullServerResponse = 1
    AudioOnlyServer = 2


@dataclass
class ServerMessage:
    type: MsgType
    event: ServerEvent | None = None
    payload: bytes | dict | None = None


@dataclass
class TTSRequest:
    text: str
    speaker: str = "zh_female_vv_uranus_bigtts"
    speech_rate: int = 0
    loudness_rate: int = 0
    fmt: str = "mp3"
    sample_rate: int = 24000


def _build_frame(header: dict, payload: bytes = b"") -> bytes:
    header_bytes = json.dumps(header, ensure_ascii=False).encode()
    return HEADER_STRUCT.pack(len(header_bytes)) + header_bytes + payload


async def _read_frame(ws: ClientConnection) -> ServerMessage:
    raw = await ws.recv()
    if isinstance(raw, str):
        return _parse_server_message(json.loads(raw), b"")
    if not isinstance(raw, bytes):
        raise TypeError("TTS: expected text or binary frame")

    # Find the JSON object by scanning for '{'
    for start in range(min(len(raw), 16)):
        if raw[start : start + 1] != b"{":
            continue
        for end in range(len(raw), start, -1):
            try:
                header = json.loads(raw[start:end].decode())
                payload = raw[end:]
                return _parse_server_message(header, payload)
            except (UnicodeDecodeError, json.JSONDecodeError):
                continue
    raise RuntimeError(f"TTS: cannot decode binary frame ({len(raw)} bytes)")


def _parse_server_message(header: dict, payload: bytes) -> ServerMessage:
    msg_type = _parse_msg_type(header.get("type"))
    event = _parse_server_event(header.get("event"))
    if msg_type == MsgType.AudioOnlyServer:
        return ServerMessage(type=msg_type, event=event, payload=payload)
    return ServerMessage(type=msg_type, event=event, payload=header.get("payload"))


def _parse_msg_type(raw: str | int | None) -> MsgType:
    if raw is None:
        return MsgType.FullServerResponse
    if isinstance(raw, str):
        return {"FullServerResponse": MsgType.FullServerResponse, "AudioOnlyServer": MsgType.AudioOnlyServer}.get(
            raw, MsgType.FullServerResponse
        )
    return MsgType(raw)


_EVENT_MAP: dict[str, ServerEvent] = {
    "ConnectionStarted": ServerEvent.ConnectionStarted,
    "SessionStarted": ServerEvent.SessionStarted,
    "TTSSentenceStart": ServerEvent.TTSSentenceStart,
    "TTSResponse": ServerEvent.TTSResponse,
    "TTSSentenceEnd": ServerEvent.TTSSentenceEnd,
    "TTSSubtitle": ServerEvent.TTSSubtitle,
    "SessionFinished": ServerEvent.SessionFinished,
    "ConnectionFinished": ServerEvent.ConnectionFinished,
    "SessionCanceled": ServerEvent.SessionCanceled,
    "ConnectionFailed": ServerEvent.ConnectionFailed,
    "SessionFailed": ServerEvent.SessionFailed,
}


def _parse_server_event(raw: str | int | None) -> ServerEvent | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        return _EVENT_MAP.get(raw)
    try:
        return ServerEvent(raw)
    except ValueError:
        return None


def _is_closed_error(e: BaseException) -> bool:
    return isinstance(e, (websockets.exceptions.ConnectionClosed, ConnectionError, OSError))


class VolcTTSConnection:
    """One warm WebSocket connection carrying sequential TTS sessions."""

    def __init__(self, api_key: str, resource_id: str = "seed-tts-2.0"):
        self._api_key = api_key
        self._resource_id = resource_id
        self._ws: ClientConnection | None = None
        self._session_id: str | None = None
        self.last_usage: dict | None = None
        self.last_used_at: float = 0.0

    @property
    def is_alive(self) -> bool:
        ws = self._ws
        if ws is None:
            return False
        try:
            from websockets.protocol import State

            return ws.state is State.OPEN
        except Exception:
            return False

    def _require_ws(self) -> ClientConnection:
        if self._ws is None or not self.is_alive:
            raise RuntimeError("TTS connection not established")
        return self._ws

    async def connect(self) -> None:
        headers = {
            "X-Api-Key": self._api_key,
            "X-Api-Resource-Id": self._resource_id,
            "X-Api-Connect-Id": uuid.uuid4().hex,
            "X-Control-Require-Usage-Tokens-Return": "*",
        }
        try:
            ws = await websockets.connect(
                TTS_WS_URL,
                additional_headers=headers,
                max_size=10 * 1024 * 1024,
                open_timeout=10,
            )
        except Exception as e:
            raise RuntimeError(f"TTS WebSocket 连接失败: {e}") from e
        self._ws = ws
        try:
            await self._send({"event": EventType.StartConnection})
            await self._wait_event(ServerEvent.ConnectionStarted)
        except Exception:
            await self._force_close()
            raise

    async def ping(self) -> None:
        """Protocol-level keepalive used by the pool to validate idle connections."""
        ws = self._require_ws()
        await ws.ping()

    async def begin_session(self, req: TTSRequest) -> None:
        """Open a session, send the full text, and close the send side."""
        self._require_ws()
        session_id = uuid.uuid4().hex
        self._session_id = session_id
        self.last_usage = None
        body = {
            "event": EventType.StartSession,
            "req_params": {
                "speaker": req.speaker,
                "audio_params": {
                    "format": req.fmt,
                    "sample_rate": req.sample_rate,
                    "speech_rate": req.speech_rate,
                    "loudness_rate": req.loudness_rate,
                },
            },
        }
        try:
            await self._send(
                {"event": EventType.StartSession, "session_id": session_id},
                json.dumps(body, ensure_ascii=False).encode(),
            )
            await self._wait_event(ServerEvent.SessionStarted)
            task_body = {
                "event": EventType.TaskRequest,
                "req_params": {"text": req.text},
            }
            await self._send(
                {"event": EventType.TaskRequest, "session_id": session_id},
                json.dumps(task_body, ensure_ascii=False).encode(),
            )
            await self._send({"event": EventType.FinishSession, "session_id": session_id})
        except Exception as e:
            if _is_closed_error(e):
                await self._force_close()
            raise

    async def read_stream(self) -> AsyncIterator[bytes]:
        """Yield audio chunks until SessionFinished; capture usage on exit."""
        ws = self._require_ws()
        try:
            while True:
                msg = await _read_frame(ws)
                if msg.type == MsgType.FullServerResponse:
                    if msg.event == ServerEvent.SessionFinished:
                        if isinstance(msg.payload, dict):
                            usage = msg.payload.get("usage")
                            self.last_usage = usage if isinstance(usage, dict) else None
                        break
                    if msg.event in (ServerEvent.ConnectionFailed, ServerEvent.SessionFailed):
                        err = msg.payload or {}
                        raise RuntimeError(f"TTS failed: {json.dumps(err, ensure_ascii=False)[:300]}")
                elif msg.type == MsgType.AudioOnlyServer:
                    if msg.payload:
                        yield bytes(msg.payload)
        except Exception as e:
            if _is_closed_error(e):
                await self._force_close()
            raise
        finally:
            self._session_id = None
            self.last_used_at = time.monotonic()

    async def abort(self) -> None:
        """Force-close without protocol handshake (mid-session cancellation).

        A connection whose session was interrupted has unread frames in
        flight and must never be reused — the pool discards dead connections.
        """
        await self._force_close()

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is None:
            return
        try:
            await ws.send(_build_frame({"event": EventType.FinishConnection}))
            await self._wait_event(ServerEvent.ConnectionFinished, ws=ws)
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass

    async def _force_close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass

    async def _send(self, header: dict, payload: bytes = b"") -> None:
        ws = self._require_ws()
        await ws.send(_build_frame(header, payload))

    async def _wait_event(self, event: ServerEvent, ws: ClientConnection | None = None) -> ServerMessage:
        target = ws or self._require_ws()
        msg = await _read_frame(target)
        if msg.type == MsgType.FullServerResponse and msg.event in (
            ServerEvent.ConnectionFailed,
            ServerEvent.SessionFailed,
        ):
            err = msg.payload or {}
            raise RuntimeError(f"TTS connection failed: {json.dumps(err, ensure_ascii=False)[:300]}")
        if msg.type != MsgType.FullServerResponse or msg.event != event:
            raise RuntimeError(f"TTS protocol error: expected {event.name}, got {msg.event}")
        return msg


class VolcBidirectionalTTSClient:
    """Compat wrapper: one-shot synthesis over a throwaway connection.

    Kept for admin health-check / test-synthesize paths which must not touch
    the shared connection pool.
    """

    def __init__(
        self,
        api_key: str,
        resource_id: str = "seed-tts-2.0",
        timeout: int = 8,
    ):
        self._api_key = api_key
        self._resource_id = resource_id
        self._timeout = timeout

    async def synthesize(self, req: TTSRequest) -> bytes:
        conn = VolcTTSConnection(api_key=self._api_key, resource_id=self._resource_id)

        async def _run() -> bytes:
            await conn.connect()
            await conn.begin_session(req)
            audio = bytearray()
            async for chunk in conn.read_stream():
                audio.extend(chunk)
            if not audio:
                raise RuntimeError("TTS returned empty audio data")
            return bytes(audio)

        try:
            return await asyncio.wait_for(_run(), timeout=self._timeout)
        except TimeoutError:
            raise RuntimeError(f"TTS 合成超时（{self._timeout}s）")
        finally:
            await conn.close()

    async def health_check(self, speaker: str | None = None) -> bool:
        try:
            req = TTSRequest(text="测试")
            if speaker:
                req.speaker = speaker
            audio = await self.synthesize(req)
            return len(audio) > 0
        except Exception:
            log.warning("TTS health check failed", exc_info=True)
            return False

    async def close(self) -> None:
        pass
