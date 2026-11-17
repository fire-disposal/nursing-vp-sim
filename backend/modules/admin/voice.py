"""Admin voice config — router + service."""

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from core.database import SessionLocal, get_db
from core.exceptions import NotFoundError, ValidationError
from core.security import require_permission
from core.unit_of_work import unit_of_work
from infra.asr.client import ASR_RESOURCE_ID, AsrSession
from infra.tts.client import TTSRequest, VolcBidirectionalTTSClient
from infra.tts.mapper import DEFAULT_SPEAKER
from models import User, VoiceConfig
from modules.voice.asr_service import AsrNotConfiguredError, load_asr_api_key
from schemas.voice import (
    AsrStatusResponse,
    VoiceConfigResponse,
    VoiceConfigUpdateRequest,
    VoiceStatusResponse,
    VoiceTestRequest,
)

log = logging.getLogger(__name__)


def _fallback_speaker(vc: VoiceConfig) -> str:
    lib = vc.speaker_library or {}
    return lib.get("fallback") or DEFAULT_SPEAKER


def _mask(raw_key: str) -> str:
    if not raw_key:
        return "未设置"
    if len(raw_key) <= 8:
        return "***...***"
    return f"{'*' * 8}{raw_key[-4:]}"


def _mask_api_key(vc: VoiceConfig) -> str:
    return _mask(vc.api_key or "")


def _mask_asr_api_key(vc: VoiceConfig) -> str:
    return _mask(vc.asr_api_key or "")


def _build_voice_config_response(vc: VoiceConfig) -> VoiceConfigResponse:
    return VoiceConfigResponse(
        id=vc.id,
        provider=vc.provider,
        api_key_masked=_mask_api_key(vc),
        api_key_suffix=(vc.api_key or "")[-4:],
        asr_api_key_masked=_mask_asr_api_key(vc),
        asr_api_key_suffix=(vc.asr_api_key or "")[-4:],
        tts_speaker=vc.tts_speaker,
        tts_resource_id=vc.tts_resource_id,
        tts_model=vc.tts_model,
        tts_sample_rate=vc.tts_sample_rate,
        tts_format=vc.tts_format,
        tts_timeout=vc.tts_timeout,
        monthly_budget=vc.monthly_budget,
        is_active=vc.is_active,
        speaker_library=vc.speaker_library,
        created_at=vc.created_at,
        updated_at=vc.updated_at,
    )


class VoiceConfigService:
    def __init__(self, db: Session):
        self.db = db

    def _get_active(self) -> VoiceConfig | None:
        return self.db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()

    def _get_latest(self) -> VoiceConfig | None:
        return self.db.query(VoiceConfig).order_by(VoiceConfig.id.desc()).first()

    def get_config(self) -> VoiceConfigResponse:
        vc = self._get_latest()
        if not vc:
            raise NotFoundError("未找到语音配置")
        return _build_voice_config_response(vc)

    def update_config(self, data: dict) -> VoiceConfigResponse:
        vc = self._get_latest()

        with unit_of_work(self.db, conflict_detail="更新语音配置失败"):
            if vc:
                if data.get("provider"):
                    vc.provider = data["provider"]
                if data.get("api_key"):
                    vc.api_key = data["api_key"]
                if data.get("asr_api_key"):
                    vc.asr_api_key = data["asr_api_key"]
                for field in (
                    "tts_resource_id",
                    "tts_model",
                    "tts_sample_rate",
                    "tts_format",
                    "tts_timeout",
                    "monthly_budget",
                ):
                    if field in data:
                        setattr(vc, field, data[field])
                if "is_active" in data:
                    vc.is_active = data["is_active"]
                if "speaker_library" in data:
                    vc.speaker_library = data["speaker_library"] or None
            else:
                vc = VoiceConfig(
                    provider=data.get("provider", ""),
                    api_key=data.get("api_key", ""),
                    asr_api_key=data.get("asr_api_key", ""),
                    tts_resource_id=data.get("tts_resource_id"),
                    tts_model=data.get("tts_model"),
                    tts_sample_rate=data.get("tts_sample_rate"),
                    tts_format=data.get("tts_format"),
                    tts_timeout=data.get("tts_timeout"),
                    monthly_budget=data.get("monthly_budget"),
                    is_active=data.get("is_active", True),
                    speaker_library=data.get("speaker_library"),
                )
                self.db.add(vc)
        self.db.refresh(vc)
        return _build_voice_config_response(vc)

    def _decrypt_key(self, vc: VoiceConfig) -> str:
        key = vc.api_key or ""
        if not key:
            raise ValidationError("尚未设置 API Key")
        return key

    async def test_tts(self, pool=None) -> VoiceStatusResponse:
        vc = self._get_active()
        if not vc:
            raise NotFoundError("未找到激活的语音配置")
        api_key = self._decrypt_key(vc)
        pool_stats = pool.stats if pool is not None else {}
        client = VolcBidirectionalTTSClient(api_key=api_key, resource_id=vc.tts_resource_id, timeout=vc.tts_timeout)
        try:
            ok = await client.health_check(speaker=_fallback_speaker(vc))
            await client.close()
            return VoiceStatusResponse(
                provider=vc.provider,
                tts_online=ok,
                last_error=None if ok else "TTS 健康检查失败",
                last_error_at=None if ok else datetime.now(UTC).isoformat(),
                tts_pool_size=pool_stats.get("size"),
                tts_pool_total=pool_stats.get("total"),
                tts_pool_idle=pool_stats.get("idle"),
                tts_pool_in_use=pool_stats.get("in_use"),
            )
        except Exception as e:
            await client.close()
            return VoiceStatusResponse(
                provider=vc.provider,
                tts_online=False,
                last_error=str(e)[:500],
                last_error_at=datetime.now(UTC).isoformat(),
                tts_pool_size=pool_stats.get("size"),
                tts_pool_total=pool_stats.get("total"),
                tts_pool_idle=pool_stats.get("idle"),
                tts_pool_in_use=pool_stats.get("in_use"),
            )

    @staticmethod
    def _scrub(text: str, secret: str) -> str:
        """上游异常里若回显了 Key 就抹掉——错误信息会直接进管理页。"""
        if secret and secret in text:
            text = text.replace(secret, "***")
        return text[:500]

    async def test_asr(self, session_factory=None) -> AsrStatusResponse:
        """只做「连接 + 发送配置帧」，不发音频：验证凭据与资源 ID，不产生计费时长。

        ``session_factory`` 仅用于单测注入（默认 ``AsrSession(api_key=...)``）。
        取 Key 走 :func:`load_asr_api_key`——与识别链路同一口径，不借用 TTS 的 Key。
        """
        vc = self._get_active()
        if not vc:
            raise NotFoundError("未找到激活的语音配置")
        try:
            api_key = load_asr_api_key(self.db)
        except AsrNotConfiguredError:
            return AsrStatusResponse(
                provider=vc.provider,
                asr_online=False,
                last_error="尚未设置 ASR API Key",
                last_error_at=datetime.now(UTC).isoformat(),
                resource_id=ASR_RESOURCE_ID,
            )

        make_session = session_factory or (lambda key: AsrSession(api_key=key))
        session = make_session(api_key)
        try:
            await session.connect()
            await session.send_full_request()
            ok, error = True, None
        except Exception as e:  # 上游异常种类多（websockets/SQLAlchemy/OSError），一律转状态
            ok, error = False, self._scrub(str(e) or type(e).__name__, api_key)
        finally:
            with contextlib.suppress(Exception):
                await session.close()

        return AsrStatusResponse(
            provider=vc.provider,
            asr_online=ok,
            last_error=error,
            last_error_at=None if ok else datetime.now(UTC).isoformat(),
            resource_id=ASR_RESOURCE_ID,
        )

    async def stream_test(self, text: str, pool, speaker: str | None = None) -> tuple[str, int, AsyncIterator[bytes]]:
        from modules.voice.service import STREAM_FORMAT, STREAM_SAMPLE_RATE

        vc = self._get_active()
        if not vc:
            raise NotFoundError("未找到激活的语音配置")
        self._decrypt_key(vc)
        if pool is None:
            raise ValidationError("TTS 连接池未就绪（请保存配置后重试）")

        resolved = speaker or _fallback_speaker(vc)

        tts_req = TTSRequest(
            text=text[:200],
            speaker=resolved,
            fmt=STREAM_FORMAT,
            sample_rate=STREAM_SAMPLE_RATE,
        )
        timeout = vc.tts_timeout or 8
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout

        conn_ctx = pool.acquire()
        conn = await conn_ctx.__aenter__()
        try:
            await asyncio.wait_for(conn.begin_session(tts_req), timeout=max(0.1, deadline - loop.time()))
        except Exception:
            await conn_ctx.__aexit__(None, None, None)
            log.warning("voice config reload cleanup failed", exc_info=True)
            raise

        async def _gen() -> AsyncIterator[bytes]:
            completed = False
            try:
                stream = conn.read_stream()
                while True:
                    try:
                        chunk = await asyncio.wait_for(anext(stream), timeout=max(0.1, deadline - loop.time()))
                    except StopAsyncIteration:
                        completed = True
                        break
                    yield chunk
            finally:
                if not completed:
                    await conn.abort()
                await conn_ctx.__aexit__(None, None, None)

        return _fallback_speaker(vc), STREAM_SAMPLE_RATE, _gen()


router = APIRouter(prefix="/voice", tags=["语音管理"])

_Manager = Annotated[User, Depends(require_permission("llm_monitor"))]


def _reload_tts_client(app_state) -> None:
    from modules.voice.service import load_tts_state

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
    current_user: _Manager,
    db: Annotated[Session, Depends(get_db)],
    req: VoiceConfigUpdateRequest,
):
    data = req.model_dump(exclude_none=True)
    return VoiceConfigService(db).update_config(data)


@router.post("/config/test-tts", response_model=VoiceStatusResponse)
async def test_tts(request: Request, current_user: _Manager, db: Annotated[Session, Depends(get_db)]):
    pool = getattr(request.app.state, "tts_pool", None)
    return await VoiceConfigService(db).test_tts(pool=pool)


@router.post("/config/test-asr", response_model=AsrStatusResponse)
async def test_asr(current_user: _Manager, db: Annotated[Session, Depends(get_db)]):
    """ASR 连通性测试：连接 + 发送配置帧，不发音频，不产生计费时长。"""
    return await VoiceConfigService(db).test_asr()


@router.post("/config/test-stream")
async def test_stream(
    request: Request,
    current_user: _Manager,
    body: VoiceTestRequest,
    db: Annotated[Session, Depends(get_db)],
):
    pool = getattr(request.app.state, "tts_pool", None)
    svc = VoiceConfigService(db)
    speaker, sample_rate, gen = await svc.stream_test(body.text, pool, body.speaker)
    return StreamingResponse(
        gen,
        media_type="audio/l16",
        headers={"X-Sample-Rate": str(sample_rate), "X-Speaker": speaker},
    )
