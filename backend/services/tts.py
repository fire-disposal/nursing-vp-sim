"""TTS synthesis business logic."""

import logging
import time

from sqlalchemy.orm import Session

from core.exceptions import AuthError, NotFoundError
from infrastructure.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infrastructure.tts.client import VolcTTSClient
from infrastructure.tts.mapper import emotion_to_tts, resolve_voice_type
from models import Case, TrainingRecord, VoiceCallLog

log = logging.getLogger(__name__)

_AUDIO_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "wav": "audio/wav",
    "pcm": "audio/pcm",
    "ogg_opus": "audio/ogg",
}

_TTS_CIRCUIT_BREAKER = TTSCircuitBreaker(failure_threshold=3, cooldown_seconds=300)


class TTSService:
    def __init__(self, db: Session):
        self.db = db

    async def synthesize(
        self,
        record_id: int,
        text: str,
        voice_type: str | None,
        user_id: int,
        client: VolcTTSClient | None,
        emotion_state: str,
        tts_model: str,
        tts_format: str,
        tts_sample_rate: int,
    ) -> tuple[bytes, str, str, int, str]:
        record = self.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise NotFoundError("训练记录不存在")
        if record.user_id != user_id:
            raise AuthError("只能操作自己的训练")

        case = self.db.query(Case).filter(Case.id == record.case_id).first()
        if not case:
            raise NotFoundError("病例不存在")

        if client is None:
            raise NotFoundError("TTS 服务未配置（请先在管理面板添加语音配置）")

        age, gender = _extract_demographics(case)
        speaker = resolve_voice_type(voice_type, age, gender)

        tts_req = emotion_to_tts(
            text=text,
            state=emotion_state,
            speaker=speaker,
            model=tts_model,
            fmt=tts_format,
            sample_rate=tts_sample_rate,
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
        cost = round(len(text) * 0.000_002, 6)

        call_log = VoiceCallLog(
            user_id=user_id,
            record_id=record_id,
            direction="tts",
            text_length=len(text),
            emotion_state=emotion_state,
            latency_ms=latency_ms,
            status="success",
            cost_estimated=cost,
        )
        self.db.add(call_log)
        self.db.commit()

        media_type = _AUDIO_MEDIA_TYPES.get(tts_format, "application/octet-stream")
        assert isinstance(audio, bytes), "TTS synthesize must return bytes"
        return audio, emotion_state, speaker, latency_ms, media_type


def _extract_demographics(case: Case) -> tuple[int | None, str | None]:
    case_data = case.case_data or {}
    age = case_data.get("age") or case_data.get("patient_age")
    if age is not None:
        try:
            age = int(age)
        except (TypeError, ValueError):
            age = None
    gender = case_data.get("gender") or case_data.get("patient_gender")
    return age, gender
