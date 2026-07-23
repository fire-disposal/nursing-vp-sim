# TTS 流式管线设计 — 对齐豆包语音合成 2.0 范式

**日期**: 2026-07-23
**状态**: 已批准（方案 A，用户授权后续决策）
**驱动力**: 首音延迟（P0）+ 顺手修 P2（真实计费/失败日志/超时生效）
**范围外**: 情感范式重构（手工 rate/loudness 映射保留）、字幕时间戳高亮

## 1. 现状诊断

### 数据流（当前）

```
学生发送 → LLM SSE 字符级流式回复 → stream:done(全文)
  → TTSManager 清洗/截断 → 若>50字拆首句 → POST /tts/synthesize
  → 后端新建 WS 连接 → 全文一次发送 → 缓冲全部音频 → 返回
  → 前端 Blob URL 整段播放
```

首音延迟 = LLM 全文时间 + TTS 全文时间 + 完整下载时间（典型 6~15s）。

### 与豆包 TTS 2.0 范式的差距

火山官方 demo 与真实报文 trace 确认三个协议事实：

1. **发送与接收并发**（`send_chars()` task 与接收循环并行）；当前实现严格串行。
2. **服务器按句组织输出**（`TTSSentenceStart` → 多个 `TTSResponse` 音频块 → `TTSSentenceEnd`），即使逐字喂入——**句级是天然的最小流水线单元**。
3. **`SessionFinished.Payload.usage.text_words`** 携带真实计费字数；当前实现丢弃。

核心差距（按严重度）：

| 级别 | 问题 |
|------|------|
| P0 | 流式能力闲置：等全文 → 整段合成 → 整段下载，三段串行 |
| P0 | 每句新建 WS 连接（握手 + StartConnection 每次数百 ms） |
| P0 | 前端"首句拆分"变通方案导致长回复两次完整串行往返 |
| P2 | usage 丢弃 → 成本靠 `len(text)*0.000002` 估算 |
| P2 | 失败路径不写 VoiceCallLog → 运维 error 恒 0、成功率虚高，与告警矛盾 |
| P2 | `tts_timeout` 配置从未生效（无 `wait_for`） |

## 2. 目标架构（方案 A：句级流水线）

```
LLM SSE chunk → bus "stream:chunk"(携带文本) → SentenceSegmenter
  → 句边界(。！？!?) → 立即 POST /api/tts/stream（句 N+1 合成与句 N 播放并行）
  → 后端连接池借出长连接 → session 内边收边转发 PCM 块
  → 前端 fetch ReadableStream → Web Audio 按样本调度，句间无缝
```

**首音延迟** = 首句生成（~1-2s）+ TTS 首块（~0.3-0.6s）≈ **1.5~2.5s**。

设计取舍：

- **PCM 24kHz 16bit mono 为流式路径固定格式**（Web Audio 免解码直接调度；mp3 无法增量解码）。管理页测试下载仍走旧端点 + 配置格式。带宽 48KB/s 可忽略。
- **句级而非字级**：trace 证明服务器本来就按句合成，字级直通（前端 WS 全双向）收益小、故障面大，YAGNI。
- **流水线深度 1**：单循环"取句 → 流式收完并全部调度 → 取下一句"，网络/合成自然与播放重叠，无复杂并发控制。

## 3. 后端设计

### 3.1 模块结构

```
backend/infrastructure/tts/
├── client.py      # 重构：VolcTTSConnection（连接/会话生命周期分离）
├── pool.py        # 新增：TTSConnectionPool
├── circuit.py     # 不动
└── mapper.py      # 不动
```

### 3.2 `VolcTTSConnection`（client.py 重构）

- `connect()`：建 WS + StartConnection 握手，一次
- `stream_synthesize(req) -> AsyncIterator[bytes]`：每次调用一个 session
  （StartSession → TaskRequest 全文 → FinishSession → 读循环），
  逐 `TTSResponse` 块 yield；`SessionFinished` 捕获 `usage` 存入 `last_usage` 后结束；
  `SessionFailed/ConnectionFailed` 抛错
- `is_alive`（WS 状态）/ `close()`
- `VolcBidirectionalTTSClient` 保留为薄兼容层（admin `health_check` 走一次性连接，不碰池）

### 3.3 `TTSConnectionPool`（pool.py 新增）

- `asyncio.Queue` 存空闲连接；每连接一把 `Lock`（单连接同时只跑一个 session）
- 池大小常量 `TTS_POOL_SIZE = 4`（core/config.py，不加 DB 列、无迁移）；懒加载，首个请求建 1 条，按需增长到上限
- `acquire()` 上下文管理器：借出时若空闲 >30s 做协议级 `ws.ping()`（2s 超时），死连接丢弃补新；异常归还时标记死亡则 close+丢弃
- `close()` 整池销毁；`load_tts_state` 配置重载时调用重建
- Circuit breaker 包在池获取外层，行为不变

### 3.4 流式端点（routers/tts.py 新增，旧端点保留）

```
POST /api/tts/stream
Body: {record_id, text, voice_type?}          # 与 /synthesize 同 schema
→ StreamingResponse, media_type: audio/pcm;rate=24000
→ headers: X-TTS-Speaker / X-TTS-Emotion / X-TTS-Sample-Rate
```

- 鉴权/限流/归属校验/speaker 解析/情感映射全部复用 `TTSService`
- speaker、emotion、sample_rate 在流开始前同步算出 → 响应头即时可用
- **限流阈值调整**：`check_tts_limit` 10/min → 60/min（句级请求扇出 ~3-5 倍，chat 限 6 msg/min → 峰值 ~30/min，60 留有余量仍有限）

### 3.5 P2 修复（services/tts.py）

| 问题 | 修法 |
|------|------|
| usage 丢弃 | session 结束读 `conn.last_usage["text_words"]`，`VoiceCallLog.text_length` 记真实计费字数；成本 = 真实字数 × 现有单价常量（费率不变，仅基数改"计费字符"） |
| 失败不落日志 | try/finally 兜底写 `VoiceCallLog(status="error", latency_ms=实测)`；含 client abort |
| timeout 未生效 | `asyncio.wait_for` 包裹整个 session（recv 循环受同一 deadline 约束），超时记 error 并抛 502 |
| latency_ms 语义 | 流式路径记**首块延迟**（首音指标）；旧端点保持全量延迟 |

无 schema 变更、无迁移。路由变更后须 `pnpm run api:update:all`。

## 4. 前端设计

### 4.1 总线事件扩展（零破坏）

- `"stream:chunk": []` → `"stream:chunk": [chunk: string]`；TrainingEngine 改 `bus.emit("stream:chunk", chunk)`
- 现有唯一订阅者 ChatDisplay 用无参 handler，加参数向后兼容

### 4.2 `SentenceSegmenter`（engine/tts/segmenter.ts 新增，纯函数类）

- `push(chunk): string[]`：累积缓冲，按 `。！？!?；;` 与 `\n` 提取完整句；提取时经 `cleanTTSText` 清洗
- `flush(): string`：`stream:done` 时返回残余（清洗后）
- 守卫：清洗后 <2 字符的碎片并入下一句；缓冲超 100 字符无句读则在最后一个 `，、` 处强制切，再不行硬切；全程 `MAX_TTS_LENGTH=500` 总量封顶

### 4.3 `PcmStreamPlayer`（engine/tts/pcm-player.ts 新增）

- 懒建 `AudioContext`(24kHz)；`prime()` 在用户手势路径（TTS 开关点击、`chat:beforeSend`）resume，满足自动播放策略
- 每句：native `fetch`（`Authorization: Bearer ${useAuthStore.getState().token}`，401 直接抛错走降级，刷新交给 axios 主链路）→ `response.body.getReader()` → Uint8Array 按 2 字节对齐转 Int16 → Float32 → `AudioBuffer` → `source.start(max(ctx.currentTime + 0.05, prevEndTime))`，句间 prevEndTime 连续 → 无缝
- 迟到块（到达时已越过调度时刻）立即播放；`stop()` 中断 fetch + 停全部已调度 source + 重置时间轴

### 4.4 `TTSManager` 重构（autoplay 管线）

- attach 订阅：`stream:chunk`(文本) → segmenter.push → 入队；`stream:done` → flush 残余入队；`chat:beforeSend` → prime + stop；`emotion:changed`（现状保留）
- 单循环 `processQueue()`：取句 → fetch+流式调度（收完即取下一句，**不等播放完**）→ 流水线深度 1
- 单句失败 → 该句 browser fallback（保持顺序播放），后续句继续尝试流式；503(circuit open) → 本次回复整体降级 browser fallback，不再重试
- `speak(text)` 手动路径复用同一流式播放器（全文单批），统一音频路径
- 事件语义保持：`tts:start`（首句首块）、`tts:end`（队列 drain 且播放时间轴走完）、`tts:provider-status`（latencyMs = 首句首块延迟）、`tts:degraded`、`tts:error`；EmotionIndicator 的暂停逻辑不受影响
- `VolcTTSProvider` 增 `stream()` 方法；旧 `synthesize()` 若无引用则删除（旧后端端点保留给管理页/兼容）

### 4.5 异常矩阵

| 场景 | 行为 |
|------|------|
| 首句 503（熔断开） | 本次回复整体 browser fallback |
| 单句 fetch 失败/中断/401 | 该句 browser fallback，后续句继续流式 |
| AudioContext resume 失败 | 该句 browser fallback |
| 后端 timeout | 服务端记 error 日志、连接丢弃；前端流截断，已调度部分照播 |
| 训练结束/换页 | detach → stop() 全中断 |
| 429 限流 | 单句失败 → browser fallback |

## 5. 测试

- `backend/tests/core/test_tts_client.py` 重写：`VolcTTSConnection`（mock websockets，验证帧序列/usage 捕获/错误事件）+ `TTSConnectionPool`（fake factory：借还/ping 淘汰/异常丢弃/close）
- `backend/tests/` 新增 service 流式测试：mock pool/conn，断言成功/失败/超时三条路径的 VoiceCallLog 落库
- 前端无单测设施，靠 tsc + biome + 手工核对单验证
- 提交前：`pnpm run check`（ruff + ty + biome + tsc）+ `pnpm run api:update:all`

## 6. 不做的事（YAGNI）

- 情感范式重构（mapper 保留）
- TTSSubtitle 字级时间戳 / 字幕高亮
- 前端 WS 全双向通道
- 音频缓存
- DB schema 变更 / 迁移
