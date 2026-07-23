"""Volcengine SeedTTS 2.0 (doubao) TTS client — v3 bidirectional binary protocol.

Uses the official binary frame format (bit-packed header with version/msg_type/
flags/serialization/compression) and single X-Api-Key auth (new console v3).
"""

from __future__ import annotations

import asyncio
import io
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


# ── Binary protocol constants ──


class MsgType(IntEnum):
    FullClientRequest = 0b0001
    FullServerResponse = 0b1001
    AudioOnlyServer = 0b1011
    Error = 0b1111


class MsgFlag(IntEnum):
    NoSeq = 0
    WithEvent = 0b100


class EventType(IntEnum):
    StartConnection = 1
    FinishConnection = 2
    ConnectionStarted = 50
    ConnectionFailed = 51
    ConnectionFinished = 52
    StartSession = 100
    SessionStarted = 150
    SessionFinished = 152
    SessionFailed = 153
    TaskRequest = 200
    TTSSentenceStart = 350
    TTSSentenceEnd = 351
    TTSResponse = 352


_SERIALIZATION_JSON = 0b0001
_COMPRESSION_NONE = 0
_VERSION = 1
_HEADER_SIZE = 4  # 4 × 4 = 16-byte header

_HEADER_BASE = bytes(
    [
        (_VERSION << 4) | _HEADER_SIZE,
        0,
        (_SERIALIZATION_JSON << 4) | _COMPRESSION_NONE,
    ]
).ljust(_HEADER_SIZE * 4, b"\x00")


def _marshal(msg_type: MsgType, flag: MsgFlag, body: bytes, /) -> bytes:
    hdr = bytearray(_HEADER_BASE)
    hdr[1] = (msg_type << 4) | flag
    return bytes(hdr) + body


def _write_event(e: EventType) -> bytes:
    return struct.pack(">i", e)


def _write_str(s: str) -> bytes:
    b = s.encode("utf-8")
    return struct.pack(">I", len(b)) + b


def _write_payload(b: bytes) -> bytes:
    return struct.pack(">I", len(b)) + b


def _read_event(buf: io.BytesIO) -> EventType | None:
    raw = buf.read(4)
    if len(raw) < 4:
        return None
    return EventType(struct.unpack(">i", raw)[0])


def _read_str(buf: io.BytesIO) -> str:
    raw = buf.read(4)
    if len(raw) < 4:
        return ""
    size = struct.unpack(">I", raw)[0]
    if size == 0:
        return ""
    return buf.read(size).decode("utf-8")


def _read_payload(buf: io.BytesIO) -> bytes:
    raw = buf.read(4)
    if len(raw) < 4:
        return b""
    size = struct.unpack(">I", raw)[0]
    if size == 0:
        return b""
    return buf.read(size)


# ── Frame build / parse ──


@dataclass
class ServerMessage:
    type: MsgType
    event: EventType | None = None
    payload: bytes | dict | None = None


def _parse_server_response(data: bytes) -> ServerMessage:
    """Parse a v3 binary server frame."""
    if len(data) < _HEADER_SIZE * 4:
        raise RuntimeError(f"TTS: frame too short ({len(data)} bytes)")

    msg_type = MsgType((data[1] >> 4) & 0xF)
    flag = MsgFlag(data[1] & 0xF)
    buf = io.BytesIO(data[_HEADER_SIZE * 4 :])

    event: EventType | None = None
    session_id: str = ""
    connect_id: str = ""

    if flag == MsgFlag.WithEvent:
        event = _read_event(buf)
        # Connection-level events skip session_id, include connect_id.
        is_connection_event = event in (
            EventType.ConnectionStarted,
            EventType.ConnectionFailed,
            EventType.ConnectionFinished,
        )
        if not is_connection_event:
            session_id = _read_str(buf)
        if event in (
            EventType.ConnectionStarted,
            EventType.ConnectionFailed,
            EventType.ConnectionFinished,
        ):
            connect_id = _read_str(buf)

    if msg_type in (MsgType.AudioOnlyServer,):
        payload = _read_payload(buf) or b""
        return ServerMessage(type=msg_type, event=event, payload=payload)

    payload_raw = _read_payload(buf)
    payload: bytes | dict = payload_raw
    if payload_raw and _SERIALIZATION_JSON:
        try:
            payload = json.loads(payload_raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            pass

    return ServerMessage(type=msg_type, event=event, payload=payload)


async def _read_server_message(ws: ClientConnection) -> ServerMessage:
    raw = await ws.recv()
    if isinstance(raw, str):
        return _parse_server_response(raw.encode("utf-8"))
    if isinstance(raw, bytes):
        return _parse_server_response(raw)
    raise TypeError(f"TTS: unexpected frame type {type(raw)}")


# ── Request helpers ──


@dataclass
class TTSRequest:
    text: str
    speaker: str = "zh_female_vv_uranus_bigtts"
    speech_rate: int = 0
    loudness_rate: int = 0
    fmt: str = "mp3"
    sample_rate: int = 24000


def _build_start_connection() -> bytes:
    """StartConnection — event-only, payload = {}"""
    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.StartConnection) + _write_payload(b"{}"),
    )


def _build_finish_connection() -> bytes:
    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.FinishConnection) + _write_payload(b"{}"),
    )


def _build_start_session(req: TTSRequest, session_id: str) -> bytes:
    body_json = json.dumps(
        {
            "event": EventType.StartSession,
            "user": {"uid": str(uuid.uuid4())},
            "namespace": "BidirectionalTTS",
            "req_params": {
                "speaker": req.speaker,
                "audio_params": {
                    "format": req.fmt,
                    "sample_rate": req.sample_rate,
                    "speech_rate": req.speech_rate,
                    "loudness_rate": req.loudness_rate,
                },
                "additions": json.dumps({"disable_markdown_filter": False}),
            },
        },
        ensure_ascii=False,
    ).encode("utf-8")

    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.StartSession)
        + _write_str(session_id)
        + _write_payload(body_json),
    )


def _build_task_request(text: str, session_id: str) -> bytes:
    body_json = json.dumps(
        {
            "event": EventType.TaskRequest,
            "user": {"uid": str(uuid.uuid4())},
            "namespace": "BidirectionalTTS",
            "req_params": {"text": text},
        },
        ensure_ascii=False,
    ).encode("utf-8")

    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.TaskRequest)
        + _write_str(session_id)
        + _write_payload(body_json),
    )


def _build_finish_session(session_id: str) -> bytes:
    return _marshal(
        MsgType.FullClientRequest,
        MsgFlag.WithEvent,
        _write_event(EventType.FinishSession)
        + _write_str(session_id)
        + _write_payload(b"{}"),
    )


# ── Connection ──


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
            await ws.send(_build_start_connection())
            await self._read_and_expect(EventType.ConnectionStarted)
        except Exception:
            await self._force_close()
            raise

    async def ping(self) -> None:
        ws = self._require_ws()
        await ws.ping()

    async def begin_session(self, req: TTSRequest) -> None:
        self._require_ws()
        session_id = uuid.uuid4().hex
        self._session_id = session_id
        self.last_usage = None
        try:
            await self._send(_build_start_session(req, session_id))
            await self._read_and_expect(EventType.SessionStarted)
            await self._send(_build_task_request(req.text, session_id))
            await self._send(_build_finish_session(session_id))
        except Exception:
            await self._force_close()
            raise

    async def read_stream(self) -> AsyncIterator[bytes]:
        ws = self._require_ws()
        try:
            while True:
                msg = await _read_server_message(ws)
                if msg.type == MsgType.FullServerResponse:
                    if msg.event == EventType.SessionFinished:
                        if isinstance(msg.payload, dict):
                            usage = msg.payload.get("usage")
                            self.last_usage = usage if isinstance(usage, dict) else None
                        break
                    if msg.event in (EventType.ConnectionFailed, EventType.SessionFailed):
                        err = msg.payload or {}
                        raise RuntimeError(f"TTS failed: {json.dumps(err, ensure_ascii=False)[:300]}")
                elif msg.type == MsgType.AudioOnlyServer:
                    p = msg.payload
                    if isinstance(p, bytes) and p:
                        yield p
        finally:
            self._session_id = None
            self.last_used_at = time.monotonic()

    async def abort(self) -> None:
        await self._force_close()

    async def close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is None:
            return
        try:
            await ws.send(_build_finish_connection())
            ws_ref = ws
            try:
                msg = await _read_server_message(ws_ref)
                if msg.type == MsgType.FullServerResponse and msg.event not in (
                    EventType.ConnectionFailed,
                    EventType.SessionFailed,
                ):
                    pass
            except Exception:
                pass
        except Exception:
            pass
        try:
            await ws.close()
        except Exception:
            pass

    async def _send(self, frame: bytes) -> None:
        await self._require_ws().send(frame)

    async def _read_and_expect(self, event: EventType) -> ServerMessage:
        msg = await _read_server_message(self._require_ws())
        if msg.type == MsgType.FullServerResponse and msg.event in (
            EventType.ConnectionFailed,
            EventType.SessionFailed,
        ):
            err = msg.payload or {}
            raise RuntimeError(f"TTS failed: {json.dumps(err, ensure_ascii=False)[:300]}")
        return msg

    async def _force_close(self) -> None:
        ws, self._ws = self._ws, None
        if ws is not None:
            try:
                await ws.close()
            except Exception:
                pass


# ── One-shot compat client (admin health-check / test-synthesize) ──


class VolcBidirectionalTTSClient:
    """Compat wrapper: one-shot synthesis over a throwaway connection."""

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
        conn = VolcTTSConnection(
            api_key=self._api_key,
            resource_id=self._resource_id,
        )

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
        except Exception as e:
            cause = e.__cause__
            is_auth = False
            if cause is not None and "401" in str(cause):
                is_auth = True
            if "401" in str(e):
                is_auth = True
            if is_auth:
                log.info("TTS health check: X-Api-Key 无效 (401)")
            else:
                log.warning("TTS health check failed", exc_info=True)
            return False

    async def close(self) -> None:
        pass
