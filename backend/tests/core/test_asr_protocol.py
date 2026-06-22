"""Unit tests for the Volcengine BigASR (SAUC) v3 binary frame codec."""

import gzip
import json

from infrastructure.asr import protocol as p


def _make_server_frame(
    payload: dict,
    *,
    sequence: int | None = None,
    is_last: bool = False,
    error_code: int | None = None,
) -> bytes:
    body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    if error_code is not None:
        message_type = p.SERVER_ERROR_RESPONSE
        flags = 0
        tail = error_code.to_bytes(4, "big") + len(body).to_bytes(4, "big") + body
    else:
        message_type = p.SERVER_FULL_RESPONSE
        flags = 0
        prefix = b""
        if sequence is not None:
            flags |= p.FLAG_HAS_SEQUENCE
            prefix += sequence.to_bytes(4, "big", signed=True)
        if is_last:
            flags |= p.FLAG_LAST_PACKET
        tail = prefix + len(body).to_bytes(4, "big") + body

    header = bytearray()
    header.append((p.PROTOCOL_VERSION << 4) | p.DEFAULT_HEADER_SIZE)
    header.append((message_type << 4) | flags)
    header.append((p.SERIALIZATION_JSON << 4) | p.COMPRESSION_GZIP)
    header.append(0x00)
    return bytes(header) + tail


def test_full_client_request_roundtrips_via_gzip():
    cfg = p.default_full_client_request(sample_rate=16000)
    frame = p.build_full_client_request(cfg)
    assert frame[0] == (p.PROTOCOL_VERSION << 4) | p.DEFAULT_HEADER_SIZE
    assert frame[1] >> 4 == p.CLIENT_FULL_REQUEST
    size = int.from_bytes(frame[4:8], "big")
    decoded = json.loads(gzip.decompress(frame[8 : 8 + size]))
    assert decoded["audio"]["rate"] == 16000
    assert decoded["request"]["model_name"] == "bigmodel"


def test_audio_request_last_flag():
    normal = p.build_audio_request(b"\x00\x01", is_last=False)
    last = p.build_audio_request(b"\x00\x01", is_last=True)
    assert normal[1] >> 4 == p.CLIENT_AUDIO_ONLY_REQUEST
    assert normal[1] & 0x0F == p.FLAG_NONE
    assert last[1] & 0x0F == p.FLAG_LAST_PACKET


def test_parse_full_response_with_text():
    frame = _make_server_frame({"result": {"text": "你好世界"}}, sequence=5)
    resp = p.parse_server_response(frame)
    assert resp.message_type == p.SERVER_FULL_RESPONSE
    assert resp.sequence == 5
    assert resp.is_last is False
    assert resp.text == "你好世界"


def test_parse_full_response_last_package():
    frame = _make_server_frame({"result": {"text": "结束"}}, sequence=-1, is_last=True)
    resp = p.parse_server_response(frame)
    assert resp.is_last is True
    assert resp.text == "结束"


def test_parse_utterances_concatenated():
    frame = _make_server_frame({"result": {"utterances": [{"text": "甲"}, {"text": "乙"}, {"text": "丙"}]}})
    resp = p.parse_server_response(frame)
    assert resp.text == "甲乙丙"


def test_parse_error_frame():
    frame = _make_server_frame({"error": "boom"}, error_code=45000001)
    resp = p.parse_server_response(frame)
    assert resp.is_error is True
    assert resp.code == 45000001
    assert resp.payload == {"error": "boom"}


def test_parse_short_frame_raises():
    import pytest

    with pytest.raises(ValueError, match="too short"):
        p.parse_server_response(b"\x11")
