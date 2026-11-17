"""语音演示（学生「电话」页）后端单测：云端 ASR/TTS 的鉴权边界与请求构造。

全程不联网、不连真实语音服务：ASR 用假 WebSocket + 假上游会话，TTS 用假连接池。
判据：
- 演示 ASR 只要求系统内已登录，**不需要** record_id、persona 或院校；日志 ``record_id`` 为 NULL；
- 训练 ASR 仍然要求本人记录（record_id 缺失/0 → 4000，非本人 → 4003）；
- 演示 TTS 没有任何 ``TrainingRecord`` 查询，情绪/分组/音色真的进了上游请求；
- 演示 TTS 的调用日志 ``record_id`` 为 NULL，成本口径与训练一致。
"""

from __future__ import annotations

import asyncio
import json
from contextlib import suppress
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import modules.voice.service as voice_service
from core.deps import get_db
from core.exceptions import AuthError, NotFoundError
from core.security import get_current_user
from infra.asr import protocol
from infra.llm.profile import get_llm_config
from infra.tts.mapper import DEFAULT_SPEAKER, resolve_context_texts
from modules.voice import asr_router
from modules.voice.demo_router import router as demo_router
from modules.voice.service import TTSService
from schemas.voice import VoiceDemoTTSRequest

# ── ASR：假对象 ──


class _FakeUpstream:
    """替身 AsrSession：记录 PCM/末包，按脚本回放，收到 stop 后推终稿。"""

    def __init__(self):
        self.sent: list[bytes] = []
        self.finished = False
        self.closed = False
        self._release = asyncio.Event()
        self._script = [{"result": {"text": "我好难受", "utterances": [{"text": "我好难受。", "definite": True}]}}]

    async def connect(self) -> None:
        pass

    async def send_full_request(self) -> None:
        pass

    async def send_audio(self, segment: bytes) -> None:
        self.sent.append(segment)

    async def finish(self) -> None:
        self.finished = True
        self._release.set()

    async def receive(self):
        for payload in list(self._script):
            self._script.remove(payload)
            yield protocol.AsrResponse(payload=payload)
        await self._release.wait()

    async def close(self) -> None:
        self.closed = True


class _FakeWebSocket:
    """只实现路由用到的 accept/receive/send_json/close。"""

    def __init__(self, incoming: list[dict]):
        self._incoming = asyncio.Queue()
        for item in incoming:
            self._incoming.put_nowait(item)
        self.accepted = False
        self.sent_json: list[dict] = []
        self.close_codes: list[int] = []

    async def accept(self) -> None:
        self.accepted = True

    async def receive(self) -> dict:
        return await self._incoming.get()

    async def send_json(self, payload: dict) -> None:
        self.sent_json.append(payload)

    async def close(self, code: int = 1000) -> None:
        self.close_codes.append(code)


def _stop_messages() -> list[dict]:
    return [
        {"type": "websocket.receive", "bytes": b"\x00\x01" * 160},
        {"type": "websocket.receive", "text": json.dumps({"type": "stop"})},
    ]


class _NullSession:
    """``_authorize`` 里只需要一个可 close 的会话（归属/密钥都已打桩）。"""

    def close(self) -> None:
        pass


def _patch_asr(monkeypatch, *, api_key: str = "asr-key", upstream=None, user_id: int = 7) -> list[dict]:
    """打桩鉴权/归属/上游；返回归属校验的调用记录。"""
    ownership_calls: list[tuple[int, int]] = []
    upstream = upstream or _FakeUpstream()

    monkeypatch.setattr(asr_router, "authenticate_ws_token", lambda token: SimpleNamespace(user_id=user_id))
    monkeypatch.setattr(asr_router, "resolve_ws_access", lambda uid, **_: True)
    monkeypatch.setattr(asr_router, "SessionLocal", _NullSession)
    monkeypatch.setattr(asr_router, "load_asr_api_key", lambda db: api_key)

    def _assert_owner(db, record_id, uid):
        ownership_calls.append((record_id, uid))

    monkeypatch.setattr(asr_router, "assert_record_owner", _assert_owner)
    monkeypatch.setattr(asr_router, "AsrSession", lambda api_key: upstream)
    return ownership_calls


def _patch_asr_log(monkeypatch) -> list[dict]:
    written: list[dict] = []
    monkeypatch.setattr(asr_router, "write_asr_log", lambda **kw: written.append(kw))
    return written


# ── ASR：演示路径 ──


class TestDemoAsr:
    def test_demo_route_needs_no_record_and_logs_null_record(self, monkeypatch):
        ownership = _patch_asr(monkeypatch)
        logs = _patch_asr_log(monkeypatch)
        ws = _FakeWebSocket(_stop_messages())

        asyncio.run(asyncio.wait_for(asr_router.voice_demo_asr(ws, token="t"), timeout=5))

        assert ownership == []  # 演示路径完全不校验训练记录归属
        assert ws.accepted is True
        assert ws.sent_json[0] == {"type": "ready"}
        assert logs
        assert logs[0]["record_id"] is None
        assert logs[0]["user_id"] == 7
        assert logs[0]["status"] == "success"
        assert logs[0]["audio_bytes"] == 320
        assert logs[0]["text_length"] == len("我好难受。")

    def test_demo_route_ignores_persona_permissions(self, monkeypatch):
        """演示 ASR 只验证登录：persona 无权也不影响，因为不读写训练数据。"""
        _patch_asr(monkeypatch)
        logs = _patch_asr_log(monkeypatch)
        monkeypatch.setattr(asr_router, "resolve_ws_access", lambda uid, **_: False)
        ws = _FakeWebSocket(_stop_messages())

        asyncio.run(asyncio.wait_for(asr_router.voice_demo_asr(ws, token="t"), timeout=5))

        assert 4003 not in ws.close_codes
        assert logs
        assert logs[0]["record_id"] is None

    def test_demo_route_rejects_bad_token(self, monkeypatch):
        _patch_asr(monkeypatch)
        logs = _patch_asr_log(monkeypatch)
        monkeypatch.setattr(asr_router, "authenticate_ws_token", lambda token: None)
        ws = _FakeWebSocket([])

        asyncio.run(asyncio.wait_for(asr_router.voice_demo_asr(ws, token="bad"), timeout=5))

        assert ws.close_codes == [4001]
        assert logs == []

    def test_demo_route_reports_unconfigured_asr(self, monkeypatch):
        _patch_asr(monkeypatch)
        _patch_asr_log(monkeypatch)

        def _raise(db):
            raise asr_router.AsrNotConfiguredError("no key")

        monkeypatch.setattr(asr_router, "load_asr_api_key", _raise)
        ws = _FakeWebSocket([])

        asyncio.run(asyncio.wait_for(asr_router.voice_demo_asr(ws, token="t"), timeout=5))

        assert ws.close_codes == [asr_router.WS_CLOSE_NOT_CONFIGURED]


# ── ASR：训练路径行为不变 ──


class TestTrainingAsrUnchanged:
    def test_training_route_requires_record_id(self, monkeypatch):
        ownership = _patch_asr(monkeypatch)
        logs = _patch_asr_log(monkeypatch)
        ws = _FakeWebSocket([])

        asyncio.run(asyncio.wait_for(asr_router.asr_stream(ws, token="t", record_id=0), timeout=5))

        assert ws.close_codes == [asr_router.WS_CLOSE_BAD_REQUEST]
        assert ownership == []
        assert logs == []

    def test_training_route_checks_ownership_and_writes_record(self, monkeypatch):
        ownership = _patch_asr(monkeypatch)
        logs = _patch_asr_log(monkeypatch)
        ws = _FakeWebSocket(_stop_messages())

        asyncio.run(asyncio.wait_for(asr_router.asr_stream(ws, token="t", record_id=42), timeout=5))

        assert ownership == [(42, 7)]
        assert logs[0]["record_id"] == 42
        assert logs[0]["status"] == "success"

    def test_training_route_rejects_foreign_record(self, monkeypatch):
        _patch_asr(monkeypatch)
        logs = _patch_asr_log(monkeypatch)

        def _deny(db, record_id, uid):
            raise asr_router.AsrForbiddenError("not mine")

        monkeypatch.setattr(asr_router, "assert_record_owner", _deny)
        ws = _FakeWebSocket([])

        asyncio.run(asyncio.wait_for(asr_router.asr_stream(ws, token="t", record_id=99), timeout=5))

        assert ws.close_codes == [4003]
        assert logs == []


def test_both_asr_paths_registered():
    paths = {getattr(r, "path", None) for r in asr_router.router.routes}
    assert {"/api/asr/stream", "/api/voice-demo/asr"} <= paths


def test_asr_log_accepts_null_record_id(monkeypatch):
    from modules.voice import asr_service

    captured = {}

    class _LogSession:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def add(self, row):
            captured["row"] = row

        def commit(self):
            pass

    monkeypatch.setattr(asr_service, "SessionLocal", _LogSession)
    asr_service.write_asr_log(
        user_id=3, record_id=None, audio_bytes=32000, text_length=4, latency_ms=9, status="success"
    )

    assert captured["row"].record_id is None
    assert captured["row"].user_id == 3
    assert captured["row"].cost_estimated == pytest.approx(round(1 / 3600, 6))  # 1s 音频照常计费


# ── TTS：演示请求构造 ──


class _LogSink:
    """把 VoiceCallLog 行收进列表，不碰数据库。"""

    def __init__(self, sink: list):
        self._sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def add(self, row):
        self._sink.append(row)

    def commit(self):
        pass


class _Pool:
    """一次流的替身连接池；记录 begin_session 收到的请求。"""

    def __init__(self, chunks: list[bytes] | None = None, usage: dict | None = None, *, hang: bool = False):
        self.captured: list = []
        self.aborted = 0
        self._chunks = chunks or [b"\x01\x02" * 240, b"\x03\x04" * 240]
        self._usage = usage
        self._hang = hang

    def acquire(self):
        pool = self

        class _Ctx:
            async def __aenter__(self):
                return _Conn(pool)

            async def __aexit__(self, *exc):
                return False

        return _Ctx()


class _Conn:
    def __init__(self, pool: _Pool):
        self._pool = pool
        self.last_usage = None

    async def begin_session(self, req):
        self._pool.captured.append(req)

    def read_stream(self):
        async def _gen():
            for chunk in self._pool._chunks:
                yield chunk
            self.last_usage = self._pool._usage

        return _gen()

    async def abort(self):
        self._pool.aborted += 1


class _NoQueryDb:
    """任何 ``query()`` 都判失败：演示路径不得碰数据库表。"""

    def query(self, *entities, **kw):
        raise AssertionError(f"demo TTS must not query {entities!r}")

    def rollback(self):
        pass


class TestDemoTtsRequest:
    def _run(self, monkeypatch, pool: _Pool, **kwargs):
        written: list = []
        monkeypatch.setattr(voice_service, "SessionLocal", lambda: _LogSink(written))

        async def _drive():
            info, gen = await TTSService(_NoQueryDb()).stream_synthesize_demo(pool=pool, timeout=5, **kwargs)
            chunks = [c async for c in gen]
            return info, chunks

        result = asyncio.run(asyncio.wait_for(_drive(), timeout=5))
        return result, written

    def test_request_carries_emotion_section_and_speaker(self, monkeypatch):
        pool = _Pool()
        info, _chunks = self._run(
            monkeypatch,
            pool,
            text="护士，我有点紧张",
            emotion_state="anxious_cooperative",
            section_id="demo-call-1",
            user_id=11,
            speaker="zh_female_qingxinnvsheng_uranus_bigtts",
        )[0]

        req = pool.captured[0]
        assert req.text == "护士，我有点紧张"
        assert req.context_texts == resolve_context_texts("anxious_cooperative")
        assert req.section_id == "demo-call-1"
        assert req.speaker == "zh_female_qingxinnvsheng_uranus_bigtts"
        assert (req.fmt, req.sample_rate) == (voice_service.STREAM_FORMAT, voice_service.STREAM_SAMPLE_RATE)
        assert info.emotion == "anxious_cooperative"
        assert info.speaker == req.speaker
        assert info.sample_rate == voice_service.STREAM_SAMPLE_RATE

    def test_absent_speaker_falls_back_to_configured_default(self, monkeypatch):
        pool = _Pool()
        self._run(
            monkeypatch,
            pool,
            text="嗯",
            emotion_state="neutral",
            section_id="s1",
            user_id=11,
            default_speaker="zh_male_taocheng_uranus_bigtts",
        )
        assert pool.captured[0].speaker == "zh_male_taocheng_uranus_bigtts"

    def test_no_default_speaker_uses_mapper_fallback(self, monkeypatch):
        pool = _Pool()
        self._run(monkeypatch, pool, text="嗯", emotion_state="neutral", section_id="s1", user_id=11)
        assert pool.captured[0].speaker == DEFAULT_SPEAKER

    def test_blank_section_id_falls_back_to_per_user_demo_marker(self, monkeypatch):
        pool = _Pool()
        self._run(monkeypatch, pool, text="嗯", emotion_state="neutral", section_id="   ", user_id=11)
        assert pool.captured[0].section_id == "demo-11"

    def test_log_written_with_null_record_and_billed_usage(self, monkeypatch):
        pool = _Pool(usage={"text_words": 500})
        (info, chunks), written = self._run(
            monkeypatch, pool, text="一" * 12, emotion_state="relaxed", section_id="s1", user_id=11
        )

        assert len(chunks) == 2  # 首块与后续块都原样下发
        row = written[0]
        assert row.record_id is None
        assert row.user_id == 11
        assert row.direction == "tts"
        assert row.text_length == 500  # 按上游 usage 计费，不是按本地字数
        assert row.status == "success"
        assert row.emotion_state == "relaxed"
        assert row.cost_estimated == pytest.approx(round(500 * voice_service._COST_PER_CHAR, 6))

    def test_unconfigured_pool_raises_not_found(self):
        async def _call():
            await TTSService(_NoQueryDb()).stream_synthesize_demo(
                text="嗯", emotion_state="neutral", section_id="s1", user_id=11, pool=None, timeout=5
            )

        with pytest.raises(NotFoundError):
            asyncio.run(_call())

    def test_training_path_still_requires_record(self, monkeypatch):
        """训练路径行为未变：没有记录 → NotFoundError，且请求未发到上游。"""
        pool = _Pool()

        class _EmptyDb:
            def query(self, *entities, **kw):
                return self

            def filter(self, *args, **kwargs):
                return self

            def first(self):
                return None

        async def _call():
            await TTSService(_EmptyDb()).stream_synthesize(
                record_id=42, text="嗯", voice_type=None, user_id=11, pool=pool, emotion_state="neutral", timeout=5
            )

        with pytest.raises(NotFoundError):
            asyncio.run(_call())
        assert pool.captured == []

    def test_training_path_rejects_foreign_record(self):
        class _ForeignDb:
            def query(self, *entities, **kw):
                return self

            def filter(self, *args, **kwargs):
                return self

            def first(self):
                return SimpleNamespace(user_id=999)

        async def _call():
            await TTSService(_ForeignDb()).stream_synthesize(
                record_id=42, text="嗯", voice_type=None, user_id=11, pool=_Pool(), emotion_state="neutral", timeout=5
            )

        with pytest.raises(AuthError):
            asyncio.run(_call())


# ── TTS：路由层 ──


def _demo_client(pool, *, tts_config=None, permissions=("training_access",)) -> TestClient:
    app = FastAPI()
    app.state.tts_pool = pool
    app.state.tts_config = (
        tts_config if tts_config is not None else {"timeout": 5, "tts_speaker": "zh_male_taocun_uranus_bigtts"}
    )
    app.include_router(demo_router)

    user = SimpleNamespace(id=11, school_id=None, is_super_admin=False)
    user.has_permission = lambda perm: perm in permissions
    user.set_permissions_cache = lambda perms: None

    async def _no_limit(*args, **kwargs):
        return None

    import modules.voice.demo_router as demo_module

    demo_module.check_tts_limit = _no_limit
    demo_module.assert_within_budget = lambda db, user, channel: None

    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[get_db] = lambda: None
    return TestClient(app)


@pytest.fixture(autouse=True)
def _restore_demo_module():
    """路由模块上的限流/预算替换是进程级的，用完还原，避免污染其他用例。"""
    import modules.voice.demo_router as demo_module

    saved = (demo_module.check_tts_limit, demo_module.assert_within_budget)
    yield
    demo_module.check_tts_limit, demo_module.assert_within_budget = saved


class TestDemoTtsRoute:
    def test_streams_pcm_with_emotion_headers(self):
        pool = _Pool()
        resp = _demo_client(pool).post(
            "/api/voice-demo/tts/stream",
            json={
                "text": "我睡不着",
                "emotion_state": "anxious_guarded",
                "section_id": "demo-call-9",
                "speaker": "zh_female_wenroumama_uranus_bigtts",
            },
        )

        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("audio/pcm")
        assert resp.headers["X-TTS-Emotion"] == "anxious_guarded"
        assert resp.headers["X-TTS-Voice"] == "zh_female_wenroumama_uranus_bigtts"
        assert resp.headers["X-TTS-Sample-Rate"] == str(voice_service.STREAM_SAMPLE_RATE)
        req = pool.captured[0]
        assert (req.section_id, req.speaker) == ("demo-call-9", "zh_female_wenroumama_uranus_bigtts")
        assert req.context_texts == resolve_context_texts("anxious_guarded")

    def test_record_id_in_body_is_rejected_not_misread(self):
        """演示请求没有 record_id 字段（``extra="forbid"``）：带上只会 422，绝不会被当成训练记录读。"""
        pool = _Pool()
        resp = _demo_client(pool).post(
            "/api/voice-demo/tts/stream",
            json={"text": "嗯", "emotion_state": "neutral", "section_id": "s", "record_id": 4242},
        )
        assert resp.status_code == 422
        assert pool.captured == []

    def test_any_authenticated_user_can_synthesize(self):
        """演示 TTS 不做 persona 权限区分：系统内登录用户即可。"""
        pool = _Pool()
        resp = _demo_client(pool, permissions=()).post(
            "/api/voice-demo/tts/stream", json={"text": "嗯", "emotion_state": "neutral", "section_id": "s"}
        )
        assert resp.status_code == 200
        assert pool.captured

    @pytest.mark.parametrize(
        "payload",
        [
            {"text": "", "emotion_state": "neutral", "section_id": "s"},
            {"text": "x" * 501, "emotion_state": "neutral", "section_id": "s"},
            {"text": "嗯", "emotion_state": "", "section_id": "s"},
            {"text": "嗯", "emotion_state": "x" * 41, "section_id": "s"},
            {"text": "嗯", "emotion_state": "neutral", "section_id": ""},
            {"text": "嗯", "emotion_state": "neutral", "section_id": "x" * 81},
            {"emotion_state": "neutral", "section_id": "s"},
        ],
    )
    def test_schema_bounds(self, payload):
        pool = _Pool()
        resp = _demo_client(pool).post("/api/voice-demo/tts/stream", json=payload)
        assert resp.status_code == 422
        assert pool.captured == []

    def test_unconfigured_tts_is_404(self):
        pool = _Pool()
        resp = _demo_client(pool, tts_config={}).post(
            "/api/voice-demo/tts/stream", json={"text": "嗯", "emotion_state": "neutral", "section_id": "s"}
        )
        assert resp.status_code == 404
        assert pool.captured == []


def test_demo_tts_schema_defaults_speaker_to_none():
    req = VoiceDemoTTSRequest(text="嗯", emotion_state="neutral", section_id="s")
    assert req.speaker is None


def test_demo_route_path_registered():
    paths = {getattr(r, "path", None) for r in demo_router.routes}
    assert "/api/voice-demo/tts/stream" in paths


def test_bridge_uses_null_record_in_state(monkeypatch):
    """演示状态里的 record_id 为 None 时，音频上限日志也不会格式化失败。"""
    state = {
        "send_lock": asyncio.Lock(),
        "record_id": None,
        "audio_bytes": 0,
        "final_parts": [],
        "definite_seen": set(),
    }
    ws = _FakeWebSocket(_stop_messages())
    upstream = _FakeUpstream()

    with suppress(Exception):
        asyncio.run(asyncio.wait_for(asr_router._bridge(ws, upstream, state), timeout=5))

    assert state["audio_bytes"] == 320
    assert upstream.sent == [b"\x00\x01" * 160]
    assert ws.sent_json[-1] == {"type": "end"}


# ── LLM 自由对话（真实 LLM 基础设施，假客户端） ──


class _FakeLLM:
    """替身 llm_client：记录每次 stream 调用的参数，按脚本逐块吐出/抛错。"""

    def __init__(self, script: list, *, fail_times: int = 0):
        self.calls: list[dict] = []
        self._script = script
        self._fail_times = fail_times

    def stream(self, messages, *, purpose, ctx, **kwargs):
        self.calls.append({"messages": messages, "purpose": purpose, "ctx": ctx, "kwargs": kwargs})
        if self._fail_times > 0:
            self._fail_times -= 1

            async def _boom():
                raise RuntimeError("upstream down")
                yield b""  # pragma: no cover

            return _boom()
        script = list(self._script)

        async def _gen():
            for chunk in script:
                yield chunk

        return _gen()


def _frames(chunks: list[str]) -> list[dict]:
    return [json.loads(c.removeprefix("data: ").strip()) for c in chunks]


def _drive(coro_factory):
    async def _run():
        out = []
        async for frame in coro_factory():
            out.append(json.loads(frame.removeprefix("data: ").strip()))
        return out

    return asyncio.run(asyncio.wait_for(_run(), timeout=5))


class TestDemoChatStream:
    def _reply(self, fake, **kwargs):
        from modules.voice.demo_chat import stream_demo_reply
        from modules.voice.demo_prompt import CHARACTERS

        params = {
            "llm_client": fake,
            "character": CHARACTERS["lin-wanqing"],
            "history": [{"role": "user", "content": "林护士，我头有点晕"}],
            "emotion_state": "anxious_cooperative",
            "user_id": 11,
            "session_id": "call-1",
        }
        params.update(kwargs)
        return _drive(lambda: stream_demo_reply(**params))

    def test_streams_content_then_done(self):
        fake = _FakeLLM(["我", "看一眼", "啊，先坐下。"])
        frames = self._reply(fake)

        assert [f.get("content") for f in frames[:-1]] == ["我", "看一眼", "啊，先坐下。"]
        done = frames[-1]
        assert done["done"] is True
        assert done["character_id"] == "lin-wanqing"
        assert done["emotion_state"] == "anxious_cooperative"
        assert done["speaker"] == "zh_female_qingxinnvsheng_uranus_bigtts"
        assert done["long_response"] is False

    def test_uses_voice_demo_purpose_and_no_record(self):
        fake = _FakeLLM(["好"])
        self._reply(fake)

        call = fake.calls[0]
        assert call["purpose"] == "voice_demo"
        assert call["ctx"].purpose == "voice_demo"
        assert call["ctx"].record_id is None  # 绝不挂训练记录
        assert call["ctx"].user_id == 11
        # 客户端级重试必须为 0：本层自己重试，避免重放已下发内容
        assert call["kwargs"]["max_retries"] == 0
        assert call["kwargs"]["max_tokens"] == get_llm_config("voice_demo")["max_tokens"]

    def test_prompt_carries_character_and_emotion(self):
        fake = _FakeLLM(["嗯"])
        self._reply(fake, emotion_state="irritated")

        messages = fake.calls[0]["messages"]
        system = messages[0]
        assert system["role"] == "system"
        assert "林婉清" in system["content"]
        assert "急性子朋友" in system["content"]
        assert "急脾气" in system["content"]  # 性格
        assert "irritated" in system["content"]
        assert "不耐烦" in system["content"]  # 四维情绪
        assert messages[1] == {"role": "user", "content": "林护士，我头有点晕"}

    def test_long_response_changes_length_rule(self):
        plain = self._reply(_FakeLLM(["嗯"]))
        long = self._reply(_FakeLLM(["嗯"]), long_response=True)

        assert long[-1]["long_response"] is True
        assert plain[-1]["long_response"] is False

    def test_retry_when_nothing_emitted(self):
        fake = _FakeLLM(["好"], fail_times=1)
        frames = self._reply(fake)

        assert len(fake.calls) == 2  # 一次失败 + 一次成功
        assert [f.get("content") for f in frames[:-1]] == ["好"]
        assert frames[-1]["done"] is True

    def test_gives_up_after_two_failures(self):
        fake = _FakeLLM([], fail_times=2)
        frames = self._reply(fake)

        assert len(fake.calls) == 2
        assert frames[-1]["code"] == "chat.llm_unavailable"
        assert "error" in frames[-1]

    def test_midstream_failure_stops_without_replaying(self):
        class _HalfThenBoom:
            def __init__(self):
                self.calls = 0

            def stream(self, messages, *, purpose, ctx, **kwargs):
                self.calls += 1

                async def _gen():
                    yield "我先说一半"
                    raise RuntimeError("dropped")

                return _gen()

        fake = _HalfThenBoom()
        frames = self._reply(fake)

        assert fake.calls == 1  # 已经发声后不再整体重说
        assert frames[0] == {"content": "我先说一半"}
        assert frames[-1]["code"] == "chat.llm_unavailable"

    def test_empty_reply_is_reported(self):
        frames = self._reply(_FakeLLM([]))
        assert frames[-1]["code"] == "chat.llm_empty_reply"


class TestDemoChatRoute:
    def _client(self, llm_client, *, permissions=("training_access",)):
        app = FastAPI()
        app.state.llm_client = llm_client
        app.include_router(demo_router)

        user = SimpleNamespace(id=11, school_id=None, is_super_admin=False)
        user.has_permission = lambda perm: perm in permissions
        user.set_permissions_cache = lambda perms: None

        import modules.voice.demo_router as demo_module

        demo_module.assert_within_budget = lambda db, user, channel: None
        app.dependency_overrides[get_current_user] = lambda: user
        app.dependency_overrides[get_db] = lambda: SimpleNamespace(rollback=lambda: None)
        return TestClient(app)

    def test_unknown_character_is_400_before_streaming(self):
        fake = _FakeLLM(["嗯"])
        resp = self._client(fake).post(
            "/api/voice-demo/chat/stream",
            json={"character_id": "nobody", "session_id": "s1", "history": [{"role": "user", "content": "hi"}]},
        )
        assert resp.status_code == 400
        assert fake.calls == []

    def test_any_authenticated_user_can_chat(self):
        """演示聊天不做 persona 权限区分：系统内登录用户即可。"""
        fake = _FakeLLM(["嗯"])
        resp = self._client(fake, permissions=()).post(
            "/api/voice-demo/chat/stream",
            json={"character_id": "su-xiaoman", "session_id": "s1", "history": [{"role": "user", "content": "hi"}]},
        )
        assert resp.status_code == 200
        assert fake.calls

    def test_streams_sse_with_long_response_flag(self):
        fake = _FakeLLM(["先说一句，", "再补一句。"])
        resp = self._client(fake).post(
            "/api/voice-demo/chat/stream",
            json={
                "character_id": "zhou-zhenguo",
                "session_id": "s-long",
                "history": [{"role": "user", "content": "陈医生，讲讲血压吧"}],
                "emotion_state": "relaxed",
                "test_mode": "long_response",
            },
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        frames = _frames([line for line in resp.text.split("\n\n") if line.strip()])
        assert [f.get("content") for f in frames[:-1]] == ["先说一句，", "再补一句。"]
        assert frames[-1]["done"] is True
        assert frames[-1]["long_response"] is True
        assert "4-6 句" in fake.calls[0]["messages"][0]["content"]

    def test_extra_fields_rejected(self):
        fake = _FakeLLM(["嗯"])
        resp = self._client(fake).post(
            "/api/voice-demo/chat/stream",
            json={
                "character_id": "su-xiaoman",
                "session_id": "s1",
                "history": [{"role": "user", "content": "hi"}],
                "record_id": 7,
            },
        )
        assert resp.status_code == 422
        assert fake.calls == []

    def test_characters_endpoint_is_authoritative(self):
        resp = self._client(_FakeLLM([])).get("/api/voice-demo/characters")
        assert resp.status_code == 200
        items = resp.json()
        assert {c["id"] for c in items} == {"lin-wanqing", "zhou-zhenguo", "su-xiaoman", "he-jianfeng"}
        assert all(c["speaker"].endswith("_uranus_bigtts") for c in items)
        # 不为前端留后门：公开字段里没有提示词
        assert all("personality" in c and "system" not in c for c in items)


class TestDemoLogCollection:
    """采集行只写 voice_demo_logs（追加），且中断时保留已生成部分。"""

    def _capture(self, monkeypatch) -> list[dict]:
        rows: list[dict] = []
        from modules.voice import demo_chat

        monkeypatch.setattr(demo_chat, "append_demo_logs", lambda batch: rows.extend(batch))
        return rows

    def _run(self, fake, monkeypatch, **kwargs):
        from modules.voice.demo_chat import stream_demo_reply
        from modules.voice.demo_prompt import CHARACTERS

        params = {
            "llm_client": fake,
            "character": CHARACTERS["su-xiaoman"],
            "history": [{"role": "user", "content": "苏护士，我怕打针"}],
            "emotion_state": "anxious_guarded",
            "user_id": 11,
            "session_id": "call-9",
        }
        params.update(kwargs)
        return _drive(lambda: stream_demo_reply(**params))

    def test_success_writes_user_and_assistant(self, monkeypatch):
        rows = self._capture(monkeypatch)
        self._run(_FakeLLM(["好", "我轻点。"]), monkeypatch)

        assert [r["role"] for r in rows] == ["user", "assistant"]
        assert rows[0]["content"] == "苏护士，我怕打针"
        assert rows[1]["content"] == "好我轻点。"
        assert rows[1]["status"] == "success"
        assert rows[1]["error"] is None
        for row in rows:
            assert row["user_id"] == 11
            assert row["session_id"] == "call-9"
            assert row["character_id"] == "su-xiaoman"
            assert row["emotion_state"] == {"dominant_state": "anxious_guarded"}
            assert "record_id" not in row  # 采集行绝不挂训练记录

    def test_interrupt_keeps_partial_reply(self, monkeypatch):
        rows = self._capture(monkeypatch)

        class _Half:
            def stream(self, messages, *, purpose, ctx, **kwargs):
                async def _gen():
                    yield "我先说一半"
                    raise RuntimeError("dropped")

                return _gen()

        self._run(_Half(), monkeypatch)

        assistant = rows[-1]
        assert assistant["role"] == "assistant"
        assert assistant["content"] == "我先说一半"  # 已生成部分必须保留
        assert assistant["status"] == "interrupted"
        assert "RuntimeError" in assistant["error"]

    def test_total_failure_writes_error_rows(self, monkeypatch):
        rows = self._capture(monkeypatch)
        self._run(_FakeLLM([], fail_times=2), monkeypatch)

        assert rows[-1]["status"] == "error"
        assert rows[-1]["content"] == ""
        assert rows[-1]["error"]

    def test_writer_is_best_effort(self, monkeypatch):
        """采集失败不能影响已经播出去的对话。"""
        from modules.voice import demo_chat

        class _Broken:
            def __enter__(self):
                raise RuntimeError("db down")

            def __exit__(self, *exc):
                return False

        monkeypatch.setattr(demo_chat, "SessionLocal", _Broken)
        demo_chat.append_demo_logs([{"user_id": 1}])  # 不抛


def test_demo_log_model_has_no_training_link():
    from models import VoiceDemoLog

    cols = set(VoiceDemoLog.__table__.columns.keys())
    assert {"user_id", "session_id", "character_id", "role", "content", "emotion_state", "status", "error"} <= cols
    assert "record_id" not in cols  # 采集表与训练档案彻底解耦


def test_migration_chains_to_permission_merge():
    from pathlib import Path

    src = Path(__file__).resolve().parents[2] / "migrations/versions/ddl/a7d3f0b81c64_add_voice_demo_logs.py"
    text = src.read_text(encoding="utf-8")
    assert 'down_revision: Union[str, Sequence[str], None] = "c5a8e1f3d7b2"' in text
    assert "def downgrade()" in text
    assert 'op.drop_table("voice_demo_logs")' in text


def test_history_is_bounded_and_must_start_with_user():
    from modules.voice.demo_prompt import CHARACTERS, MAX_HISTORY_TURNS, build_messages

    history = [{"role": "assistant", "content": "先说话的是我"}] + [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"m{i}"} for i in range(60)
    ]
    messages = build_messages(CHARACTERS["he-jianfeng"], "neutral", history)
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"  # 首条非 system 必须是用户输入
    assert len(messages) - 1 <= MAX_HISTORY_TURNS
