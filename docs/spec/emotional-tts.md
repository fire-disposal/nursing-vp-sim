# Spec: 情感语音合成集成 (Emotional TTS)

> 状态: Draft  
> 分支: `feat/emotional-tts`  
> 产品: 火山引擎 · 语音技术 · 大模型语音合成 v2

## 1. 目标

将现有纯文本 TTS（浏览器 SpeechSynthesis API）替换为火山引擎大模型语音合成，实现根据对话情感状态（trust/comfort）自动调节音色的自然语音输出。

---

## 2. 架构概览

```
┌──────────────────────────────────────────────────────┐
│                     Backend                           │
│                                                      │
│  side_effects.py         emotion.py                  │
│  emotion.update()   →   EmotionState                 │
│       │                      │                       │
│       ▼                      ▼                       │
│  SSE emotion_change   emotion → TTS params mapping   │
│       │                 (infrastructure/tts/mapper)   │
│       ▼                      │                       │
│  Frontend (bus)              ▼                       │
│       │              TTS Client (HTTP)                │
│       ▼              infrastructure/tts/client        │
│  TTSManager ←── POST /api/tts/synthesize             │
│       │           ←── binary audio (mp3/wav)          │
│       ▼                                               │
│  <audio> playback                                    │
└──────────────────────────────────────────────────────┘
```

**关键设计决策**: TTS API 调用走后端代理，前端不直接持有火山密钥。

---

## 3. 情绪 → TTS 参数映射

| 情绪状态 | trust/comfort 条件 | TTS emotion | speech_rate | volume |
|----------|-------------------|-------------|-------------|--------|
| withdrawn | trust < 30, comfort < 30 | `sad` | 0.85 | 0.9 |
| defensive | trust < 40, comfort ≥ 30 | `angry` | 1.15 | 1.0 |
| anxious | trust ≥ 30, comfort < 30 | `fearful` | 1.10 | 0.95 |
| neutral | 30 ≤ trust < 60, 30 ≤ comfort < 60 | `neutral` | 1.0 | 1.0 |
| relaxed | trust ≥ 40, comfort ≥ 60 | `happy` | 0.95 | 1.0 |
| open | trust ≥ 60, comfort ≥ 60 | `friendly` | 1.0 | 1.05 |

**映射函数签名**:
```python
def emotion_to_tts_params(state: str, trust: int, comfort: int) -> TTSRequest:
    """Return (emotion_tag, speech_rate, volume) for given emotion state."""
```

---

## 4. 后端新增模块

### 4.1 `backend/infrastructure/tts/__init__.py`
- 模块导出

### 4.2 `backend/infrastructure/tts/client.py`
**职责**: 封装火山引擎 TTS HTTP 调用

```python
@dataclass
class TTSRequest:
    text: str
    voice_type: str          # zh_female_vv 等
    emotion: str | None      # sad/angry/fearful/happy/neutral/friendly
    speech_rate: float       # 0.5-2.0
    volume: float            # 0.1-1.0
    encoding: str            # mp3 | wav | pcm
    timeout: int             # 默认 8s

class VolcTTSClient:
    """火山引擎语音合成 HTTP 客户端。"""
    
    def __init__(self, app_id: str, token: str, cluster: str = "volcengine"):
        ...
    
    async def synthesize(self, req: TTSRequest) -> bytes:
        """返回合成后的音频二进制数据。"""
        ...
    
    async def health_check(self) -> bool:
        """快速连通性检查。"""
        ...
```

**API 调用流程**:
1. 组装请求体 (JSON)
2. 火山鉴权签名 (HMAC-SHA256，参考 `volc-sdk-python`)
3. POST `https://openspeech.bytedance.com/api/v1/tts`
4. 解析响应 → 返回 `bytes`

### 4.3 `backend/infrastructure/tts/mapper.py`
**职责**: 情绪状态 → TTS 参数转换

```python
EMOTION_TTS_MAP: dict[str, dict] = {
    "withdrawn": {"emotion": "sad", "speech_rate": 0.85, "volume": 0.9},
    "defensive": {"emotion": "angry", "speech_rate": 1.15, "volume": 1.0},
    "anxious": {"emotion": "fearful", "speech_rate": 1.10, "volume": 0.95},
    "neutral": {"emotion": "neutral", "speech_rate": 1.0, "volume": 1.0},
    "relaxed": {"emotion": "happy", "speech_rate": 0.95, "volume": 1.0},
    "open": {"emotion": "friendly", "speech_rate": 1.0, "volume": 1.05},
}

def emotion_to_tts(text: str, state: str, voice: str = "default") -> TTSRequest:
    ...
```

### 4.4 `backend/routers/tts.py` (新增路由)
**职责**: 前端无法直接调火山 API → 走后端代理

```python
router = APIRouter(prefix="/api/tts", tags=["语音合成"])

@router.post("/synthesize")
async def synthesize(
    req: TTSSynthesizeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    request: Request,
) -> Response:
    """将文本 + 情绪状态合成语音，返回音频流。"""
    # 1. 查询当前训练记录的 emotion state
    # 2. mapper 转换为 TTS 参数
    # 3. 调用 VolcTTSClient.synthesize()
    # 4. 返回 StreamingResponse(audio_bytes, media_type="audio/mpeg")
```

**请求体**:
```python
class TTSSynthesizeRequest(BaseModel):
    text: str
    record_id: int           # 关联的训练记录（获取情绪状态）
    voice_type: str = "zh_female_vv"
```

**响应**: `audio/mpeg` 二进制流

### 4.5 配置

```bash
# .env 新增
VOLC_TTS_APP_ID=your_app_id
VOLC_TTS_TOKEN=your_access_token
VOLC_TTS_VOICE_TYPE=zh_female_vv    # 默认音色
VOLC_TTS_CLUSTER=volcengine
VOLC_TTS_TIMEOUT=8
```

`core/config.py` 新增常量。

---

## 5. 前端改造

### 5.1 `TTSManager.ts`

**现状**: 
- 使用浏览器 `SpeechSynthesis` API
- DOM 抓取 `[data-role="patient"]` 获取文本

**改造后**:
```typescript
export class TTSManager {
    // 改为后端代理调用
    private async fetchAudio(text: string, recordId: number): Promise<ArrayBuffer> {
        const res = await api.post(
            "/api/tts/synthesize",
            { text, record_id: recordId },
            { responseType: "arraybuffer" }
        );
        return res.data;
    }

    private async speak(text: string): Promise<void> {
        const audioBuffer = await this.fetchAudio(text, this.recordId);
        const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        await audio.play();
        URL.revokeObjectURL(url);
    }
}
```

**保留降级**: 如果火山 API 不可用，回退到浏览器 SpeechSynthesis。

### 5.2 `TTSManager` 接入 `recordId`

TTSManager 需要知道 `recordId` 才能查询情绪状态。现有构造只接收 `recordId` 但不用于 TTS。改造：
- 存储 `recordId` 引用
- 每次 `speak()` 时传递

### 5.3 音频预缓冲

为避免首次播放延迟，可在 `stream:chunk` 收到最后一块时预触发合成（并发），`stream:done` 时即刻播放。

---

## 6. API 流程

```
Student sends message
  → Pipeline runs
    → side_effects: emotion.update() + emotion_cache.set()
    → runner yields patient reply chunks (SSE)
  → Frontend StreamManager receives chunks + done
    → bus.emit("stream:done")
  → TTSManager:
      1. extractLastPatientMessage()   [获取患者文本]
      2. POST /api/tts/synthesize      [后端代理]
         → VolcTTSClient.synthesize()
            ├─ 查询 emotion state (get_emotion)
            ├─ mapper.emotion_to_tts()
            ├─ POST openspeech.bytedance.com/api/v1/tts
            └─ 返回 audio bytes
      3. new Audio(blob).play()        [浏览器播放]
    → 降级: catch error → 静默失败（不回退到原生 TTS 以避免体验分裂）
```

---

## 7. 降级与容错

| 失败场景 | 策略 |
|---------|------|
| 火山 API 超时 (>8s) | 静默丢弃，不播放 |
| 火山 API 鉴权失败 | 日志告警，后续请求降级到浏览器 TTS |
| 网络不通 | 跳过本次 TTS（已有聊天文字可见） |
| 情绪状态不存在 | 使用 `neutral` 默认值 |
| audio 播放失败 | 静默忽略 |

**熔断**: 连续 3 次失败 → 5 分钟内全部降级到浏览器 TTS。火山恢复后自动切回。

---

## 8. 音色预设

| voice_type | 描述 | 适用场景 |
|------------|------|---------|
| `zh_female_vv` | 温柔女声 | 默认患者（中年女性） |
| `zh_male_qingse` | 青年男声 | 青年男性患者 |
| `zh_female_tianmei` | 甜美女声 | 年轻女性患者 |
| `zh_male_laoshi` | 老师男声 | 中年男性患者 |

音色选择可写入病例 `case_data.personality.voice_type`，支持病例编辑时配置。

---

## 9. 实施计划

| Phase | 内容 | 预估 |
|-------|------|------|
| **Phase 1** | 后端 `infrastructure/tts/` + `routers/tts.py` + 配置 | 1 次提交 |
| **Phase 2** | 前端 `TTSManager.ts` 重构 + API 对接 | 1 次提交 |
| **Phase 3** | 熔断降级 + 音色病例配置 + 测试 | 1 次提交 |

---

## 10. 安全

- AK/SK 仅存储在后端 `ApiSecret` 表（Fernet 加密）
- 前端不接触任何火山凭证
- 路由需要用户认证（`get_current_user`）
- 限流：每个用户最多 10 次/分钟 TTS 调用

---

## 11. 开放问题

- [ ] 火山语音是否需要开通企业认证？（个人开发者能否使用）
- [ ] `zh_female_vv` 音色在 `fearful`/`angry` 情感下的实际效果需实测
- [ ] 是否需要在 LLM 对话提示中告知患者"你的语音将被合成"以影响表达风格？
- [ ] 音频缓存策略：相同文本 + 相同情绪是否需要缓存？
