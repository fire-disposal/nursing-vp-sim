"""ASR 业务逻辑：配置读取、记录归属校验、调用计费日志。

与 ``modules/voice/service.py``（TTS）同约定：密钥只有本模块从 ``voice_configs``
读出并交给 ``infra.asr``，绝不进返回值、日志或前端；计费用独立 SessionLocal
best-effort 落 ``voice_call_logs``（direction='asr'）。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy.exc import SQLAlchemyError

from core.database import SessionLocal
from infra.asr.protocol import audio_seconds
from models import TrainingRecord, VoiceCallLog, VoiceConfig

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

ASR_DIRECTION = "asr"

#: 小时版资源的单价（元/小时）。与 TTS 的 _COST_PER_CHAR 同性质——
#: 只用于运营估算，不参与预算判定。
_COST_PER_HOUR = 1.0


class AsrNotConfiguredError(RuntimeError):
    """没有可用的 active VoiceConfig（或 api_key 为空）。"""


class AsrForbiddenError(RuntimeError):
    """训练记录不属于当前用户。"""


def load_asr_api_key(db: Session) -> str:
    """取当前 active VoiceConfig 的 api_key。

    ``app_state.tts_config`` 里只有非敏感字段，密钥直接查库；调用方用完即弃，
    不缓存到任何全局位置。
    """
    vc = db.query(VoiceConfig).filter(VoiceConfig.is_active == True).first()
    if vc is None or not vc.api_key:
        raise AsrNotConfiguredError("ASR 未配置")
    return vc.api_key


def assert_record_owner(db: Session, record_id: int, user_id: int) -> None:
    """记录必须存在且属于当前用户。"""
    record = db.query(TrainingRecord.id, TrainingRecord.user_id).filter(TrainingRecord.id == record_id).first()
    if record is None:
        raise AsrForbiddenError("训练记录不存在")
    if record.user_id != user_id:
        raise AsrForbiddenError("只能操作自己的训练")


def estimate_cost(audio_bytes: int, status: str) -> float:
    """按实际收到的音频字节数折算费用；失败也按已消耗时长计。"""
    seconds = audio_seconds(audio_bytes)
    if seconds <= 0:
        return 0.0
    return round(seconds / 3600 * _COST_PER_HOUR, 6)


def write_asr_log(
    *,
    user_id: int,
    record_id: int,
    audio_bytes: int,
    text_length: int,
    latency_ms: int,
    status: str,
) -> None:
    """写一条 ASR 调用日志（独立 session，best-effort）。

    与 ``TTSService._write_log`` 同理由：请求会话只 close 不 commit，且流式路径会
    中途 rollback，日志必须自带事务才能落库。
    """
    try:
        with SessionLocal() as log_db:
            log_db.add(
                VoiceCallLog(
                    user_id=user_id,
                    record_id=record_id,
                    direction=ASR_DIRECTION,
                    text_length=max(0, text_length),
                    emotion_state=None,
                    confidence=None,
                    latency_ms=max(0, latency_ms),
                    status=status,
                    cost_estimated=estimate_cost(audio_bytes, status),
                )
            )
            log_db.commit()
    except (SQLAlchemyError, OSError, RuntimeError):
        log.warning("ASR: failed to write call log", exc_info=True)
