# 基建/安全/运维域重构指南（Phase 6）

> 基线：9410d921。缺陷映射：defect-list.md I1-I6 + 主指南 §7 风险册。实测：staging 15.8% 评分故障率（41 超时 + 33 零分）、事故复盘文档化（incident-2026-07-26）。

---

## 1. 定位与洞察（单人运维的生存形态）

**单人开发 + AI 辅助 + 自动化 + 快反**，对基建域意味着三条硬约束：

1. **可观测性即生产力**：单人运维没有"值班"概念——一切靠**指标 + 告警 + 一键诊断**。当前 metrics/错误缓冲是进程内存（multi-worker 失真）、diagnose 靠 token query param（进访问日志），等于**盲飞**。本域第一优先级是把"事实"落到 DB/落盘，让告警可信任。
2. **成本闸门是"不失控"的底线**：平台面向学校客户，单人开发者无法承担"月底账单失控"这类事故。`monthly_cost_limit` 只展示不执行 + scoring `max_tokens=65536` 是**结构性的账单炸弹**，必须在评分域（Phase 1 的 S9）同批落地。
3. **快反 = 明确回滚 + 快速定位**：事故复盘文化已存在（incident-2026-07-26），要把它制度化：部署=镜像 SHA 标签（服务器已是 `ghcr.io/...:2e8095ba` 形态，很好）、回滚=切旧 tag、定位=diagnose 端点+DB 统计。

## 2. 成本闸门（联动 S9，Phase 1 同批）

| 动作 | 位置 | 说明 |
|---|---|---|
| 评分输出上限 | `infra/llm/profile.py:57-76` | scoring/scoring_feedback `max_tokens: 65536 → 8192`（thinking 保留，输出受控） |
| 评分输入预算 | `scoring/engine.py:282` + `_build_history_messages` | 复用 `context/budget.py` 截断（≤120 条/≤8k token），截断统计入 fallback.note |
| 会话/用户配额 | `scoring/router.py` 入队前 | 查 `LLMCallLog` 当日该用户成本（或简化：会话消息数/重试次数上限），超限 429 + 提示教师人工处理 |
| 预算执行 | `modules/admin/costs.py:241-249` | `monthly_cost_limit` 从"求和展示"改为"比较降级"：超限 → 该 key 全部 purpose 降级（复用 `ProfileRouter` 的 degrade 通道，`router.py` 已有机制） |
| 记账统一 | `token_counter.py:112-115` vs `router.py:227-232` | 统一计价来源（DB key 价优先），消除双轨对不上账 |

**快反配套**：`scripts/cost-health.sql`——每日成本趋势、单会话 TOP 成本、零分/超时占比（与 `score-health.sql` 同批入库）。

## 3. 安全

| 动作 | 位置 | 说明 |
|---|---|---|
| 对话明文 | `models/llm.py:74-75` + `infra/llm/logging.py:166-169,249-255` | LLMCallLog 默认只存 prompt/response 的 token 数与摘要（`request_text` 截断到 200 字）；详情接口二次确认；溢出文件不落 prompt 全文；加保留期清理任务（如 90 天） |
| 密钥 | `models/llm.py:25`、`models/voice.py:18-27`、`seed.py:242-248` | 应用层 AES-GCM + env 主密钥（KMS 可选）；`modules/admin/secrets.py` 加到期提醒 + 双活切换流程 |
| 运维 token | `infra/diagnostics.py:65-76`、`core/config.py:83-91` | 从 query param 移 `Authorization` header；token 缺失时启动日志显式告警（当前静默 404 = 监控盲区） |
| XFF 盲信 | `core/rate_limits.py:68-75`、`infra/telemetry.py:159-163` | 反代层 `real_ip` 模块取真实 IP；登录限流改 IP+账号双维度（学校 NAT 场景不误伤） |

## 4. 可观测性（先于扩容）

| 动作 | 位置 | 说明 |
|---|---|---|
| 关键计数 DB 化 | `infra/metrics.py:41-48`、`bootstrap.py:96-130` | LLM 成功率/错误突发/评分故障率改从 DB 统计（`infra/ops_queries.py` 已有 DB 侧查询），per-worker 内存计数降级为调试用途 |
| 评分健康脚本 | `scripts/score-health.sql`（Phase 0 已承诺） | failed+0 分兜底率、按 case 分布、超时原因——发布前后必跑 |
| diagnose 加固 | `infra/diagnostics.py:102-197` | 错误消息截断+过滤（`client.py:703-710` 的 provider 错误体可能回显 prompt 片段）；`summary.status` 基于 DB 事实而非残缺内存快照 |
| error_archive | `error_archive.py:19-31` | 多进程无锁轮转 → 单进程聚合写入或加进程锁（`flock`）；崩溃丢 delta（`diagnose.py:110-119`）→ 每次 emit 即持久化 |

## 5. 队列与可靠性

| 动作 | 位置 | 说明 |
|---|---|---|
| 内存队列 | `infra/queue.py:57,69-77` | 二选一（推荐 b）：(a) 队列状态落 DB（pending 已半落地）+ 重启恢复；(b) shutdown 时 **drain 而非 cancel**（让 in-flight 评分跑完），滚动发布零丢失——先做 (b)（低成本快反），(a) 视容量需要 |
| 并发注释漂移 | `queue.py:31-33`（semaphore=10）vs `profile.py:64`（200） | 收敛到 profile.py 单一常量 + 单测锁定；容量规划基于真实值 |
| 同步 DB I/O | `router.py:133-134,242-243` | `_refresh_profile_from_db`/`_persist_stats` 改 `asyncio.to_thread`（故障期不阻塞事件循环） |
| TTS 池 | `infra/tts/pool.py:79-91` | 等待 `_idle.get()` 移出锁外（条件变量模式），满池不串行化 |

## 6. 部署与回滚纪律（快反制度化）

1. **部署即镜像 SHA**：保持现状（`ghcr.io/fire-disposal/emoguard_project/*:<sha>`），**发布 = 推送 master → staging 验证（score-health 全绿）→ 切 tag**；生产由人执行（AGENTS.md 红线不破）。
2. **回滚脚本**：`deploy/rollback.sh` 已存在——补"回滚前先跑 score-health 快照"步骤，回滚后对比。
3. **发布检查单**（`docs/review/release-checklist.md`，Phase 6 交付物）：score-health / cost-health / 冒烟清单 / diagnose status / 备份时间戳，5 项全绿才准切生产。
4. **事故复盘模板**：incident-2026-07-26 的格式（时间线/根因/修复/后续）固化为模板，未来事故 24h 内出复盘。

## 7. 验收

- staging 双 worker 下 `/api/metrics` 与 DB 统计一致（误差 <5%）；score-health/cost-health 可一键运行；
- LLMCallLog 详情接口默认脱敏；溢出文件无 prompt 全文；密钥存储非明文（新写入）；
- 模拟超限（测试注入）→ 评分被拒且提示明确；月度预算超限 → 主 key 自动降级；
- 滚动发布（staging 重启）无 in-flight 评分丢失（drain 生效）；
- 部署检查单 5 项全绿为生产发布前置条件。
