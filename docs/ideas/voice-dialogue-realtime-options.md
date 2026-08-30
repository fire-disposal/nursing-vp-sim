# 语音对答（对标豆包 / GPT 打电话模式）技术方案评估

> 状态：论证文档（非决策）
> 日期：2026-08-30 ｜ 基于主干 master @ `e882416e`
> 参考：[电话式纯语音采集可行性](./voice-call-feasibility.md)（半双工对讲机 MVP 论证，2026-07-31）
> 范围：现网 VP-SIM 训练系统上实现「类豆包 / GPT-Realtime 打电话」的语音对答。
> 明确不做：真实 PSTN 电话（监管 + 号码资质 + 录音合规），维持原结论。

---

## 一、事实盘点（基于代码，非推测）

### 1.1 已具备的能力

| 组件 | 位置 | 成熟度 |
|------|------|--------|
| TTS 句级流式播放 | `frontend/src/engine/tts/TTSManager.ts`（sentence-pipelined、PCM 分块、浏览器兜底、熔断降级） | 🟢 生产级 |
| TTS 服务端 | `backend/infra/tts/`（Volc `VolcBidirectionalTTSClient`、连接池、熔断、句级流式）+ `backend/modules/voice/router.py`（`/api/tts/synthesize` 与 `synthesize_stream`） | 🟢 生产级 |
| 语音情绪 → 语气 | `backend/modules/voice/router.py:_resolve_emotion()`（4D 情绪主导态 → TTS 语气）+ 人口学 speaker 映射 | 🟢 |
| 训练/聊天/评分 | SSE 流式 chat + TrainingAction + 情绪引擎 + 守卫 + 评分（`Score.effective_total`） | 🟢 |
| 浏览器语音**输入** | `frontend/src/components/training/ConversationComposer.tsx`：`SpeechRecognition`/`webkitSpeechRecognition`（`zh-CN`，interim 实时进输入框）确认后 send | ⚪ MVP |
| 通话模式 | `ConversationComposer` 的 `call` 模式（CallShell） | 🔴 仅入口占位 |

### 1.2 缺失的能力

| 组件 | 现状 | 关键证据 |
|------|------|----------|
| **服务端 ASR（语音→文本）** | **从零** | 迁移 `0a3b2c1d4e5f_drop_asr_columns_from_voice_configs.py` 已删 `asr_resource_id/asr_sample_rate/asr_endpoint_mode`；`voice_config_v3` 又删 `asr_enable_streaming`。整个 backend 无任何 `bigasr`/转录实现（仅 .venv 噪声） |
| 全双工 / turn-taking | 无 | 当前为「打字 → 发送 → 流式回复」半双工；`call` 模式无实现 |
| VAD / barge-in（打断） | 无 | `TTSManager.stop()` 存在，但无麦克风 VAD 触发逻辑 |
| 实时音频通道 | 无 | `backend/infra/realtime.py` 的 `PgRealtimeHub` 是 PG LISTEN/NOTIFY **通知**订阅，非音频流，不能复用 |

### 1.3 结构性事实（决定路由的关键）

1. **系统的"智能"全在文本脑**：`patient_chat` 目的 → `deepseek-v4-flash`（`backend/infra/llm/profile.py`，`max_tokens=512`，`temperature=0.6`）。病例/四域消息组装/prompt 模板/4D 情绪/守卫/评分全部挂在 DeepSeek **文本消息**语义上。
2. **聊天即 SSE 文本流**（`frontend/src/engine/StreamManager.ts` 的 `onPatientChunk`/`onPatientDone` → `TTSManager.speakStreamChunk`），非实时语音会话。
3. **TTS=请求-响应**（synthesize / stream_synthesize），非双工。
4. 因此：**「语音对答」的可行形态必然是「音频前装 + 文本脑」** —— 输入经 ASR 转写出文本消息，复用现有 SSE 管道，评分/情绪/守卫零改动自动覆盖。

---

## 二、目标定义（对标豆包 / GPT-Realtime）

| 维度 | 参考基准 | 本项目可接受档 |
|------|----------|----------------|
| 双工 | 全双工，双向同时 | 全双工（学生说话时患者可已开始 / 反之） |
| 打断 | 可 barge-in，患者立即停下 | 打断→停 TTS→切聆听（可并行） |
| 首响延迟 | ~200–800ms | ≤1.5–2.5s（半句 ASR + LLM TTFB + TTS 首分句） |
| 回声 | 无外放自激 | 无回声/自激 |
| 跨端 | 各端一致 | Chrome/Edge 主、移动 Safari 尽力 |

**核心洞察（沿用 07-31 结论，此处强化）**：教学价值在「语音输入 + 自动评分」闭环，不在「像不像真电话」。类豆包外壳是**体验加成**，不是教学刚需。

---

## 三、架构 fork（先拍板）

### 路线 甲 — 原生实时 speech-to-speech 模型
OpenAI Realtime / 豆包 Realtime / Volc 实时语音。模型端到端完成 ASR+LLM+TTS + turn-taking + barge-in。

- 优点：最像打电话、音频工程最少、延迟最低。
- 致命缺点（本项目）：**会把 DeepSeek 文本脑 + prompt + 4D 情绪 + 守卫 + 评分全部关进黑盒**。要么重写 prompt 工程塞进新模型，要么丢评分/情绪/病例逻辑。**产品风险极大**。

### 路线 乙 — 音频前装 + DeepSeek 文本脑（推荐）
保留文本脑 + 全部 scorer/emotion/guard。在其上装**全双工实时音频前端**（服务端流式 ASR 输入 + 现有 Volc TTS 输出 + 双向 WS 管线 + VAD/barge-in/回声消除）。

- 优点：评分/情绪/病例逻辑零改动；复用全部现成组件。
- 代价：**turn-taking 要自己造**（豆包/GPT 中由模型免费提供），M3 是成败点且易膨胀。

### 路线 丙 — 半双工对讲机 MVP（已有论证，作为滚入路径）
浏览器 Web Speech ASR 半双工 + 现有 TTS。后端零改动，1–2 周，覆盖 90% 教学价值。

> 已由 `voice-call-feasibility.md` 论证（3–5 周含细化），本文将其作为**最低成本保底路径**保留。

---

## 四、几个最可行的方案（按可行性 × 教学质量 × 工程风险排序）

> 下表「AI 开发 token」指：以 DeepSeek flash 为编码模型，**写代码 + 调试**所消耗的代理 token（大头在上下文重读与迭代，不在代码行数）。

| 方案 | 形态 | 技术要点 | 难度 | 工期（1 人） | AI 开发 token（flash） | 主要风险 |
|------|------|----------|------|--------------|------------------------|----------|
| **A. 半双工对讲 MVP**（推荐先做） | 按住说话→患者语音回复 | 浏览器 `SpeechRecognition` + 现有 SSE/TTS；后端零改动 | 低 | **1–2 周** | **≈2M–5M** | Web Speech 仅 Chrome/Edge、医学名词易错、无法打断 |
| **B. 半双工 + 服务端 ASR（Volc BigASR）** | 同上，识别质量升级 | 恢复被删的 `asr_*` 配置列（迁移）+ self-build WS 客户端 + 医学热词表；`SpeechRecognition` 降级为兜底 | 中 | **2–3 周** | **≈4M–8M** | 新增后端 ASR 依赖、配置/管理面板、热词维护 |
| **C. 全双工（自建 / LiveKit、Pipecat）** | 类豆包可打断 | LiveKit Agents / Pipecat 管 VAD+打断+WebRTC；你接 Volc ASR + DeepSeek + 现有 TrainingAction | 中高 | **4–6 周** | **≈15M–35M** | VAD/barge-in/回声/延迟；跨端；M3 易膨胀 |
| **D. 原生实时 speech-to-speech** | 类豆包最像 | 豆包 / OpenAI Realtime，模型自带 turn-taking | 中（接口省） | **2–4 周** | **≈20M–40M** | **破坏评分/情绪/prompt/审计链，需重写**；产品风险最高 |

### 方案对比结论

```
A：95% 教学价值，最低风险，最优 ROI  → 建议先行
B：A 的质量升级（识别 + 热词），接口隔离后可平滑替换 A 的 ASR
C：真正对标豆包外壳（全双工/打断/低延迟），是「体验达标」的必经之路
D：最快最像，但把系统智能关进平台黑盒，本项目不推荐（除非接受重构）
```

---

## 五、难度 / 可行度 / 工期 / token 消耗（逐项）

### 5.1 难度构成（对标豆包）

| 子系统 | 难度 | 说明 |
|--------|------|------|
| 服务端流式 ASR | 中 | Volc BigASR 接入：PCM16k、partial→final、配置/迁移/管理面板 |
| 双向 WS 实时管线 | 中 | mic→ASR→LLM→TTS→播放；分块/背压/重连；现有 `PgRealtimeHub` 不能复用 |
| **VAD + barge-in + 回声** | **高（最大成败点）** | 学生打断患者、静音阈值、外放回声/自激、自然轮次切换 |
| 延迟预算 | 高 | 全管 <2.5s 首响；ASR 半句 + DeepSeek TTFB + TTS 首分句，压缩空间有限 |
| 跨端兼容 | 高 | 移动 Safari mic / `AudioContext` / iOS 播放锁 / MediaRecorder 差异 |
| 会话融合 | 中 | 语音轮次映射回离散文本消息边界；情绪/守卫/评分/快照不被并发破坏 |

### 5.2 可行度

- **高**：TTS、LLM、SSE 管道、情绪、守卫、评分、会话状态全部现成；缺的只是「实时双工输入管线」。
- **但要诚实**：类豆包的自然感 **80% 取决于 VAD/barge-in/回声/延迟**，不是模型也不是接口。这四块是「像 demo / 像产品」的分水岭。
- 服务端 ASR 是从零接入（非复用），是唯一新增的系统级依赖。

### 5.3 工期（1 名全栈，含测试 + 真机）

| 里程碑 | 内容 | 工期 |
|--------|------|------|
| M1 | 服务端 ASR + WS 管线 | 1–1.5 周 |
| M2 | 前端采集/播放 + 双工 | 1 周 |
| M3 | VAD / barge-in / 回声 / 延迟调优 | **1.5–2 周（质量红线，易膨胀）** |
| M4 | 会话融合 + 降级 + 真机 + 测试 | 1 周 |

- 方案 C 全双工：**≈4.5–6 周**（对标豆包约 5 周）；若只求「能通、能打断到及格」，**3–4 周**（压缩 M3，风险上移）。
- 方案 A：**1–2 周**（前端会话 hook + ASR，后端零改动）。

### 5.4 AI 开发 token 消耗（DeepSeek flash 示例，编码 + 调试）

- 方法：AI 编码 token 大头是**上下文反复读取 + 每轮工具/测试输出 + 重试迭代**；新写/改动约 2200–3200 行（方案 C），但整段会话 token 远大于代码行数。
- 参考量级：约 **1000–1500+ 轮次**，单轮上下文中后期 3–6 万 token，输出 0.5–2k/轮。

| 方案 | flash token（编码+调试） | 折算成本（`~$0.28/M in / $0.42/M out`，官方未核对） |
|------|--------------------------|------------------------------------------------------|
| A | ≈2M–5M | ≈$1–$2 |
| B | ≈4M–8M | ≈$2–$4 |
| C | ≈15M–35M（中枢 ~22M） | ≈$6–$18 |
| D | ≈20M–40M | ≈$8–$20 |

> 结论：**token 成本远低于工时报价，真正的瓶颈是工期与真机调试（尤其 M3）**，不是 token 钱。

---

## 六、关键风险与 PoC 验收

### 6.1 关键风险

1. **ASR 识别质量**（最大变数）：浏览器 Web Speech 依赖 Chrome/Edge 与网络，医学用词易错；服务端 Volc BigASR 质量好、可加热词表，但需恢复配置列 + 自建客户端。
2. **打断 / 回声**：方案 C 的核心质量线；做不好则「像对讲机」，不像豆包。
3. **跨端**：移动 Safari 的 mic/AudioContext/iOS 播放锁是高频调试坑。
4. **会话融合**：语音轮次必须映射回文本消息边界，否则破坏守卫/评分/快照。

### 6.2 PoC 前置（拍板前先跑通，明确验收指标）

- 全双工（学生说话时患者已开始 / 反之）。
- 可打断：barge-in 延迟 <500ms，患者立即停止。
- 首响 <2s；外放无回声/自激。
- Chrome/Edge + 移动 Safari 各测一轮。

> 这三条跑不通，方案 C 不建议立项；跑通再排 M3/M4。

---

## 七、决策建议

```
✅ 推荐推进路径：A →（可选 B）→ C
   A（1-2 周）：半双工对讲，覆盖 90% 教学价值，后端零改动，立即可用
   B（可选）：A 的 ASR 换 Volc BigASR + 热词，接口隔离
   C（4-6 周）：LiveKit/Pipecat + 现有组件，真正对标豆包
   —— 若教学验收可接受半双工，A 即止；若要"像打电话"，再上 C

⚠ 关键前提：
   1. 服务端 ASR 从零接入（唯一新增系统依赖），需恢复被删 `asr_*` 配置列。
   2. M3（VAD/barge-in/回声/延迟）单独隔离为质量红线，预留 1.5-2 周。
   3. 移动端兼容需真机调试，勿以单元测试替代。

❌ 不推荐：路线甲（原生 realtime speech-to-speech）——破坏评分/情绪/prompt/审计链。
```

**一句话结论**：本项目做「类豆包语音对答」**可行且成本低**（AI 开发 token 仅数美分到十几美金，瓶颈在工期而非 token）；但要保住评分/情绪/病例逻辑这条产品命脉，**方案 C（音频前装 + DeepSeek 文本脑）是唯一正确路线**，且务必以 M3（可打断/无回声/低延迟）为质量红线先行 PoC。
