"""TTS synthesis business logic."""

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sqlalchemy.orm import Session

from core.config import TTS_POOL_SIZE
from core.exceptions import AuthError, NotFoundError
from core.gender import normalize_gender
from infra.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infra.tts.client import TTSRequest, VolcBidirectionalTTSClient, VolcTTSConnection
from infra.tts.mapper import resolve_emotion_context, resolve_voice_type
from infra.tts.pool import TTSConnectionPool
from models import Case, TrainingRecord, VoiceCallLog
log = logging.getLogger(__name__)

_DEFAULT_TTS_CONFIG = {
    "model": "seed-tts-2.0-standard",
    "format": "mp3",
    "sample_rate": 24000,
}

# Streaming path is fixed PCM 24kHz 16-bit mono — the Web Audio player
# schedules raw PCM sample-accurately without decoding.
STREAM_FORMAT = "pcm"
STREAM_SAMPLE_RATE = 24000

# Rough list-price estimate per billed character (CNY). Only the base changed
# from "input chars" to "usage.text_words"; the rate itself is unchanged.
_COST_PER_CHAR = 0.000_002


def load_tts_state(app_state, db: Session) -> None:
    """(Re)load ``app_state.tts_client``/``tts_pool``/``tts_config`` from the
    active VoiceConfig.

    Single source of truth shared by startup (``main.py``) and the admin
    reload after a config save. Setting ``tts_config`` here is what keeps the
    ``/api/tts/synthesize`` router usable after a cold start — without it the
    router treats an empty config as "TTS 未配置" and always 404s.
    """
    from models import VoiceConfig

    old_pool = getattr(app_state, "tts_pool", None)
    if old_pool is not None:
        old_pool.close_sync()
    app_state.tts_pool = None

    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    app_state.tts_config = {
        "model": vc.tts_model if vc else _DEFAULT_TTS_CONFIG["model"],
        "format": vc.tts_format if vc else _DEFAULT_TTS_CONFIG["format"],
        "sample_rate": vc.tts_sample_rate if vc else _DEFAULT_TTS_CONFIG["sample_rate"],
        "timeout": vc.tts_timeout if vc else 8,
        "speaker_library": vc.speaker_library if vc else None,
    }

    if vc and vc.api_key:
        api_key = vc.api_key
        if api_key:
            app_state.tts_client = VolcBidirectionalTTSClient(
                api_key=api_key,
                resource_id=vc.tts_resource_id,
                timeout=vc.tts_timeout,
            )
            app_state.tts_pool = TTSConnectionPool(
                api_key=api_key,
                resource_id=vc.tts_resource_id,
                size=TTS_POOL_SIZE,
            )
            log.info("TTS client+pool ready (resource_id=%s)", vc.tts_resource_id)
            return
        log.warning("TTS client: api_key empty or integrity check failed")

    app_state.tts_client = None
    log.info("TTS client cleared (no usable active config)")


_AUDIO_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
    "ogg_opus": "audio/ogg",
}

_TTS_CIRCUIT_BREAKER = TTSCircuitBreaker(failure_threshold=3, cooldown_seconds=300)


@dataclass
class TTSStreamInfo:
    speaker: str
    emotion: str
    sample_rate: int


class TTSService:
    def __init__(self, db: Session):
        self.db = db

    def _resolve_request(
        self,
        record_id: int,
        text: str,
        voice_type: str | None,
        user_id: int,
        emotion_state: str,
        fmt: str,
        sample_rate: int,
        speaker_library: dict | None,
    ) -> TTSRequest:
        record = self.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise NotFoundError("训练记录不存在")
        if record.user_id != user_id:
            raise AuthError("只能操作自己的训练")

        case = self.db.query(Case).filter(Case.id == record.case_id).first()
        if not case:
            raise NotFoundError("病例不存在")

        age, gender = _extract_demographics(case)
        override = _extract_voice_override(case)
        speaker = resolve_voice_type(
            voice_type,
            age,
            gender,
            speaker_library=speaker_library,
            override=override,
        )
        return TTSRequest(
            text=text,
            speaker=speaker,
            context_texts=resolve_emotion_context(emotion_state),
            fmt=fmt,
            sample_rate=sample_rate,
        )
    def _write_log(
        self,
        *,
        user_id: int,
        record_id: int,
        emotion_state: str,
        text_length: int,
        latency_ms: int,
        status: str,
    ) -> None:
        cost = round(text_length * _COST_PER_CHAR, 6) if status == "success" else 0.0
        try:
            self.db.add(
                VoiceCallLog(
                    user_id=user_id,
                    record_id=record_id,
                    direction="tts",
                    text_length=text_length,
                    emotion_state=emotion_state,
                    latency_ms=latency_ms,
                    status=status,
                    cost_estimated=cost,
                )
            )
            self.db.flush()
        except Exception:
            log.warning("TTS: failed to write call log", exc_info=True)

    async def synthesize(
        self,
        record_id: int,
        text: str,
        voice_type: str | None,
        user_id: int,
        client: VolcBidirectionalTTSClient | None,
        emotion_state: str,
        tts_format: str,
        tts_sample_rate: int,
        speaker_library: dict | None = None,
    ) -> tuple[bytes, str, str, int, str]:
        if client is None:
            raise NotFoundError("TTS 服务未配置（请先在管理面板添加语音配置）")

        tts_req = self._resolve_request(
            record_id, text, voice_type, user_id, emotion_state, tts_format, tts_sample_rate, speaker_library
        )

        t0 = time.perf_counter()
        try:
            audio = await _TTS_CIRCUIT_BREAKER.call(client.synthesize, tts_req)
        except CircuitOpenError:
            raise
        except Exception as e:
            log.error("TTS synthesis failed: record_id=%s user_id=%s error=%s", record_id, user_id, e)
            raise RuntimeError(f"TTS 合成失败: {str(e)[:200]}")

        latency_ms = int((time.perf_counter() - t0) * 1000)
        self._write_log(
            user_id=user_id,
            record_id=record_id,
            emotion_state=emotion_state,
            text_length=len(text),
            latency_ms=latency_ms,
            status="success",
        )

        media_type = _AUDIO_MEDIA_TYPES.get(tts_format, "application/octet-stream")
        assert isinstance(audio, bytes), "TTS synthesize must return bytes"
        return audio, emotion_state, tts_req.speaker, latency_ms, media_type

    async def stream_synthesize(
        self,
        *,
        record_id: int,
        text: str,
        voice_type: str | None,
        user_id: int,
        pool: TTSConnectionPool | None,
        emotion_state: str,
        timeout: int,
        speaker_library: dict | None = None,
    ) -> tuple[TTSStreamInfo, AsyncIterator[bytes]]:
        """Open a pooled session eagerly, then return a chunk generator.

        Pool acquisition + session start happen before the response starts
        streaming, so upstream failures still map to proper HTTP status codes.
        """
        if pool is None:
            raise NotFoundError("TTS 服务未配置（请先在管理面板添加语音配置）")

        tts_req = self._resolve_request(
            record_id, text, voice_type, user_id, emotion_state, STREAM_FORMAT, STREAM_SAMPLE_RATE, speaker_library
        )
        info = TTSStreamInfo(speaker=tts_req.speaker, emotion=emotion_state, sample_rate=STREAM_SAMPLE_RATE)

        t0 = time.perf_counter()
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout

        def _remaining() -> float:
            left = deadline - loop.time()
            if left <= 0:
                raise TimeoutError(f"TTS 合成超时（{timeout}s）")
            return left

        # Eager phase — CircuitOpenError / RuntimeError propagate pre-headers.
        conn_ctx = pool.acquire()

        async def _acquire() -> VolcTTSConnection:
            return await conn_ctx.__aenter__()

        conn = await _TTS_CIRCUIT_BREAKER.call(_acquire)
        try:
            await asyncio.wait_for(conn.begin_session(tts_req), timeout=_remaining())
        except Exception:
            await conn_ctx.__aexit__(None, None, None)
            raise

        async def _gen() -> AsyncIterator[bytes]:
            first_chunk_ms: int | None = None
            billed_words = 0
            status = "error"
            completed = False
            try:
                stream = conn.read_stream()
                while True:
                    try:
                        chunk = await asyncio.wait_for(anext(stream), timeout=_remaining())
                    except (TimeoutError, asyncio.CancelledError):
                        break  # timeout or client disconnect — end stream cleanly
                    except StopAsyncIteration:
                        completed = True
                        break
                    if first_chunk_ms is None:
                        first_chunk_ms = int((time.perf_counter() - t0) * 1000)
                    yield chunk
                status = "success"
            finally:
                if not completed:
                    # Interrupted session (timeout/client abort) — frames are
                    # still in flight; the connection is poisoned, never reuse.
                    await conn.abort()
                await conn_ctx.__aexit__(None, None, None)
                if isinstance(conn.last_usage, dict):
                    words = conn.last_usage.get("text_words")
                    if isinstance(words, int) and words > 0:
                        billed_words = words
                latency = first_chunk_ms if first_chunk_ms is not None else int((time.perf_counter() - t0) * 1000)
                self._write_log(
                    user_id=user_id,
                    record_id=record_id,
                    emotion_state=emotion_state,
                    text_length=billed_words or len(text),
                    latency_ms=latency,
                    status=status,
                )

        return info, _gen()


def _extract_demographics(case: Case) -> tuple[int | None, str | None]:
    case_data = case.case_data or {}
    pi = case_data.get("patient_info") or {}
    age = pi.get("age") or case_data.get("age") or case_data.get("patient_age")
    if age is not None:
        try:
            age = int(age)
        except (TypeError, ValueError):
            age = None
    raw_gender = pi.get("gender") or case_data.get("gender") or case_data.get("patient_gender")
    gender = normalize_gender(raw_gender)
    return age, gender


def _extract_voice_override(case: Case) -> str | None:
    """Highest‑priority case‑level custom voice ID from ``case_data.voice_override``."""
    case_data = case.case_data or {}
    override = case_data.get("voice_override")
    if override and isinstance(override, str) and override.strip():
        return override.strip()
    return None
