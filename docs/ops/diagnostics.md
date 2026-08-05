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

默认单文件 5 MB、保留 3 个备份，总量约 20 MB。容器部署时应确保 `/app/data` 使用持久卷；否则容器删除后档案仍会丢失。

可选环境变量：

```text
DIAGNOSTIC_ERROR_ARCHIVE=/app/data/diagnostics/backend-errors.jsonl
DIAGNOSTIC_ERROR_ARCHIVE_MAX_MB=5
DIAGNOSTIC_ERROR_ARCHIVE_BACKUPS=3
```

同一 logger 与消息在五分钟内视为同一错误组。首次出现立即写盘；持续重复时最多每 30 秒补记一次增量，避免错误风暴造成文件膨胀。

## 返回结构

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

响应中的 `total_events` 和 `unique_groups` 描述完整查询窗口；`groups` 只包含裁剪后的代表错误。如果 `truncated=true`，调用方应先分析已有高优先级错误，而不是自动扩大到无限上下文。

前端遥测当前仍为进程内缓冲，但接口同样限制最多返回 20 个近期错误。后续只有在实际需要跨重启追踪前端错误时才应增加持久化，避免本轮改造扩大范围。

## 隐私与日志内容

错误档案只负责保存应用已经写入日志的内容，不会自动识别患者信息或密钥。业务代码不得把 Authorization、Cookie、完整请求体、患者自由文本或数据库连接串写入 ERROR 日志。诊断接口虽然有 token 保护，仍应按敏感运维数据处理。
