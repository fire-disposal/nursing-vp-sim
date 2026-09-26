> 状态：待评审（设计已收敛，未实施）

# 管线五阶段收敛 + Job/API 进程分离（合并设计）

两项被提到高优先级，且**必须一起设计**：管线阶段是身份与账本的捕获点，而"谁在执行阶段"决定了这些捕获是否可跨进程、可恢复。分开设计会出现两套边界。

## 一、事实基线（代码与部署事实）

| 事实 | 证据 |
|---|---|
| 生产**已经是多进程**：`uvicorn --workers 2` | `deploy/docker-compose.prod.yml:52 UVICORN_WORKERS: ${UVICORN_WORKERS:-2}` |
| 每进程 import 基线 ~110MB（实测 107MB；compose 注释记 ~116MB） | 实测 `import main` 峰值 RSS 107.2MB；`docker-compose.prod.yml:34` |
| 后端容器上限 640m，运维口径"超过 500MB 持续增长则重启" | `docker-compose.prod.yml:36`、`docs/09-operations.md:440` |
| 内存 `TaskQueue` **只**用于评分 | `infra/queue.py`；唯一入队边界 `scoring/runner.enqueue_scoring` |
| 队列参数：`SCORING_WORKERS=8`（实际受限 LLM semaphore 上限 10）、`max_size=100`、入队超时 → `QueueFullError` | `infra/queue.py` 类文档 |
| 后台循环都跑在每个 API worker 内：结算 `settlement_loop`、通知发布 `notification_publisher`、metrics、诊断 | `infra/bootstrap.py`（`start_settlement` / `init_infra`） |
| 跨进程安全机制**已存在**：评分认领 CAS `claim_scoring`、结算 `pg_try_advisory_lock` | `scoring/lifecycle.py`、`session/settlement.py:47` |
| 进程内状态确实是进程局部的：`ScoringProgressTracker`（注释自述"多 worker 下各自独立"）、`abandoned_stream_count`、前端遥测缓冲（靠 JSONL 档案合并） | `scoring/runner.py` 注释、`pipeline/runner.py`、`infra/telemetry.py` |
| **事件循环阻塞已在生产致障**：一个 worker 处理 TTS 时阻塞循环 → 同进程 chat SSE 返回 200/0 字节 → 前端 30s 超时 | `docs/ops/incident-2026-07-26-timeout.md` |
| 管线是"固定顺序 + 中间件链"：`PipelineStage` 枚举**声明 7 个阶段**，但 `GUARD`/`TRANSITION` 无任何实现与使用者（空桶，只在 `_STAGE_ORDER` 里有编号）；`builder._CORE_MIDDLEWARE` 给其余 5 个阶段各配**恰好一个**中间件 | `pipeline/stages.py:27-28`、`pipeline/builder.py:18-33`、`pipeline/runner.py`（`next_mw` 链式驱动） |
| 评分超时已有"派生常量"先例：`SCORING_RETRY_GRACE_SECONDS = SCORING_TIMEOUT_SECONDS + 30`（180/30/210） | `core/config.py:118-128` |

**结论性事实**：进程分离不需要"新建多进程架构"——系统本来就是 2 个进程 + DB 级仲裁；缺的只是**持久化任务**与**角色划分**。而事件循环隔离有生产事故背书。

## 二、Part 1：管线五阶段显式化

### 2.1 现状与要删的东西

现状：5 个中间件对象 + 一个把 fixed list 装起来的 builder + 一个 `next_mw` 链式驱动器 + 若干只为在包装之间传值而存在的 `STATE_*` 键。

目标形态：

```python
async def run_turn(ctx: TurnContext) -> None:
    """一轮对话的唯一编排：五阶段显式调用，顺序即契约。"""
    await analyze_emotion(ctx)      # ANALYSIS    最佳努力
    await build_prompt(ctx)         # PROMPT      产出 ledger + 身份
    await call_llm(ctx)             # LLM         写调用日志（带身份）
    await persist_turn(ctx)         # PERSIST     必须成功，失败即中止
    await emit_side_effects(ctx)    # SIDE_EFFECTS 最佳努力
```

要删：

| 删除项 | 理由 |
|---|---|
| `PipelineStage.GUARD` / `TRANSITION` 枚举成员 + 其 `_STAGE_ORDER` 编号 | 声明了但零实现零使用者（空桶）；枚举应只留下真实存在的阶段 |
| `PipelineMiddleware` 协议与 `next_mw` 驱动器 | 只有一个实现（固定顺序），链式驱动让控制流不可读；短路需求改为 `return` / 显式 `ctx.short_circuit` 判定 |
| `builder.build_pipeline()` 的列表装配 | 组装权从"运行时拼列表"变成"源码里的函数调用顺序"；顺序契约搬进函数体 + 一个顺序断言测试 |
| 只为跨包装传值而存在的 `STATE_*` 键 | 阶段变函数后，同一作用域内的局部变量即可传递；仅跨阶段且需持久/可观测的（ledger、身份、turn 元数据）保留为 `ctx` 字段 |
| `run_pipeline` 与 `stream_pipeline` 的双份驱动 | 合并为一个编排 + 一个"帧发射器"；流式与否是**发射器**的选择，不是管线的第二份实现 |

保留（不能顺手删掉的东西）：

1. **阶段顺序契约**（ANALYSIS→PROMPT→LLM→PERSIST→SIDE_EFFECTS）。
2. **must-succeed vs best-effort 的区分**：`persist_turn` 失败必须中止请求；`emit_side_effects` 失败只记录。
3. **SSE 错误帧形状**（含稳定 `code`）与断线不取消任务（整段生成后推送）的行为。
4. **幂等回放**（`request_id` 命中既有回合直接回放）。

### 2.2 风险与验证

这是交互热路径，收敛必须**零行为变化**：

* 先只做机械收敛（顺序、状态、帧都不变），用现有回合/SSE 测试兜底；
* 新增两条契约测试：①阶段顺序与短路（注入探测桩，断言调用次序与"短路后不再进入后续阶段"）；②PERSIST 失败时 SIDE_EFFECTS 不被执行、请求以错误帧结束。
* 账本与身份捕获放在**收敛之后**单独一片（否则身份会随包装一起二次搬迁）。

## 三、Part 2：持久化 Job 与进程角色分离

### 3.1 进程角色

| 角色 | 启动 | 职责 | 明确不做的 |
|---|---|---|---|
| `api`（现状） | `uvicorn main:app --workers N` | HTTP/SSE/工具/WS/权限/静态 | **不再执行评分**；不跑结算与通知循环 |
| `worker`（新增） | `python -m app.worker`（同镜像） | 认领并执行 job、结算循环、通知发布 | 不接 HTTP 公网流量；不做 metrics 采样（进程口径留在 api） |

两边共享：同一镜像、同一 `.env`、同一 PostgreSQL。**不构建第二份镜像**（同 image，不同 command）。

### 3.2 Job 表（唯一新增的持久化）

```sql
CREATE TABLE jobs (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT        NOT NULL,          -- 'scoring'（首个），后续 'export' / 'notify'
  record_id     INT         NULL REFERENCES training_records(id) ON DELETE CASCADE,
  payload       JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'pending',  -- pending|running|succeeded|failed
  priority      INT         NOT NULL DEFAULT 0,
  attempts      INT         NOT NULL DEFAULT 0,
  max_attempts  INT         NOT NULL DEFAULT 2,
  available_at  TIMESTAMPTZ NOT NULL DEFAULT now(),      -- 退避/延迟
  lease_owner   TEXT        NULL,                        -- 角色+主机+pid
  lease_expires_at TIMESTAMPTZ NULL,                     -- 过期即可被重领
  last_error    TEXT        NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 认领路径
CREATE INDEX ix_jobs_claim ON jobs (status, available_at, priority DESC, id) WHERE status = 'pending';
-- 同一记录的评分不得重复挂起（对应今天的 "评分正在进行中" 语义）
CREATE UNIQUE INDEX uq_jobs_active_scoring ON jobs (record_id)
  WHERE kind = 'scoring' AND status IN ('pending', 'running');
```

**认领**（无长事务、无锁等待）：

```sql
UPDATE jobs SET status='running', lease_owner=$1,
       lease_expires_at=now()+interval '300 seconds', attempts=attempts+1
WHERE id = (SELECT id FROM jobs
            WHERE status='pending' AND available_at <= now()
            ORDER BY priority DESC, id
            FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING *;
```

**心跳**：执行中每 30s 续租。租约 300s 必须大于评分总时长上限（`SCORING_TIMEOUT_SECONDS=180` 全局超时；整个重试序列也被全局超时包住），否则会被误判死亡并重领。**绑定方式照抄库里已有的先例**：`SCORING_RETRY_GRACE_SECONDS = SCORING_TIMEOUT_SECONDS + 30`（`core/config.py:128`）——同样派生出租约常量并在测试里断言 `lease > scoring_timeout`。

**恢复**：启动时把 `status='running' AND lease_expires_at < now()` 的行置回 `pending`（或 `attempts >= max_attempts` 时置 `failed`）。这**取代**今天"扫 `scoring_status` 卡住记录"的主路径：

* 主路径：租约过期 → 有明确原因（worker 死亡/被杀）；
* 兜底：保留刚收束好的 `classify_stuck_records`（记录状态与 job 状态不一致时的一致性检查），但不再承担主恢复职责。

**退避与终态**：失败按 `attempts` 指数退避写 `available_at`；耗尽后写 `failed` + `last_error`，并复用现有 `handle_scoring_failure`（通知 + SSE + force 重评快照恢复）。

### 3.3 切换与回滚

* 特性开关 `SCORING_EXECUTION=inline|job`：
  * `inline`（默认起步）：保持今天的 `TaskQueue` 行为，**同时**镜像写一条 `jobs` 行（影子行，只观测不认领）→ 用于验证行数与状态分布；
  * `job`：`enqueue_scoring` 改为只插 job 行；worker 认领执行。
* 双跑安全性：`claim_scoring` 的 CAS 已保证「同一记录只有一个执行者」，因此切换窗口内即使两条路径同时存在也不会双评分。
* 回滚：开关切回 `inline`；`jobs` 行留在表里（幂等，不清理也不影响）。
* 删除 `TaskQueue` 的时机：`job` 模式稳定运行一个发布周期后，连同 `SCORING_WORKERS` 配置与队列 metrics 一起删（届时无第二个任务类型，不留通用队列）。

### 3.4 内存与就绪性（含实测数字）

实测：单进程 import 基线 **107MB**（与 `docs/09` 记录的 ~116MB 同量级）。

| 方案 | 进程构成 | 内存粗算 | 取舍 |
|---|---|---|---|
| A. 现状 | 2×api（含队列/结算/通知） | 2×110MB + 运行时 ≈ 300-400MB（640m 上限内） | 一个 worker 阻塞循环会连带同进程 chat SSE（已致障） |
| B. **api 2 + worker 1**（推荐） | api 不再跑评分/结算/通知；worker 跑 job+结算+通知 | +110MB 基线 + worker 运行时（无 uvicorn/metrics/TTS）≈ +150-200MB | 需为 worker 单独配 `mem_limit`（建议 320m）并确认宿主机余量；事件循环隔离 |
| C. api 1 + worker 1 | 把 api 降到单 worker 抵消新增 | 总量与现状持平 | 单 api worker 下任一慢请求影响全部 HTTP；交互面风险升高 |

**切换前置条件（必须在目标机上核）**：`free -h` 与 `docker stats --no-stream`，确认方案 B 的 +200MB 不触发宿主 OOM（当前 caps 合计 db 512m + backend 640m + frontend 128m）。若余量不足 → 先降一个 api worker（方案 C）或压缩 `mem_limit`。

**就绪性**：

* `api`：沿用 `/api/health`（compose healthcheck 不变）。
* `worker`：不暴露公网端口。心跳写 `worker_heartbeats(role, instance, beat_at)` 每 15s 一条 upsert；
  * compose 侧用一行 python 检查心跳新鲜度（不引额外依赖）；
  * `/api/diagnose` 增加 `worker` 块（`last_beat_age_seconds`、`active_leases`、`expired_leases`），让**运维入口仍是 diagnose 一处**（与 `.omp/skills/ops-interfaces` 的契约一致）。
* `/api/diagnose` 与 `/admin/ops/dashboard` 增加 `jobs` 块：按 kind 的 pending/running/failed 计数、最老 pending 年龄、租约过期数。

### 3.5 什么留在进程内（明确不做）

* 对话 SSE 与工具命令**不进 job**：它们需要请求上下文（流式 token、断线、幂等键），且已有事务 A/B 边界。job 只承载"可离线完成、可重试、无交互"的工作。
* `metrics`、`realtime_hub`、`diagnose` 采样留在 api（进程口径语义）。
* 不做 Redis/Celery/RQ：PostgreSQL 已是唯一共享状态，`FOR UPDATE SKIP LOCKED` 足够，且运维面不新增组件。
* 不做 API/Worker 双镜像、不做 broker、不做动态扩缩容。

## 四、切片顺序（合并推进）

| 片 | 内容 | 依赖 | 回归 |
|---|---|---|---|
| S1 | 管线机械收敛：五阶段显式函数 + 单编排 + 帧发射器；删中间件协议/驱动器/传值键 | 无 | 顺序与短路契约测试 + 回合/SSE 测试 |
| S2 | PROMPT 阶段产出 ledger + 策略身份；LLM 阶段写调用日志身份；SIDE_EFFECTS 落回合账本 | S1 | 账本形状测试；日志字段测试 |
| S3 | `jobs` 表迁移 + 影子写入（`inline` 模式，只观测） | 无（可与 S1/S2 并行） | 迁移链 + 影子行断言 |
| S4 | `worker` 角色：认领/心跳/租约恢复/退避；`SCORING_EXECUTION=job` 切换 | S3 | 认领原子性（并发认领只成功一次）、租约过期重领、退避与终态 |
| S5 | 身份物化（`prompt_id` 等，若 S2 的聚合查询证明必要）+ 版本页与记录调试页 | S2/S4 | 一致性测试 + 前端套件 |
| S6 | 删除 `TaskQueue`/`SCORING_WORKERS`/队列 metrics；compose 增加 worker 服务与 cap；diagnose 增加 `jobs`/`worker` 块 | S4 稳定一个发布周期 | 部署冒烟 + 回滚演练 |

## 五、开放决策

1. **worker 是否与 api 同容器**：独立容器（推荐：独立 cap/健康检查/回滚）vs 同容器多进程（省一层编排，但共享 cap 与 PID，故障域重叠）。
2. **租约数字**：建议租约 300s / 心跳 30s（需与 `SCORING_TIMEOUT_SECONDS`、重试间隔绑定并测试断言）；是否按 kind 区分租约。
3. **api worker 数量**：方案 B（2 worker）还是 C（1 worker）——取决于宿主机实测余量。
4. **影子期长度**：至少一个发布周期（建议 3-5 天），期间核对 job 行数与实际评分次数一致。
5. **是否把结算与通知循环一并迁到 worker**：本设计建议迁（它们本就是后台循环，且通知发布的锁 `NOTIFICATION_LOCK_KEY` 已是跨进程语义）。
