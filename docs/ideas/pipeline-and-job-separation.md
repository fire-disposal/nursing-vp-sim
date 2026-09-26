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

## 二、Part 1：管线五阶段显式化（✅ 已实施）

### 2.1 落地形态

顺序契约现在住在**源码里的一个元组**（`pipeline/runner.py`）：

```python
STAGES: tuple[tuple[str, StageFn], ...] = (
    ("analysis", emotion_analysis),
    ("prompt", prompt_builder),
    ("llm", llm_caller),
    ("persist", persister),
    ("side_effects", side_effects),
)

async def _run_stages(ctx) -> None:
    for name, stage in STAGES:
        if ctx.should_shortcut:
            return          # 短路 = 不再进入后续阶段（与旧链式驱动逐字一致）
        await stage(ctx)

async def run_pipeline(ctx) -> None                    # 不再接收 middlewares
async def stream_pipeline(ctx, *, release=None)        # 不再接收 middlewares
```

关键语义核实（决定线性化等价）：五个阶段里所有 `await next_mw()` 都是**分支末尾或函数末句**
（`side_effects` 的调用更是末阶段的空操作），因此"链式驱动"与"顺序调用"逐字等价。

已删除：

| 删除项 | 结果 |
|---|---|
| `PipelineStage.GUARD` / `TRANSITION` 空阶段 | 已删（`dae47400`）；枚举随后整体删除 |
| `PipelineMiddleware` 协议 + `_make_next` 链式驱动器 | 已删；短路语义搬进 `_run_stages` 的进入前判定 |
| `builder.build_pipeline()` 列表装配 | 改为 `builder.build_note_collector(workflow)`（只决定"有哪些上下文来源"） |
| `pipeline/stages.py` 整个模块（枚举 + `_STAGE_ORDER` + `stage_order`） | 已删；顺序的唯一表达是 `STAGES` |
| `run/stream` 的 middlewares 形参 | 已删；两条路径共用 `_run_stages`（双份驱动只剩帧发射差异） |

保留（未动）：顺序语义、must-succeed vs best-effort、SSE 错误帧形状与稳定 `code`、断线不取消任务、
幂等回放、`STATE_*` 跨阶段键（尚未收敛——它们是真跨阶段数据，不是包装传值）。

### 2.2 顺带修掉的根因：域包初始化拉全应用

实施时暴露出一个被惰性导入掩盖的循环：`persister → patient_ai.initiative → session.cache →
modules.training/__init__ → router → chat → pipeline → persister`。根因是
`modules/training/__init__.py` **急切导入两个 router**，于是任何 `modules.training.<anything>`
导入都会连带装配整个应用，把局部环放大成全局环。

处置：域包 `__init__` 只保留入口地图（文档），不再导入子模块；挂载方 `main.py` 改为
`from modules.training.router import router` / `from modules.training.router.chat import router`。
修完后 `persister` 的顶层导入自动恢复（无需函数内导入兜底）。**新增域包时不要重犯**：
包初始化不得拉起整个应用。

### 2.3 验证

* 特征化测试先行：16 条用例覆盖阶段顺序、短路（不误判为错误帧）、PERSIST must-succeed vs
  SIDE_EFFECTS best-effort、SSE 错误帧形状与稳定 `code`、`STATE_*` 前写后读的身份不变；
  作者用 9 处临时变异证明"测试真的会失败"（`db40cd2f`）。
* 重构后同一批不变量改用新 seam（monkeypatch `runner.STAGES`）表达，并做变异验证。

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

### 3.5 认领语义已在真实库验证（2026-09-26）

本地无库，`FOR UPDATE SKIP LOCKED`、`make_interval`、部分唯一索引都无法用单元测试覆盖。
`backend/scripts/jobs_claim_probe.sh` 在**真实 Postgres** 上跑一次性 schema（结束即 DROP，
不碰应用表），7 项断言全部通过：

| 断言 | 结果 |
|---|---|
| 同一记录不得同时有两条活动评分任务（部分唯一索引 + `ON CONFLICT DO NOTHING`） | PASS |
| 并发认领：A 持有未提交事务时，B 的认领返回 0 行（无重复认领） | PASS |
| 租约过期：未耗尽尝试 → 退回 `pending`（可重领） | PASS |
| 租约过期：尝试耗尽 → 终态 `failed`（不再重领） | PASS |
| 失败退避：未耗尽 → `pending` 且 `available_at` 在未来 | PASS |
| 失败退避：耗尽 → 终态 `failed` | PASS |
| `available_at` 未到 → 不认领 | PASS |

任何改动认领 SQL 的提交都应先跑这个探针（它是该组件唯一能验证语义的手段）。
**尚未做的**：在宿主切换 `SCORING_EXECUTION=job`（需要一次发布窗口，把迁移
`c8e2a3b4d5f6` 与代码一起上线），以及容器拆分的启停决策（按宿主余量数据定）。

### 3.6 什么留在进程内（明确不做）

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
