"""TTS synthesis router — emotionally-expressive patient voice."""

import logging
import os
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from contexts.patient.emotion import get_emotion
from core.database import get_db
from core.security import get_current_user
from infrastructure.llm.crypto_utils import decrypt_api_key
from infrastructure.tts.client import VolcTTSClient
from infrastructure.tts.mapper import emotion_to_tts
from models import Case, TrainingRecord, User, VoiceCallLog, VoiceConfig
from schemas.voice import TTSSynthesizeRequest

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["TTS"])

_tts_client: VolcTTSClient | None = None
_tts_client_config_id: int | None = None


def _get_tts_client(db: Session) -> VolcTTSClient | None:
    """Resolve TTS client from DB VoiceConfig, falling back to env vars.

    Uses a module-level cache — invalidated when the active config changes.
    """
    global _tts_client, _tts_client_config_id

    config = db.query(VoiceConfig).filter(VoiceConfig.is_active == True, VoiceConfig.provider == "volcengine").first()
    if config:
        if _tts_client is not None and _tts_client_config_id == config.id:
            return _tts_client
        try:
            token = decrypt_api_key(config.token_enc)
        except Exception:
            log.exception("Failed to decrypt TTS token for config id=%s", config.id)
            return None
        _tts_client = VolcTTSClient(
            app_id=config.app_id,
            token=token,
            timeout=config.tts_timeout,
        )
        _tts_client_config_id = config.id
        return _tts_client

    # Fallback to env vars
    app_id = os.getenv("VOLC_TTS_APP_ID", "")
    token = os.getenv("VOLC_TTS_TOKEN", "")
    if not app_id or not token:
        return None

    if _tts_client is not None and _tts_client_config_id == 0:
        return _tts_client

    _tts_client = VolcTTSClient(app_id=app_id, token=token)
    _tts_client_config_id = 0
    return _tts_client


def _resolve_voice_type(case: Case, config: VoiceConfig | None) -> str:
    """Resolve voice_type: case_data → config default → hardcoded default."""
    case_data = case.case_data or {}
    vt = case_data.get("voice_type") or case_data.get("tts_voice_type")
    if vt:
        return vt
    if config and config.tts_voice_type:
        return config.tts_voice_type
    return "zh_female_vv"


def _estimate_cost(text_length: int) -> float:
    """Rough cost estimate for Volcengine TTS (CNY per character)."""
    return round(text_length * 0.000_002, 6)


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
    record = db.query(TrainingRecord).filter(TrainingRecord.id == req.record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只能操作自己的训练")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    if not case:
        raise HTTPException(status_code=404, detail="病例不存在")

    client = _get_tts_client(db)
    if client is None:
        raise HTTPException(status_code=503, detail="TTS 服务未配置（请先在管理面板添加 VoiceConfig 或设置环境变量）")

    # Resolve emotion state
    emotion_cache = getattr(request.app.state, "emotion_cache", None)
    emotion_state = "neutral"
    if emotion_cache is not None:
        emotion = get_emotion(req.record_id, emotion_cache, db)
        emotion_state = emotion.state

    # Resolve voice type
    config = db.query(VoiceConfig).filter(VoiceConfig.is_active == True, VoiceConfig.provider == "volcengine").first()
    voice_type = req.voice_type or _resolve_voice_type(case, config)

    # Build TTS request with emotion mapping
    tts_req = emotion_to_tts(text=req.text, state=emotion_state, voice=voice_type)

    t0 = time.perf_counter()
    status = "success"
    error_info = ""
    try:
        audio = await client.synthesize(tts_req)
    except Exception as e:
        status = "error"
        error_info = str(e)[:500]
        log.error("TTS synthesis failed: record_id=%s user_id=%s error=%s", req.record_id, current_user.id, e)
        raise HTTPException(status_code=502, detail=f"TTS 合成失败: {error_info[:200]}")

    latency_ms = int((time.perf_counter() - t0) * 1000)
    cost = _estimate_cost(len(req.text))

    # Log call
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
            "X-TTS-Latency-Ms": str(latency_ms),
        },
    )
