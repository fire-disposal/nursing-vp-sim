# Spec: 情感语音合成集成 (Emotional TTS)

> 状态: Draft  
> 分支: `feat/emotional-tts`  
> 产品: 火山引擎 · 语音技术 · 传统 TTS + SSML 标记语言

## 0. 方案选型

| 维度 | 传统 TTS + SSML | **大模型 TTS ← 采用** |
|------|----------------|---------------------|
| 延迟 | 200-500ms | 1-3s → **通过预缓冲降至 <300ms 感知** |
| 成本 | ~¥2/万字 | ~¥5/万字 — 教育场景可接受 |
| 情感表现 | rate/pitch/volume 模拟 | **真实情感建模** — 悲伤/愤怒/恐惧 |
| 音色库 | 30+ 标准音色 | **10+ 情感音色** + 情感标签 |
| 关键差异 | 机械感，护理学生可感知不自然 | 自然情感，更贴近真人患者 |

**选型理由**: 大模型 TTS 虽然原始延迟 1-3s，但配合预缓冲、流式合成、连接复用三层优化，实际感知延迟可降至 <300ms。情感真实度对护理仿真训练有不可替代的价值——学生需要听到"真的"紧张或冷漠，而不只是加快/放慢的机械声。

## 1. 目标

将现有浏览器 SpeechSynthesis API 替换为火山引擎大模型 TTS，根据对话情感状态自动选择 emotion 标签，通过预缓冲策略消除感知延迟。

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

| 情绪状态 | trust/comfort 条件 | emotion 标签 | speech_rate | 效果描述 |
|----------|-------------------|-------------|-------------|---------|
| withdrawn | trust < 30, comfort < 30 | `sad` | 0.85 | 低沉退缩 |
| defensive | trust < 40, comfort ≥ 30 | `angry` | 1.15 | 急促抵触 |
| anxious | trust ≥ 30, comfort < 30 | `fearful` | 1.10 | 紧张不安 |
| neutral | 30 ≤ both < 60 | — | 1.0 | 平稳 |
| relaxed | trust ≥ 40, comfort ≥ 60 | `happy` | 0.95 | 放松 |
| open | trust ≥ 60, comfort ≥ 60 | `friendly` | 1.0 | 温和配合 |

**映射函数签名**:
```python
def emotion_to_tts_params(state: str) -> TTSRequest:
    """Return (emotion_tag, speech_rate) for given emotion state."""
```

## 4. 延迟优化策略

大模型 TTS 原始延迟 1-3s，通过以下三层优化将感知延迟降至 <300ms：

### 4.1 预缓冲 (Pre-buffer)

在 SSE 流收尾阶段即发起 TTS 请求，与文本渲染并行：

```
SSE chunk N-2, N-1  →  患者文本已完整（llm_reply 已确定）
  → 立即 POST /api/tts/synthesize     ← TTS 开始合成
  → SSE chunk N (final) + stream:done
  → 此时 TTS 响应已返回或接近完成
  → 即刻播放
```

**实现**: 在 `StreamManager` 的 SSE chunk 回调中，当收到倒数第 2 个 chunk 或文本长度不再增长时，触发预合成。`bus.emit("tts:prebuffer", { text, recordId })` → TTSManager 异步发起请求并缓存结果。

### 4.2 连接复用 (HTTP Keep-Alive)

火山 TTS 服务的 TLS 握手 ~200ms。通过 `httpx.AsyncClient` 连接池（`keepalive_expiry=60`）避免每次请求重复握手：

```python
# infrastructure/tts/client.py
self._http = httpx.AsyncClient(
    timeout=httpx.Timeout(8.0),
    limits=httpx.Limits(max_keepalive_connections=3, max_connections=10),
)
```

### 4.3 流式播放 (Streaming Playback)

若火山支持流式 TTS（chunked transfer），前端可边收边播：

```
POST /api/tts/synthesize/stream
  → 后端流式转发火山 TTS chunked response
  → 前端 MediaSource API 逐块播放
```

若火山暂不支持流式，则使用预缓冲策略兜底，效果相当。

### 4.4 首句优先

对于长回复（>50 字），按第一个标点符号分割，首句单独请求 TTS 即刻播放，剩余部分后台合成、无缝衔接。

### 4.5 延迟目标

| 场景 | 无优化 | 优化后（目标） |
|------|--------|-------------|
| 短回复 (≤30字) | 1.2s | **<300ms 感知延迟** |
| 中回复 (30-80字) | 1.8s | **<500ms 感知延迟** |
| 长回复 (>80字) | 2.5s | **首句 <500ms，全文 <2s** |

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
1. `emotion_to_tts_params()` 将情绪状态 → (emotion_tag, speech_rate)
2. 组装请求体 `{"text": "...", "emotion": "sad", "speech_rate": 0.85, "voice_type": "zh_female_vv"}`
3. 火山鉴权签名 (HMAC-SHA256)
4. POST `openspeech.bytedance.com/api/v1/tts`
5. 解析响应 → 返回 `bytes`

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
     → 降级: catch error → 浏览器 TTS 无缝回退
```

---

## 7. 降级与容错

### 7.1 降级策略：火山 → 浏览器 TTS 无缝切换

```
火山 TTS 调用
  ├─ 成功 → 播放火山音频
  └─ 失败 → 检查降级状态
       ├─ 未达熔断阈值 → 尝试浏览器 TTS
       └─ 已达熔断阈值 → 浏览器 TTS（跳过火山请求）
```

**熔断器状态机**:
```
CLOSED ──3次连续失败──→ OPEN (5min)
  ↑                        │
  └── 1次成功(半开探测) ───┘
```

### 7.2 浏览器 TTS 回退

前端保留现有 `createBrowserTTS()` 作为 Provider，形成双层 TTS 架构：

```typescript
// 双层 Provider 模式
class TTSManager {
    private emotionProvider: VolcTTSProvider;   // 火山（优先）
    private fallbackProvider: BrowserTTSProvider; // 浏览器（回退）
    
    async speak(text: string, recordId: number): Promise<void> {
        try {
            await this.emotionProvider.speak(text, recordId);
        } catch {
            // 无缝回退 — 用户无感知
            await this.fallbackProvider.speak(text);
        }
    }
}
```

**浏览器 TTS 的情感模拟**（基础降级）：
- 调节 `SpeechSynthesisUtterance.rate` — 愤怒加速，悲伤减速
- 调节 `SpeechSynthesisUtterance.pitch` — 紧张升调，平静降调
- 限制：无法表达细微情感差异，但提供基础区分度

### 7.3 失败场景矩阵

| 失败场景 | 行为 |
|---------|------|
| 火山 API 超时 (>8s) | 浏览器 TTS 回退，记录熔断计数 |
| 火山 API 鉴权失败 | 日志告警，浏览器回退，触发熔断 |
| 网络不通 | 浏览器 TTS 回退 |
| 情绪状态不存在 | 使用 `neutral` 默认参数 |
| audio 播放失败 | 静默忽略 |
| 浏览器 TTS 不可用 | 静默丢弃（如无声卡） |

### 7.4 TTS 状态指示

TrainingHeader TTS 按钮旁显示指示灯：
- 🟢 火山引擎在线
- 🟡 浏览器回退中
- 🔴 TTS 不可用

点击指示灯 → 弹窗显示详情（延迟、今日调用量、费用）。


## 8. 密钥与计费管理

> **更新**: 与 ASR 共用 `VoiceConfig` 模型和 `/api/admin/voice/*` 接口。详见 `docs/spec/asr-voice-input.md` §6。

TTS + ASR 同属火山引擎"语音技术"，共享 app_id/token。管理接口统一在 `/api/admin/voice/` 下。

### 8.1 后端接口

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/admin/tts/config` | 获取 TTS 配置（提供商、密钥掩码、计费状态） |
| `PUT` | `/api/admin/tts/config` | 更新 TTS 密钥和配置 |
| `POST` | `/api/admin/tts/config/test` | 测试连通性（用当前配置调用一次 TTS） |
| `GET` | `/api/admin/tts/usage` | 获取调用统计（今日/本月/总计的调用次数、费用） |
| `GET` | `/api/admin/tts/status` | 当前 TTS 服务状态（在线/降级/不可用、最近错误） |

### 8.2 数据模型

```python
class TTSConfig(Base):
    __tablename__ = "tts_configs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str]         # "volcengine"
    app_id: Mapped[str]           # 加密存储
    access_token: Mapped[str]     # 加密存储
    voice_type: Mapped[str]       # "zh_female_vv"
    cluster: Mapped[str]          # "volcengine"
    monthly_budget: Mapped[float] # 月度费用上限 (CNY)
    is_active: Mapped[bool]
```

```python
class TTSCallLog(Base):
    __tablename__ = "tts_call_logs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int]
    record_id: Mapped[int | None]
    text_length: Mapped[int]      # 原文长度
    emotion_state: Mapped[str | None]
    latency_ms: Mapped[int]
    status: Mapped[str]           # "success" | "fallback" | "error"
    cost_estimated: Mapped[float] # 预估费用
    created_at: Mapped[datetime]
```

### 8.3 管理界面

| 页面 | 位置 | 内容 |
|------|------|------|
| TTS 配置卡片 | `pages/admin/LLMManagementPage.tsx` 内新增 Tab | App ID / Token 掩码输入、音色选择、月度预算、连通性测试按钮 |
| TTS 用量面板 | 同上 Tab 下方 | 今日/本月调用次数、费用统计、成功率折线图 |
| TTS 状态指示灯 | `TrainingHeader.tsx` | 实时显示当前 TTS 模式（火山/浏览器/关闭） |

### 8.4 计费估算

火山大模型 TTS 定价约 ¥5/万字。按以下公式估算：
- 每次调用字符数 × 单价 ÷ 10000 = 预估费用
- 月度预算到达 90% → 管理员告警
- 月度预算到达 100% → 自动切换为浏览器 TTS

### 8.5 权限

- `tts_manage` 权限控制 `/api/admin/tts/*` 接口
- 普通用户只能使用 TTS（通过训练路由），不接触配置

---

## 9. 音色预设与声线分配

### 9.1 音色库

| voice_type | 描述 | 适用人群 |
|------------|------|---------|
| `zh_female_vv` | 温柔女声 | 中年女性 |
| `zh_male_qingse` | 青年男声 | 青年男性 |
| `zh_female_tianmei` | 甜美女声 | 年轻女性 |
| `zh_male_laoshi` | 老师男声 | 中年男性 |
| `zh_female_child` | 女童声 | 儿童（不限性别） |
| `zh_male_elder` | 老年男声 | 老年男性 |
| `zh_female_elder` | 老年女声 | 老年女性 |

### 9.2 声线分配优先级

```
1. case_data.personality.voice_type   ← 病例显式配置
   ↓ (为空或音色不存在)
2. 患者人口学自动匹配 (age + gender)
   ↓ (患者信息不完整)
3. 系统默认: zh_female_vv
```

### 9.3 人口学自动匹配规则

```python
# infrastructure/tts/mapper.py

def resolve_voice_type(voice_type: str | None, age: int | None, gender: str | None) -> str:
    """按优先级解析最终使用的音色。"""
    # 1. 病例显式配置（需验证有效性）
    if voice_type and voice_type in VALID_VOICE_TYPES:
        return voice_type

    # 2. 人口学推断
    if age is not None and gender is not None:
        if age <= 12:
            return "zh_female_child"
        if age >= 60:
            return "zh_male_elder" if gender == "male" else "zh_female_elder"
        if age <= 25:
            return "zh_male_qingse" if gender == "male" else "zh_female_tianmei"
        return "zh_male_laoshi" if gender == "male" else "zh_female_vv"

    # 3. 未知 → 默认
    return "zh_female_vv"

VALID_VOICE_TYPES = frozenset({
    "zh_female_vv", "zh_male_qingse", "zh_female_tianmei",
    "zh_male_laoshi", "zh_female_child", "zh_male_elder", "zh_female_elder",
})
```

### 9.4 用例编辑

- 病例编辑表单：`personality.voice_type` 下拉框，选项为音色库所有值 + "自动"（默认）
- 选择"自动"时：字段值 `null`，触发人口学匹配
- 用例 API 返回时附带解析后的实际音色（`resolved_voice_type`），方便前端预览

---

## 10. 实施计划

| Phase | 内容 | 共享 |
|-------|------|------|
| **V-1** | `VoiceConfig` + `VoiceCallLog` 模型 + 迁移 + 管理 API | TTS + ASR 共用 |
| **T-1** | 后端 `infrastructure/tts/` + `routers/tts.py` | TTS |
| **T-2** | 前端 `TTSManager` 重构 + 双层 Provider + 预缓冲 | TTS |
| **T-3** | 熔断降级 + 浏览器 TTS 情感模拟 + 音色病例配置 | TTS |
| **A-1** | 后端 `infrastructure/asr/` + WebSocket 路由 | ASR |
| **A-2** | 前端 `useVoice` 重构 + `ChatInput` 语音按钮 | ASR |
| **M-1** | 管理面板"语音服务"Tab + 连通性测试 + 用量 | 共用 |

---

## 11. 安全

- AK/SK 仅存储在后端 `ApiSecret` 表（Fernet 加密）
- 前端不接触任何火山凭证
- 路由需要用户认证（`get_current_user`）
- 限流：每个用户最多 10 次/分钟 TTS 调用

---

## 12. 开放问题

- [ ] 火山语音是否需要开通企业认证？（个人开发者能否使用）
- [ ] `zh_female_vv` 音色在 `fearful`/`angry` 情感下的实际效果需实测
- [ ] 是否需要在 LLM 对话提示中告知患者"你的语音将被合成"以影响表达风格？
- [ ] 音频缓存策略：相同文本 + 相同情绪是否需要缓存？
