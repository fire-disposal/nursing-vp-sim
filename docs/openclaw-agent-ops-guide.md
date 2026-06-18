# OpenClaw Agent Ops Guide

## 诊断入口

```
GET /api/ops/dashboard?token=<DIAGNOSE_TOKEN>
```

返回完整系统快照。Diagnose token 在 `.env` 的 `DIAGNOSE_TOKEN` 中。

## 响应结构

```json
{
  "code": 0,
  "data": {
    "health":         {"status": "ok", "version": "..."},
    "llm":            {"total_calls_24h": N, "success_rate": 95.0, "error_count_24h": N, "avg_latency_ms": N, "recent_errors": [...]},
    "scoring":        {"pending": N, "stuck": N},
    "sessions":       {"active": N},
    "notifications":  {"unread": N},
    "metrics":        {"requests": {...}, "llm": {...}},
    "diagnostic":     {...}
  }
}
```

## 日报摘要

```
GET /api/ops/report?token=<DIAGNOSE_TOKEN>
```

与 dashboard 相同数据源，附带 `alerts` 预警列表。

## 判断逻辑

| 现象 | 可能原因 | 行动 |
|------|----------|------|
| `llm.success_rate < 90%` | 某个 provider 故障 | 查 `recent_errors`，考虑优雅降级 |
| `llm.error_count_24h > 50` | API key 过期或限额 | 检查 key 配置 |
| `scoring.stuck > 0` | 卡住超 24h 的评分任务 | 手动 retry 或清理 |
| `sessions.active > 50` | 异常高负载 | 检查是否有攻击流量 |
| `health.status != "ok"` | 后端无法响应 | 查看容器日志 |
| `diagnostic` 含错误 | 基础设施问题 | 查 DB 连接/内存 |

## 注意事项

- Token 通过查询参数传递：`?token=...`
- 无 token 时端点返回 404（完全隐藏）
- 网络不可达时无响应，不要无限重试
- 数据来自内存快照，非实时精确值
