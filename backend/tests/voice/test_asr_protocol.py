"""SAUC 帧协议与识别结果归一化的纯单测（不连任何真实服务）。"""

from __future__ import annotations

import gzip
import json
import struct

import pytest

from infra.asr import protocol
from infra.asr.client import build_headers, build_request_payload


def _read_frame(frame: bytes) -> tuple[int, int, int, int, int | None, bytes]:
    """独立于被测实现的最小帧解码（按官方布局逐字段读）。"""
    assert frame[0] & 0x0F == 1
    header_size = (frame[0] & 0x0F) * 4
    message_type = frame[1] >> 4
    flags = frame[1] & 0x0F
    compression = frame[2] & 0x0F
    offset = header_size
    seq = None
    if flags & 0b01:
        seq = struct.unpack(">i", frame[offset : offset + 4])[0]
        offset += 4
    size = struct.unpack(">I", frame[offset : offset + 4])[0]
    offset += 4
    return message_type, flags, compression, size, seq, frame[offset : offset + size]


class TestFullRequestFrame:
    def test_layout_and_gzip_json(self):
        payload = {"request": {"model_name": "bigmodel"}, "user": {"uid": "u1"}}
        frame = protocol.build_full_request(payload, seq=1)
        message_type, flags, compression, size, seq, body = _read_frame(frame)

        assert message_type == protocol.MessageType.CLIENT_FULL_REQUEST
        assert flags == protocol.MsgFlags.POS_SEQUENCE
        assert compression == protocol.Compression.GZIP
        assert seq == 1
        assert size == len(body) == len(frame) - 12
        assert json.loads(gzip.decompress(body)) == payload

    def test_payload_size_is_compressed_length(self):
        payload = {"a": "中文" * 100}
        frame = protocol.build_full_request(payload, seq=7)
        _, _, _, size, _, body = _read_frame(frame)
        assert size == len(gzip.compress(json.dumps(payload, ensure_ascii=False).encode()))
        assert size < len(json.dumps(payload, ensure_ascii=False).encode())


class TestAudioFrame:
    def test_positive_sequence_for_normal_chunk(self):
        pcm = bytes(range(64))
        frame = protocol.build_audio_request(pcm, seq=5)
        message_type, flags, compression, size, seq, body = _read_frame(frame)

        assert message_type == protocol.MessageType.CLIENT_AUDIO_ONLY
        assert flags == protocol.MsgFlags.POS_SEQUENCE
        assert compression == protocol.Compression.NONE
        assert seq == 5
        assert size == 64
        assert body == pcm  # 音频不压缩，字节原样透传

    def test_last_packet_uses_negative_sequence(self):
        frame = protocol.build_audio_request(b"", seq=9, is_last=True)
        _, flags, _, size, seq, body = _read_frame(frame)

        assert flags == protocol.MsgFlags.NEG_WITH_SEQUENCE
        assert seq == -9
        assert size == 0
        assert body == b""

    def test_last_packet_allows_trailing_audio(self):
        _, flags, _, size, seq, body = _read_frame(protocol.build_audio_request(b"\x01\x02", seq=3, is_last=True))
        assert (flags, seq, size, body) == (protocol.MsgFlags.NEG_WITH_SEQUENCE, -3, 2, b"\x01\x02")


def _server_frame(
    payload: dict,
    *,
    message_type: int = protocol.MessageType.SERVER_FULL_RESPONSE,
    flags: int = protocol.MsgFlags.POS_SEQUENCE,
    seq: int = 1,
    code: int = 0,
) -> bytes:
    body = gzip.compress(json.dumps(payload, ensure_ascii=False).encode())
    header = bytes(
        [
            (protocol.ProtocolVersion.V1 << 4) | 1,
            (message_type << 4) | flags,
            (protocol.Serialization.JSON << 4) | protocol.Compression.GZIP,
            0x00,
        ]
    )
    out = header
    if flags & 0b01:
        out += struct.pack(">i", seq)
    if message_type == protocol.MessageType.SERVER_ERROR:
        out += struct.pack(">i", code)
    out += struct.pack(">I", len(body)) + body
    return out


class TestParseResponse:
    def test_full_response_with_sequence(self):
        resp = protocol.parse_response(_server_frame({"result": {"text": "你好"}}, seq=4))
        assert resp.message_type == protocol.MessageType.SERVER_FULL_RESPONSE
        assert resp.sequence == 4
        assert resp.is_last is False
        assert resp.code == 0
        assert resp.payload == {"result": {"text": "你好"}}

    def test_last_package_flag(self):
        frame = _server_frame(
            {"result": {"text": "结束"}}, flags=protocol.MsgFlags.POS_SEQUENCE | protocol.MsgFlags.SERVER_LAST
        )
        resp = protocol.parse_response(frame)
        assert resp.is_last is True
        assert resp.sequence == 1

    def test_negative_sequence_marks_end(self):
        resp = protocol.parse_response(_server_frame({"result": {"text": "x"}}, seq=-2))
        assert resp.sequence == -2

    def test_error_response_carries_code(self):
        resp = protocol.parse_response(
            _server_frame({"error": "bad audio"}, message_type=protocol.MessageType.SERVER_ERROR, code=45000001)
        )
        assert resp.message_type == protocol.MessageType.SERVER_ERROR
        assert resp.code == 45000001
        assert resp.payload == {"error": "bad audio"}

    def test_truncated_frame_raises(self):
        with pytest.raises(protocol.ProtocolError):
            protocol.parse_response(b"\x11\x91")

    def test_bad_json_raises(self):
        body = gzip.compress(b"not json")
        header = bytes([0x11, 0x90, 0x11, 0x00])
        with pytest.raises(protocol.ProtocolError):
            protocol.parse_response(header + struct.pack(">I", len(body)) + body)


class TestTranscriptNormalization:
    def test_definite_only_from_definite_utterances(self):
        payload = {
            "result": {
                "text": "我头有点晕",
                "utterances": [
                    {"text": "我头有点晕。", "definite": True, "start_time": 0, "end_time": 900},
                    {"text": "还有", "definite": False},
                ],
            }
        }
        update = protocol.extract_transcript(payload)
        assert update.definite == ["我头有点晕。"]
        assert update.partial == "还有"

    def test_interim_never_becomes_definite(self):
        """interim 分句即使带 result.text 也只能是 partial —— 否则前端会把半句话钉死。"""
        payload = {"result": {"text": "我想问", "utterances": [{"text": "我想问", "definite": False}]}}
        update = protocol.extract_transcript(payload)
        assert update.definite == []
        assert update.partial == "我想问"

    def test_all_definite(self):
        payload = {
            "result": {
                "utterances": [
                    {"text": "你好。", "definite": True},
                    {"text": "哪里不舒服？", "definite": True},
                ]
            }
        }
        update = protocol.extract_transcript(payload)
        assert update.definite == ["你好。", "哪里不舒服？"]
        assert update.partial == ""

    def test_falls_back_to_result_text_when_no_utterances(self):
        update = protocol.extract_transcript({"result": {"text": "  肚子疼 "}})
        assert update.definite == []
        assert update.partial == "肚子疼"

    def test_empty_utterances_falls_back_to_result_text(self):
        update = protocol.extract_transcript({"result": {"text": "后背疼", "utterances": []}})
        assert update.definite == []
        assert update.partial == "后背疼"

    @pytest.mark.parametrize("payload", [None, {}, {"result": None}, {"result": []}, "str", 5])
    def test_malformed_payload_yields_empty_update(self, payload):
        update = protocol.extract_transcript(payload)
        assert update.is_empty

    def test_blank_and_non_string_texts_are_skipped(self):
        payload = {
            "result": {
                "utterances": [
                    {"text": "   ", "definite": True},
                    {"text": None, "definite": True},
                    "garbage",
                    {"definite": True},
                ]
            }
        }
        assert protocol.extract_transcript(payload).is_empty


class TestAudioDuration:
    @pytest.mark.parametrize(
        ("byte_count", "expected"),
        [(0, 0.0), (-5, 0.0), (protocol.BYTES_PER_SECOND, 1.0), (protocol.BYTES_PER_SECOND // 2, 0.5)],
    )
    def test_seconds_from_bytes(self, byte_count, expected):
        assert protocol.audio_seconds(byte_count) == pytest.approx(expected)

    def test_one_minute_of_pcm16_mono_16k(self):
        assert protocol.audio_seconds(16000 * 2 * 60) == pytest.approx(60.0)


class TestRequestPayload:
    def test_audio_and_request_flags_follow_protocol(self):
        payload = build_request_payload("req-1")
        assert payload["audio"] == {"format": "pcm", "codec": "raw", "rate": 16000, "bits": 16, "channel": 1}

        req = payload["request"]
        assert req["model_name"] == "bigmodel"
        assert req["enable_nonstream"] is True
        assert req["enable_itn"] is True
        assert req["enable_punc"] is True
        assert req["enable_ddc"] is False
        assert req["show_utterances"] is True
        assert req["result_type"] == "single"
        assert req["end_window_size"] == 800

    def test_corpus_context_is_json_with_hotwords(self):
        context = json.loads(build_request_payload("req-2")["request"]["corpus"]["context"])
        words = [item["word"] for item in context["hotwords"]]
        assert "高血压" in words
        assert all(isinstance(w, str) and w for w in words)

    def test_uid_defaults_to_request_id(self):
        assert build_request_payload("req-3")["user"]["uid"] == "req-3"
        assert build_request_payload("req-3", uid="u9")["user"]["uid"] == "u9"


class TestAuthHeaders:
    def test_headers_carry_key_resource_and_ids(self):
        headers = build_headers("secret-key", "req-42")
        assert headers["X-Api-Key"] == "secret-key"
        assert headers["X-Api-Resource-Id"] == "volc.seedasr.sauc.duration"
        assert headers["X-Api-Request-Id"] == "req-42"
