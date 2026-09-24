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

### 后端错误（`errors.groups`）

`errors.groups` 按最近出现时间和次数排序，并始终受 `error_groups` 限制：

```json
{
  "fingerprint": "8ad41e4d45f2517a",
  "level": "ERROR",
  "logger": "modules.training.chat",
  "message": "TimeoutError: ...",
  "count": 27,
  "first_seen": "2026-08-05T08:10:00+00:00",
  "last_seen": "2026-08-05T08:13:30+00:00"
}
```

`count` 块（`last_5min` / `last_hour` / `total_captured` / `unique_24h`）与 `recent` 仍是
**本进程**计数（后端错误档案只服务于窗口分组），跨进程口径以 `groups` 为准。

### 前端遥测（`frontend_errors`）

```json
{
  "count": {"last_5min": 5, "last_hour": 24, "total_captured": 8},
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

- `count.last_5min` / `last_hour`：跨 worker 发生次数；`count.total_captured`：24h 内不同签名数。
- `groups`：60 分钟窗口内按 `time`（最近一次发生）倒序，最多 20 条。
- `ua` **必须**用于区分环境问题与代码缺陷：机房/旧浏览器缺内置 API 会稳定复现同一
  `TypeError`，只看 message 会误判为代码 bug。

响应中的 `total_events` 和 `unique_groups` 描述完整查询窗口；`groups` 只包含裁剪后的代表错误。如果 `truncated=true`，调用方应先分析已有高优先级错误，而不是自动扩大到无限上下文。

## 隐私与日志内容

错误档案只负责保存应用已经写入日志的内容，不会自动识别患者信息或密钥。业务代码不得把 Authorization、Cookie、完整请求体、患者自由文本或数据库连接串写入 ERROR 日志。诊断接口虽然有 token 保护，仍应按敏感运维数据处理。
