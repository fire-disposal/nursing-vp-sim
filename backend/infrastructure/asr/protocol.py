"""Volcengine BigASR (SAUC) v3 binary frame codec.

Pure functions for encoding client frames and decoding server frames. No I/O
here so the protocol can be unit-tested in isolation.

Frame layout (big-endian)::

    byte0: (protocol_version << 4) | header_size      # 0b0001_0001
    byte1: (message_type      << 4) | flags
    byte2: (serialization     << 4) | compression     # JSON=0b0001 Gzip=0b0001
    byte3: reserved
    [optional int32 sequence]   # server full response, when flag bit set
    uint32 payload_size
    payload                     # gzip-compressed (JSON or raw audio)
"""

import gzip
import json
from dataclasses import dataclass

PROTOCOL_VERSION = 0b0001
DEFAULT_HEADER_SIZE = 0b0001

# message types
CLIENT_FULL_REQUEST = 0b0001
CLIENT_AUDIO_ONLY_REQUEST = 0b0010
SERVER_FULL_RESPONSE = 0b1001
SERVER_ERROR_RESPONSE = 0b1111

# message_type_specific_flags
FLAG_NONE = 0b0000
FLAG_LAST_PACKET = 0b0010  # final audio packet
FLAG_HAS_SEQUENCE = 0b0001

# serialization
SERIALIZATION_JSON = 0b0001
# compression
COMPRESSION_GZIP = 0b0001


def _header(message_type: int, flags: int) -> bytearray:
    h = bytearray()
    h.append((PROTOCOL_VERSION << 4) | DEFAULT_HEADER_SIZE)
    h.append((message_type << 4) | flags)
    h.append((SERIALIZATION_JSON << 4) | COMPRESSION_GZIP)
    h.append(0x00)
    return h


def build_full_client_request(payload: dict) -> bytes:
    """Encode the initial JSON config frame (gzip + JSON)."""
    body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    frame = _header(CLIENT_FULL_REQUEST, FLAG_NONE)
    frame += len(body).to_bytes(4, "big")
    frame += body
    return bytes(frame)


def build_audio_request(audio: bytes, is_last: bool = False) -> bytes:
    """Encode an audio-only frame (gzip raw PCM). Set ``is_last`` for the tail."""
    body = gzip.compress(audio)
    frame = _header(CLIENT_AUDIO_ONLY_REQUEST, FLAG_LAST_PACKET if is_last else FLAG_NONE)
    frame += len(body).to_bytes(4, "big")
    frame += body
    return bytes(frame)


def default_full_client_request(
    sample_rate: int = 16000,
    bits: int = 16,
    channel: int = 1,
    audio_format: str = "pcm",
    language: str = "zh-CN",
    model_name: str = "bigmodel",
    enable_itn: bool = True,
    enable_punc: bool = True,
    uid: str = "nursing-vp-sim",
) -> dict:
    """Build the standard full-client-request config payload (§7.2)."""
    return {
        "user": {"uid": uid},
        "audio": {
            "format": audio_format,
            "rate": sample_rate,
            "bits": bits,
            "channel": channel,
            "language": language,
        },
        "request": {
            "model_name": model_name,
            "enable_itn": enable_itn,
            "enable_punc": enable_punc,
        },
    }


@dataclass
class ServerResponse:
    message_type: int
    is_last: bool = False
    sequence: int | None = None
    code: int | None = None  # set for error frames
    payload: dict | None = None  # decoded JSON payload (or error message)

    @property
    def is_error(self) -> bool:
        return self.message_type == SERVER_ERROR_RESPONSE

    @property
    def text(self) -> str:
        """Best-effort transcript extraction from a full server response."""
        if not self.payload:
            return ""
        result = self.payload.get("result")
        if isinstance(result, dict):
            if result.get("text"):
                return str(result["text"])
            utterances = result.get("utterances") or []
            return "".join(u.get("text", "") for u in utterances if isinstance(u, dict))
        return ""


def parse_server_response(data: bytes) -> ServerResponse:
    """Decode a server frame into a :class:`ServerResponse`."""
    if len(data) < 4:
        raise ValueError("ASR frame too short")

    header_size = data[0] & 0x0F
    message_type = data[1] >> 4
    flags = data[1] & 0x0F
    compression = data[2] & 0x0F

    body = data[header_size * 4 :]
    resp = ServerResponse(message_type=message_type)

    if message_type == SERVER_FULL_RESPONSE:
        if flags & FLAG_HAS_SEQUENCE:
            resp.sequence = int.from_bytes(body[:4], "big", signed=True)
            body = body[4:]
        if flags & FLAG_LAST_PACKET:
            resp.is_last = True
        payload_size = int.from_bytes(body[:4], "big", signed=False)
        payload_bytes = body[4 : 4 + payload_size]
    elif message_type == SERVER_ERROR_RESPONSE:
        resp.code = int.from_bytes(body[:4], "big", signed=False)
        payload_size = int.from_bytes(body[4:8], "big", signed=False)
        payload_bytes = body[8 : 8 + payload_size]
    else:
        raise ValueError(f"Unsupported ASR message type: {message_type:#06b}")

    if compression == COMPRESSION_GZIP and payload_bytes:
        payload_bytes = gzip.decompress(payload_bytes)

    if payload_bytes:
        try:
            resp.payload = json.loads(payload_bytes)
        except json.JSONDecodeError:
            resp.payload = {"raw": payload_bytes.decode("utf-8", errors="replace")}

    return resp
