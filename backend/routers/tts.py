"""TTS synthesis router — thin router with cached config."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from core.deps import DbSession
from core.exceptions import NotFoundError
from core.rate_limits import check_tts_limit
from core.security import get_current_user
from infrastructure.tts.circuit import CircuitOpenError
from infrastructure.tts.client import VolcBidirectionalTTSClient
from models import User
from profiles.history_taking.emotion import get_emotion
from schemas.voice import TTSSynthesizeRequest
from services.tts import TTSService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["TTS"])


@router.post("/synthesize")
async def synthesize(
    req: TTSSynthesizeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    request: Request,
) -> Response:
    await check_tts_limit(current_user.id, request)

    client: VolcBidirectionalTTSClient | None = request.app.state.tts_client

    emotion_cache = getattr(request.app.state, "emotion_cache", None)
    emotion_state = "neutral"
    if emotion_cache is not None:
        emotion = get_emotion(req.record_id, emotion_cache, db)
        emotion_state = emotion.state

    cfg = getattr(request.app.state, "tts_config", {})
    if not cfg:
        raise NotFoundError("TTS 未配置，请先在管理面板添加语音配置")

    try:
        audio, emotion, speaker, latency_ms, media_type = await TTSService(db).synthesize(
            record_id=req.record_id,
            text=req.text,
            voice_type=req.voice_type,
            user_id=current_user.id,
            client=client,
            emotion_state=emotion_state,
            tts_format=cfg["format"],
            tts_sample_rate=cfg["sample_rate"],
            speaker_library=cfg.get("speaker_library"),
        )
    except CircuitOpenError:
        raise HTTPException(status_code=503, detail="TTS 服务暂时不可用，已切换浏览器端语音")
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=audio,
        media_type=media_type,
        headers={
            "X-TTS-Emotion": emotion,
            "X-TTS-Voice": speaker,
            "X-TTS-Latency-Ms": str(latency_ms),
        },
    )
