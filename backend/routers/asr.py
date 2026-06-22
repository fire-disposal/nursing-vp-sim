"""ASR (speech-to-text) router."""

import base64
import logging
import time
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import User, VoiceCallLog
from schemas.voice import ASRRecognizeRequest, ASRRecognizeResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/asr", tags=["ASR"])


@router.post("/recognize", response_model=ASRRecognizeResponse)
async def recognize(
    req: ASRRecognizeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    request: Request,
):
    asr_client = getattr(request.app.state, "asr_client", None)
    if not asr_client:
        raise HTTPException(status_code=503, detail="ASR 服务未就绪")

    try:
        audio_bytes = base64.b64decode(req.audio)
    except Exception:
        raise HTTPException(status_code=400, detail="无效的 base64 音频数据")

    http = request.app.state.httpx_client

    t0 = time.perf_counter()
    result = await asr_client.recognize(http, audio_bytes, req.format, req.sample_rate)
    latency_ms = int((time.perf_counter() - t0) * 1000)

    text_length = len(result.text)
    cost_estimated = round(text_length * 0.00005, 6)  # ~0.05 CNY per 1000 chars est.

    call_log = VoiceCallLog(
        user_id=current_user.id,
        direction="asr",
        text_length=text_length,
        confidence=result.confidence,
        latency_ms=latency_ms,
        status="success" if result.text else "error",
        cost_estimated=cost_estimated,
    )
    db.add(call_log)
    db.commit()

    return ASRRecognizeResponse(text=result.text, confidence=result.confidence)
