# 诊断接口与错误档案

`GET /api/diagnose` 是面向运维脚本和 Agent 的只读诊断入口。它继续使用 `DIAGNOSE_TOKEN`，并通过两个参数控制错误上下文：

```text
/api/diagnose?token=...&error_window_minutes=60&error_groups=20
```

- `error_window_minutes`：错误查询窗口，1–1440 分钟，默认 60。
- `error_groups`：最多返回的后端错误组，1–50，默认 20。

## 错误留存

后端 `ERROR` 及以上日志同时进入内存缓冲和轮转 JSONL 档案。默认路径：

```text
/app/data/diagnostics/backend-errors.jsonl
```

默认单文件 5 MB、保留 3 个备份，总量约 20 MB。`/app/data/diagnostics` 已挂 `ai_vp_diagnostics`
命名卷（`deploy/docker-compose.prod.yml`），档案跨容器重建存活；换机器/换卷时才需要重新考量这一层。

可选环境变量：

```text
DIAGNOSTIC_ERROR_ARCHIVE=/app/data/diagnostics/backend-errors.jsonl
DIAGNOSTIC_ERROR_ARCHIVE_MAX_MB=5
DIAGNOSTIC_ERROR_ARCHIVE_BACKUPS=3
```

同一 logger 与消息在五分钟内视为同一错误组。首次出现立即写盘；持续重复时最多每 30 秒补记一次增量，避免错误风暴造成文件膨胀。

## 前端遥测档案

前端错误（ErrorBoundary / `window.error` / unhandledrejection）由 `POST /api/telemetry` 上报，
同样进内存缓冲 + 轮转 JSONL 档案：

```text
FRONTEND_ERROR_ARCHIVE=/app/data/diagnostics/frontend-errors.jsonl
FRONTEND_ERROR_ARCHIVE_MAX_MB=2
FRONTEND_ERROR_ARCHIVE_BACKUPS=2
```

**为什么需要归档**：后端以 `uvicorn --workers 2` 运行，每个 worker 有独立进程内缓冲。
2026-09-24 机房崩溃取证时，同一 `/api/diagnose` 连续调用返回两套互斥计数（`last_hour=25`
与 `44`，后端错误计数一组为 0），单进程口径无法作为取证依据。现在每个 worker 把去重增量
写入共享档案，快照合并「本进程未落盘增量 + 档案」，计数与分组均为跨 worker 口径。

同一签名（source + type + message 前 120 字符）在 5 分钟内视为一组：首次出现立即写盘，
持续重复最多每 30 秒补记一次增量。

## 返回结构

响应为 `schema_version: 3`。顶层键共 15 个（`summary` 的 `alerts` 与顶层 `alerts` 同源同值）：

```text
schema_version  version  generated_at  summary  alerts
runtime  sessions  errors  frontend_errors  llm  scoring  voice  voice_budget  business  metrics
```

顶层不再有集中的窗口块：每个块自带 `scope` / `window` 字段，口径跟着数据走。
`summary.status` 有 alerts 即 `degraded`，否则 `healthy`（发布冒烟依赖此语义）。

admin 出口 `/admin/ops/dashboard`、`/admin/ops/errors` 与公开端点**同规则**：各块同样自带
`scope` / `window`（`errors` / `frontend_errors` 的形状与公开端点逐字一致，由同一 builder 产出），
且不再返回恒为 `ok` 的 `health` 字段——页面按 `alerts` 判运行状态、版本取 `metrics.version`。

admin 出口另有公开端点没有的 `feedback` 块（`scope: db` / `window: now`）：
`unanswered` / `oldest_created_at` / `oldest_age_days`，取代宿主日报的「未回复用户反馈 N 条」。
为遵守最小暴露原则，该块**不含反馈正文与用户标识**；查询失败只告警并降级为 0/`null`，
不会让整个 dashboard 失败。

### 口径词表

`scope`：`process` = 本 worker 进程内；`workers` = 跨 worker JSONL 档案 + 未落盘增量合并；
`db` = 数据库全局。

`window`：`now` = 即时状态；`since_start` = 进程启动至今累计；`m5` / `h1` / `h24` = 滚动窗口；
`rolling_24h` = DB 侧滚动 24 小时；`rolling_Nm` = 由请求参数 `error_window_minutes` 决定的滚动
窗口；`day_cn` = 北京自然日；`month_cn` = 北京自然月；`rolling_24h_by_record_end_time` =
`scoring` 专用，按记录结束时间归口的 24h 滚动窗口。

### 各块 scope / window

| 块 | scope | window | 说明 |
|----|-------|--------|------|
| `runtime` | `process` | `now` | `cache_ttl_seconds`(120) / `cached_age_seconds` / `uptime_seconds` / `database{connected,pool_size,checked_out}` / `diagnose_cached_at` |
| `sessions` | `db` | `now` | `active` = 数据库中进行中的训练数（取代旧 `runtime` 内失效的会话计数） |
| `errors` | `workers` | `rolling_<N>m` | N = `error_window_minutes`（默认 60） |
| `frontend_errors` | `workers` | `rolling_<N>m` | 与 `errors` 同形 |
| `llm` | `db` | `rolling_24h` | 24h 调用量 / 成功率 / 错误数 / 平均延迟 / 最近错误 |
| `llm.router` | `process` | `now` | 降级 / 熔断 / 兜底 / 落库失败等进程侧状态 |
| `scoring` | `db` | `rolling_24h_by_record_end_time` | 另标 `in_progress_scope: process` / `in_progress_window: now`（in_progress 来自进程内 scoring_tracker） |
| `voice` | `db` | `rolling_24h` | TTS / ASR 统计 |
| `voice_budget` | `db` | `month_cn` | 语音月度预算 |
| `business` | `db` | `day_cn` | 北京自然日业务量 |
| `metrics` | `process` | `since_start` | 另标 `active_sessions_scope: db` / `active_sessions_window: now`；形状与 `/api/metrics` 完全一致 |

**LLM 降级/熔断证据的规范位置是 `llm.router`**（`degraded_providers` / `global_degraded` /
`degraded_by_reason` / `env_fallback` / `persist_failures` / `log_queue`）。旧顶层 `runtime` 下的
路由状态字段已移入此处；`metrics.llm.degraded_*` 仍在，仅作宿主日报的兼容别名。

### 错误计数键（`errors` / `frontend_errors` 同形）

`count` 的每个键对应 `window_by_count` 声明的窗口：

| 键 | 窗口 | 语义 |
|----|------|------|
| `count.last_5min` | `m5` | 窗口内**发生次数**（按事件时间计） |
| `count.last_hour` | `h1` | 窗口内**发生次数**（按事件时间计） |
| `count.total_captured` | `h24` | 24h 内不同错误签名数（历史键名，语义已与 `unique_24h` 统一） |
| `count.unique_24h` | `h24` | 24h 内不同错误签名数（== `count.total_captured`） |

两块均为 **workers 口径**：合并「本进程未落盘增量 + 跨 worker 共享档案」后按事件时间统计，
不再按 worker 分裂。窗口内另有 `window_minutes` / `total_events` / `unique_groups` / `truncated`；
短窗口突发不再单列键，与 `last_5min` 同源同义。

### 后端错误（`errors.groups`）

`errors.groups` 按最近出现时间和次数排序，并始终受 `error_groups` 限制：

```json
{
  "fingerprint": "8ad41e4d45f2517a",
  "level": "ERROR",
  "logger": "modules.training.chat",
  "message": "TimeoutError: ...",
  "messages": ["TimeoutError: ...", "ConnectionResetError: ..."],
  "count": 27,
  "first_seen": "2026-08-05T08:10:00+00:00",
  "last_seen": "2026-08-05T08:13:30+00:00"
}
```

- `message`：`last_seen` 时刻的那条消息。
- `messages`：同指纹的变体消息（去重、按首次出现顺序、上限 5 条），避免单一根因线索被覆盖。
- `count` / `first_seen` / `last_seen`：该指纹在查询窗口内的累计次数与首末时间。

### 前端遥测（`frontend_errors`）

```json
{
  "count": {"last_5min": 5, "last_hour": 24, "total_captured": 8, "unique_24h": 8},
  "groups": [
    {
      "fingerprint": "b1f0c0a2e3d4f5a6",
      "type": "TypeError",
      "message": "Object.hasOwn is not a function",
      "url": "/training/538",
      "user_id": 67,
      "ua": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) … Chrome/92.0.4515.131 … Edg/92.0.902.67",
      "source": "ErrorBoundary",
      "component_stack": "at Ga (/assets/markdown-….js:14:12727)",
      "count": 12,
      "time": "2026-09-24T02:30:29.620412+00:00",
      "first_seen": "2026-09-24T02:30:29.620412+00:00"
    }
  ]
}
```

- `count.last_5min` / `last_hour`：窗口内**发生次数**；`count.total_captured` == `count.unique_24h`：
  24h 内不同签名数。均为跨 worker 口径。
- `groups`：60 分钟窗口内按 `time`（最近一次发生）倒序，最多 20 条。
- `errors` 块的 `total_events` / `unique_groups` 描述完整查询窗口，`truncated=true` 表示
  `groups` 只包含裁剪后的代表错误；此时应先分析已有高优先级错误，而不是自动扩大到无限上下文。
- `ua` **必须**用于区分环境问题与代码缺陷：机房/旧浏览器缺内置 API 会稳定复现同一
  `TypeError`，只看 message 会误判为代码 bug。

## 隐私与日志内容

错误档案只负责保存应用已经写入日志的内容，不会自动识别患者信息或密钥。业务代码不得把 Authorization、Cookie、完整请求体、患者自由文本或数据库连接串写入 ERROR 日志。诊断接口虽然有 token 保护，仍应按敏感运维数据处理。
