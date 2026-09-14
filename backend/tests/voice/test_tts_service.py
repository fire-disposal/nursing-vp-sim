"""TTSService：供应商 Protocol 注入 + 调用日志落库。

回归目标（review qa-voice-tools #7）：
  - 业务逻辑只依赖 TTSCapability/TTSConnectionProvider，可用假实现直接驱动；
  - 调用日志（含失败）写在独立事务里并 commit——挂在请求 session 上的行随
    ``get_db()`` 的 close 一起回滚，运营/成本视图恒为空。
"""

from types import SimpleNamespace

import pytest

from core.exceptions import AuthError, NotFoundError
from modules.voice import service as voice_service
from modules.voice.service import TTSCapability, TTSConnectionProvider, TTSService, TTSStreamConnection


class _RecordingSession:
    """独立日志 session 的替身：记录 add/commit。"""

    def __init__(self):
        self.rows = []
        self.commits = 0

    def add(self, row):
        self.rows.append(row)

    def commit(self):
        self.commits += 1

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _PassthroughBreaker:
    async def call(self, fn, *args, **kwargs):
        return await fn(*args, **kwargs)


class _FakeCapability:
    """满足 TTSCapability 的假供应商（无 Volc 依赖即可驱动业务逻辑）。"""

    def __init__(self, audio: bytes = b"audio-bytes", error: Exception | None = None):
        self.audio = audio
        self.error = error
        self.requests: list = []

    async def synthesize(self, req):
        self.requests.append(req)
        if self.error is not None:
            raise self.error
        return self.audio


class _FakeDB:
    """按调用顺序返回查询对象（TrainingRecord → Case）。"""

    def __init__(self, *rows):
        self._rows = list(rows)

    def query(self, *_args):
        return self

    def filter(self, *_args):
        return self

    def first(self):
        return self._rows.pop(0)


@pytest.fixture
def log_sink(monkeypatch):
    sink = _RecordingSession()
    monkeypatch.setattr(voice_service, "SessionLocal", lambda: sink)
    # 熔断器是模块级单例：测试里旁路，避免污染其他用例的熔断计数
    monkeypatch.setattr(voice_service, "_TTS_CIRCUIT_BREAKER", _PassthroughBreaker())
    return sink


def _service(user_id: int = 10) -> TTSService:
    record = SimpleNamespace(id=1, user_id=user_id, case_id=2)
    case = SimpleNamespace(case_data={"patient_info": {"age": 40, "gender": "男"}})
    return TTSService(_FakeDB(record, case))


async def _synthesize(service: TTSService, capability, user_id: int = 10):
    return await service.synthesize(
        record_id=1,
        text="你好",
        voice_type=None,
        user_id=user_id,
        client=capability,
        emotion_state="neutral",
        tts_format="mp3",
        tts_sample_rate=24000,
    )


@pytest.mark.asyncio
async def test_synthesize_returns_audio_from_injected_capability(log_sink):
    service = _service()
    capability = _FakeCapability()

    audio, emotion, speaker, latency_ms, media_type = await _synthesize(service, capability)

    assert audio == b"audio-bytes"
    assert emotion == "neutral"
    assert speaker
    assert latency_ms >= 0
    assert media_type == "audio/mpeg"
    assert len(capability.requests) == 1


@pytest.mark.asyncio
async def test_successful_call_is_logged_and_committed(log_sink):
    service = _service()

    await _synthesize(service, _FakeCapability())

    assert len(log_sink.rows) == 1
    row = log_sink.rows[0]
    assert row.direction == "tts"
    assert row.status == "success"
    assert row.text_length == len("你好")
    assert row.cost_estimated > 0
    assert log_sink.commits == 1


@pytest.mark.asyncio
async def test_failed_call_is_logged_with_error_status(log_sink):
    service = _service()

    with pytest.raises(RuntimeError):
        await _synthesize(service, _FakeCapability(error=RuntimeError("upstream 500")))

    assert [row.status for row in log_sink.rows] == ["error"]
    assert log_sink.rows[0].cost_estimated == 0.0
    assert log_sink.commits == 1


@pytest.mark.asyncio
async def test_missing_capability_raises_not_found(log_sink):
    service = _service()

    with pytest.raises(NotFoundError):
        await _synthesize(service, None)

    assert log_sink.rows == []


@pytest.mark.asyncio
async def test_other_users_record_is_rejected(log_sink):
    service = _service(user_id=99)

    with pytest.raises(AuthError):
        await _synthesize(service, _FakeCapability(), user_id=10)

    assert log_sink.rows == []


@pytest.mark.asyncio
async def test_log_failure_does_not_break_synthesis(monkeypatch):
    """日志写入失败不得影响合成结果（best-effort）。"""

    def _boom():
        raise RuntimeError("db down")

    monkeypatch.setattr(voice_service, "SessionLocal", _boom)
    monkeypatch.setattr(voice_service, "_TTS_CIRCUIT_BREAKER", _PassthroughBreaker())

    audio, *_ = await _synthesize(_service(), _FakeCapability())

    assert audio == b"audio-bytes"


def test_volc_implementation_satisfies_the_protocols():
    """infra/tts 的实现必须满足 modules/voice 声明的协议（供应商缝不被漂移破坏）。"""
    from infra.tts.client import VolcBidirectionalTTSClient, VolcTTSConnection
    from infra.tts.pool import TTSConnectionPool

    assert isinstance(VolcBidirectionalTTSClient(api_key="k", resource_id="r", timeout=1), TTSCapability)
    assert isinstance(TTSConnectionPool(api_key="k", resource_id="r", size=1), TTSConnectionProvider)
    assert isinstance(VolcTTSConnection(api_key="k"), TTSStreamConnection)
