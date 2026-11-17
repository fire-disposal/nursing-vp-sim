"""豆包 SAUC v3 流式 ASR 二进制帧协议（纯函数，无 I/O）。

帧结构（与官方 ``sauc_python/protocol.py`` 对齐）::

    header(4B) | [seq(>i,4B)] | payload_size(>I,4B) | payload

* byte0: ``(version << 4) | header_size`` —— version=1，header_size=1（×4 = 4 字节）
* byte1: ``(message_type << 4) | flags``
* byte2: ``(serialization << 4) | compression``
* byte3: 保留位 0x00

``payload_size`` 填 **gzip 压缩后** 的字节数；未压缩（compression=0）时填原始长度。
音频包不压缩（零成本拷贝，PCM 本身不可压）。
"""

from __future__ import annotations

import gzip
import json
import struct
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any

AUDIO_SAMPLE_RATE = 16000
AUDIO_BITS = 16
AUDIO_CHANNELS = 1
BYTES_PER_SECOND = AUDIO_SAMPLE_RATE * (AUDIO_BITS // 8) * AUDIO_CHANNELS


class ProtocolVersion(IntEnum):
    V1 = 0b0001


class MessageType(IntEnum):
    CLIENT_FULL_REQUEST = 0b0001
    CLIENT_AUDIO_ONLY = 0b0010
    SERVER_FULL_RESPONSE = 0b1001
    SERVER_ACK = 0b1011
    SERVER_ERROR = 0b1111


class MsgFlags(IntEnum):
    NO_SEQUENCE = 0b0000
    POS_SEQUENCE = 0b0001
    NEG_SEQUENCE = 0b0010
    NEG_WITH_SEQUENCE = 0b0011
    #: 响应包：bit1 = is_last_package，bit2 = 带 event
    SERVER_LAST = 0b0010
    SERVER_EVENT = 0b0100


class Serialization(IntEnum):
    NO_SERIALIZATION = 0b0000
    JSON = 0b0001


class Compression(IntEnum):
    NONE = 0b0000
    GZIP = 0b0001


_HEADER_SIZE = 1  # 1 × 4 = 4 字节头


def _header(message_type: int, flags: int, serialization: int, compression: int) -> bytes:
    return bytes(
        (
            (ProtocolVersion.V1 << 4) | _HEADER_SIZE,
            (message_type << 4) | flags,
            (serialization << 4) | compression,
            0x00,
        )
    )


def build_full_request(payload: dict[str, Any], *, seq: int = 1) -> bytes:
    """首包：gzip(JSON) + 正序号。"""
    body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    return (
        _header(MessageType.CLIENT_FULL_REQUEST, MsgFlags.POS_SEQUENCE, Serialization.JSON, Compression.GZIP)
        + struct.pack(">i", seq)
        + struct.pack(">I", len(body))
        + body
    )


def build_audio_request(segment: bytes, *, seq: int, is_last: bool = False) -> bytes:
    """音频包：裸 PCM16 分包。

    末包必须置 ``NEG_WITH_SEQUENCE`` 且序号取负 —— 这是服务端结束会话的唯一信号，
    漏掉会让服务端在 8s 后报 ``waiting next packet timeout``。
    """
    flags = MsgFlags.NEG_WITH_SEQUENCE if is_last else MsgFlags.POS_SEQUENCE
    signed_seq = -abs(seq) if is_last else abs(seq)
    return (
        _header(MessageType.CLIENT_AUDIO_ONLY, flags, Serialization.NO_SERIALIZATION, Compression.NONE)
        + struct.pack(">i", signed_seq)
        + struct.pack(">I", len(segment))
        + segment
    )


class ProtocolError(ValueError):
    """上游帧不可解析（截断/长度越界）。"""


@dataclass
class AsrResponse:
    message_type: int = 0
    flags: int = 0
    sequence: int | None = None
    is_last: bool = False
    event: int | None = None
    code: int = 0
    payload: Any = None
    raw_payload: bytes = b""


def parse_response(msg: bytes) -> AsrResponse:
    """解析服务端帧。截断或长度越界时抛 :class:`ProtocolError`（不静默返回半成品）。"""
    if len(msg) < 4:
        raise ProtocolError(f"response too short: {len(msg)} bytes")

    header_size = msg[0] & 0x0F
    message_type = msg[1] >> 4
    flags = msg[1] & 0x0F
    serialization = msg[2] >> 4
    compression = msg[2] & 0x0F
    offset = header_size * 4
    if offset > len(msg):
        raise ProtocolError(f"header_size {header_size} exceeds frame length {len(msg)}")

    resp = AsrResponse(message_type=message_type, flags=flags)

    if flags & MsgFlags.POS_SEQUENCE:
        resp.sequence = _read_i32(msg, offset)
        offset += 4
    if flags & MsgFlags.SERVER_LAST:
        resp.is_last = True
    if flags & MsgFlags.SERVER_EVENT:
        resp.event = _read_i32(msg, offset)
        offset += 4

    if message_type == MessageType.SERVER_FULL_RESPONSE:
        payload_size = _read_u32(msg, offset)
        offset += 4
    elif message_type == MessageType.SERVER_ERROR:
        resp.code = _read_i32(msg, offset)
        offset += 4
        payload_size = _read_u32(msg, offset)
        offset += 4
    else:
        payload_size = 0

    body = msg[offset:] if payload_size == 0 else msg[offset : offset + payload_size]
    resp.raw_payload = body
    if not body:
        return resp

    if compression == Compression.GZIP:
        try:
            body = gzip.decompress(body)
        except (OSError, EOFError) as e:
            raise ProtocolError(f"gzip decompress failed: {e}") from e

    if serialization == Serialization.JSON:
        try:
            resp.payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            raise ProtocolError(f"json decode failed: {e}") from e

    return resp


def _read_i32(buf: bytes, offset: int) -> int:
    if offset + 4 > len(buf):
        raise ProtocolError("truncated int32 field")
    return struct.unpack(">i", buf[offset : offset + 4])[0]


def _read_u32(buf: bytes, offset: int) -> int:
    if offset + 4 > len(buf):
        raise ProtocolError("truncated uint32 field")
    return struct.unpack(">I", buf[offset : offset + 4])[0]


# ── 响应归一化 ──


@dataclass
class TranscriptUpdate:
    """归一化后的识别增量。

    ``partial``：当前这句话的实时快照（可被覆盖，前端临时展示）。
    ``definite``：已定稿文本（只能往后追加，前端归档）。
    """

    partial: str = ""
    definite: list[str] = field(default_factory=list)
    #: 本次新增定稿分句的时间键（``(start_time, end_time)``）；调用方据此去重，
    #: 因为同一分句会先以 interim 出现、再以 definite 重发一次。
    definite_keys: list[tuple[int, int]] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not self.partial and not self.definite


def _utterance_text(utt: Any) -> str:
    if not isinstance(utt, dict):
        return ""
    text = utt.get("text")
    return text.strip() if isinstance(text, str) else ""


def utterance_key(utt: Any) -> tuple[int, int] | None:
    """分句的稳定身份：``(start_time, end_time)``（毫秒）。

    服务端省略时间戳时退回 ``None``（调用方按文本去重）。
    """
    if not isinstance(utt, dict):
        return None
    start = utt.get("start_time")
    end = utt.get("end_time")
    if isinstance(start, int) and isinstance(end, int):
        return start, end
    return None


def extract_transcript(payload: Any) -> TranscriptUpdate:
    """从 ``payload_msg`` 提取增量文本。

    只把 ``utterances[].definite == True`` 的分句当作定稿 —— ``result.text`` 在
    ``result_type=single`` 下是增量，但它不区分 interim/final，用它当 final 会把
    半句话钉死在前端。没有 utterances（服务端未给）时退化为 ``result.text`` 作 partial。
    """
    update = TranscriptUpdate()
    if not isinstance(payload, dict):
        return update

    result = payload.get("result")
    if not isinstance(result, dict):
        return update

    utterances = result.get("utterances")
    if isinstance(utterances, list) and utterances:
        pending: list[str] = []
        for utt in utterances:
            text = _utterance_text(utt)
            if not text:
                continue
            if isinstance(utt, dict) and utt.get("definite") is True:
                update.definite.append(text)
                update.definite_keys.append(utterance_key(utt) or (-1, -1))
            else:
                pending.append(text)
        update.partial = "".join(pending)
        return update

    text = result.get("text")
    if isinstance(text, str):
        update.partial = text.strip()
    return update


def audio_seconds(byte_count: int) -> float:
    """PCM16 / 16k / mono 的实际字节数 → 秒数。"""
    if byte_count <= 0:
        return 0.0
    return byte_count / BYTES_PER_SECOND
