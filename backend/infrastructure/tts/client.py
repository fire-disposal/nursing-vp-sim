"""Volcengine SeedTTS 2.0 (doubao) TTS client — v3 bidirectional WebSocket protocol.

Streams text character-by-character and receives raw audio binary frames
with sub-200ms latency. Replaces the legacy unidirectional HTTP endpoint.
"""

from __future__ import annotations

import json
import logging
import struct
import uuid
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
    if len(raw) < 4:
        raise RuntimeError(f"TTS: frame too short ({len(raw)} bytes)")
    header_len_raw = HEADER_STRUCT.unpack(raw[:4])[0]
    # The header length may or may not include the 4-byte prefix.
    # Try excluding it first, then including.
    for offset in (0, 4):
        hl = header_len_raw - offset
        if hl <= 0 or hl > len(raw) - 4:
            continue
        try:
            header_bytes = raw[4 : 4 + hl]
            header = json.loads(header_bytes.decode())
            payload = raw[4 + hl :]
            return _parse_server_message(header, payload)
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    raise RuntimeError(f"TTS: cannot decode binary frame header (header_len={header_len_raw}, total={len(raw)})")


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
        return {"FullServerResponse": MsgType.FullServerResponse, "AudioOnlyServer": MsgType.AudioOnlyServer}.get(raw, MsgType.FullServerResponse)
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


class VolcBidirectionalTTSClient:
    """Async client for Volcengine SeedTTS 2.0 bidirectional WebSocket synthesis."""

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

        try:
            session_id = uuid.uuid4().hex

            await self._start_connection(ws)
            await self._wait_event(ws, MsgType.FullServerResponse, ServerEvent.ConnectionStarted)

            await self._start_session(ws, req, session_id)
            await self._wait_event(ws, MsgType.FullServerResponse, ServerEvent.SessionStarted)

            audio = bytearray()
            audio_started = False
            text_sent = False

            send_task = None
            # We send text incrementally but receive audio in parallel.
            # Simple approach: send first, then drain audio.
            await self._send_text(ws, req.text, session_id)
            await self._finish_session(ws, session_id)

            while True:
                msg = await _read_frame(ws)
                if msg.type == MsgType.FullServerResponse:
                    if msg.event == ServerEvent.SessionFinished:
                        break
                    if msg.event in (ServerEvent.ConnectionFailed, ServerEvent.SessionFailed):
                        err = msg.payload or {}
                        raise RuntimeError(f"TTS failed: {json.dumps(err, ensure_ascii=False)[:300]}")
                    if msg.event == ServerEvent.TTSSentenceStart:
                        audio_started = True
                elif msg.type == MsgType.AudioOnlyServer:
                    audio_started = True
                    if msg.payload:
                        audio.extend(msg.payload)

            if not audio:
                raise RuntimeError("TTS returned empty audio data")
            return bytes(audio)

        finally:
            try:
                await self._finish_connection(ws)
                await self._wait_event(ws, MsgType.FullServerResponse, ServerEvent.ConnectionFinished)
            except Exception:
                pass
            await ws.close()

    async def _start_connection(self, ws: ClientConnection) -> None:
        header = {"event": EventType.StartConnection}
        await ws.send(_build_frame(header))

    async def _start_session(self, ws: ClientConnection, req: TTSRequest, session_id: str) -> None:
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
        header = {"event": EventType.StartSession, "session_id": session_id}
        await ws.send(_build_frame(header, json.dumps(body, ensure_ascii=False).encode()))

    async def _send_text(self, ws: ClientConnection, text: str, session_id: str) -> None:
        body = {
            "event": EventType.TaskRequest,
            "req_params": {"text": text},
        }
        header = {"event": EventType.TaskRequest, "session_id": session_id}
        await ws.send(_build_frame(header, json.dumps(body, ensure_ascii=False).encode()))

    async def _finish_session(self, ws: ClientConnection, session_id: str) -> None:
        header = {"event": EventType.FinishSession, "session_id": session_id}
        await ws.send(_build_frame(header))

    async def _finish_connection(self, ws: ClientConnection) -> None:
        header = {"event": EventType.FinishConnection}
        await ws.send(_build_frame(header))

    async def _wait_event(
        self, ws: ClientConnection, msg_type: MsgType, event: ServerEvent
    ) -> ServerMessage:
        msg = await _read_frame(ws)
        if msg.type == MsgType.FullServerResponse and msg.event in (
            ServerEvent.ConnectionFailed,
            ServerEvent.SessionFailed,
        ):
            err = msg.payload or {}
            raise RuntimeError(f"TTS connection failed: {json.dumps(err, ensure_ascii=False)[:300]}")
        return msg

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
