# 故障报告: 测试服连接超时 (2026-07-26)

## 概述

- **时间**: 2026-07-26 21:51 CST (13:51 UTC)
- **环境**: Staging (test.205716.xyz, v2026.07.26-15)
- **影响**: 用户训练中 chat SSE stream 超时，底部红色 toast "请求超时，请重试"
- **根因**: 单 worker 处理 TTS 请求时阻塞 event loop，chat stream 连接被接受但零数据返回

## 时间线

| 时间 (UTC) | 事件 |
|------------|------|
| 06:55 | 3 次 Connection refused/reset（旧版本遗留） |
| 08:41 | 8 次 Connection refused/reset，持续 11 秒（旧版本） |
| 09:24 | 2 次 Connection refused（旧版本） |
| 10:15 | 3 次 HTTP 499（用户取消：TTS/Chat/Record 同时超时） |
| 13:24 | Staging 重新部署 v2026.07.26-15 |
| 13:51:34 | **核心事件**: 用户 record=285，TTS 502 + Chat 200/0 同秒发生 |

## 证据

### Nginx 日志 (关键请求)

```
09:51:34 EDT  POST /api/tts/stream                  → 502 (Bad Gateway)
09:51:34 EDT  POST /api/chat/285/message/stream      → 200 0 bytes ← 空响应
09:51:34 EDT  GET  /api/training/records/285         → 200 (正常)
09:51:40 EDT  GET  /api/training/ws?token=...        → WebSocket 重连
```

### 当日 HTTP 状态分布 (staging)

```
200  ✅  2,928   正常
304       749   缓存
503  🔴    142   Service Unavailable (QueueFullError)
500  🔴    114   Internal Server Error
499  🟡     41   客户端取消 (用户等不及)
502  🟡     40   Bad Gateway
401        7   认证失败
```

### 后端配置

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1 --no-access-log
```

- 单 worker，单 event loop
- 无 access log，无法回溯请求轨迹

## 根因分析

### 故障链路

```
Worker 正处理 /api/tts/stream (事件循环阻塞)
  → /api/chat/285/message/stream 到达
    → TCP 连接被接受（内核层面），但 event loop 无法处理
    → HTTP 200 返回但零字节响应体
    → 前端等待 30s (FETCH_TIMEOUT=30000) → AbortError
    → bus.emit("stream:error", "请求超时，请重试")
    → sonner toast 底部红色提示
```

### 前端超时链

| 组件 | 超时值 | 说明 |
|------|--------|------|
| `chat.ts` FETCH_TIMEOUT | 30s | fetch AbortController |
| `qa.ts` FETCH_TIMEOUT | 30s | QA stream |
| `sse.ts` STREAM_IDLE_TIMEOUT | 60s | SSE 通道空闲超时 |
| `client.ts` axios timeout | 120s | 普通 HTTP 请求 |
| 前端 nginx proxy_connect_timeout | 30s | TCP 连接建立 |
| 前端 nginx proxy_read_timeout | 300s | 流式响应 |

### SSE idle timeout 变更

`922fcbbe` 将 `STREAM_IDLE_TIMEOUT` 从 25s 提升到 60s，因为 25s < 后端 stream timeout 30s，导致 LLM 生成间隙触发前端提前截断。此变更不存在过度严格的问题。

### 用户反馈澄清

用户反馈"无法进入系统"实为：**登录成功（所有 /api/auth/login → 200），进入训练页后发送消息卡死**。非登录鉴权问题。

## 修复方案

### 短期 (已完成)

- `f16327bc` PendingRollbackError fix（隔离 initiative timer 事务）
- `cfb93c22` WS 鉴权 TypeError fix
- `0cd57d46` nginx /api/ 直连（已部署 staging，待部署 production）

### 中期 (进行中)

1. **RealtimeHub → PG LISTEN/NOTIFY**: 跨 worker WS 事件推送
2. **--workers 1 → 2**: Dockerfile 参数化
3. **DB pool 调小**: pool_size=5, max_overflow=10
4. **--no-access-log 移除**: 排障需要
5. **proxy_connect_timeout 30s → 10s**: 快速失败

### 长期

- Staging/Production 拆分到独立机器
- Redis 替代 PG LISTEN/NOTIFY（50+ 并发时）
- 接入 APM (Sentry/Datadog)

## 附录

### 服务器资源

```
CPU:    2 核 Intel i7-8650U
内存:   3.8 GB (可用 ~1.8 GB)
磁盘:   50 GB SSD (可用 13 GB)
PG:     max_connections=100 per instance
```

### 4-worker 资源预估

```
staging:  2 workers × ~170 MB = 340 MB
production: 2 workers × ~170 MB = 340 MB
DB ×2:    ~130 MB
frontend:  ~10 MB
OS:       ~500 MB
─────────────────────────────
总计:     ~1.3 GB / 3.8 GB ✅
```

### 相关提交

| Commit | 描述 |
|--------|------|
| `922fcbbe` | SSE idle timeout 25s→60s |
| `f16327bc` | PendingRollbackError fix |
| `cfb93c22` | WS 鉴权 TypeError fix |
| `0cd57d46` | nginx /api/ 直连 fix |
| `1a197463` | JWT key rename + schema 容错 |
