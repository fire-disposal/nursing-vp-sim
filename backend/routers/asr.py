"""ASR (speech-to-text) router - v3 streaming WebSocket proxy + availability probe.

The browser streams 16k mono PCM frames to ``/api/asr/stream``; this router
authenticates, opens an upstream Volcengine SAUC WebSocket, and relays
transcripts back. ASR is best-effort: any missing config or upstream failure
degrades to ``{"type": "unavailable"}`` so the training flow is never blocked.
"""

import asyncio
import contextlib
import json
import logging
import time
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from core.config import ALGORITHM, JWT_SECRET_KEY
from core.database import SessionLocal, get_db
from core.security import get_current_user
from infrastructure.asr.client import ASRError, VolcASRClient
from infrastructure.asr.fallback import asr_configured
from infrastructure.llm.crypto_utils import decrypt_api_key
from models import User, VoiceCallLog, VoiceConfig
from schemas.voice import ASRStatusResponse

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/asr", tags=["ASR"])

_ASR_IDLE_TIMEOUT = 30  # seconds without audio before auto-close
_ASR_COST_PER_CHAR = 0.00005  # CNY per character (Volcengine SAUC pricing)


def _load_active_config(db: Session) -> tuple[str, VoiceConfig] | None:
    """Return (api_key, config) when ASR is usable, else None."""
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not vc:
        return None
    try:
        api_key = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
    except Exception:
        log.warning("ASR: api_key decryption failed")
        return None
    if not asr_configured(api_key, vc.asr_resource_id):
        return None
    return api_key, vc


@router.get("/status")
def asr_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ASRStatusResponse:
    """Lightweight gate the frontend probes before showing the mic button."""
    return ASRStatusResponse(available=_load_active_config(db) is not None)


def _build_client(api_key: str, vc: VoiceConfig) -> VolcASRClient:
    return VolcASRClient(
        api_key=api_key,
        resource_id=vc.asr_resource_id,
        endpoint_mode=vc.asr_endpoint_mode,
        sample_rate=vc.asr_sample_rate,
    )


def _confidence(payload: dict | None) -> float:
    if not payload:
        return 0.0
    result = payload.get("result")
    if isinstance(result, dict) and isinstance(result.get("confidence"), int | float):
        return float(result["confidence"])
    return 0.0


@router.websocket("/stream")
async def asr_stream(websocket: WebSocket, token: str = Query(default="")) -> None:
    await websocket.accept()

    # Auth (JWT via query param - the secret never reaches the browser)
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        await websocket.close(code=1008)
        return
    user_id = payload.get("user_id")
    if not isinstance(user_id, int):
        await websocket.close(code=1008)
        return

    db = SessionLocal()
    try:
        loaded = _load_active_config(db)
        if loaded is None:
            await websocket.send_json({"type": "unavailable"})
            await websocket.close()
            return
        api_key, vc = loaded

        client = _build_client(api_key, vc)
        try:
            await client.connect()
        except ASRError as e:
            log.warning("ASR upstream connect failed: %s", e)
            await websocket.send_json({"type": "unavailable"})
            await websocket.close()
            return

        final_text = ""
        t0 = time.perf_counter()

        async def browser_to_upstream() -> None:
            last_audio = time.perf_counter()
            while True:
                try:
                    msg = await asyncio.wait_for(websocket.receive(), timeout=_ASR_IDLE_TIMEOUT)
                except TimeoutError:
                    log.info("ASR idle timeout (%ds) — closing", _ASR_IDLE_TIMEOUT)
                    await client.send_audio(b"", is_last=True)
                    break
                if msg.get("type") == "websocket.disconnect":
                    raise WebSocketDisconnect
                if (data := msg.get("bytes")) is not None:
                    last_audio = time.perf_counter()
                    await client.send_audio(data)
                elif (text := msg.get("text")) is not None:
                    try:
                        ctrl = json.loads(text)
                    except json.JSONDecodeError:
                        continue
                    kind = ctrl.get("type")
                    if kind == "stop":
                        await client.send_audio(b"", is_last=True)
                    elif kind == "cancel":
                        raise WebSocketDisconnect

        async def upstream_to_browser() -> None:
            nonlocal final_text
            while True:
                resp = await client.recv()
                if resp is None:
                    break
                if resp.is_error:
                    await websocket.send_json({"type": "error", "text": "", "confidence": 0.0})
                    break
                text = resp.text
                if resp.is_last:
                    final_text = text
                    await websocket.send_json({"type": "final", "text": text, "confidence": _confidence(resp.payload)})
                    break
                await websocket.send_json({"type": "partial", "text": text, "confidence": _confidence(resp.payload)})

        up = asyncio.create_task(browser_to_upstream())
        down = asyncio.create_task(upstream_to_browser())
        done, pending = await asyncio.wait({up, down}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                log.warning("ASR stream task error: %s", exc)

        await client.close()

        # Best-effort usage log
        if final_text:
            latency_ms = int((time.perf_counter() - t0) * 1000)
            db.add(
                VoiceCallLog(
                    user_id=user_id,
                    record_id=None,
                    direction="asr",
                    text_length=len(final_text),
                    latency_ms=latency_ms,
                    status="success",
                    cost_estimated=round(len(final_text) * _ASR_COST_PER_CHAR, 6),
                )
            )
            db.commit()
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("ASR stream proxy error")
        with contextlib.suppress(Exception):
            await websocket.send_json({"type": "error", "text": "", "confidence": 0.0})
    finally:
        db.close()
        with contextlib.suppress(Exception):
            await websocket.close()
