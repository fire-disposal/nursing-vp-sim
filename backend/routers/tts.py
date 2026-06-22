"""TTS synthesis router — emotionally-expressive patient voice."""

import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from contexts.patient.emotion import get_emotion
from core.database import get_db
from core.security import get_current_user
from infrastructure.tts.circuit import CircuitOpenError, TTSCircuitBreaker
from infrastructure.tts.client import VolcTTSClient
from infrastructure.tts.mapper import emotion_to_tts, resolve_voice_type
from middleware.rate_limits import check_tts_limit
from models import Case, TrainingRecord, User, VoiceCallLog
from schemas.voice import TTSSynthesizeRequest

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["TTS"])

_tts_circuit_breaker = TTSCircuitBreaker(failure_threshold=3, cooldown_seconds=300)


def _estimate_cost(text_length: int) -> float:
    """Rough cost estimate for Volcengine TTS (CNY per character)."""
    return round(text_length * 0.000_002, 6)


def _extract_demographics(case: Case) -> tuple[int | None, str | None]:
    """Extract patient age and gender from case_data JSONB."""
    case_data = case.case_data or {}
    age = case_data.get("age") or case_data.get("patient_age")
    if age is not None:
        try:
            age = int(age)
        except (TypeError, ValueError):
            age = None
    gender = case_data.get("gender") or case_data.get("patient_gender")
    return age, gender


@router.post("/synthesize")
async def synthesize(
    req: TTSSynthesizeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
) -> Response:
    """Synthesize patient speech with emotion-aware voice.

    Looks up the training record's current emotional state and maps it
    to TTS parameters (emotion + speech rate), then calls Volcengine TTS.
    """
    await check_tts_limit(current_user.id, request)

    record = db.query(TrainingRecord).filter(TrainingRecord.id == req.record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    client: VolcTTSClient | None = request.app.state.tts_client
    if client is None:
        raise HTTPException(status_code=503, detail="TTS 服务未配置（请先在管理面板添加 VoiceConfig 或设置环境变量）")

    emotion_cache = getattr(request.app.state, "emotion_cache", None)
    emotion_state = "neutral"
    if emotion_cache is not None:
        emotion = get_emotion(req.record_id, emotion_cache, db)
        emotion_state = emotion.state

    age, gender = _extract_demographics(case)
    voice_type = resolve_voice_type(req.voice_type, age, gender)

    tts_req = emotion_to_tts(text=req.text, state=emotion_state, voice=voice_type)

    t0 = time.perf_counter()
    status = "success"
    error_info = ""
    try:
        audio = await _tts_circuit_breaker.call(client.synthesize, tts_req)
    except CircuitOpenError:
        raise HTTPException(status_code=503, detail="TTS 服务暂时不可用，已切换浏览器端语音")
    except Exception as e:
        status = "error"
        error_info = str(e)[:500]
        log.error("TTS synthesis failed: record_id=%s user_id=%s error=%s", req.record_id, current_user.id, e)
        raise HTTPException(status_code=502, detail=f"TTS 合成失败: {error_info[:200]}")

    latency_ms = int((time.perf_counter() - t0) * 1000)
    cost = _estimate_cost(len(req.text))

    call_log = VoiceCallLog(
        user_id=current_user.id,
        record_id=req.record_id,
        direction="tts",
        text_length=len(req.text),
        emotion_state=emotion_state,
        latency_ms=latency_ms,
        status=status,
        cost_estimated=cost,
    )
    db.add(call_log)
    db.commit()

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "X-TTS-Emotion": emotion_state,
            "X-TTS-Voice": voice_type,
            "X-TTS-Latency-Ms": str(latency_ms),
        },
    )
