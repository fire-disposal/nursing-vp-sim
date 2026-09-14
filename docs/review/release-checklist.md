# 发布检查单（切生产前置）

> 交付物来源：`refactor-infra.md` §6.3。**5 项全绿才准切生产**；任一项非绿 → 停下修，不许"先发再补"。
> 生产发布由人执行（AGENTS.md 红线不破）：推 master → staging 验证本单 → 切 tag → 手动 workflow_dispatch。

适用环境：staging = `test.205716.xyz`，prod = `iomt.205716.xyz`（见 `docs/09-operations.md`）。

## 0. 前置

```bash
set -a; . ./.env; set +a          # 取 DATABASE_URL / DIAGNOSE_TOKEN
echo "$DATABASE_URL"              # 确认指向的是 staging 库，不是本地 vptest
```

- staging 已部署到待发布镜像 `<sha>`；生产未动。
- 本地 HEAD == 待发布 SHA（`git rev-parse --short HEAD`）。

## 1. score-health（评分健康，只读）

```bash
pnpm run health:score             # 默认近 7 天；对比基线可加 window_days=30
```

| 通过条件 | 目标 |
|---|---|
| 第 1 段 `failure_pct` | < 3（基线 15.8） |
| 第 2 段 `marked_pct` | = 100（0 分兜底必须带 fallback 标记） |
| 第 6 段 `raw_mismatch` / `display_mismatch` | = 0 |
| 第 1 段 `not_settled` | = 0（无卡在 pending/processing 的场次） |

不通过时：先看第 5 段失败原因（`评分超时` vs 其他）与第 6b 段明细行（哪条记录算术不符），再决定放行或回滚。**记录**：贴 `completed / broken / failure_pct / raw_mismatch` 四列数字。

## 2. cost-health（成本，只读）

```bash
pnpm run health:cost
```

| 通过条件 | 目标 |
|---|---|
| 第 1 段日成本 | 与上一版同量级，无跳变 |
| 第 2 段单会话 TOP 成本 | 无异常单会话（相对上一版不出现数量级抬升） |
| 第 3 段 `cost_pct` | 评分链路（`scoring` + `scoring_feedback`）占比符合预期 |
| 第 6 段 `limit_pct` | < 100（未超月度预算）；`degraded_reason` 无意外降级 |

不通过时：第 2 段按 `record_id` 定位失控会话，第 4 段看 `error_type` 是否重试风暴。

## 3. 冒烟清单（手动 3 分钟，staging）

按 `refactor-frontend.md` 既有清单（U 类每次合入 staging 后跑一遍）：

开始训练 → 对话 3 轮 → 查体 2 项 → 结束 → 看评分 → 教师复核 → 结果页导出。

| 通过条件 |
|---|
| 无阻断级报错（页面白屏 / 5xx / 流式卡死） |
| 倒计时到点自动提交，超时后再发消息被拒（409） |
| 评分呈现含 fallback 标记；教师复核写回后总分与条目一致 |
| 导出/结果页数据与详情页一致 |

## 4. diagnose status（运行时）

```bash
curl -sS "https://test.205716.xyz/api/diagnose?token=$DIAGNOSE_TOKEN" \
  | jq '{version, health, summary, alerts, scoring, llm: {success_rate: .llm.success_rate}}'
```

| 通过条件 | 目标 |
|---|---|
| `summary` | `healthy`（`degraded` 时必须逐条看清 `alerts` 来源） |
| `version` | 等于待发布 SHA |
| `alerts` | 空；或每条都能解释为已知非回归项 |
| `scoring.pending` / `in_progress` | 个位数，无堆积 |

阈值表见 `docs/09-operations.md`（诊断端点章节）。

## 5. 备份时间戳（回滚保险）

```bash
ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-backup.sh prod list"
```

| 通过条件 | 目标 |
|---|------|
| 最近一条 `success` 备份 | 距发布 < 3 天（cron 每 3 天一次） |
| 不满足 | 先跑 `ssh yecaoyun "cd /opt/nursing-vp-sim && bash deploy/db-backup.sh prod"`，成功后再发 |

回滚流程见 `docs/09-operations.md`（回滚前同样先落一份备份）。

## 记录模板（复制进发布 issue / PR）

```text
发布 SHA:            <sha>
1 score-health:      completed=__  broken=__  failure_pct=__  raw_mismatch=__   [ ] 绿
2 cost-health:       day_cost=__  top_session=__  limit_pct=__                   [ ] 绿
3 冒烟清单:          训练→评分→复核→导出                                          [ ] 绿
4 diagnose:          summary=__  version=__  alerts=__                            [ ] 绿
5 备份时间戳:        latest=__  (距今 __ 天)                                       [ ] 绿
结论:                放行 / 回滚  —  备注:
```
