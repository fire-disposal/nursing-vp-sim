"""Unit tests — TTS 2.0 request serialization & the emotion/cost wiring.

Pure unit level: frames are parsed back from bytes, the DB session is a fake,
no network and no real TTS/ASR service is touched.
"""

import asyncio
import json
import struct
from types import SimpleNamespace

import pytest

import modules.voice.service as voice_service
from infra.tts.client import (
    EventType,
    MsgFlag,
    MsgType,
    TTSRequest,
    _build_start_session,
    _build_task_request,
)
from infra.tts.mapper import resolve_context_texts
from modules.voice.service import TTSService

_HEADER_LEN = 4


def _parse_client_frame(frame: bytes) -> dict:
    """Decode a FullClientRequest frame back into its JSON body."""
    assert frame[0] == 0x11  # version 1, header size 4
    assert (frame[1] >> 4) == MsgType.FullClientRequest
    assert (frame[1] & 0xF) == MsgFlag.WithEvent
    buf = frame[_HEADER_LEN:]
    event = struct.unpack(">i", buf[:4])[0]
    size = struct.unpack(">I", buf[4:8])[0]
    session_id = buf[8 : 8 + size].decode("utf-8")
    rest = buf[8 + size :]
    payload_size = struct.unpack(">I", rest[:4])[0]
    body = json.loads(rest[4 : 4 + payload_size].decode("utf-8"))
    return {"event": event, "session_id": session_id, "body": body}


def _additions(frame: bytes) -> dict:
    return json.loads(_parse_client_frame(frame)["body"]["req_params"]["additions"])


class TestStartSessionFrame:
    def test_context_texts_serialized_in_additions(self):
        req = TTSRequest(text="我头疼", context_texts=["语气焦虑不安。"])
        parsed = _parse_client_frame(_build_start_session(req, "sess"))
        assert parsed["event"] == EventType.StartSession
        assert parsed["session_id"] == "sess"
        additions = json.loads(parsed["body"]["req_params"]["additions"])
        assert additions["context_texts"] == ["语气焦虑不安。"]
        assert additions["disable_markdown_filter"] is False

    def test_section_id_serialized_under_additions(self):
        req = TTSRequest(text="我头疼", section_id="42")
        additions = _additions(_build_start_session(req, "sess"))
        assert additions["section_id"] == "42"
        # 官方协议位置在 additions 下，不在 req_params 顶层
        body = _parse_client_frame(_build_start_session(req, "sess"))["body"]
        assert "section_id" not in body["req_params"]

    def test_empty_instruction_omits_context_texts(self):
        for value in (None, [], [""], ["   "]):
            additions = _additions(_build_start_session(TTSRequest(text="x", context_texts=value), "s"))
            assert "context_texts" not in additions

    def test_blank_section_id_omitted(self):
        for value in (None, "", "  "):
            additions = _additions(_build_start_session(TTSRequest(text="x", section_id=value), "s"))
            assert "section_id" not in additions

    def test_only_first_instruction_sent(self):
        # 官方：字符串列表只第一个值有效
        req = TTSRequest(text="x", context_texts=["第一", "第二"])
        assert _additions(_build_start_session(req, "s"))["context_texts"] == ["第一"]

    def test_speaker_and_audio_params_unchanged(self):
        req = TTSRequest(text="x", speaker="zh_female_popo_uranus_bigtts", fmt="pcm", sample_rate=24000)
        params = _parse_client_frame(_build_start_session(req, "s"))["body"]["req_params"]
        assert params["speaker"] == "zh_female_popo_uranus_bigtts"
        assert params["audio_params"]["format"] == "pcm"
        assert params["audio_params"]["sample_rate"] == 24000

    def test_task_request_untouched(self):
        parsed = _parse_client_frame(_build_task_request("你好", "sess"))
        assert parsed["event"] == EventType.TaskRequest
        assert parsed["body"]["req_params"] == {"text": "你好"}


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class _FakeDb:
    def __init__(self, record, case):
        self._record = record
        self._case = case

    def query(self, model):
        from models import Case, TrainingRecord

        if model is TrainingRecord:
            return _FakeQuery(self._record)
        if model is Case:
            return _FakeQuery(self._case)
        raise AssertionError(f"unexpected model {model}")


def _service(age=None, gender=None, case_data_extra=None) -> TTSService:
    case_data = {"patient_info": {"age": age, "gender": gender}, **(case_data_extra or {})}
    record = SimpleNamespace(id=42, user_id=7, case_id=3)
    case = SimpleNamespace(id=3, case_data=case_data)
    return TTSService(_FakeDb(record, case))


class TestResolveRequestWiring:
    @pytest.mark.parametrize(
        "state",
        [
            "open_trusting",
            "trusting_anxious",
            "irritated",
            "anxious_cooperative",
            "anxious_guarded",
            "withdrawn",
            "defensive",
            "relaxed",
            "neutral",
            "not_a_state",
        ],
    )
    def test_emotion_becomes_context_texts(self, state):
        req = _service(age=45, gender="女")._resolve_request(42, "我胸口疼", None, 7, state, "pcm", 24000, None)
        assert req.context_texts == resolve_context_texts(state)
        assert req.context_texts  # 永不为空
        assert req.section_id == "42"

    def test_context_texts_reach_upstream_frame(self):
        req = _service(age=45, gender="女")._resolve_request(42, "我胸口疼", None, 7, "irritated", "pcm", 24000, None)
        additions = _additions(_build_start_session(req, "sess"))
        assert additions["context_texts"] == resolve_context_texts("irritated")
        assert additions["section_id"] == "42"

    def test_speaker_is_builtin_uranus(self):
        req = _service(age=70, gender="女")._resolve_request(42, "疼", None, 7, "neutral", "pcm", 24000, None)
        assert req.speaker == "zh_female_popo_uranus_bigtts"


class TestCostRate:
    def test_official_price_per_char(self):
        # 官方 seed-tts-2.0 后付费字符版：3 元/万字符
        assert voice_service._COST_PER_CHAR == 0.0003

    def test_ten_thousand_chars_cost_three_yuan(self, monkeypatch):
        written = []
        monkeypatch.setattr(
            voice_service,
            "SessionLocal",
            lambda: _LogSession(written),
        )
        voice_service.TTSService(db=None)._write_log(
            user_id=1, record_id=2, emotion_state="neutral", text_length=10_000, latency_ms=10, status="success"
        )
        assert written[0].cost_estimated == pytest.approx(3.0)

    def test_error_call_costs_nothing(self, monkeypatch):
        written = []
        monkeypatch.setattr(voice_service, "SessionLocal", lambda: _LogSession(written))
        voice_service.TTSService(db=None)._write_log(
            user_id=1, record_id=2, emotion_state="neutral", text_length=500, latency_ms=10, status="error"
        )
        assert written[0].cost_estimated == 0.0


class _LogSession:
    """Records the VoiceCallLog row instead of touching the DB."""

    def __init__(self, sink):
        self._sink = sink

    def add(self, row):
        self._sink.append(row)

    def commit(self):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class TestStreamRequestEmotion:
    def test_stream_synthesis_passes_instruction_to_session(self, monkeypatch):
        monkeypatch.setattr(voice_service.TTSService, "_write_log", lambda self, **kw: None)
        captured = {}

        class _Conn:
            last_usage = None

            async def begin_session(self, request):
                captured["req"] = request

            def read_stream(self):
                async def _empty():
                    return
                    yield b""  # pragma: no cover

                return _empty()

            async def abort(self):
                pass

        class _Ctx:
            async def __aenter__(self):
                return _Conn()

            async def __aexit__(self, *exc):
                return False

        class _Pool:
            def acquire(self):
                return _Ctx()

        async def _run():
            info, gen = await _service(age=30, gender="男").stream_synthesize(
                record_id=42,
                text="我睡不着",
                voice_type=None,
                user_id=7,
                pool=_Pool(),
                emotion_state="anxious_cooperative",
                timeout=5,
            )
            async for _ in gen:
                pass
            return info

        info = asyncio.run(_run())
        assert captured["req"].context_texts == resolve_context_texts("anxious_cooperative")
        assert captured["req"].section_id == "42"
        assert info.emotion == "anxious_cooperative"
