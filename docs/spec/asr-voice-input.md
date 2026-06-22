# Spec: 语音识别集成 (ASR / Speech-to-Text)

> 状态: Draft  
> 分支: `feat/emotional-tts` (与 TTS 共享)  
> 产品: 火山引擎 · 语音技术 · 实时语音识别

## 0. 方案选型

**采用: 火山引擎实时语音识别**。与 TTS 同厂商，单一控制台、单一账单、同认证体系。

| 接口 | 场景 | 延迟 |
|------|------|------|
| 实时流式 ASR (WebSocket) | 对话语音输入 — 边说边显示 | 首字 <200ms |
| 一句话识别 (HTTP) | 短音频文件识别 — 回退/降级 | <500ms |

## 1. 目标

激活现有 `useVoice.ts` hook，将底层替换为火山引擎 ASR，实现学生语音输入 → 实时转写 → 自动发送聊天消息。

---

## 2. 架构概览

```
┌─ Frontend ─────────────────────────────────────────────┐
│  ChatInput                                                │
│  [🎤] 按钮 → useVoice.startListening()                    │
│       │                                                   │
│       ▼                                                   │
│  useVoice hook (改造)                                     │
│  ├─ liveTranscript: string   ← 实时转写显示               │
│  ├─ isListening: boolean     ← 麦克风状态                 │
│  └─ onResult(transcript)     ← 最终结果回调               │
│       │                                                   │
│       ▼                                                   │
│  POST /api/asr/recognize (HTTP 一句话识别，降级用)        │
│  或 WebSocket /api/asr/stream (流式，主力)                │
└───────────────────────────────────────────────────────────┘
         │
         ▼
┌─ Backend ────────────────────────────────────────────────┐
│  routers/asr.py                                            │
│  ├─ WS /asr/stream        → VolcASRClient.stream()        │
│  └─ POST /asr/recognize   → VolcASRClient.recognize()     │
│                                                            │
│  infrastructure/asr/                                       │
│  ├─ client.py       → VolcASRClient (鉴权、调用)          │
│  └─ metrics.py      → 调用统计 (延迟、字符数、置信度)      │
└───────────────────────────────────────────────────────────┘
```

---

## 3. API 设计

### 3.1 WebSocket 流式识别（主力）

```
Client                           Server                    Volcengine
  │                                │                          │
  │── WS /api/asr/stream ────────→│                          │
  │   { auth: Bearer token }      │                          │
  │                                │── WS volc ASR stream ──→│
  │←─ { type: "ready" } ─────────│                          │
  │                                │                          │
  │── { type: "audio",            │                          │
  │     data: base64(pcm) } ─────→│── forward ──────────────→│
  │                                │←─ partial result ───────│
  │←─ { type: "partial",         │                          │
  │     text: "护士" } ──────────│                          │
  │                                │                          │
  │── { type: "audio", ... } ────→│── forward ──────────────→│
  │                                │←─ final result ─────────│
  │←─ { type: "final",           │                          │
  │     text: "护士你好",         │                          │
  │     confidence: 0.95 } ──────│                          │
  │                                │                          │
  │── { type: "end" } ───────────→│── close ────────────────→│
  │←─ { type: "done" } ──────────│                          │
```

**WebSocket 消息格式**:

```typescript
// Client → Server
{ type: "audio", data: "<base64 pcm>" }
{ type: "end" }

// Server → Client
{ type: "ready" }
{ type: "partial", text: string }
{ type: "final", text: string, confidence: number }
{ type: "error", message: string }
{ type: "done" }
```

### 3.2 HTTP 一句话识别（降级）

```
POST /api/asr/recognize
Body: { audio: "<base64 wav>", format: "wav", sample_rate: 16000 }
Response: { text: "护士你好", confidence: 0.95, duration_ms: 3200 }
```

用于不支持 WebSocket 的场景或快速测试。

---

## 4. 前端改造

### 4.1 useVoice hook 重构

```typescript
// frontend/src/hooks/useVoice.ts

export function useVoice() {
    const [isListening, setIsListening] = useState(false);
    const [partialText, setPartialText] = useState("");
    const wsRef = useRef<WebSocket | null>(null);
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);

    const startListening = useCallback(async () => {
        // 1. 请求麦克风权限
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // 2. 建立后台 WebSocket
        const token = useAuthStore.getState().token;
        const ws = new WebSocket(`wss://${host}/api/asr/stream?token=${token}`);
        // 3. MediaRecorder 采集 PCM → Base64 → WS 发送
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recorder.ondataavailable = (e) => {
            const reader = new FileReader();
            reader.onload = () => ws.send(JSON.stringify({
                type: "audio",
                data: arrayBufferToBase64(reader.result as ArrayBuffer),
            }));
            reader.readAsArrayBuffer(e.data);
        };
        recorder.start(200); // 每 200ms 发送一片
        // 4. 接收实时转写
        ws.onmessage = (e) => {
            const msg = JSON.parse(e.data);
            if (msg.type === "partial") setPartialText(msg.text);
            if (msg.type === "final") { onResult(msg.text); stopListening(); }
        };
        setIsListening(true);
    }, []);

    const stopListening = useCallback(() => {
        wsRef.current?.send(JSON.stringify({ type: "end" }));
        mediaRecorderRef.current?.stop();
        setIsListening(false);
        setPartialText("");
    }, []);

    return { isListening, partialText, startListening, stopListening };
}
```

### 4.2 ChatInput 整合

`ChatInput.tsx` 语音按钮调用 `useVoice()`:
- 按住录音 / 点击切换录音状态
- `partialText` 实时显示在输入框（灰色斜体）
- `final` 结果自动填入输入框 → 触发发送

---

## 5. 后端新增模块

### 5.1 `backend/infrastructure/asr/client.py`

```python
@dataclass
class ASRResult:
    text: str
    confidence: float       # 0.0-1.0
    is_final: bool
    duration_ms: int

class VolcASRClient:
    def __init__(self, app_id: str, token: str, cluster: str = "volcengine"):
        ...

    async def stream_recognize(
        self,
        audio_chunks: AsyncIterable[bytes],
        sample_rate: int = 16000,
    ) -> AsyncIterable[ASRResult]:
        """WebSocket 流式识别，yield 中间/最终结果。"""
        ...

    async def recognize(
        self, audio: bytes, format: str = "wav", sample_rate: int = 16000
    ) -> ASRResult:
        """HTTP 一句话识别。"""
        ...

    async def health_check(self) -> bool: ...
```

### 5.2 `backend/routers/asr.py`

| 路径 | 方法 | 说明 |
|------|------|------|
| `/api/asr/stream` | WS | WebSocket 流式识别 |
| `/api/asr/recognize` | POST | HTTP 一句话识别（降级） |

---

## 6. ASR 密钥与计费管理（合并到 TTS 管理面板）

### 6.1 配置复用

ASR 与 TTS 同属火山引擎"语音技术"产品，共享同一 `app_id`/`token`。已有 `§8 TTS 密钥与计费管理` 中的 `TTSConfig` 模型和 `/api/admin/tts/config` 接口同时控制 ASR。

`TTSConfig` 重命名为 `VoiceConfig`，同时管理 TTS + ASR：

```python
class VoiceConfig(Base):
    __tablename__ = "voice_configs"

    id           # PK
    app_id       # 火山 app id (TTS + ASR 共用)
    token_enc    # 加密 token
    # TTS settings
    tts_voice_type
    tts_timeout
    # ASR settings  
    asr_sample_rate
    asr_enable_streaming
    # Billing
    monthly_budget  # 月度预算 (TTS + ASR 合计)
    is_active
```

### 6.2 调用日志

TTSCallLog 扩展为 `VoiceCallLog`，新增 `direction` 字段区分 TTS/ASR：

```python
class VoiceCallLog(Base):
    id
    user_id
    record_id
    direction: str      # "tts" | "asr"
    text_length: int
    emotion_state       # TTS only
    confidence: float   # ASR only
    latency_ms: int
    status: str         # success | fallback | error
    created_at
```

### 6.3 管理 API 扩展

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/voice/config` | 获取语音配置（TTS + ASR） |
| `PUT` | `/api/admin/voice/config` | 更新配置 |
| `POST` | `/api/admin/voice/config/test-tts` | 测试 TTS 连通性 |
| `POST` | `/api/admin/voice/config/test-asr` | 测试 ASR 连通性 |
| `GET` | `/api/admin/voice/usage` | 用量统计 (TTS/ASR 分别) |
| `GET` | `/api/admin/voice/status` | 服务状态 |

### 6.4 管理界面

`LLMManagementPage` 内的 "语音服务" Tab 包含：
- App ID / Token 输入（掩码）
- TTS 音色选择 + ASR 采样率
- 连通性测试按钮（TTS + ASR 分别）
- 用量面板：TTS/ASR 分别的调用次数、时长、费用
- 月度预算进度条

---

## 7. 计费估算

| 产品 | 计费方式 | 单价 |
|------|---------|------|
| 实时 ASR (流式) | 按音频时长 | ~¥3.5/小时 |
| 一句话识别 (HTTP) | 按调用次数 | ~¥0.002/次 |
| 大模型 TTS | 按字符数 | ~¥5/万字 |

**护理训练场景估算**（单次 20 分钟对话）:
- 学生语音输入：约 5 分钟实际说话 → ASR ¥0.29
- 患者语音输出：约 10 条回复 × 30 字 → TTS ¥0.15
- **单次训练总成本: ~¥0.44**

月度预算建议：¥200（约 450 次训练）。

---

## 8. 实施计划

| Phase | 内容 |
|-------|------|
| **语音基础设施** | `VoiceConfig` 模型 + 迁移 + 管理 API + 认证复用 |
| **ASR 后端** | `infrastructure/asr/` + WebSocket 路由 + HTTP 降级 |
| **ASR 前端** | `useVoice` 重构 + `ChatInput` 语音按钮 + 实时转写显示 |
| **管理面板** | `LLMManagementPage` 新增"语音服务" Tab |
| **合并测试** | 端到端语音输入 → 发送 → LLM → 情感语音输出 |
