"""Admin voice config — thin router."""

import json
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.database import SessionLocal, get_db
from core.security import require_permission
from infrastructure.asr.client import VolcASRClient
from infrastructure.llm.crypto_utils import decrypt_api_key, encrypt_api_key
from infrastructure.tts.client import VolcTTSClient
from models import User, VoiceConfig
from schemas.voice import (
    VoiceConfigResponse,
    VoiceConfigUpdateRequest,
    VoiceStatusResponse,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/voice", tags=["语音管理"])


def _reload_tts_client(app_state) -> None:
    """Reload app.state.tts_client + config cache from active VoiceConfig."""
    from services.tts import load_tts_state

    db = SessionLocal()
    try:
        load_tts_state(app_state, db)
    finally:
        db.close()


def _mask_api_key(vc: VoiceConfig) -> str:
    try:
        raw = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
        if not raw:
            return "未设置"
        if vc.api_key_suffix and not raw.endswith(vc.api_key_suffix):
            return "***mismatch***"
    except Exception:
        return "***error***"
    if len(raw) <= 8:
        return "***...***"
    return f"{'*' * 8}{raw[-4:]}"


def _build_voice_config_response(vc: VoiceConfig | None) -> VoiceConfigResponse | None:
    if not vc:
        return None
    return VoiceConfigResponse(
        id=vc.id,
        provider=vc.provider,
        api_key_masked=_mask_api_key(vc),
        api_key_suffix=vc.api_key_suffix or "****",
        tts_resource_id=vc.tts_resource_id,
        tts_speaker=vc.tts_speaker,
        tts_model=vc.tts_model,
        tts_sample_rate=vc.tts_sample_rate,
        tts_format=vc.tts_format,
        tts_timeout=vc.tts_timeout,
        asr_resource_id=vc.asr_resource_id,
        asr_sample_rate=vc.asr_sample_rate,
        asr_endpoint_mode=vc.asr_endpoint_mode,
        monthly_budget=vc.monthly_budget,
        is_active=vc.is_active,
        created_at=vc.created_at.isoformat(),
        updated_at=vc.updated_at.isoformat(),
    )


# ── Voice Config CRUD ──


@router.get("/config", response_model=VoiceConfigResponse)
def get_config(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    vc = db.query(VoiceConfig).order_by(VoiceConfig.id.desc()).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到语音配置")
    return _build_voice_config_response(vc)


@router.put("/config", response_model=VoiceConfigResponse)
def update_config(
    req: VoiceConfigUpdateRequest,
    request: Request,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    vc = db.query(VoiceConfig).order_by(VoiceConfig.id.desc()).first()

    if vc:
        if req.provider:
            vc.provider = req.provider
        if req.api_key:
            vc.api_key_enc = encrypt_api_key(req.api_key)
            vc.api_key_suffix = req.api_key[-8:] if len(req.api_key) >= 8 else req.api_key
        vc.tts_resource_id = req.tts_resource_id
        vc.tts_speaker = req.tts_speaker
        vc.tts_model = req.tts_model
        vc.tts_sample_rate = req.tts_sample_rate
        vc.tts_format = req.tts_format
        vc.tts_timeout = req.tts_timeout
        vc.asr_resource_id = req.asr_resource_id
        vc.asr_sample_rate = req.asr_sample_rate
        vc.asr_endpoint_mode = req.asr_endpoint_mode
        vc.monthly_budget = req.monthly_budget
        vc.is_active = req.is_active
    else:
        api_key_enc = encrypt_api_key(req.api_key) if req.api_key else ""
        api_key_suffix = req.api_key[-8:] if req.api_key and len(req.api_key) >= 8 else (req.api_key or "")
        vc = VoiceConfig(
            provider=req.provider,
            api_key_enc=api_key_enc,
            api_key_suffix=api_key_suffix,
            tts_resource_id=req.tts_resource_id,
            tts_speaker=req.tts_speaker,
            tts_model=req.tts_model,
            tts_sample_rate=req.tts_sample_rate,
            tts_format=req.tts_format,
            tts_timeout=req.tts_timeout,
            asr_resource_id=req.asr_resource_id,
            asr_sample_rate=req.asr_sample_rate,
            asr_endpoint_mode=req.asr_endpoint_mode,
            monthly_budget=req.monthly_budget,
            is_active=req.is_active,
        )
        db.add(vc)

    db.commit()
    db.refresh(vc)
    _reload_tts_client(request.app.state)
    return _build_voice_config_response(vc)


async def _do_test_tts(db: Session) -> VoiceStatusResponse:
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到激活的语音配置")

    try:
        api_key = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
        if not api_key:
            raise HTTPException(status_code=400, detail="尚未设置 API Key")
        if vc.api_key_suffix and not api_key.endswith(vc.api_key_suffix):
            raise HTTPException(status_code=500, detail="API Key 完整性校验失败，请重新设置")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="无法解密 API Key")

    client = VolcTTSClient(api_key=api_key, resource_id=vc.tts_resource_id, timeout=vc.tts_timeout)
    try:
        ok = await client.health_check(speaker=vc.tts_speaker)
        await client.close()
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=ok,
            asr_online=False,
            last_error=None if ok else "TTS 健康检查失败",
            last_error_at=None if ok else datetime.now(UTC).isoformat(),
        )
    except Exception as e:
        await client.close()
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=False,
            last_error=str(e)[:500],
            last_error_at=datetime.now(UTC).isoformat(),
        )


@router.post("/config/test-tts", response_model=VoiceStatusResponse)
async def test_tts(
    request: Request,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    return await _do_test_tts(db)


async def _do_test_asr(db: Session, request: Request) -> VoiceStatusResponse:
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if not vc:
        raise HTTPException(status_code=404, detail="未找到激活的语音配置")

    try:
        api_key = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
    except Exception:
        api_key = ""

    if not api_key or not vc.asr_resource_id:
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=False,
            last_error="ASR 未配置（缺少 API Key 或 resource_id），将使用文本输入降级",
            last_error_at=datetime.now(UTC).isoformat(),
        )

    client = VolcASRClient(
        api_key=api_key,
        resource_id=vc.asr_resource_id,
        endpoint_mode=vc.asr_endpoint_mode,
        sample_rate=vc.asr_sample_rate,
    )
    try:
        ok = await client.health_check()
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=ok,
            last_error=None if ok else "ASR 上游建连失败",
            last_error_at=None if ok else datetime.now(UTC).isoformat(),
        )
    except Exception as e:
        return VoiceStatusResponse(
            provider=vc.provider,
            tts_online=False,
            asr_online=False,
            last_error=str(e)[:500],
            last_error_at=datetime.now(UTC).isoformat(),
        )


@router.post("/config/test-asr", response_model=VoiceStatusResponse)
async def test_asr(
    request: Request,
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    return await _do_test_asr(db, request)


@router.get("/config/export")
def export_voice_config(
    current_user: Annotated[User, Depends(require_permission("llm_monitor"))],
    db: Annotated[Session, Depends(get_db)],
):
    from services.voice import VoiceConfigService

    payload = VoiceConfigService(db).export_config()
    json_bytes = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=voice_config_export.json"},
    )
