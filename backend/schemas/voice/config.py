"""Voice config schemas — TTS configuration, status, and synthesis."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from schemas.common import _REQ_CFG, _RESP_CFG


class VoiceConfigUpdateRequest(BaseModel):
    model_config = _REQ_CFG
    provider: str = "volcengine"
    api_key: str | None = Field(default=None, min_length=1)
    #: 独立 ASR 凭据；与 TTS 的 ``api_key`` 互不影响，留 None 表示不改。
    asr_api_key: str | None = Field(default=None, min_length=1)
    tts_resource_id: str = Field(default="seed-tts-2.0", max_length=64)
    tts_speaker: str = Field(default="zh_female_vv_uranus_bigtts", max_length=64)
    tts_model: str = Field(default="seed-tts-2.0-standard", max_length=40)
    tts_sample_rate: int = Field(default=24000, ge=8000, le=48000)
    tts_format: str = Field(default="mp3", max_length=16)
    tts_timeout: int = Field(default=8, ge=3, le=30)
    monthly_budget: float = Field(default=200.0, ge=0)
    is_active: bool = True
    speaker_library: dict[str, str] | None = None


class VoiceConfigResponse(BaseModel):
    model_config = _RESP_CFG
    id: int
    provider: str
    api_key_masked: str
    api_key_suffix: str
    #: ASR 独立凭据——响应里只有掩码与尾 4 位，完整 Key 不出后端。
    asr_api_key_masked: str
    asr_api_key_suffix: str
    tts_resource_id: str
    tts_speaker: str
    tts_model: str
    tts_sample_rate: int
    tts_format: str
    tts_timeout: int
    monthly_budget: float
    is_active: bool
    speaker_library: dict[str, str] | None = None
    created_at: datetime
    updated_at: datetime


class VoiceStatusResponse(BaseModel):
    provider: str
    tts_online: bool
    last_error: str | None
    last_error_at: str | None
    tts_pool_size: int | None = None
    tts_pool_total: int | None = None
    tts_pool_idle: int | None = None
    tts_pool_in_use: int | None = None


class AsrStatusResponse(BaseModel):
    """``POST /admin/voice/config/test-asr``：只验证「连得上 + 配置帧被接受」，不发音频。"""

    provider: str
    asr_online: bool
    last_error: str | None
    last_error_at: str | None
    resource_id: str


class VoiceTestRequest(BaseModel):
    model_config = _REQ_CFG
    text: str = Field(default="你好，这是一段测试语音。", min_length=1, max_length=200)
    speaker: str | None = Field(default=None, max_length=64)


class TTSSynthesizeRequest(BaseModel):
    model_config = _REQ_CFG
    text: str = Field(min_length=1, max_length=500)
    record_id: int
    voice_type: str | None = Field(default=None, max_length=40)


class VoiceDemoTTSRequest(BaseModel):
    """``POST /api/voice-demo/tts/stream``：演示台词合成，不关联任何训练记录。

    情绪由前端直接给出（演示脚本里每个角色自带四维状态机），不再从训练记录反查，
    因此这里没有任何 ``record_id`` 字段——请求里带上也不会被读取。
    """

    model_config = _REQ_CFG
    text: str = Field(min_length=1, max_length=500)
    emotion_state: str = Field(min_length=1, max_length=40)
    #: 对话分组 ID：同一通演示电话的逐句合成共享它，服务端据此串多轮上下文。
    section_id: str = Field(min_length=1, max_length=80)
    speaker: str | None = Field(default=None, max_length=64)


class VoiceDemoHistoryItem(BaseModel):
    """当前页面会话里的一条历史消息（服务端不持久化，由前端每次带回）。"""

    model_config = _REQ_CFG
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1000)


class VoiceDemoChatRequest(BaseModel):
    """``POST /api/voice-demo/chat/stream``：自由语音对话的一轮。

    只要 ``character_id``：角色定义（姓名/性格/语气/音色）以服务端为准，前端传 ID
    即选人，传不认识的 ID 是 422/400——绝不由前端注入人设文本。
    """

    model_config = _REQ_CFG
    character_id: str = Field(min_length=1, max_length=40)
    #: 当前页面会话 ID（前端生成）。只用于实验采集行分组，服务端不据此做任何状态。
    session_id: str = Field(min_length=1, max_length=64)
    #: 倒序无关：按时间顺序排列的历史，最后一条通常是 user。
    history: list[VoiceDemoHistoryItem] = Field(default_factory=list, max_length=50)
    emotion_state: str = Field(default="neutral", min_length=1, max_length=40)
    #: 打断演练：让角色一次说完一段长句（4-6 句），便于测试随时插话。
    test_mode: Literal["long_response"] | None = None


class VoiceDemoCharacterItem(BaseModel):
    model_config = _RESP_CFG
    id: str
    name: str
    role: str
    personality: str
    tone: str
    speaker: str


class VoiceConfigExportResponse(BaseModel):
    model_config = _RESP_CFG
    provider: str
    tts_resource_id: str
    tts_speaker: str
    tts_model: str
    tts_sample_rate: int
    tts_format: str
    tts_timeout: int
    monthly_budget: float
    exported_at: str
