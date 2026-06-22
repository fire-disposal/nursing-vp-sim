# 05 — LLM 设计与提示词工程

> 适用版本: 当前 | 最后更新: 2026-06-22

## 架构总览

```
LLMClient (infrastructure/llm/client.py)
  ┌─ ProfileRouter (router.py) — 按 purpose 选配置 → ApiSecret
  ├─ circuit.py — async_retry + backoff_delay 指数退避
  ├─ logging.py — LogWorker 异步队列批量写 DB
  ├─ parsing.py — _safe_parse_json 容错解析
  ├─ crypto_utils.py — Fernet 加密 API Key
  └─ provider_catalog.py — Provider 产品目录 (providers.json)
```

## LLM 配置

按 purpose 管理超时/token/温度，集中在 `core/llm_profile.py` 的 `PROFILES`：

| purpose | timeout | max_tokens | temperature | max_retries |
|---------|---------|------------|-------------|-------------|
| patient_chat | 30s | 512 | 0.3 | 2 |
| qa | 30s | 1024 | 0.7 | 2 |
| scoring | 120s | 4096 | 0 | 3 |
| scoring_feedback | 60s | 2048 | 0.3 | 2 |
| case_generation | 120s | 4096 | 0.3 | 3 |

支持 `LLM_CONFIG_JSON` 环境变量覆盖任意 purpose 参数。全局回退：

| 参数 | 默认值 |
|------|--------|
| LLM_CONCURRENT_LIMIT | 50 |
| LLM_CONNECTION_POOL_SIZE | 60 |
| LLM_CONNECTION_KEEPALIVE | 30 |
| LLM_MAX_RETRIES | 3（此为全局上限，具体 per-purpose 见上表） |
| LLM_REQUEST_TIMEOUT | 90s（此为中转超时，按 purpose 有更精确的调用超时） |

成本估算全局回退：input ¥1/1M tokens, output ¥2/1M tokens，DB 中 per-key 定价优先。

## LLMClient (client.py)

单一入口点，三个公开方法：

| 方法 | 用途 | 默认参数 |
|------|------|---------|
| `call()` | 普通补全 | temperature=0.7, max_tokens=512, timeout=30, max_retries=2 |
| `stream()` | 流式 SSE | 同上，重试耗尽回退非流式 call() 兜底 |
| `call_json()` | 补全 + JSON 解析 | temperature=0.3, max_tokens=2048, timeout=120, max_retries=3 |

内部结构：
- `_select_config()` → 通过 ProfileRouter 按 purpose 选配置，解密 API Key
- `_do_call()` / `_do_stream()` → 发送 HTTP 请求
- `async_retry()` 包装重试逻辑
- `asyncio.Semaphore(50)` 并发限流
- 调用日志通过 LogWorker 异步入队

## 路由与熔断 (ProfileRouter in router.py)

基于 DB `ApiSecret` + `LLMConfig` 表的按 purpose 路由：

```
select(purpose)
  1. 按 purpose 查找 binding（LLMConfig）
  2. binding 匹配 → 查找对应 ApiSecret
  3. 跳过 status=degraded 且冷却期未过的
  4. 无匹配 → 最后防线：.env DEEPSEEK_API_KEY（_SyntheticConfig）
  5. 全部不可用 → 全局降级 30s
```

**熔断规则（`report_result`）：**
- 成功 → 重置 consecutive_failures，累计成本
- HTTP 429 → degraded 60s（rate_limited）
- 其他 5xx → cumulative, ≥5 次 degraded 300s（consecutive_failures）
- 月度成本超限 → degraded 至下月
- 状态变化（degraded/每5次调用）自动写回 DB

启动时 `load_from_db()`：从 DB 加载所有配置 + 恢复已过冷却期的 profile。

**加密存储：** API Key 经 Fernet（独立 `FERNET_KEY`）加密存入 `api_secrets.encrypted_key`。

## 重试与退避 (circuit.py)

```python
backoff_delay(attempt)  # attempt 0-indexed
  → min(2^(attempt+1), 16) + rand(0, 0.5)
```

异步重试 `async_retry()` 包装：
- 可重试的 HTTP 状态码：429, 500, 502, 503, 504
- 可重试的异常：TimeoutException, ConnectError, RemoteProtocolError, ReadError
- 非可重试（400/401/403/404 等）：直接抛出
- 全部 429 → LLMRateLimited；其余失败 → NoProviderAvailable

## 调用日志 (LogWorker in logging.py)

异步队列批量写入 `llm_call_logs` 表：
- `enqueue()` 将日志条目放入 `asyncio.Queue(maxsize=2000)`
- 后台协程每 2 秒或满 20 条 flush 一次
- 队列满时溢出到磁盘 JSONL 文件（`LLM_LOG_OVERFLOW_DIR`）
- 溢出文件自动回卷：最大 10MB/文件，保留 5 个
- 单条目写入失败不回滚整批（`savepoint` 隔离）

## JSON 解析容错 (parsing.py)

`_safe_parse_json()` 按顺序尝试：
1. 标准 `json.loads()`
2. 移除尾部逗号后重试
3. 截断修复（补全缺失的 `]` 和 `}`）
4. 正则降级提取（逐字段 match total_score、strengths、suggestions 等）
5. 以上均失败 → ValueError

## Prompt 管理 (infrastructure/prompt/)

### PromptManager
- 从 DB `prompt_templates` 表加载模板，按 `purpose` 缓存
- 热切换：`reload()` 重新加载，加载失败保留上次有效缓存
- 内置硬编码兜底：DB 不可用时回退 `prompts/` 目录的静态模板
- 启动时自动 seed 内置模板到 DB（幂等）

### VariableRegistry
集中管理每个 purpose 的合法变量定义：

| purpose | 变量数 | 关键变量 |
|---------|--------|----------|
| patient_chat | 9 | patient_info, scenario, personality, chief_complaint, present_illness, allergy_history, deep_background, example_dialogues, author_note |
| patient_dynamic | 4 | chief_complaint, present_illness, allergy_history, deep_background |
| scoring | 4 | scoring_criteria, required_inquiries, scoring_json_schema, conversation_text |
| scoring_feedback | 4 | scoring_criteria, required_inquiries, scoring_result, conversation_text |
| case_generation | 3 | description, reference_material, field_instruction |
| qa | 2 | user_name, user_role |

模板使用 `{#variable_name#}` 语法渲染。缺失变量运行时抛错。

### 评分标准拆分
评分 Prompt 拆为三个独立变量，教师可在管理面板独立调整：
- `scoring_criteria` — 19 项评分标准（维度+条目+锚点），由 `rubrics/nursing_history_v1.json` + `build_scoring_criteria()` 自动生成
- `required_inquiries` — 必须采集清单（来自病例数据）
- `scoring_json_schema` — LLM 输出 JSON 格式模板

## 患者安全护栏 (contexts/patient/guards.py)

### PostGuard 策略模式
- **PatternGuard**（默认）：26 条身份泄露 forbidden pattern（"我是AI"、"评分标准"、"训练模式"等）
- **NoGuard**：直通模式（开发/调试用）

检测到泄露后返回修正提示，注入到下一轮系统消息前缀。

### 身份泄露模式（部分示例）
```
我是AI, 我是人工智能, 我是AI助手, 我是虚拟患者,
作为AI, 评分标准, 教学反馈, 你应该继续问,
你还需要问, 训练模式, ...
```

## Provider 产品目录 (provider_catalog.py)

`providers.json` 集中管理多 Provider 的模型和定价数据，支持自动匹配 `base_url` 获取模型列表和定价信息。

## 关键文件定位

| 文件 | 用途 |
|------|------|
| `infrastructure/llm/client.py` | LLMClient 统一入口 |
| `infrastructure/llm/router.py` | ProfileRouter 配置路由 |
| `infrastructure/llm/circuit.py` | 重试+退避 |
| `infrastructure/llm/logging.py` | LogWorker 异步日志 |
| `infrastructure/llm/parsing.py` | JSON 容错解析 |
| `infrastructure/llm/crypto_utils.py` | Fernet 加密 |
| `infrastructure/llm/provider_catalog.py` | Provider 目录 |
| `infrastructure/prompt/manager.py` | Prompt 模板管理 |
| `infrastructure/prompt/registry.py` | VariableRegistry 变量注册 |
| `infrastructure/prompt/static.py` | 评分标准文本生成 |
| `contexts/patient/guards.py` | PostGuard 患者身份保护 |
| `core/llm_profile.py` | LLM 配置常量 (LLMProfile dataclass) |
