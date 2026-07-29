"""TTS synthesis router — thin router with cached config."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

from contexts.training.patient_ai.emotion import EmotionState
from core.deps import DbSession
from core.exceptions import NotFoundError
from core.rate_limits import check_tts_limit
from core.security import get_current_user
from infrastructure.tts.circuit import CircuitOpenError
from infrastructure.tts.client import VolcBidirectionalTTSClient
from infrastructure.tts.pool import TTSConnectionPool
from models import User
from modules.voice.service import TTSService
from schemas.voice import TTSSynthesizeRequest

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tts", tags=["TTS"])


def _resolve_emotion(request: Request, record_id: int, db) -> str:
    """Read emotion without creating/updating session state.

    TTS is a consumer of emotion state. Creating the default row here can block
    behind training side effects and turn audio playback into a 120s DB timeout.
    """
    emotion_cache = getattr(request.app.state, "emotion_cache", None)
    if emotion_cache is None:
        return "neutral"
    try:
        state = emotion_cache.get(record_id, db)
    except Exception:
        log.warning("TTS emotion lookup failed: record_id=%d", record_id, exc_info=True)
        return "neutral"
    return state.state if isinstance(state, EmotionState) else "neutral"


def _require_record_id(record_id: int | None) -> int:
    if record_id is None:
        raise HTTPException(status_code=400, detail="record_id 不能为空")
    return record_id


@router.post(
    "/synthesize",
    response_class=Response,
    responses={
        200: {
            "content": {
                "audio/mpeg": {"schema": {"type": "string", "format": "binary"}},
                "audio/pcm": {"schema": {"type": "string", "format": "binary"}},
            }
        }
    },
)
async def synthesize(
    req: TTSSynthesizeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    request: Request,
) -> Response:
    await check_tts_limit(current_user.id, request)

    record_id = _require_record_id(req.record_id)
    client: VolcBidirectionalTTSClient | None = request.app.state.tts_client
    emotion_state = _resolve_emotion(request, record_id, db)
    db.rollback()  # 只读情绪查询结束后立即释放连接事务；TTS 流式期间不持有快照

    cfg = getattr(request.app.state, "tts_config", {})
    if not cfg:
        raise NotFoundError("TTS 未配置，请先在管理面板添加语音配置")

    try:
        audio, emotion, speaker, latency_ms, media_type = await TTSService(db).synthesize(
            record_id=record_id,
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


@router.post(
    "/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"audio/pcm": {"schema": {"type": "string", "format": "binary"}}}}},
)
async def synthesize_stream(
    req: TTSSynthesizeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: DbSession,
    request: Request,
) -> StreamingResponse:
    """Sentence-granularity streaming synthesis — PCM chunks as they arrive."""
    await check_tts_limit(current_user.id, request)

    record_id = _require_record_id(req.record_id)
    pool: TTSConnectionPool | None = getattr(request.app.state, "tts_pool", None)
    emotion_state = _resolve_emotion(request, record_id, db)
    db.rollback()  # 只读情绪查询结束后立即释放连接事务；TTS 流式期间不持有快照

    cfg = getattr(request.app.state, "tts_config", {})
    if not cfg:
        raise NotFoundError("TTS 未配置，请先在管理面板添加语音配置")

    try:
        info, gen = await TTSService(db).stream_synthesize(
            record_id=record_id,
            text=req.text,
            voice_type=req.voice_type,
            user_id=current_user.id,
            pool=pool,
            emotion_state=emotion_state,
            timeout=cfg.get("timeout", 8),
            speaker_library=cfg.get("speaker_library"),
        )
        db.rollback()  # 释放 _resolve_request 的只读事务；StreamingResponse 不持有 DB 事务
    except CircuitOpenError:
        raise HTTPException(status_code=503, detail="TTS 服务暂时不可用，已切换浏览器端语音")
    except TimeoutError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return StreamingResponse(
        gen,
        media_type=f"audio/pcm;rate={info.sample_rate}",
        headers={
            "X-TTS-Emotion": info.emotion,
            "X-TTS-Voice": info.speaker,
            "X-TTS-Sample-Rate": str(info.sample_rate),
        },
    )
