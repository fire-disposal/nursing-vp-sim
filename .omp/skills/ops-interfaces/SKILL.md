---
name: ops-interfaces
description: nursing-vp-sim 观测/运维接口总览：反馈、前端遥测、诊断接口（/api/diagnose v3 口径与陷阱）、健康与进程指标；含消费方清单与改口径的开发规矩
---

# 观测与运维接口总览

生产 `https://iomt.205716.xyz`（单实例；tag 推送即发布，无审批闸门）。四个入口各管一段，别混用：

| 入口 | 谁在用 | 关键特性 |
|---|---|---|
| `GET /api/diagnose?token=<DIAGNOSE_TOKEN>` | Agent 故障诊断、宿主日报、CI 部署冒烟、PiOps prompt | 机器可读快照，`schema_version: 3` |
| `POST /api/telemetry` | 前端错误上报（ErrorBoundary / `window.error` / unhandledrejection） | 204；每 IP 5 次/60s；单批 ≤20 条 |
| `GET /api/health` | 存活与版本（公开） | `{status, version}` |
| `GET /api/metrics` | 宿主 monitor 本地读取 | 进程口径；nginx 对公网 `return 444`；形状**冻结** |

## 诊断接口口径（v3）

每块自带 `scope` ∈ {`process` 本 worker · `workers` 跨 worker 档案合并 · `db` 数据库全局}
与 `window` ∈ {`now` · `since_start` · `m5` · `h1` · `h24` · `rolling_24h` · `rolling_<N>m`(N=`error_window_minutes`) · `day_cn` · `month_cn`}。

| 块 | scope / window | 怎么读 |
|---|---|---|
| `summary` / `alerts` | — | `alerts` 非空 ⇒ `status: degraded`；部署冒烟只认这两个字段 |
| `errors` | workers / `rolling_<N>m` | `count.last_5min/last_hour` = **窗口内发生次数**（按事件时间）；`total_captured == unique_24h` = 24h 内不同签名数（前者是历史键名）；`window_by_count` 给出每个键的窗口 |
| `frontend_errors` | workers / `rolling_60m` | 与 `errors` 同形；`groups[].ua` **必须**用来区分「旧浏览器环境问题」与「代码缺陷」 |
| `llm` | db / `rolling_24h` | 24h 调用量、成功率、`recent_errors` |
| `llm.router` | process / `now` | **LLM 降级/熔断/兜底/落库失败的唯一规范位置**：`degraded_providers` `global_degraded` `degraded_by_reason` `env_fallback` `persist_failures` `log_queue` |
| `scoring` | db / `rolling_24h_by_record_end_time` | `in_progress` 另有 `in_progress_scope: process`（进程内 tracker） |
| `sessions` | db / `now` | `active` = 进行中训练数；判断「无会话」用这里，别用恒 0 的历史字段 |
| `runtime` | process / `now` | `database{connected,pool_size,checked_out}`；`cache_ttl_seconds=120` + `cached_age_seconds` = 这段最多 2 分钟陈旧 |
| `voice` / `voice_budget` / `business` | db / `rolling_24h` · `month_cn` · `day_cn` | TTS 成本、北京自然月预算、北京自然日业务量 |
| `metrics` | process / `since_start` | 单 worker 进程指标；其中 `active_sessions` 的 scope 是 db/now（兼容宿主 monitor） |

**坑位**

1. `metrics.*` 是**单 worker** 值，多 worker 下两次调用可能不一致，别当集群口径。
2. `metrics.llm.*` 与顶层 `llm.*` 同名不同义：前者进程累计（且带降级别名），后者 24h DB。
3. 错误计数跨 worker 靠 JSONL 档案（`/app/data/diagnostics/*.jsonl`，挂 `ai_vp_diagnostics` 卷，跨容器重建存活）；
   窗口边界归属精度受落盘节奏限制（同组最多每 30s 补记一次增量）。
4. 可调参数：`error_window_minutes`(1–1440)、`error_groups`(1–50)。
5. 鉴权：`DIAGNOSE_TOKEN` 未配置 ⇒ **404**（端点整体隐藏）；token 不符 ⇒ **403**。

## 排障顺序

1. `summary.status` / `alerts`：degraded 直接读告警文案（每条自带窗口/作用域字样）。
2. `errors.groups`：指纹 + `count/first_seen/last_seen` + `messages`（同指纹变体，上限 5 条）。
3. `frontend_errors.groups`：看 `ua` / `url` / `component_stack`；机房旧浏览器会稳定复现同一 `TypeError`。
4. `llm.router.*`：花钱走了 env key（`env_fallback`）或成本账没落库（`persist_failures`）只在这里暴露。
5. `scoring.failed_24h` / `pending` / `in_progress`、`sessions.active`。

## 前端遥测（`POST /api/telemetry`）

- 无 token，按 IP 限流；载荷 `{errors:[{type,message,url,user_id,ua,source,component_stack}]}`，各字段有长度上限。
- 落盘 `FRONTEND_ERROR_ARCHIVE`（默认 2MB × 2 备份），与后端 `DIAGNOSTIC_ERROR_ARCHIVE`（5MB × 3）分开。
- 同一签名（source+type+message 前 120 字符）5 分钟内算一组：首次立即写盘，持续重复最多每 30s 补记增量。

## 反馈接口（`/api/feedback/bot`）

字段与参数的权威表在仓库 `AGENTS.md`「反馈 Bot API」；这里只补调用形态与陷阱：

```bash
TOKEN_FILE=~/.secrets/feedback_bot_token   # 值为 FEEDBACK_BOT_TOKEN；只经 --url-query 传，绝不打印
BASE=https://iomt.205716.xyz
curl -s -G "$BASE/api/feedback/bot" --url-query "token@$TOKEN_FILE" --url-query "replied=false" | jq .
curl -s -X PATCH "$BASE/api/feedback/bot/<id>" --url-query "token@$TOKEN_FILE" | jq .   # 标记已尝试修复
curl -s -X PUT "$BASE/api/feedback/bot/<id>/reply" --url-query "token@$TOKEN_FILE" \
  -H 'Content-Type: application/json' -d '{"reply":"已在 2026.09.25-1 修复，请更新后重试"}' | jq .
```

- 正文 1..2000 字符；写 `developer_reply` + `replied_at`，并发 `feedback_replied` 通知；署名 `FEEDBACK_BOT_NAME`（默认「系统助手」）。
- 已有回复**默认 409**（防覆盖人工回复）；确需覆盖加 `overwrite=true`，只换正文、**不重置**首条 `replied_at`。
- 404 = `FEEDBACK_BOT_TOKEN` 未配置；403 = token 不符。token 只经 `--url-query "token@文件"`（curl ≥ 7.87），输出用 `<redacted>`。

## 改口径的开发规矩

- 契约唯一来源：`backend/infra/diagnostics.py` 的 scope/window 词表（含 `ERROR_COUNT_WINDOWS`）+ `docs/ops/diagnostics.md`。
- 改字段必须同步全部消费方：`docs/09-operations.md`、宿主日报 `/opt/server-ops/monitor/daily_report.py`、
  `.github/piops/build_prompt.py`、admin 看板（`frontend/src/pages/admin/SystemOpsPage.tsx` + `api/admin/ops.ts`）、`deploy.yml` 冒烟。
- 三条不变量：一个数据只放一处；**同名必须同义**；每块自带 `scope`/`window`。
- 改完跑 `cd backend && uv run python -m pytest tests/infra/test_diagnose_contract.py`（窗口语义/词表/去重不变量）。
- 生效路径：`pnpm run tag` ⇒ tag 推送触发 `deploy.yml` ⇒ 部署后冒烟会真打 `/api/diagnose`
  （依赖仓库 secret `DIAGNOSE_TOKEN`；未配置时该步骤会打印跳过并 continue）。
