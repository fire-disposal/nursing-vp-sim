"""ASR 双向桥（``_bridge``）的行为单测：假 WebSocket + 假上游会话。

只测转发语义：二进制 PCM 逐块上行、partial/definite 归一化下行、stop 发负序号末包
并等终稿、断开时取消任务。不触碰 FastAPI 生命周期，也不连任何真实服务。
"""

from __future__ import annotations

import asyncio
import json

import pytest

from infra.asr import protocol
from modules.voice import asr_router


class FakeUpstream:
    """替身 AsrSession：记录收到的 PCM 与末包，按脚本回放响应。"""

    def __init__(self, script: list[dict] | None = None):
        self.sent: list[bytes] = []
        self.finished = False
        self.closed = False
        self._script = script or []
        self._release = asyncio.Event()

    async def send_audio(self, segment: bytes) -> None:
        if self.finished:
            raise RuntimeError("sent after finish")
        self.sent.append(segment)

    async def finish(self) -> None:
        if self.finished:
            return
        self.finished = True
        self._release.set()

    def push(self, payload: dict) -> None:
        self._script.append(payload)

    async def receive(self):
        for payload in list(self._script):
            self._script.remove(payload)
            yield protocol.AsrResponse(payload=payload)
        await self._release.wait()

    async def close(self) -> None:
        self.closed = True


class FakeWebSocket:
    """只实现路由用到的 receive/send_json。"""

    def __init__(self, incoming: list[dict]):
        self._incoming = asyncio.Queue()
        for item in incoming:
            self._incoming.put_nowait(item)
        self.sent_json: list[dict] = []
        self.closed = False

    async def receive(self) -> dict:
        return await self._incoming.get()

    async def send_json(self, payload: dict) -> None:
        self.sent_json.append(payload)

    def push(self, message: dict) -> None:
        self._incoming.put_nowait(message)


def _state() -> dict:
    return {"send_lock": asyncio.Lock(), "record_id": 1, "audio_bytes": 0, "final_parts": [], "definite_seen": set()}


async def test_pcm_forwarded_and_transcripts_normalized():
    upstream = FakeUpstream(
        [
            {"result": {"text": "我", "utterances": [{"text": "我", "definite": False}]}},
            {"result": {"text": "我头晕", "utterances": [{"text": "我头晕。", "definite": True}]}},
        ]
    )
    ws = FakeWebSocket(
        [
            {"type": "websocket.receive", "bytes": b"\x01\x02"},
            {"type": "websocket.receive", "bytes": b"\x03\x04"},
            {"type": "websocket.receive", "text": json.dumps({"type": "stop"})},
        ]
    )
    state = _state()

    ok = await asyncio.wait_for(asr_router._bridge(ws, upstream, state), timeout=5)

    assert ok is True
    assert upstream.sent == [b"\x01\x02", b"\x03\x04"]
    assert upstream.finished is True
    assert state["audio_bytes"] == 4
    assert state["final_parts"] == ["我头晕。"]

    kinds = [p["type"] for p in ws.sent_json]
    assert kinds == ["partial", "definite", "end"]
    assert ws.sent_json[1]["text"] == "我头晕。"


async def test_disconnect_cancels_and_marks_not_success():
    upstream = FakeUpstream()
    ws = FakeWebSocket([{"type": "websocket.disconnect"}])

    ok = await asyncio.wait_for(asr_router._bridge(ws, upstream, _state()), timeout=5)

    assert ok is False
    assert upstream.finished is False
    assert ws.sent_json[-1] == {"type": "end"}


async def test_stop_without_audio_still_finishes_upstream():
    upstream = FakeUpstream()
    ws = FakeWebSocket([{"type": "websocket.receive", "text": '{"type": "stop"}'}])

    ok = await asyncio.wait_for(asr_router._bridge(ws, upstream, _state()), timeout=5)

    assert ok is True
    assert upstream.sent == []
    assert upstream.finished is True


async def test_non_stop_text_is_ignored():
    upstream = FakeUpstream()
    ws = FakeWebSocket(
        [
            {"type": "websocket.receive", "text": '{"type":"ping"}'},
            {"type": "websocket.receive", "text": "garbage"},
            {"type": "websocket.receive", "bytes": b"\x09"},
            {"type": "websocket.receive", "text": '{"type":"stop"}'},
        ]
    )
    ok = await asyncio.wait_for(asr_router._bridge(ws, upstream, _state()), timeout=5)

    assert ok is True
    assert upstream.sent == [b"\x09"]


async def test_audio_cap_stops_session():
    upstream = FakeUpstream()
    oversized = b"\x00" * (asr_router._MAX_AUDIO_BYTES + 1)
    ws = FakeWebSocket([{"type": "websocket.receive", "bytes": oversized}])

    ok = await asyncio.wait_for(asr_router._bridge(ws, upstream, _state()), timeout=5)

    assert ok is False
    assert upstream.sent == []  # 超限的那块不再上行
    assert ws.sent_json[-1] == {"type": "end"}


async def test_download_finish_ends_bridge():
    """上游先给终稿并关流时，桥应自己收尾（不必等浏览器 stop）。"""
    upstream = FakeUpstream([{"result": {"utterances": [{"text": "没了。", "definite": True}]}}])

    class ClosingUpstream(FakeUpstream):
        async def receive(self):
            for payload in list(self._script):
                self._script.remove(payload)
                yield protocol.AsrResponse(payload=payload)

    upstream.__class__ = ClosingUpstream
    ws = FakeWebSocket([])
    state = _state()

    ok = await asyncio.wait_for(asr_router._bridge(ws, upstream, state), timeout=5)

    assert ok is False
    assert state["final_parts"] == ["没了。"]
    assert ws.sent_json == [{"type": "definite", "text": "没了。"}, {"type": "end"}]


@pytest.mark.parametrize("text", ['{"type":"stop"}', '{"type": "stop", "x": 1}'])
def test_stop_shapes(text):
    assert asr_router._is_stop(text) is True


class TestDefiniteDedupe:
    def test_same_time_range_only_emitted_once(self):
        seen: set = set()
        first = protocol.extract_transcript(
            {"result": {"utterances": [{"text": "我头晕。", "definite": True, "start_time": 0, "end_time": 800}]}}
        )
        again = protocol.extract_transcript(
            {"result": {"utterances": [{"text": "我头晕。", "definite": True, "start_time": 0, "end_time": 800}]}}
        )
        assert asr_router._take_new_definite(first, seen) == ["我头晕。"]
        assert asr_router._take_new_definite(again, seen) == []

    def test_distinct_sentences_both_emitted(self):
        seen: set = set()
        update = protocol.extract_transcript(
            {
                "result": {
                    "utterances": [
                        {"text": "我头晕。", "definite": True, "start_time": 0, "end_time": 800},
                        {"text": "还恶心。", "definite": True, "start_time": 800, "end_time": 1600},
                    ]
                }
            }
        )
        assert asr_router._take_new_definite(update, seen) == ["我头晕。", "还恶心。"]

    def test_missing_timestamps_dedupe_by_text(self):
        seen: set = set()
        update = protocol.extract_transcript({"result": {"utterances": [{"text": "好的。", "definite": True}]}})
        assert asr_router._take_new_definite(update, seen) == ["好的。"]
        repeat = protocol.extract_transcript({"result": {"utterances": [{"text": "好的。", "definite": True}]}})
        assert asr_router._take_new_definite(repeat, seen) == []

    async def test_bridge_forwards_only_new_definite(self):
        sentence = {"text": "我头晕。", "definite": True, "start_time": 0, "end_time": 700}
        upstream = FakeUpstream([{"result": {"utterances": [sentence]}}, {"result": {"utterances": [sentence]}}])

        class ClosingUpstream(FakeUpstream):
            async def receive(self):
                for payload in list(self._script):
                    self._script.remove(payload)
                    yield protocol.AsrResponse(payload=payload)

        upstream.__class__ = ClosingUpstream
        ws = FakeWebSocket([])
        state = _state()

        await asyncio.wait_for(asr_router._bridge(ws, upstream, state), timeout=5)

        assert [p["type"] for p in ws.sent_json] == ["definite", "end"]
        assert state["final_parts"] == ["我头晕。"]
