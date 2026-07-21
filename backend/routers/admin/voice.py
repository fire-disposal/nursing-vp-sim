"""Admin voice config — thin router delegates to VoiceConfigService."""

import json
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.database import SessionLocal, get_db
from core.security import require_permission
from models import User
from schemas.voice import (
    VoiceConfigResponse,
    VoiceConfigUpdateRequest,
    VoiceStatusResponse,
)
from services.voice import VoiceConfigService

log = logging.getLogger(__name__)

router = APIRouter(prefix="/voice", tags=["语音管理"])

_Manager = Annotated[User, Depends(require_permission("llm_monitor"))]


def _reload_tts_client(app_state) -> None:
    from services.tts import load_tts_state

    db = SessionLocal()
    try:
        load_tts_state(app_state, db)
    finally:
        db.close()


@router.get("/config", response_model=VoiceConfigResponse)
def get_config(current_user: _Manager, db: Annotated[Session, Depends(get_db)]):
    return VoiceConfigService(db).get_config()


@router.put("/config", response_model=VoiceConfigResponse)
def update_config(
    req: VoiceConfigUpdateRequest,
    request: Request,
    current_user: _Manager,
    db: Annotated[Session, Depends(get_db)],
):
    data = req.model_dump(exclude_none=True)
    result = VoiceConfigService(db).update_config(data)
    _reload_tts_client(request.app.state)
    return result


@router.post("/config/test-tts", response_model=VoiceStatusResponse)
async def test_tts(current_user: _Manager, db: Annotated[Session, Depends(get_db)]):
    return await VoiceConfigService(db).test_tts()


@router.post("/config/test-asr", response_model=VoiceStatusResponse)
async def test_asr(current_user: _Manager, db: Annotated[Session, Depends(get_db)]):
    return await VoiceConfigService(db).test_asr()


@router.post("/config/test-synthesize")
async def test_synthesize(
    request: Request,
    current_user: _Manager,
    db: Annotated[Session, Depends(get_db)],
):
    body = await request.json()
    text = str(body.get("text", "你好，这是一段测试语音。"))[:200]

    try:
        audio, media_type, ext = await VoiceConfigService(db).synthesize_test(text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"TTS 合成失败: {str(e)[:500]}")

    return Response(
        content=audio,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="tts_test.{ext}"',
            "X-TTS-Speaker": "see config",
            "X-TTS-Format": ext,
        },
    )


@router.get("/config/export")
def export_voice_config(current_user: _Manager, db: Annotated[Session, Depends(get_db)]):
    payload = VoiceConfigService(db).export_config()
    json_bytes = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=voice_config_export.json"},
    )
