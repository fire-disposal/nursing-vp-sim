# 05 — LLM 设计与提示词工程

> 适用版本: v2026.06.04-5 | 最后更新: 2026-06-07

## LLM 配置

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 路由策略 | 多配置优先级降级 + 熔断 | `llm_router.py`，按 Config.purpose+priority 选择 |
| 默认 Provider | DeepSeek | 首次启动自动 seed |
| 模型 | deepseek-v4-flash / deepseek-v4-pro | Config 级别配置 |
| 温度 | 对话0.6 / QA 0.7 / 评分0.3 | 调用点硬编码 |
| 聊天 max_tokens | 512 | LLM_CHAT_MAX_TOKENS |
| 评分 max_tokens | 4096 | LLM_SCORING_MAX_TOKENS |
| 聊天超时 | 30s | LLM_CHAT_TIMEOUT |
| 评分超时 | 120s | LLM_SCORING_TIMEOUT |
| 并发限制 | 50 | LLM_CONCURRENT_LIMIT |
| 连接池 | 60 max / 30 keepalive | LLM_CONNECTION_POOL_SIZE / KEEPALIVE |
| 重试延迟 | `min(2^a,4)+rand(0,0.5)`s | `_backoff()` |
| JSON 模式 | `response_format: json_object` | 评分调用启用 |

## 路由与熔断 (ConfigRouter)

基于 DB `LLMConfig` 表的优先级路由：

```
select_key(purpose)
  1. 按 purpose 匹配，priority 升序
  2. 跳过 disabled / 冷却中的 degraded
  3. purpose 无匹配 → 回退通配符 "*"
  4. 全部不可用 → 最后防线：.env DEEPSEEK_API_KEY
  5. .env 也没有 → 全局降级 30s
```

**熔断规则（`report_result`）：**
- 成功 → 重置计数器，累计成本
- HTTP 429 → 立即冷却 60s
- 其他 5xx → 累计失败次数，≥5 次熔断 300s
- 月度成本超限 → 熔断至下月

**加密存储：** API Key 经 Fernet（SHA-256(SECRET_KEY) 派生）加密存入 `api_secrets.encrypted_key`。

## LLM 服务基础设施 (`llm_service.py`)

### `_backoff(attempt)`
统一退避函数，消除原 6 处重复代码。公式同前。

### `_CallContext`
日志上下文 dataclass，统一 `call_llm` / `call_llm_stream` 的日志收集和写入。消除原 `_log_llm_success` / `_log_llm_failure` 两个长签名函数。

### `_acquire_sema`
信号量超时包装（30s），排队过久返回报错而非无限挂起。

### 响应去重缓存（`llm_cache.py`）
30s TTL 精确匹配缓存，防止短时间内重复调用浪费 token。按 `sha256(messages+temperature+max_tokens+model)` 建键。

## 流式调用优化

- `call_llm_stream`：SSE 逐 token 推送
- 全部重试耗尽且无内容产出 → 自动回退非流式 `call_llm` 兜底
- 流中断但已有内容 → 返回 `{truncated: true}` 标记
- 共享 HTTP/2 客户端，多路复用

## 成本追踪 (`llm_logging.py`)

异步队列批量写入 `llm_call_logs` 表（每2秒或满20条刷新）。每配置独立追踪：日调用数、日 token、日成本、月成本。超限自动降解。

## Prompt 变量工程 (`VariableRegistry`)

集中管理所有 purpose 的合法变量定义。模板创建/更新时即时校验——未知变量产生警告（不阻断），仅 QA purpose 的变量硬阻断。

| Purpose | 变量数 | 示例 |
|---------|--------|------|
| patient_chat | 6 | `patient_info`, `hidden_info_rules`, ... |
| scoring | 5 | `scoring_criteria`, `required_inquiries`, `scoring_json_schema`, `conversation_text`, `scoring_rubric`(deprecated) |
| case_generation | 2 | `description`, `reference_material` |
| QA | 0 | 纯静态模板 |

变量元数据（desc/source/type/example）存于 `PromptTemplate.variables` JSONB。前端 VariableCard 支持点击编辑描述、来源、默认值。`render()` 在 kwargs 缺失时回退到模板的 `default_value`。

## 评分标准拆分

`{#scoring_rubric#}` 拆为三个独立变量：

| 变量 | 来源 | 内容 |
|------|------|------|
| `scoring_criteria` | `prompt_static.build_scoring_criteria()` | 19 项评分标准（维度+条目+锚点） |
| `required_inquiries` | `case_data.required_inquiries` | 必须采集清单（JSON） |
| `scoring_json_schema` | `prompt_static.build_scoring_json_schema()` | LLM 输出 JSON 格式模板 |

教师可在 Prompt 编辑器中独立调整各部分的措辞和位置。向后兼容：`scoring_rubric` 变量保留（deprecated），旧模板仍可使用。

## 安全护栏 (`patient_guard.py`)

- 角色泄露检测：26 条 forbidden pattern（"作为AI"、"我是语言模型"等）
- 诊断化检测：7 条（"诊断为"、"你患有"等）
- 称谓归一化：自动将"医生/大夫/医师"替换为"护士/同学"
- 严重越界时替换为随机兜底回复
