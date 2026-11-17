"""语音电话 AEC3 音频遥测：独立内存环形缓冲与查询接口。

不写数据库：这是运行时诊断数据，前端每 2 秒回传一次，保留最近样本即可。
查询按当前登录用户过滤，避免跨账号读到别人的设备/延迟数据。
"""

from __future__ import annotations

import threading
import time
from collections import deque
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from core.deps import CurrentUser

router = APIRouter(prefix="/api/voice-demo/audio-telemetry", tags=["Voice Demo"])

_MAX_SAMPLES = 5000


class AudioTelemetrySample(BaseModel):
    session_id: str = Field(min_length=1, max_length=64)
    mode: Literal["workbench", "phone"]
    character_id: str | None = Field(default=None, max_length=40)
    delay_ms: float | None = None
    erle_db: float | None = None
    erl_db: float | None = None
    divergent_filter_fraction: float | None = None
    voice: bool | None = None
    reference_short: int = 0
    reference_dropped: int = 0
    non_finite_samples: int = 0
    errors: int = 0
    mic_level: float | None = None
    clean_level: float | None = None


class _StoredSample(AudioTelemetrySample):
    user_id: int
    created_at: float


_buffer: deque[_StoredSample] = deque(maxlen=_MAX_SAMPLES)
_lock = threading.Lock()


@router.post("", status_code=204)
async def ingest_audio_telemetry(sample: AudioTelemetrySample, current_user: CurrentUser) -> None:
    """接收一次前端遥测。始终返回 204，不阻塞通话。"""
    with _lock:
        _buffer.append(_StoredSample(**sample.model_dump(), user_id=current_user.id, created_at=time.time()))


@router.get("")
async def query_audio_telemetry(
    current_user: CurrentUser,
    session_id: str | None = None,
    limit: int = 200,
) -> list[dict]:
    """按会话返回最近的 AEC3 样本，最新在前。"""
    capped = max(1, min(limit, 1000))
    with _lock:
        rows = [
            sample
            for sample in reversed(_buffer)
            if sample.user_id == current_user.id and (session_id is None or sample.session_id == session_id)
        ][:capped]
    return [row.model_dump(mode="json") for row in rows]
