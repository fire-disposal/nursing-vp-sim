"""Voice config business logic."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from infrastructure.asr.client import VolcASRClient
from infrastructure.llm.crypto_utils import decrypt_api_key, encrypt_api_key
from infrastructure.tts.client import VolcTTSClient
from models import VoiceConfig
from schemas.voice import VoiceConfigResponse, VoiceStatusResponse


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
                    vc.api_key_enc = encrypt_api_key(data["api_key"])
                    vc.api_key_suffix = data["api_key"][-8:] if len(data["api_key"]) >= 8 else data["api_key"]
                vc.tts_resource_id = data.get("tts_resource_id", vc.tts_resource_id)
                vc.tts_speaker = data.get("tts_speaker", vc.tts_speaker)
                vc.tts_model = data.get("tts_model", vc.tts_model)
                vc.tts_sample_rate = data.get("tts_sample_rate", vc.tts_sample_rate)
                vc.tts_format = data.get("tts_format", vc.tts_format)
                vc.tts_timeout = data.get("tts_timeout", vc.tts_timeout)
                vc.asr_resource_id = data.get("asr_resource_id", vc.asr_resource_id)
                vc.asr_sample_rate = data.get("asr_sample_rate", vc.asr_sample_rate)
                vc.asr_endpoint_mode = data.get("asr_endpoint_mode", vc.asr_endpoint_mode)
                vc.monthly_budget = data.get("monthly_budget", vc.monthly_budget)
                vc.is_active = data.get("is_active", vc.is_active)
            else:
                api_key_enc = encrypt_api_key(data.get("api_key", "")) if data.get("api_key") else ""
                raw_key = data.get("api_key", "")
                api_key_suffix = raw_key[-8:] if len(raw_key) >= 8 else raw_key
                vc = VoiceConfig(
                    provider=data.get("provider", ""),
                    api_key_enc=api_key_enc,
                    api_key_suffix=api_key_suffix,
                    tts_resource_id=data.get("tts_resource_id"),
                    tts_speaker=data.get("tts_speaker"),
                    tts_model=data.get("tts_model"),
                    tts_sample_rate=data.get("tts_sample_rate"),
                    tts_format=data.get("tts_format"),
                    tts_timeout=data.get("tts_timeout"),
                    asr_resource_id=data.get("asr_resource_id"),
                    asr_sample_rate=data.get("asr_sample_rate"),
                    asr_endpoint_mode=data.get("asr_endpoint_mode"),
                    monthly_budget=data.get("monthly_budget"),
                    is_active=data.get("is_active", True),
                )
                self.db.add(vc)
        self.db.refresh(vc)
        return _build_voice_config_response(vc)

    async def test_tts(self) -> VoiceStatusResponse:
        vc = self._get_active()
        if not vc:
            raise NotFoundError("未找到激活的语音配置")

        try:
            api_key = decrypt_api_key(vc.api_key_enc) if vc.api_key_enc else ""
            if not api_key:
                raise ValidationError("尚未设置 API Key")
            if vc.api_key_suffix and not api_key.endswith(vc.api_key_suffix):
                raise ValidationError("API Key 完整性校验失败，请重新设置")
        except (NotFoundError, ValidationError):
            raise
        except Exception:
            raise ValidationError("无法解密 API Key")

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

    async def test_asr(self) -> VoiceStatusResponse:
        vc = self._get_active()
        if not vc:
            raise NotFoundError("未找到激活的语音配置")

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

    def get_config_params(self) -> dict:
        vc = self.db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
        return {
            "model": vc.tts_model if vc else "seed-tts-2.0-standard",
            "format": vc.tts_format if vc else "mp3",
            "sample_rate": vc.tts_sample_rate if vc else 24000,
            "timeout": vc.tts_timeout if vc else 8,
        }

    def export_config(self) -> dict:
        from datetime import UTC, datetime

        vc = self.db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
        if not vc:
            from core.exceptions import NotFoundError

            raise NotFoundError("未找到激活的语音配置")
        return {
            "provider": vc.provider,
            "tts_resource_id": vc.tts_resource_id,
            "tts_speaker": vc.tts_speaker,
            "tts_model": vc.tts_model,
            "tts_sample_rate": vc.tts_sample_rate,
            "tts_format": vc.tts_format,
            "tts_timeout": vc.tts_timeout,
            "asr_resource_id": vc.asr_resource_id,
            "asr_sample_rate": vc.asr_sample_rate,
            "asr_endpoint_mode": vc.asr_endpoint_mode,
            "monthly_budget": vc.monthly_budget,
            "exported_at": datetime.now(UTC).isoformat(),
        }
