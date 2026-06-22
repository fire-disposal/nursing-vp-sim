# 火山引擎语音服务迁移到 v3（豆包大模型）设计

**日期**: 2026-06-22
**状态**: 设计稿（待负责人补齐 speaker ID / ASR 资源后转实现计划）
**范围**: TTS + ASR 全量重构，凭证统一为新版控制台 `X-Api-Key`，保持 TTS / ASR 模块相对隔离

---

## 1. 背景与根因

线上 TTS 健康检查返回 `401 Unauthorized`（`https://openspeech.bytedance.com/api/v1/tts`），密钥可正常解密但鉴权失败。

排查确认：控制台开通的是 **TTS-SeedTTS2.0（豆包语音合成大模型 2.0）**，走 **v3 协议**，而现有代码实现的是 **旧版 v1 REST 协议**。三处协议级错配：

| 维度 | 现有代码 (v1) | SeedTTS 2.0 需要 (v3) |
|---|---|---|
| 鉴权 | body `app.token` + `Authorization: Bearer;token` | HTTP 头 `X-Api-Key`（新版控制台单一 Key） |
| endpoint | `/api/v1/tts` | `/api/v3/tts/unidirectional`（HTTP）|
| resource-id | 无 | `X-Api-Resource-Id: seed-tts-2.0` |
| 音色 | 短名 `zh_female_vv`（非法 v3 ID） | 完整 ID 如 `zh_female_vv_uranus_bigtts` |
| speech_rate | 浮点比例 `1.0` | 整数 `[-50,100]`（100=2.0x） |
| emotion | body `emotion` 字段 | v3 无该字段 |

ASR 同样停留在 v1（`/api/v1/asr`，`Bearer;token`），与 TTS 共用同一份 `app_id + token`，存在相同问题。

## 2. 目标与非目标

**目标**
- TTS 迁移到 v3 HTTP 单向流式，恢复合成能力，修复 401。
- 凭证模型统一为新版控制台单一 `X-Api-Key`（加密落库）。
- ASR 迁移到 v3 WebSocket 流式（前端实时推流 + 后端代理鉴权）。
- 管理后台表单/字段同步重构。
- TTS / ASR 模块边界清晰、相对隔离。

**非目标**
- 不引入声音复刻（ICL）。
- 不做 TTS 高表现力 `seed-tts-2.0-expressive` + `context_texts`（留作后续可选项，本期 `model=standard`）。
- 不保留旧 v1 兼容代码（直接替换）。

**优先级**
- TTS：高，主链路。
- ASR：低，大概率仅试用版，**必须实现无服务优雅回退**（无凭证/无资源/上游失败时前端降级，不阻断训练流程）。

## 3. 架构与隔离原则

```
                 VoiceConfig (单一 api_key + 各服务参数)
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                     ▼
infrastructure/tts/   (HTTP v3)        infrastructure/asr/   (WebSocket v3)
  client.py  合成→bytes                  client.py   上游 WS 客户端
  mapper.py  emotion/speaker             protocol.py 二进制帧编解码 (header+gzip+seq)
  circuit.py 熔断（保留）                 fallback.py 无服务降级判定
        │                                     │
        └──────────────┬──────────────────────┘
                       ▼
        infrastructure/volc/auth.py  （唯一共享：构造 X-Api-* 头）
```

- 共享面**仅**一个薄工具 `volc/auth.py`，输出统一的 `X-Api-Key` 等头。TTS / ASR 协议逻辑零相互依赖。
- TTS 走 HTTP、ASR 走 WS，传输层天然解耦。

## 4. 数据模型：`VoiceConfig` 重构

**删除字段**（旧 appid+token 方案）
- `app_id`
- `token_enc`
- `key_suffix`

**新增字段**
| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `api_key_enc` | Text | — | 新版控制台 API Key，Fernet 加密 |
| `api_key_suffix` | String(8) | "" | 完整性校验（与解密值后缀比对） |
| `tts_resource_id` | String(64) | `seed-tts-2.0` | 可配置 |
| `tts_speaker` | String(64) | （待负责人确认，临时 `zh_female_vv_uranus_bigtts`） | 真实 v3 speaker ID，原 `tts_voice_type` 改名 |
| `tts_model` | String(40) | `seed-tts-2.0-standard` | standard / expressive |
| `tts_sample_rate` | Integer | 24000 | TTS 输出采样率 |
| `tts_format` | String(16) | `mp3` | mp3 / pcm / ogg_opus / wav |
| `tts_timeout` | Integer | 8 | 保留 |
| `asr_resource_id` | String(64) | `volc.bigasr.sauc.duration` | 可配置（1.0/2.0、duration/concurrent） |
| `asr_sample_rate` | Integer | 16000 | 保留 |
| `asr_endpoint_mode` | String(24) | `bigmodel_nostream` | `bigmodel` / `bigmodel_nostream` / `bigmodel_async` |

**保留**：`provider`、`monthly_budget`、`is_active`、`created_at`、`updated_at`。
**移除**：`asr_enable_streaming`（v3 流式与否由 endpoint_mode 决定）。

## 5. TTS 客户端（HTTP v3 unidirectional）

**`infrastructure/tts/client.py` 重写**

- endpoint：`https://openspeech.bytedance.com/api/v3/tts/unidirectional`
- 请求头：
  ```
  X-Api-Key: <api_key>
  X-Api-Resource-Id: <tts_resource_id>          # 默认 seed-tts-2.0
  Content-Type: application/json
  X-Control-Require-Usage-Tokens-Return: *       # 返回计费字数
  ```
- 请求体：
  ```json
  {
    "req_params": {
      "text": "...",
      "speaker": "<tts_speaker>",
      "additions": "<JSON string>",
      "audio_params": {
        "format": "mp3",
        "sample_rate": 24000,
        "speech_rate": 0,
        "loudness_rate": 0
      }
    }
  }
  ```
- 响应：换行分隔 JSON 流。逐行解析：
  - `code == 0` 且有 `data` → base64 解码累加音频块
  - `code == 20000000` → 结束
  - `code > 0` → 报错，**记录整行 body** 到日志（修复旧版吞响应体的盲区）
- 对外接口保持 `synthesize(req) -> bytes`，`routers/tts.py` 仅需适配 `TTSRequest` 字段，路由主体不变。
- `health_check()`：用配置的 `tts_speaker` 合成「测试」短文本，成功即在线。

**`TTSRequest` dataclass 调整**：`voice_type` → `speaker`；`emotion` 移除；新增 `speech_rate: int`、`loudness_rate: int`、`model`。

## 6. TTS emotion 映射（`infrastructure/tts/mapper.py`）

v3 无 `emotion` 字段，采用 **speech_rate + loudness_rate 整数映射**，`model=standard`（低时延）。

| 情绪状态 | speech_rate | loudness_rate | 含义 |
|---|---|---|---|
| `withdrawn` | -15 | -10 | 慢、轻 |
| `defensive` | +15 | +10 | 快、强 |
| `anxious` | +10 | 0 | 略快 |
| `neutral` | 0 | 0 | 常态 |
| `relaxed` | -5 | 0 | 略慢 |
| `open` | 0 | +5 | 略亮 |

> 具体数值在实现期可微调；范围 `[-50,100]`。

**speaker 解析 `resolve_voice_type`**：输入短名/人口学特征 → 输出真实 v3 speaker ID。映射表的 7 个真实 ID **待负责人确认**（见 §11）。在确认前用占位默认 `zh_female_vv_uranus_bigtts`，并保留 fallback 逻辑（非法 ID → 默认）。

## 7. ASR（前端实时流式 + 后端 WS 代理）

### 7.1 后端代理端点
新增 WS 端点 `GET /api/asr/stream`（FastAPI WebSocket）：
- JWT 鉴权：连接 query 参数 `?token=<jwt>` 或 subprotocol 携带（密钥不入浏览器）。
- 流程：浏览器连入 → 后端用 `volc/auth.py` 头开上游 WS（`wss://openspeech.bytedance.com/api/v3/sauc/<asr_endpoint_mode>`）→ 双向中转。

上游 WS 请求头：
```
X-Api-Key: <api_key>
X-Api-Resource-Id: <asr_resource_id>
X-Api-Request-Id: <uuid>
X-Api-Connect-Id: <uuid>
X-Api-Sequence: -1
```

### 7.2 二进制协议 `infrastructure/asr/protocol.py`
封装火山二进制帧（大端）：
- 4 字节 header：protocol version(0b0001)、header size(0b0001)、message type、flags、serialization(JSON=0b0001)、compression(Gzip=0b0001)、reserved。
- 消息类型：full client request(0b0001)、audio-only(0b0010)、full server response(0b1001)、error(0b1111)。
- payload Gzip 压缩 + 4 字节大端长度；server response 带 sequence；末包用 flags `0b0010`。
- full client request payload：`{user, audio{format,rate,bits,channel,language}, request{model_name:"bigmodel", enable_itn, enable_punc, ...}}`。
- 解析 server response：`result.text` / `utterances[].definite`；错误帧解析 error code + message。

### 7.3 浏览器 ↔ 后端消息协议（应用层，与火山二进制解耦）
- 浏览器 → 后端：二进制音频帧（PCM 16k 单声道，~200ms/包）；控制消息用文本 JSON（`{type:"start"|"stop"|"cancel"}`）。
- 后端 → 浏览器：文本 JSON `{type:"partial"|"final"|"error"|"unavailable", text, confidence}`。

### 7.4 前端 `useVoice.ts` 重写
- 用 **AudioWorklet** 采集，重采样到 **16k 单声道 PCM**；无 AudioWorklet 时降级 `ScriptProcessorNode`。
- **移动端兼容**：用户手势内 `AudioContext.resume()` 解锁（iOS Safari）；处理 48k→16k 重采样；`getUserMedia` 失败/拒绝时优雅提示。
- 打开 `/api/asr/stream` WS，推流 → 渲染 `partialText` → 收到 `final` 或 `unavailable` 收尾。

### 7.5 无服务优雅回退（重点）
ASR 优先级低、大概率仅试用版，必须降级不阻断：
- **无凭证 / 无 `asr_resource_id` / 上游 WS 建连失败 / 超时**：后端立即回 `{type:"unavailable"}`，前端隐藏语音输入、提示「语音识别不可用，请手动输入」，回落到文本输入框。
- 前端启动前先探测 ASR 可用性（轻量 `GET /api/asr/status` 返回 `{available: bool}`），不可用则根本不渲染麦克风按钮。
- 训练流程在 ASR 缺失下完全可用（文本输入）。

旧端点 `POST /api/asr/recognize`（v1 一次性）**移除**。

## 8. 管理后台 UI / 表单（`VoiceTokenCard.tsx` 等）

- 凭证区：`App ID` + `API Token` 两字段 → **单一 `API Key`** 字段；打码显示 `api_key_masked`。
- TTS 区：`tts_speaker`（下拉，真实 v3 ID）、`tts_resource_id`（可配置，默认 seed-tts-2.0）、`tts_model`、`tts_sample_rate`、`tts_format`。
- ASR 区：`asr_resource_id`（可配置）、`asr_endpoint_mode`、`asr_sample_rate`。
- `ImportModal` + 导入/导出 schema 同步（`api_key` 取代 `app_id/token`；导出仍不含密钥）。
- 测试按钮：TTS 测试保留；ASR 测试改为探测上游可建连。

## 9. Schema / 路由 / 生成类型

- `schemas/voice.py`：`VoiceConfigUpdateRequest` / `Response` / `Import` / `Export` 全部把 `app_id`+`token` 换成 `api_key`，新增 tts_*/asr_* 字段。
- `routers/admin_voice.py`：`_mask_token` → `_mask_api_key`；`_do_test_tts` 用新 client；新增/调整 ASR 测试与 `GET /api/asr/status`。
- `routers/tts.py`：适配新 `TTSRequest` 字段。
- `routers/asr.py`：移除 v1 `recognize`，新增 WS `/api/asr/stream` + `/api/asr/status`。
- `main.py`：TTS/ASR client 初始化改用 `api_key`；ASR 初始化失败不致命（降级）。
- 重新生成：`pnpm run api:update:all`（禁止手改 `.gen.ts`）。

## 10. DB 迁移

- DDL autogenerate 迁移：drop `app_id`/`token_enc`/`key_suffix`/`asr_enable_streaming`，add `api_key_enc`/`api_key_suffix`/`tts_resource_id`/`tts_speaker`(rename)/`tts_model`/`tts_sample_rate`/`tts_format`/`asr_resource_id`/`asr_endpoint_mode`。
- 遵循 AGENTS 迁移规则：DDL 不含 `op.execute()`；幂等用 `insp.get_columns()` 守卫。
- 现有 `VoiceConfig` 行：旧 token 与新方案不通用，**不做数据迁移**，部署后管理员在后台重新录入 API Key。

## 11. 外部待确认数据（不阻塞设计，阻塞实现收尾）

| 项 | 当前状态 | 来源 |
|---|---|---|
| TTS 7 个真实 speaker ID（vv / 男声qingse / 女声甜美 / 男老师 / 女童 / 男老人 / 女老人） | 待负责人确认；临时默认 `zh_female_vv_uranus_bigtts` | 控制台 > 音色库 |
| ASR `asr_resource_id` 精确值（1.0 vs 2.0、duration vs concurrent） | 大概率试用版；默认 `volc.bigasr.sauc.duration`，字段可配 | 控制台 > 服务详情 |
| API Key 实际值 | 已确认持有新版单一 API Key | 控制台 > API Key 管理 |

## 12. 错误处理 / 成本 / 测试

- **错误处理**：所有上游错误记录响应体/错误帧（修复盲区）；TTS 熔断 `circuit.py` 保留；ASR 失败降级。
- **成本**：`VoiceCallLog` 不变；TTS 用量取 `X-Control-Require-Usage-Tokens-Return` 返回的计费字数，ASR 按时长估算（缺省维持现有 `_estimate_cost`）。
- **测试**：
  - TTS：mock httpx，覆盖 NDJSON 累加、错误码、health_check。
  - ASR protocol：纯单测帧编解码（header/gzip/seq/末包/error 帧）。
  - ASR client：mock WS server。
  - 前端：`useVoice` 重采样与降级路径手测 + 移动端真机。

## 13. 文件改动清单

**后端**
- `infrastructure/volc/auth.py`（新）
- `infrastructure/tts/client.py`（重写）、`mapper.py`（改）、`circuit.py`（保留）
- `infrastructure/asr/client.py`（重写）、`protocol.py`（新）、`fallback.py`（新）
- `routers/tts.py`（改）、`routers/asr.py`（重写）、`routers/admin_voice.py`（改）
- `schemas/voice.py`（改）、`models.py`（改 VoiceConfig）、`main.py`（改）
- `migrations/versions/ddl/xxxx_voice_config_v3.py`（新，autogenerate）

**前端**
- `pages/admin/cost/VoiceTokenCard.tsx`（改）、`VoiceTTSTab.tsx`/`VoiceASRTab.tsx`（改）
- `api/admin/voice-cost.ts`（改）、`hooks/useVoice.ts`（重写）
- `api/api-types.gen.ts`（重新生成）

## 14. 验收

- 后台录入 API Key → TTS 测试通过、能播放患者语音。
- emotion 状态切换体现在语速/音量。
- ASR：开通时可流式识别；未开通/失败时前端自动隐藏麦克风、文本输入可用，训练不受阻。
- `pnpm run check` + 相关 pytest 全绿；`pnpm run check:api` 无 diff。
