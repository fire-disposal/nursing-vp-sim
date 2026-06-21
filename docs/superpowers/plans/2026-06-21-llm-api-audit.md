# DeepSeek API 功能全面审计报告

> 基于官方文档二次核查，验证当前方案的合规性，分析所有可用功能在系统中的适用性。

**审计日期**: 2026-06-21  
**文档来源**: DeepSeek API Docs (zh-cn)  
**涉及系统**: Nursing VP Sim — patient_chat, scoring, scoring_feedback

---

## 1. KV Cache（上下文硬盘缓存）再核查

### 1.1 官方规则精读

> "缓存命中的前提是相应前缀已被'落盘'（写入硬盘缓存）。每条缓存前缀是一个独立的完整单元。后续请求只有在**完整匹配缓存前缀单元**时，才能命中缓存。"

| 落盘时机 | 说明 |
|----------|------|
| 请求结束位置落盘 | 用户输入结束位置 + 模型输出结束位置产生两个缓存前缀单元 |
| 公共前缀检测落盘 | 多次请求存在公共前缀时，系统识别并落盘 |
| 按固定 token 间隔落盘 | 长输入/输出中以固定间隔截取缓存单元 |

### 1.2 当前消息结构分析

**patient_chat 消息构建流程** (`contexts/patient/prompt.py:build_patient_chat_messages`)：

```
Round 1: [system, system, author_note_1, user_1]                    ← 发送到 API
Round 2: [system, system, user_1(D), assistant_1(D), author_note_2, user_2]  ← 发送到 API
```

其中 `(D)` 表示从 DB 加载的消息，内容为原始文本（不含 author_note）。

**缓存判定**：
- Round 1 落盘：`[system, system, author_note_1, user_1]`（输入结束位置），`[system, system, author_note_1, user_1, assistant_1]`（输出结束位置）
- Round 2 前缀: `[system, system, user_1, …]`，位置3是 `user_1`，Round 1 缓存位置3是 `author_note_1` → **不匹配，MISS**
- 公共前缀检测：识别 `[system, system]` 为公共前缀 → 第三轮起可能命中 `[system, system]`
- **实际效果**：只有 ~2000 tokens 的 system prompt 可被缓存，历史消息部分完全无法命中

### 1.3 修改后的消息结构

```
Round 1: [system, system, user_1, system:author_note_1]             ← author_note 移到末尾
Round 2: [system, system, user_1(D), assistant_1(D), user_2, system:author_note_2]
Round 3: [system, system, user_1(D), assistant_1(D), user_2(D), assistant_2(D), user_3, system:author_note_3]
```

**缓存判定（修改后）**：
- Round 1 落盘（用户输入结束）：`[system, system, user_1]`
- Round 2: `[system, system, user_1(D), …]` — 完整匹配 `[system, system, user_1]` → **命中 system prompt + 第一轮用户消息**
- Round 2 落盘（用户输入结束）：`[system, system, user_1, assistant_1, user_2]`
- Round 3: `[system, system, user_1, assistant_1, user_2, …]` → **命中全部历史**
- Round N: 缓存命中量 = system prompt + 前 N-1 轮全部对话

**结论：方案正确，收益为 cascading（逐轮增长），从第3轮起历史消息几乎全部命中。**

### 1.4 author_note 移至末尾的语义影响

当前 author_note 在 user 之前（system 消息），影响 patient 对用户输入的"解读"。移至末尾后，author_note 成为"响应指令"，影响 patient 的"输出"。对于情感和体检结果的注入（"患者此时感到焦虑，疼痛评分7分"），放在末尾功能等价甚至更合理——模型在生成回复时接收到最新状态。

### 1.5 额外发现：`user` 参数与 KVCache 隔离

API Reference 指出：

> `user_id` 可用于 KVCache 缓存隔离，以进行隐私管理。

当前系统**未**在 API payload 中传递 `user` 参数。这意味着不同训练记录之间的 KV Cache 可能互相污染（若前缀恰巧相同）。应添加 `user` 参数用于训练记录/会话级隔离。

---

## 2. JSON Mode 适配性

### 2.1 当前状态

| 条件 | 状态 |
|------|------|
| `response_format: {"type": "json_object"}` | ✅ scoring + scoring_feedback 均已设置 |
| prompt 含 "json" 字样 | ✅ 所有 scoring prompt 均含 "json"/"JSON" |
| `max_tokens` 合理设置 | ✅ scoring: 4096, scoring_feedback: 2048 |

### 2.2 已知问题

> "使用 JSON Output 功能时，API 有概率会返回空的 content。"

当前 scoring 已有两层防护：
1. 校验层 (`_validate_scoring_essentials`) 捕获空/不完整输出
2. 重试层 (`_score_stage`, `_feedback_stage`) 重新调用

**结论：已充分利用 JSON Mode，无需改动。**

---

## 3. Chat Prefix Completion（Beta）适用性

### 3.1 功能描述

强制模型以 assistant 消息中指定的前缀开始输出，需设置 `base_url="https://api.deepseek.com/beta"`。

### 3.2 对当前系统的适用性

| 场景 | 需要？ | 理由 |
|------|--------|------|
| patient_chat | **否** | 患者回复需自由文本，无法预知前缀 |
| scoring | **否** | 已用 JSON Mode 约束输出格式，prefilling 可能破坏 JSON 结构 |
| scoring_feedback | **否** | 同上 |
| case_generation | **否** | 病例生成需完整结构化输出 |
| QA | **否** | 自由对话场景 |

**结论：不适用于当前系统。**

---

## 4. Tool Calls 适用性

### 4.1 功能描述

模型可调用外部函数，如 `get_weather({location: "Beijing"})`，系统执行后返回结果给模型。

### 4.2 对当前系统的适用性

| 场景 | 价值 | 复杂度 |
|------|------|--------|
| patient_chat — 体检数据查询 | 患者可"知道"自己的生命体征数据，避免前端插件写死 | 高：需定义 tools schema，实现 tool 执行循环，管理 tool call 状态 |
| scoring — 评分标准动态查询 | 需时可根据 rubric 动态查询维度 | 低：当前 rubric 已全部注入 prompt |

**结论：当前不适用。** 前端的 physical-exam 等插件已实现工具功能。若未来要改为 LLM 驱动的自主体检触发，Tool Calls 是正确方向，但需重构整个插件体系，超出本次优化范围。

---

## 5. Create Chat Completion API 参数审查

### 5.1 当前发送参数 vs 官方支持参数

| 参数 | 官方 | 当前 | 影响 |
|------|------|------|------|
| `model` | ✅ | ✅ | — |
| `messages` | ✅ | ✅ | — |
| `temperature` | ✅ | ✅ | — |
| `max_tokens` | ✅ | ✅ | — |
| `stream` | ✅ | ✅ | — |
| `response_format` | ✅ | ✅ (scoring only) | — |
| `top_p` | ✅ | ❌ | 未暴露，可选择性补充 |
| `stop` | ✅ | ❌ | chat 可受益于提前终止 |
| `user` | ✅ | ❌ | **缺失：影响 KVCache 隔离 + 滥用监控** |
| `stream_options.include_usage` | ✅ | ❌ | **缺失：导致 streaming 调用永远无法获取 API 返回的 usage 数据** |
| `frequency_penalty` | 已废弃 | N/A | — |
| `presence_penalty` | 已废弃 | N/A | — |
| `logprobs` | 不支持 | ✅ (正确忽略) | — |

### 5.2 关键缺陷

#### 缺陷 A：`stream_options.include_usage` 缺失（P0）

**位置**: `client.py:_do_stream` line 502

```python
payload = {
    "model": state.model,
    "messages": messages,
    "temperature": temperature,
    "max_tokens": max_tokens,
    "stream": True,
    # 缺失: "stream_options": {"include_usage": True}
}
```

**后果**: Line 520-522 的 usage 提取逻辑永远不会触发：
```python
if last_obj and "usage" in last_obj:
    state.usage = last_obj["usage"]
```

导致 streaming 调用每次都 fallback 到本地 token 估算 (`estimate_tokens()`)，而不是使用 API 返回的真实 usage。

**修复**: 在 streaming payload 中添加 `"stream_options": {"include_usage": True}`。

#### 缺陷 B：`user` 参数缺失

**位置**: `client.py:_do_call` line 420 和 `_do_stream` line 483

**后果**:
1. DeepSeek 无法按用户隔离 KV Cache，不同训练会话之间可能互相污染
2. 缺少滥用检测的终端用户标识

**修复**: 从 `CallContext` 获取 `record_id` 作为 `user` 参数值：
```python
payload["user"] = f"record_{ctx.record_id}" if ctx and ctx.record_id else None
```

### 5.3 选择性补充：`top_p` 和 `stop`

| 参数 | 建议 | 理由 |
|------|------|------|
| `top_p` | 不补充 | temperature 已足够控制随机性，两者同时使用反而会过度约束 |
| `stop` | 可考虑 | patient_chat 可设置 `["\n学生：", "\n护士："]` 防止患者角色越界，但对延迟无帮助 |

---

## 6. 参数传递架构缺陷

### 6.1 问题

`client.py` 的方法签名是硬编码的：

```python
async def call(self, messages, *, purpose, temperature, max_tokens, timeout, max_retries, response_format, ctx)
```

`config.py` 中的 `_LLM_PURPOSE_DEFAULTS` 只能传递 `timeout`, `max_tokens`, `temperature`, `max_retries`, `response_format`。添加任何新 API 参数都需要：
1. 修改 `config.py` 的 dict
2. 修改 `client.py` 的 `call()` / `stream()` / `call_json()` 方法签名
3. 修改 `_do_call()` / `_do_stream()` 的 payload 构造

### 6.2 建议

不要过度设计。当前缺少的只有 `stream_options` 和 `user`，直接在 payload 构造处硬编码即可：
- `stream_options` 仅 streaming 需要，在 `_do_stream` 固定添加
- `user` 从 `CallContext` 直接读取，在 `_do_call` 和 `_do_stream` 中条件添加

---

## 总结：对计划的修正建议

| 原计划 | 状态 | 修正 |
|--------|------|------|
| Task 1: Keepalive | ✅ 不变 | — |
| Task 2: temperature | ✅ 不变 | — |
| Task 3: author_note 重构 | ✅ 方案正确 | — |
| Task 4: Cache 监控 | ✅ 不变 | 追加：同时记录 cache_hit/miss 到 ops dashboard |
| Task 5: Scoring DB 并行 | ✅ 不变 | — |
| **新增 Task 6** | — | **添加 `user` 参数到 API payload（KVCache 隔离）** |
| **新增 Task 7** | — | **添加 `stream_options.include_usage` 到 streaming payload** |
| JSON Mode | ✅ 已验证 | 无需变更 |
| Chat Prefix Completion | ❌ 不适用 | — |
| Tool Calls | ❌ 当前不适用 | 留待未来物理检查自动化时考虑 |
