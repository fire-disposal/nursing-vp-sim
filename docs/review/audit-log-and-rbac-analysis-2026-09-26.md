# 审计日志与 RBAC 现状分析 + 集成方案（2026-09-26）

> **输入**：维护者要求「审计日志的功能集成」与「RBAC 系统现状」两份可执行分析。
> **方法**：本次为**纯只读静态调查** —— ripgrep / sed 读代码、读 `openapi.json`、读既有文档。**未改动任何产品代码/配置/迁移/测试**，未跑 build/lint/test，未连数据库、未起服务。
> **基线**：仓库工作区（2026-09-26）。**注意**：撰写时工作区存在**他人未提交的改动**（`backend/modules/training/router/session_views.py`、`frontend/src/pages/TrainingSelect.tsx`、`backend/modules/training/record_sorting.py` 等，属训练记录排序相关工作），本文所有 `path:line` 均按**当时工作区的实际行号**给出；若这些文件再次变动，引用行号可能漂移，行号仅作定位起点、以符号名（函数/常量名）为准。
> **未改动的证明**：`git status --short` 中本任务只新增 `docs/review/audit-log-and-rbac-analysis-2026-09-26.md` 一个文件，其余改动均非本次产出。
> **证据口径**：每条结论带 `path:line`；区分**已实现 / 部分实现 / 缺失**；推测一律标 `[INFERENCE]`。
> **严重度口径**（沿用 [`ui-audit-2026-09-26.md`](ui-audit-2026-09-26.md)）：**P0** 功能整体失效/可被合法自毁且无自救路径；**P1** 明确功能缺陷或口径不一致；**P2** 一致性脆弱、可观测缺失、双维护；**P3** 死代码与清理。
> **成本口径**：**S** ≤半天（单文件级）· **M** 1–3 天（跨文件或需决策）· **L** >3 天。
> 编号：`AL-` 审计日志域 · `RB-` RBAC 域 · `A*` 集成切片。

---

## 0. 结论先行

### 0.1 审计日志：**功能整体缺失**，现有"日志"不具备审计能力

后端**没有**任何审计表、审计模型、审计查询端点或审计页面（§1.1 证据）。所谓"已经记了日志"，实际链路是：

```
业务代码 log.info(..., extra={"user_id": ...})
   → root logger → StreamHandler(stderr)                 ← 唯一出口
   → docker json-file (10m × 3 ≈ 30MB/容器)              ← 唯一落地
```

三个致命细节使这条链路**不构成审计**：

1. **`extra` 根本不会出现在输出里**。`backend/infra/logging_setup.py:33` 的 format 是 `"%(asctime)s.%(msecs)03d %(levelname)s %(name)s %(message)s"` —— 没有任何 `%(user_id)s` / `%(action)s` 占位符，`extra` 被 Formatter 静默丢弃。即当前 **53 处** `extra={...}`（`rg -o "extra=\{" backend/ -g '!backend/\.venv' -g '!backend/tests' | wc -l` → 53）在实际输出中**一个字段都看不到**；「谁做的」不可能从日志里读出来。
2. **唯一的文件级持久化只收 ERROR+，且同样丢 extra**。`backend/infra/diagnose.py:87-91` 的 `ErrorCaptureHandler` 硬编码 `level=logging.ERROR`；`backend/infra/diagnose.py:74-85` 的 `ErrorEntry.as_dict()` 只序列化 `fingerprint/level/logger/message/first_seen/last_seen/count`。业务审计（`log.info`）永远不会进 `backend-errors.jsonl`。
3. **无 request_id 可关联**。`backend/modules/qa/router/endpoints.py:121,173` 读取 `request.state.request_id`，但**全仓没有任何赋值点**（`rg -n "request_id" backend/ -g '!backend/\.venv'` 只命中测试与训练工具的 `request_id` 幂等键）→ 恒为 `None`。

**最关键的 3 个缺口**（完整清单见 §1.5）：

| # | 缺口 | 证据 |
|---|---|---|
| ★1 | **权限/角色变更零痕迹**：`backend/modules/admin/roles.py` 全文件无 `import logging`、无任何日志调用；改权限集合是本系统最需要被审计的事件，且它能让审计系统自己被静默降权 | `rg -c "import logging" backend/modules/admin/roles.py` → 0；§2.4 RB-2 |
| ★2 | **导出/下载全体零痕迹**：**10 个**导出端点无一处记录"谁导出了什么、多少行、什么筛选" | `backend/modules/admin/exports.py:68,99`（`import logging` 有、`log.*` 调用 **0 处**）；`backend/modules/admin/users.py:714`、`admin/roles.py:222`、`admin/llm_monitor.py:408`、`admin/costs.py:387`、`cases/router.py:229`、`assignments/router.py:201`、`questionnaires/router.py:197`、`feedback/router.py:111`（枚举命令：`rg -n "@router\.(get\|post)\(.*export" backend/modules/` + `admin/exports.py` 的两个无 `export` 字样的路由） |
| ★3 | **`user_manage` 可停用/删除 `super_admin`，且系统无"最后一个超级管理员"保护** —— 可把系统推到"无人持有 `role_manage`/`api_manage`"的状态，重启也不恢复（`backend/seed.py:85-86` 在 `roles` 非空时直接 return），只能直连数据库救 | `backend/modules/admin/users.py:219-222`（停用）、`:261-274`（删除）均无 `_assert_role_within_scope`；`rg -in "最后一个\|last.*super" backend/` 零命中 |

### 0.2 RBAC：判定路径合格，变更面与可见性有洞

**做得好的部分**（不要重做）：单一权限词表（`backend/core/permissions.py:21-39`）+ import 期校验（`backend/core/roles.py:59-61`）+ 前端词表自动派生与 CI 漂移门禁（`.github/workflows/commit-format.yml:203-210`）；每请求从 DB 校验 `is_active`/`token_version`（`backend/core/security.py:73-79`）；`require_permission` fail-closed 且**无 super_admin 硬编码旁路**（`security.py:121-128`）；"不得授予自身没有的权限"的反提权口径已实现且被回归测试锁定（`backend/modules/admin/users.py:183-189`、`admin/roles.py:111-118`、`backend/tests/admin/test_user_privilege_guard.py`）。

**问题**（完整清单见 §2.4）：`P0` 停用/删除缺 scope 检查 + 无最后管理员保护（RB-1）；`P1` 权限变更零审计（RB-2）、权限缓存跨 worker 最长 60s 陈旧（RB-3）、前端权限最长 24h 陈旧（RB-4）；`P2` 前后端门禁错配 3 处 + 缺 `audit_view` 等粒度（RB-5/6/7）。

### 0.3 建议的第一步切片

**A1（审计底座，M）+ A2（高风险面接入 + RB-1 补丁，S）同批交付**——收益最大：① RB-1 是 P0，且它的修法只需在 `users.py` 两个分支各加一行 `_assert_role_within_scope` + 一个"最后管理员"守卫；② 权限变更记录是"审计系统不被静默降权"的前提，缺了它后面所有审计都建立在可被篡改的地基上；③ 底座建好后，A3–A6 全部复用。详见 §3.7。

---

## 一、审计日志现状

### 1.1 数据模型与表：**缺失**

- **无审计模型**：`backend/models/__init__.py:1-72` 是全部模型的权威清单（`Role/RolePermission/User/Assignment/Case/CaseRevision/Feedback/Job/ApiSecret/LLMCallLog/Notification/SystemNotification/QARecord/QASession/Questionnaire*/RateLimitEntry/Class/ClassMembership/SimulationSession/Message/NursingRecord/Score/ScoreReview/TrainingAction/TrainingRecord/TrainingSessionState/.../VoiceCallLog/VoiceConfig`），**没有任何 `AuditLog` / `OperationLog` / `ActivityLog`**。
- **无对应迁移**：`backend/migrations/versions/ddl/` 62 个文件、`backend/migrations/versions/data/` 15 个文件中，`create_table` 名字含 `log` 的只有 `llm_call_logs` 与 `voice_call_logs`（`backend/models/llm.py:45-46`、`backend/models/voice.py:39-40`）。
- **`logs/audit.log` 是陈旧残留，不是功能**：`.gitignore:36` 忽略 `logs/`；`rg -n "audit\.log" --hidden --no-ignore .`（排除 `node_modules` / `.venv`）**零命中** → 当前代码库中**没有任何写入方**。该文件现存一行内容为 `{"ts": "...", "level": "INFO", "msg": "GET /api/admin/api/providers → 401 (1ms)", "request_id": "86764764", "client_ip": "testclient"}`，`client_ip` 为 `testclient`，即一次 TestClient 调用留下的产物。`[INFERENCE]` 该文件来自一个已被移除的 access-log 尝试（其格式含 `request_id`/`client_ip`，与本仓库现存任何日志格式都不同——`backend/main.py:286-290` 的格式是 `"%s %s → %d [%dms]"`，无 JSON、无这两个字段）。
- **`TrainingAction` 不是本议题所指的审计日志**：`backend/models/training.py:193-195` 的 docstring 自称「Immutable operation audit log」，但它是**单次训练会话内学生动作**的域时间线 + RPC 幂等表（`UniqueConstraint("record_id","request_id", name="uq_training_action_record_request")`，`backend/models/training.py:197-201`），作用域锁死在 `record_id` 内，不覆盖任何管理面动作。不要把它当成审计基础设施。

### 1.2 现在记了什么、记到哪：**部分实现（只在应用日志，且字段不可见）**

**分层事实**：

| 层 | 位置 | 落地 | 是否含操作者 | 是否含 target | 可检索 |
|---|---|---|---|---|---|
| 应用日志（唯一出口） | `backend/infra/logging_setup.py:25-55`（root → StreamHandler(stderr)） | docker json-file | 代码里有 `extra={"user_id":...}`，**但 format 无占位符 → 输出中不存在**（`:33`） | 多数只在 `message` 字符串里 | ❌ 无结构化字段、无按用户检索 |
| 错误档案 | `backend/infra/diagnose.py:30` → `/app/data/diagnostics/backend-errors.jsonl` | 卷 `ai_vp_diagnostics`，5MB × 3 | ❌ 只收 ERROR+，`emit` 丢 extra（`:74-85, :97-99`） | ❌ | 只有 `/api/diagnose` token 查询，按指纹聚合 |
| 请求级中间件 | `backend/main.py:276-292` | stderr | ❌ 只有 method/path/status/ms | path 里含 id | ❌；同时喂给进程内 metrics（`infra/metrics.py:44-56`） |
| 领域异常 | `backend/core/exceptions.py:129-138` | stderr | ❌ 无 user_id | path 里有 | ❌ |
| **真正落 DB 的行为记录** | 见下 | 表 | ✅ | ✅ | ✅（各自模块的接口） |

**真正落库的五处**（这是全仓仅有的"可事后追责"数据）：

| 记录 | 位置 | 覆盖范围 |
|---|---|---|
| `llm_call_logs`（含 `user_id`/`record_id`/`purpose`/tokens/cost） | `backend/models/llm.py:45-80`；写入 `backend/infra/llm/logging.py:96+` 的 `LogWorker`（asyncio.Queue 批量、2s/20 条 flush、字节与条数双预算、超预算**丢最旧**、溢出落 JSONL） | 所有 LLM 调用 |
| `voice_call_logs`（含 `user_id`/`record_id`/`status`/`cost`） | `backend/models/voice.py:39-58` | 所有 TTS 调用 |
| `case_revisions.created_by` | `backend/models/case.py:109-110`；写入 `backend/modules/cases/revisions.py:61` 的 `append_revision` | 病例**内容**修订的作者 |
| `score_reviews.reviewed_by` | `backend/models/training.py:168`；写入 `backend/modules/training/router/score_review.py` | 评分复核的作者 |
| `system_notifications.created_by` | `backend/models/notification.py:30`；写入 `backend/modules/admin/system_notifications.py:41-47` | 系统通知的创建者（**改/删无记录**） |

**5 个代表性业务写入点**（全部只在应用日志、全部带着一个输出中不存在的 `extra`）：

1. **登录成功/失败**：`backend/modules/auth/service.py:74-86`。失败路径 `:77` 的 `extra={"action": "login_failed"}` 里**既无 IP 也无 user_id**（username 在 message 里）；`action` 字段在全仓只有 10 处（`rg -o '"action": "[a-z_]+"'` 计数）。
2. **用户更新/删除/批量导入/批量分班**：`backend/modules/admin/users.py:733-741`（update）、`:748-756`（delete）、`:758-766`（batch）、`:768-777`（bulk-assign）。只有汇总信息（如 `created=3 skipped=2`），**无字段级 diff**，无法回答"把谁从什么角色改成了什么"。
3. **角色与权限 CRUD**：`backend/modules/admin/roles.py` —— **零日志**（无 `import logging`）。`create`(`:198-208`)、`update`(`:210-220`)、`delete`(`:238-241`) 全无痕迹。
4. **病例生命周期**：`backend/modules/cases/service.py:211`（创建）、`:247`（编辑）、`:272`（发布）、`:288`（归档）、`:303`（删除）有日志；发布被门禁拒绝另有一条 `:265` 的 `log.warning`；但 **`set_open`（学生可见性开关）无日志**（`cases/service.py:308`）。
5. **评分**：复核有日志（`backend/modules/training/router/score_review.py:109-112`）且落 DB（`score_reviews.reviewed_by`）；**`force=true` 重评零日志**（`backend/modules/training/router/scoring.py:226-301`）—— 而它会 `db.delete(old_score)` 并删掉已有 `ScoreReview`（`:281-282`），即**抹掉教师复核结果却无任何痕迹**。

**零日志的模块清单**（`rg -c "import logging"` = 0 且无 `log.*` 调用，逐文件核对）：`admin/roles.py`、`admin/classes.py`、`admin/class_memberships.py`、`admin/system_notifications.py`、`admin/rubrics.py`、`admin/stats.py`、`feedback/router.py`、`feedback/service.py`、`questionnaires/*`（3 个文件）、`cases/router.py`。另有 `admin/secrets.py`、`admin/exports.py`、`admin/versions.py` 定义了 `log` 但**一次都没调用**。

### 1.3 谁能读：**基本无读取面**

- **无审计查询端点**：`openapi.json` 规模 **119 条路径 / 146 个 operation**，其中 **134 个带 `"security": [{"HTTPBearer": []}]`、12 个不带**；`rg -c audit` → **0**；`rg "role_manage" openapi.json` → **0 命中**（权限真相只在 `core/security.py:121-128` 的 `Depends` 闭包里，**openapi 不含权限元数据**，scopes 恒为空数组）。119 条路径里没有任何审计/操作日志端点。
- **12 个免 Bearer 的 operation** 恰为公开/token 端点：`/api/auth/login`、`/api/admin/deploy-warning`(POST/DELETE)、`/api/deploy-status`、`/api/health`、**`/api/metrics`**、`/api/diagnose`、`/api/feedback/bot`(GET)、`/api/feedback/bot/{id}`(PATCH)、`/api/feedback/bot/{id}/reply`(PUT)、`/api/qa/section-text`、`/api/telemetry`。
- **无后台页面**：前端无审计页（`frontend/src/components/shell/navigation.tsx:111-300` 的 `APP_ROUTES` 无该项）。
- **无导出**。
- **现有可读的近似物**（都不是审计）：
  - `/api/admin/ops/diagnose`、`/api/admin/ops/dashboard`：`backend/modules/admin/ops.py:41-46, 64-69`，`require_permission("api_manage")`；返回错误分组/告警/业务计数。
  - `/api/diagnose?token=***`：`backend/infra/diagnostics.py:133-137`，query token 认证（非 RBAC）。
  - **`/api/metrics`：无任何鉴权**（`backend/infra/diagnostics.py:122-124`，`def metrics(request: Request)` 无依赖）。它经 `backend/main.py:291-292` 的 `metrics.record_request(...)` 暴露出**按路由的 4xx/5xx 计数**（`backend/infra/metrics.py:44-56` 的 `_request_by_route_status`，`_route_key` 会把路径段替换成 `:id`）。即"哪个端点被拒了多少次"是**公网可读**的（nginx `location /api/` 直接反代，`nginx.conf:100-125`），但**没有操作者、不持久、重启清零**。
  - **越权拒绝（403）本身**：`require_permission` 直接 `raise HTTPException(403)`（`backend/core/security.py:125-126`），走 Starlette 默认 handler，**不触发** `backend/core/exceptions.py:129-138` 的领域异常记录；只留下 `backend/main.py:288-289` 那一行 `"%s %s → %d [%dms]"`。→ 能回答"哪个接口被拒了几次"，不能回答"谁被拒了"。

### 1.4 保留与合规：**30MB 环形缓冲，无策略**

- **应用日志**：`deploy/docker-compose.prod.yml:10-14`（db）、`:53-57`（backend）、`:69-73`（frontend）统一 `driver: json-file`，`max-size: 10m` / `max-file: 3` → **每个容器约 30MB 滚动覆盖**。无集中收集（无 fluentd/loki/syslog 配置）。唯一查法见 `docs/09-operations.md:225-227, 332-334, 573`（`docker logs --tail`）。
- **诊断档案**：`backend/infra/diagnose.py:30-32` → `/app/data/diagnostics/backend-errors.jsonl`，5MB × 3 备份 ≈ 20MB；前端遥测 `FRONTEND_ERROR_ARCHIVE` 2MB × 2（`docs/ops/diagnostics.md:46-51`）；卷 `ai_vp_diagnostics` 跨容器重建存活（`deploy/docker-compose.prod.yml:44-45`；`docs/ops/diagnostics.md:30-32`）。
- **无 logrotate / 无 journald 外发 / 无对象存储归档**：`deploy/` 下没有任何日志轮转文件（`ls deploy/` 只有 backup/rollback/prune/nginx）；`rg -n "logrotate"` 零命中。备份侧倒是有成体系策略（`docs/ops/backup-restore.md` 的保留规则、`deploy/pre-deploy-backup.sh` 的 `prune`、`deploy/backup-audit.sh` 的预算审计）—— **审计日志可以复用这套模式**。
- **能否按"某个用户做了什么"检索**：**不能**。原因不是没日志，而是 ① 业务日志只到 stderr 且 `extra` 不渲染（§1.2 表）；② 唯一的字段化持久化只覆盖 LLM/TTS 调用与上面五处 `created_by`/`reviewed_by`。

### 1.5 缺口清单：当前**完全无痕**的高风险动作

按风险排序（"无痕"= 既无 DB 记录，也无可用日志字段）：

| 风险 | 动作 | 现状证据 | 现有最接近的记录 |
|---|---|---|---|
| P0 | **角色权限集合变更** | `admin/roles.py` 零日志（`update` `:210-220` → `replace_permissions` `:103-106`） | 无 |
| P0 | **角色创建 / 删除** | `admin/roles.py:198-208`、`:238-241` 零日志 | 无 |
| P0 | **用户停用 / 删除**（含 C 端"软删"） | `admin/users.py:219-222`、`:261-274` 只在外层有汇总 info（`:748-756`），无 target 角色、extra 不可见 | 无 |
| P1 | **用户角色变更** | `admin/users.py:733-741` 的 info 里**不含 new role** | 无 |
| P1 | **管理员重置他人密码** | `admin/users.py:213-216` 只有 400/403 分支，成功路径无记录 | 无 |
| P1 | **批量导入用户** | `admin/users.py:758-766` 只有计数 | 无 |
| P1 | **API 密钥增删改** | `admin/secrets.py:143/148/161` 零日志（`log` 定义未用） | 无 |
| P1 | **全部 10 个导出端点** | 见 §0.1 ★2 清单 | 无 |
| P1 | **评分强制重算（force）** | `training/router/scoring.py:226-301` 零日志，且会删除既有 `Score`/`ScoreReview` | 无 |
| P1 | **病例发布 / 归档 / 删除 / 可见性开关** | 有 info（`cases/service.py:272, 288, 303`）但 extra 不可见、无 DB；`set_open` 连 info 都没有 | `case_revisions.created_by` 只覆盖内容修订 |
| P1 | **登录失败与暴力破解** | `auth/service.py:77` 无 IP、无 user_id；**无账号级锁定**，只有 per-IP `10次/300s` 限流（`backend/core/rate_limits.py:91-97`） | 无（`RateLimitEntry` 行会被自我清理，`rate_limits.py:24-27`） |
| P2 | **反馈回复** | `backend/models/feedback.py:36-37`（模型文件 43 行）只有 `developer_reply`/`replied_at`，**无 `replied_by`**；`admin_name` 仅拼进用户通知正文（`feedback/service.py:238-245` 的 `Notification(body=...)`，`:243`） | 通知正文里那句 `f"{admin_name} 回复了..."` |
| P2 | **问卷模板 建/改/删 + 病例绑定** | `questionnaires/router.py:54/80/99/109` 零日志 | 无 |
| P2 | **班级与成员增删改** | `admin/classes.py`、`admin/class_memberships.py` 零日志 | 无 |
| P2 | **系统通知 改/删** | `admin/system_notifications.py:91/100/110` 零日志 | 仅创建有 `created_by` |
| P2 | **系统设置 / 提示词与版本管理** | `admin/versions.py` 是**只读归因**端点（`:119-120`），当前无写入面；一旦加入可写必须补审计 | 无 |
| P2 | **备份 / 恢复** | `deploy/db-restore.sh` 等运维脚本，无应用侧审计 | 脚本自身的 `logs/`（若有）——`[INFERENCE]` 未逐脚本核对 |

> 说明：上表"无痕"是就**应用可见、可检索**的层而言。`docs/ops/incident-*.md` 表明实际上出事时靠的是 `docker logs` + `/api/diagnose` 人工翻查——这正是要补的部分。

---

## 二、RBAC 现状

### 2.1 数据模型与权威定义

**表结构**（`backend/models/auth.py`）：

| 表 | 关键列 | 约束 | 行号 |
|---|---|---|---|
| `roles` | `id`, `name(20)`, `display_name(40)`, `is_system` | `UniqueConstraint("name")` | `:17-24` |
| `role_permissions` | `id`, `role_id`, `permission(40)` | `UniqueConstraint("role_id","permission", name="ix_rp_role_perm")`；`role_id` FK **CASCADE** | `:27-33` |
| `users` | `role_id` **NOT NULL**、`is_active`、`token_version`、`username` unique | `role_id` FK **RESTRICT**；+ `TimestampMixin`（`backend/models/_base.py:11-15`；注意它在 `models/` 而非 `core/database.py`，后者只有 `class Base` `:53-54`） | `:36-56` |

- **无 per-user 权限覆盖**：权限只能通过角色获得（`User` 无任何 permissions 列；`has_permission` 只读进程内快照 `models/auth.py:58-62`）。
- **`role_id` 不可为 NULL**，且 FK 为 `RESTRICT` → 结构上不存在"无角色用户"；但**不阻止"无 `role_manage` 持有者"**（见 RB-1）。
- **权限键的权威定义（单一真相）**：`backend/core/permissions.py:21-35` 的 `PERMISSIONS`（**14 个键**：`user_manage`, `role_manage`, `grade_class_manage`, `case_manage`, `training_access`, `score_review`, `stats_view`, `qa_access`, `llm_monitor`, `api_manage`, `assignment_manage`, `feedback_review`, `export_data`, `questionnaire_manage`）→ `:38` `PERMISSION_KEYS`、`:39` `PERMISSION_LABELS`。
- **角色→权限映射**：`backend/core/roles.py:3-49` 的 `SYSTEM_PERMISSIONS`（super_admin 全 14 键；admin 12 键（缺 `role_manage`/`api_manage`）；teacher 10 键；student 仅 `training_access`+`qa_access`），`:52-57` `SYSTEM_ROLES`，`:59-61` **import 期校验**未定义键即 `raise ValueError`。
- **前端生成物链路**：`backend/scripts/gen_permissions_ts.py:14-46` → `frontend/src/config/permissions.gen.ts`（头部 `DO NOT EDIT` 警告 `:29-30`）；CI 门禁 `.github/workflows/commit-format.yml:203-210`（重新生成 + `git diff --exit-code`）；本地等价 `package.json:34` 的 `check:api`；`pnpm run perm:generate` 已并入 `api:update`（`package.json:32-33`）。**注意**：`backend/core/permissions.py:4` 与 README 写的 `scripts/gen_permissions_ts.py` 是相对 `backend/` 的路径。
- **漂移风险实测**：键集/顺序/标签 **14/14 完全一致**，无单侧存在的 key，后端 `require_permission("...")` 字面量全集也恰好是这 14 个（24 个文件命中）。→ **键级漂移风险为 0**，这是本仓库做得最扎实的一环。

### 2.2 判定路径、缓存与前端对齐

**后端判定链**（一句话）：`HTTPBearer → get_current_user`（JWT HS256 解 `user_id`+`tv` → 查 DB 取 `User`+`role` → 校验 `is_active`/`token_version`）`→ _set_user_permissions`（把 `role_permissions` 塞进 `user._permissions_cache`）`→ require_permission(p)` 只读该快照，缺失即 403`。

| 环节 | 位置 | 事实 |
|---|---|---|
| token 组成 | `backend/modules/auth/service.py:31-35` | 只带 `user_id`/`role_id`/`role`/`tv`，**不含 permissions** |
| 认证 | `backend/core/security.py:60-82` | `:73` 每请求查 DB（`joinedload(User.role)`）、`:74` `is_active`、`:77-79` `token_version` 比对 → 停用/改密/登出立即生效，无需等 token 过期 |
| 权限读取 | `backend/core/security.py:21-29` | `load_role_permissions`：**进程内** `_permission_cache: dict[role_id → (expires_at, frozenset)]`（`:17`），**TTL = 60s**（`:18`） |
| 快照注入 | `backend/core/security.py:39-42` | `_set_user_permissions` → `User.set_permissions_cache` |
| 判定 | `backend/core/security.py:121-128` | `raise HTTPException(403, "权限不足")`；**fail-closed**（缓存缺失 → `models/auth.py:58-62` 返回 `False`） |
| **super_admin 旁路** | — | **不存在**。全仓无 `role.name == "super_admin"` 之类的硬编码判权；super_admin 只是"恰好拥有全部 14 键的普通角色"（`core/roles.py:4-19`）。✅ 这是好设计 |
| 缓存失效点 | `backend/modules/admin/roles.py:159` | **全仓唯一调用点**（`rg -n "clear_permission_cache"`：product code 仅此一处 + `tests/admin/test_user_privilege_guard.py:38,50`、`tests/auth/test_security_ext.py:94-96`）。`create`(`:120-137`)/`delete`(`:164-177`) **不失效**（新建无影响；删除角色的残留条目到 TTL 自然过期，无害） |
| 跨 worker | `Dockerfile.backend:22` | `uvicorn ... --workers ${UVICORN_WORKERS:-2}`，`deploy/docker-compose.prod.yml:46` 亦设 `UVICORN_WORKERS: ${UVICORN_WORKERS:-2}` → 进程内 dict **无法跨 worker 广播失效**，只能靠 60s TTL 兜底 |
| 显示与执行的口径差 | `backend/modules/admin/roles.py:99-101` | `get_permissions` 直读 DB，而 **判定走缓存** → 编辑页刚改完可能显示新值、执行仍是旧值（≤60s）`[INFERENCE：仅推断展示层，未实测]` |

**前端对齐**：

| 环节 | 位置 | 事实 |
|---|---|---|
| 路由门禁 | `frontend/src/components/RequirePermission.tsx:18-23` | 无权限 → `<Navigate to={fallback}>`，默认 `fallback="/home"`（`:13-17`）；**没有 403 页、没有提示** |
| 挂载 | `frontend/src/App.tsx:104-110` | 按 `r.permission` 条件包裹路由元素 |
| 侧栏过滤 | `frontend/src/components/Layout.tsx:130-133` | `NAV_ITEMS.filter(l => !l.permission \|\| permissions.includes(l.permission))`；`SidebarNav`/`BottomTabBar` 内无权限逻辑 |
| 导航唯一来源 | `frontend/src/components/shell/navigation.tsx:111-300`（`APP_ROUTES`，带 `permission`）、`:308-310`（`NAV_ITEMS` 派生） | 20 条带权限路由 + 6 条仅需登录；权限随路由继承，**只有一份映射表** |
| 前端权限来源 | `frontend/src/stores/authStore.ts:66,89-93,160` | 只来自登录/刷新的 `TokenResponse.permissions`；持久化到 localStorage `nursing-auth` |
| `/auth/me` | `backend/modules/auth/router.py:50-55` + `backend/schemas/user.py:32-45` | 返回 `UserBrief`，**无 `permissions` 字段** → 前端**没有**任何重新同步权限的通道 |
| 刷新节奏 | `frontend/src/stores/authStore.ts:26-33` | 定时器 **24h** 一次 `refreshAuth`；`refreshUser()`(`:112-144`) 不更新 permissions |
| 前端语义工具 | `frontend/src/utils/permissions.ts:6-16` | `STUDENT_TIER_PERMISSIONS={training_access,qa_access,stats_view}`；`isAdminPermissions` = 「持有任一非学生层权限」；不读 `user.role` |

### 2.3 变更面：端点、能力边界与自保护

**端点总表**（`backend/modules/admin/__init__.py:8` 前缀 `/api/admin`）：

| 端点 | 方法 | 权限 | 影响范围 | 自保护 |
|---|---|---|---|---|
| `/api/admin/roles` | GET | `role_manage`（`roles.py:182`） | 只读 | — |
| `/api/admin/roles` | POST | `role_manage` | 新建自定义角色（`is_system=False` 硬编码，`:132`），可任意设权限集合 | ✅ 未知键 400（`:111-114`）、越权授予 403（`:115-118`）、重名（`:128-131`） |
| `/api/admin/roles/{id}` | PUT | `role_manage` | 改 `display_name` + **全量替换权限集合**（`replace_permissions` `:103-106`；定向清缓存 `:159`） | ✅ 系统角色 403（`:150-151`）、越权/未知键同上 |
| `/api/admin/roles/{id}` | DELETE | `role_manage` | 物理删除（级联删 `role_permissions`） | ✅ 系统角色 400（`:168-169`）、有用户引用 400（`:170-172`）；并发窗口靠 FK `RESTRICT`→`unit_of_work`→409（`core/unit_of_work.py:19-27`） |
| `/api/admin/roles/export` | POST | `role_manage` | 只读 | — |
| `/api/admin/users/{id}` | PUT | `user_manage` | 改角色、重置密码、姓名/学号/性别/头像、**启用停用**、全量替换班级成员 | ⚠️ 见下 |
| `/api/admin/users/{id}` | DELETE | `user_manage` | 物理删除 | ⚠️ 见下 |
| `/api/admin/users/batch` | POST | `user_manage` | 批量建号（仅 `student`，`:412-413`；上限 `BATCH_USER_LIMIT`） | ⚠️ 无 scope 检查（今天不可利用） |
| `/api/admin/users/bulk-assign-class` | POST | `user_manage` | 批量加成员关系（`:491-506`） | ⚠️ `member_role` 无白名单（`:768-777`） |
| `/api/auth/register` | POST | `user_manage` | 建号（仅 `student`/`teacher`，`auth/service.py:93-94`） | ⚠️ 无 scope 检查（今天不可利用） |
| `/api/admin/users/export` | POST | `user_manage` | 只读 | — |
| `/api/admin/stats` | GET | `stats_view`（`users.py:780`） | 只读 | — |
| `/api/admin/deploy-warning` | POST/DELETE | **无 RBAC**，`token` query（`infra/diagnostics.py:72-89`） | 进程内横幅 | ⚠️ 非 RBAC 体系（不写角色/权限，影响小） |

**已实现的自保护**（有回归测试锁定，`backend/tests/admin/test_user_privilege_guard.py`）：

| 保护 | 位置 |
|---|---|
| 不能修改自己的角色 | `users.py:201-202` → 400 |
| 不能停用自己的账号 | `users.py:220-221` → 400 |
| 不能删除自己 | `users.py:262-263` → 400 |
| 不能授予自身权限集合外的角色 | `users.py:183-189` + 调用 `:208` → 403（注释明示该意图 `:206-207`） |
| 不能重置权限高于自己账号的密码 | `users.py:213-216` → 403 |
| 不能改/删系统角色 | `roles.py:150-151`、`:168-169` |
| 造不出超出自身权限的角色来借道 | `roles.py:111-118` + `_grantable`（`:185-186`） |
| 无 impersonate / sudo / dev 后门 | `rg -i "impersonate\|sudo\|backdoor\|dev_only"` 在 `modules/admin`、`modules/auth`、`core/` **零命中** |

### 2.4 现状问题（按风险排序）

#### RB-1（P0）`user_manage` 可停用/删除高权限账号，且无"最后一个超级管理员"保护

`UserService.update` 对**改角色**与**重置密码**都做了 `_assert_role_within_scope`（`users.py:208`、`:215`），但对**停用**（`:219-222`）与**删除**（`:261-274`）**完全没有**同等检查——只判"不能操作自己"。后果：

1. 持有 `user_manage` 的角色（当前 = `admin`，`core/roles.py:20-32`）可以 `PUT /api/admin/users/{super_admin_id}` + `{"is_active": false}` 停用超级管理员；下一次该账号请求即 401（`core/security.py:74`）。
2. 同一角色可以 `DELETE /api/admin/users/{super_admin_id}`（只要目标无 `TrainingRecord`，`:269-273`）。
3. **无全局兜底**：全仓没有"最后一个 `super_admin` / 最后一个 `role_manage` 持有者"守卫（`rg -in "最后一个|last.*super"` 在 `backend/` 零命中；`roles.py` 无相关分支）。`super_admin` **角色行**本身删不掉（`roles.py:168-169`），但**用户**可以删/停。
4. **重启不恢复**：`backend/seed.py:85-86` 在 `roles` 表非空时直接 `return`，种子管理员（`:113-121`）只在该表为空时创建 → 一旦失去全部 `super_admin` 用户，`role_manage`/`api_manage` 能力**只能直连数据库恢复**。

这条与审计直接相关：能看审计的人只有一个角色，而这个角色可以被 `admin` 合法地"消灭"。

#### RB-2（P1）权限/角色变更零审计 → 审计系统可被静默降权

`admin/roles.py` 无任何日志；`RolePermission` 的写操作全清单只有 `roles.py:104/106/136`（HTTP）、`seed.py:107/109`（仅空表时）、以及两个 data 迁移（`backend/migrations/versions/data/mreipemggvlq_resync_system_role_permissions.py`、`a35d80cbe22c_remove_record_notes_permission.py`）。→ 改权限集合后**没有任何记录**说明"谁、什么时候、把哪个角色的哪几个权限改成了什么"。这是本议题的第二大缺口。

#### RB-3（P1）权限缓存一致性：跨 worker 最长 60s 陈旧

`_permission_cache` 是**进程内** dict（`core/security.py:17`），失效只有 `roles.py:159` 一处单进程调用，而 `Dockerfile.backend:22` 跑 `--workers 2`。→ 同一次权限变更，另一个 worker 最长 60s 仍按旧权限判定。`[INFERENCE]` 未实测线上表现，但代码路径是确定的。次要：`get_permissions`（`roles.py:99-101`）直读 DB 而判定走缓存，展示与执行存在同量级时差。

#### RB-4（P1）前端权限最长 24h 陈旧

权限只在登录/刷新时进入前端（`authStore.ts:66,89-93`），`/auth/me` 不返回 permissions（`schemas/user.py:32-45`），定时刷新 24h（`authStore.ts:26-33`）。→ **降权后侧栏仍显示旧菜单**（点了 403）；**升权后最长 24h 看不到新菜单**。后端每请求实时校验，所以这是 UX/可用性问题，不是越权（但会被用户读成"系统坏了"）。

#### RB-5（P2）前后端门禁错配 3 处

1. `/admin`（教学看板）前端要 `score_review`（`navigation.tsx:230`），页面实际调 `GET /admin/stats`（`pages/admin/dashboard/TeachingDashboard.tsx` → `api/admin/users.ts:9`）**要 `stats_view`**（`admin/users.py:780`）→ 自建"只有 `score_review`"的角色能进页面但统计区 403。系统角色因 admin/teacher 两者都含，不触发。
2. `export_data` **前端零消费**（`rg` 在 `frontend/src` 只命中生成文件 `permissions.gen.ts:17,78`），后端只在 `assignments/router.py:204`、`questionnaires/router.py:200`（`Depends`）与 `admin/exports.py:23,60`（服务内 `has_permission`）三处使用它 → 无 `export_data` 的角色看不到任何差别，却会在其余 6 个导出入口点到 403（那些入口用模块权限）。
3. `/admin/records` 前端要 `score_review`（`navigation.tsx:244`），后端 `GET /api/training/records` 只要求登录、`score_review` 在 handler 内软降级（`training/router/session_views.py:102-104` 的端点只 `Depends(get_current_user)`；`:128`、`:259`、`:314` 用 `has_permission("score_review")` 决定"只看自己"还是"看全部"）→ 前端**严于**后端契约（可接受，但两套口径需要显式记录）。

#### RB-6（P2）系统角色上仍渲染"编辑权限"按钮

`frontend/src/pages/admin/RolesPage.tsx:211` 对 `is_system` 角色同样渲染编辑按钮（只有删除按钮按 `!is_system` 隐藏，`:213-216`），后端必然 403（`roles.py:150-151`）→ 用户点击后拿到"保存失败"toast。同时 UI **无**"你正在改自己所属角色 / 会失去哪些权限"的提示（自我降权在 UI 上不可见）。

#### RB-7（P2）权限粒度缺口

无 `audit_view`/`audit_export`（本研究要补）；`export_data` 的语义已漂移——**10 个导出端点里只有 4 个受 `export_data` 把关**（`assignments/router.py:204`、`questionnaires/router.py:200` 用 `Depends`；`admin/exports.py:23,60` 用服务内手写 `has_permission`），其余 6 个各用模块权限（`admin/users.py:714`→`user_manage`、`admin/roles.py:222`→`role_manage`、`admin/llm_monitor.py:408`→`llm_monitor`、`admin/costs.py:387`→`llm_monitor`（`costs.py:369`）、`cases/router.py:229`→`case_manage`（`:38`）、`feedback/router.py:111`→`feedback_review`）。→ **无法表达"只能导出、不能管理"或"只能看审计、不能导出"**这两类角色。

#### RB-8（P2）非 RBAC 的保护面

`/api/metrics` 无鉴权（`infra/diagnostics.py:122-124`）且暴露按路由的 4xx/5xx 计数（`infra/metrics.py:44-56`）——对"被拒访问"的**外部可观测性**，与审计读权限的口径不一致；`/api/admin/deploy-warning` 与 `/api/diagnose` 用 token 而非 RBAC（`infra/diagnostics.py:72-89, 133-137`）。

#### RB-9（P3）条件性提权与数据质量

`register`（仅 `student`/`teacher`）与 `batch_create`（仅 `student`）**无 scope 检查**。当前 `user_manage` 只属于 `super_admin`（其 grantable 覆盖全部 14 键，含 teacher/student 的全部权限）→ **今天不可利用**；但若将来创建"只有 `user_manage`、不含 teacher/student 全部权限"的自定义角色，该角色可自行建 `teacher` 账号并知晓密码 = 相对自身的垂直提权。`[INFERENCE]`。另有 `bulk_assign_class` 的 `member_role` 无白名单校验（`users.py:768-777` → `:491-506`），属数据质量。

---

## 三、集成方案

### 3.0 设计原则（先立约束，再谈方案）

1. **沿用本仓既有约定**，不新立范式：迁移分 `ddl/`（禁 `op.execute()`）与 `data/`（需 `# Manual override reason: data_only`，见 `AGENTS.md:68`、`docs/03-database.md:151`）——两个目录由 `backend/alembic.ini:52-54` 的 `version_locations` 同时搜索，**当前唯一 head 是 `d9f3b4c5e6a7`**（`backend/migrations/versions/ddl/d9f3b4c5e6a7_add_context_policy_version.py:19-20`；`docs/ops/incident-2026-09-26-deploy-silent-truncation.md:53,57` 佐证）；列表/导出共用「`@dataclass XFilters` + `Depends()` + 服务层唯一入口 `list_filtered` + `MAX_EXPORT_ROWS + 1`」；前端 `useListFilters` + `OpenAPI` 派生参数类型；生成物（`*.gen.ts`）**禁止手改**（`AGENTS.md:69`）。
2. **审计写入必须与业务变更同事务**（成功路径）；**拒绝/失败路径走独立 session**。理由见 §3.2。
3. **审计记录只追加**：模型无 `updated_at`、无任何 update/delete 代码路径、DB 层再加一道（§3.1）。
4. **权限变更自身必须被审计**（否则整个审计系统可被静默降权）；**新增权限键必须走"改 `core/permissions.py` → 重新生成前端词表"的既有链路**。
5. **PII 最小化**：只记标识与变动，不记密码/密钥明文/病例正文/患者自由文本。既有隐私条款见 `docs/ops/diagnostics.md:183-185`。

### 3.1 数据模型：`audit_logs`

**表结构建议**（`backend/models/audit.py`，模型放入 `models/__init__.py` 的清单与 `__all__`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `id` | `BigInteger` PK | 审计量会远超其他表，用 BIGSERIAL |
| `created_at` | `DateTime(timezone=True) NOT NULL` | 事件时间；复用 `backend/models/_base.py:7-8` 的 `_now_utc` 作 Python 侧默认（**但不引入 `updated_at`** → 不用 `TimestampMixin` `:11-15`）；DDL 侧 `server_default=sa.text("NOW()")` |
| `actor_id` | `Integer NULL` FK `users.id` **ON DELETE SET NULL** | 操作者；用 SET NULL 而非 CASCADE：**删用户不能连带删掉它的审计** |
| `actor_username` | `String(50) NULL` | 快照（ID 被 SET NULL 后仍可读） |
| `actor_display_name` | `String(50) NULL` | 快照 |
| `actor_role` | `String(20) NULL` | 角色名快照（`role_id` 会变，角色名更稳定） |
| `action` | `String(64) NOT NULL` | 枚举字符串，常量集中在 `core/audit.py`（与 `core/permissions.py` 同思路） |
| `target_type` | `String(32) NOT NULL` | `user` / `role` / `case` / `score` / `secret` / `export` / `session` / `config` |
| `target_id` | `String(64) NULL` | **字符串**：目标可能是 int id、username、或复合键（如 `questionnaire:12`） |
| `target_label` | `String(120) NULL` | 人类可读名（username / 病例名 / 角色显示名），避免查询时 join 已删除行 |
| `outcome` | `String(16) NOT NULL` | `success` / `denied` / `failure` |
| `payload` | `JSONB NOT NULL DEFAULT '{}'` | `before`/`after` 或关键字段（如 `{"before":["a","b"],"after":["a"]}`、`{"rows":1234,"filters":{...}}`）；遵守 PII 最小化 |
| `error_detail` | `String(500) NULL` | 失败摘要（截断） |
| `request_id` | `String(64) NULL` | 需先补 request-id 中间件（§3.2） |
| `ip` | `String(64) NULL` | 取值复用 `core/rate_limits.py:76-90` 的 `get_client_ip`（**同一套信任模型**，不要另写一份） |
| `user_agent` | `String(255) NULL` | 截断 |
| `request_method` / `request_path` | `String(10)` / `String(200)` NULL | 便于与 access 日志交叉验证 |

**索引**（命名沿用本仓 `ix_*` 风格，参考 `models/auth.py:29`、`models/voice.py:41-45`）：

- `ix_audit_logs_created_at`（`created_at`）— 时间范围主扫；写入量大时可改 `BRIN`。
- `ix_audit_logs_actor_created`（`actor_id, created_at DESC`）— 「某人做了什么」。
- `ix_audit_logs_action_created`（`action, created_at DESC`）— 「某类操作」。
- `ix_audit_logs_target`（`target_type, target_id`）— 「某对象被谁动过」。
- `ix_audit_logs_outcome_created`（`outcome, created_at DESC`）— 拒绝/失败面板；可退化为 `WHERE outcome <> 'success'` 的部分索引。

**只追加（append-only）如何保证**（三层，缺一层都不算）：

1. **代码层**：模型无 `updated_at`；`core/audit.py` **只暴露 `record()`**，不提供 update/delete；`AuditLogService` 只有查询（`_filtered_query` / `list_filtered` / `list_all`）。
2. **守卫测试**：仿本仓对迁移的"目录级禁令"惯例（`AGENTS.md:68`），加一条测试断言 `rg "AuditLog" backend/modules` 不存在 `db.delete(...)`/`update(...)` 用法；以及断言 `AuditLog` 无 `updated_at` 属性。这条测试比注释可靠。
3. **DB 层**：**当前做不到**——backend 用 `nursing` 这个库 owner 连接（`deploy/docker-compose.prod.yml:13, 46`），owner 无法对自己 `REVOKE UPDATE, DELETE`。两条可行路径：
   - (a) 新建受限角色 `nursing_app`（对 `audit_logs` 仅 `INSERT, SELECT`），backend 改用该角色 + 对旧表授权 → 成本最高但最彻底；
   - (b) 在 `audit_logs` 上装 `BEFORE UPDATE OR DELETE` 触发器 `RAISE EXCEPTION`。按 `AGENTS.md:68` 的目录纪律，`op.execute()` 属 `data/`，因此**触发器 DDL 要么放 `data/` 并带 `# Manual override reason: data_only`（脚手架见 `scripts/create-data-migration.js:28-52`），要么先明确放宽 `ddl/` 规则** —— 注意 `ddl/` 已有一处事实例外（`backend/migrations/versions/ddl/f4a5b6c7d8e9_drop_simulation_session_status.py:42-43` 写了 `op.execute("UPDATE ...")`），**不要把它当可效仿的先例**。
   推荐先 (b) 后 (a)：触发器当天可落地，且不引入连接凭据变更风险。

**迁移落位**：新建表 → `backend/migrations/versions/ddl/`。**建表模板用 `backend/migrations/versions/ddl/c8e2a3b4d5f6_create_jobs_table.py`**（`op.create_table` `:24-47` → 命名的 `sa.ForeignKeyConstraint(..., name="fk_jobs_record_id", ondelete=...)` `:45` → `op.create_index` `:49` → 部分唯一索引 `postgresql_where` `:51-56` → `downgrade()` 逆序 `drop_index`/`drop_table` `:59-62`）；若新表还要挂到既有表上加列，参考 `ddl/e5a1b2c3d4f5_expand_case_lifecycle.py:34-47`。约束/索引命名沿用本仓 `ix_*` / `uq_*` / `fk_*` / `ck_*`（`idx_*` 只在 `rate_limit_entries` 这个旧特例上出现，新表别用）；`server_default` 必须与模型声明**同形**（理由见 `ddl/a9d0c1b2e3f4_add_training_record_workflow_id.py:10-11`：让测试库 `create_all` 形状一致）；时间列统一 `DateTime(timezone=True)` + `server_default=sa.text("NOW()")`（`ddl/c8e2a3b4d5f6:39-40`）。触发器 → `.../data/`。

### 3.2 写入路径

**落点选择（推荐：服务层显式调用 + 同事务，不用装饰器/中间件自动记录）**

| 方案 | 取舍 |
|---|---|
| **服务层显式 `audit.record(db, ...)`（推荐）** | 能拿到语义（before/after、target 真身）；缺点是每个写入点要手写一行，且**可能漏写** → 用"必审事件清单 + 每条一测"覆盖（§3.3） |
| 装饰器（如 `@audited("role.updated")`） | 参数提取要从函数签名/返回值猜，`before` 需要额外读一次；对 `unit_of_work` 内的中途失败语义表达不清 |
| 中间件自动记录所有 mutation | ❌ 不推荐：无业务语义、无法可靠取 before、body 可能是流、会把 `POST /login`、`/api/chat/*` 这类高频非审计请求也卷进来 |
| UoW 集成（`unit_of_work` 里挂 hook） | 可以**作为补充**：在 `core/unit_of_work.py:19-27` 的 contextmanager 出口记录"已登记但未提交"的审计项，无法解决"忘了登记" |

**事务语义（这是最容易做错的地方）**：

- **成功变更** → 审计行与业务行**同一事务**（同一个 `db`，同一 `unit_of_work`）。这样二者原子：要么都提交，要么都回滚。代价是"业务回滚时也丢了审计"——但这正确：**没发生的变更不该留下"已发生"的审计**。
- **被拒绝/失败的尝试**（403、409、400、以及门禁拒绝）→ **必须独立 session**（`SessionLocal()`，参照 `backend/infra/llm/logging.py:96+` 的独立 session 模式）。否则业务 `db.rollback()` 会把"有人尝试越权"的证据一起回滚掉——而这恰恰是最需要留下的记录。
- **`before` 的取法**：在 `unit_of_work` 内部、**变更前**读取（如 `roles.py:154` 的 UoW 里、`replace_permissions` 之前调 `self.get_permissions(role.id)`），避免依赖 ORM 的脏状态追踪；也要避免"改完再读"（读不到旧值）。
- **不得使用会丢数据的异步队列**：`infra/llm/logging.py:102-105` 的 `LogWorker` 在超预算时**丢最旧条目**——那是 LLM 成本统计可接受的取舍，**审计不可接受**。若要异步，必须保证"队列满 → 业务失败"（fail-closed）而不是静默丢弃。因此 v1 建议**同步写**（审计写入是单行 INSERT，成本远低于业务本身的 LLM 调用）。

**与现有 `log.info(extra=...)` 的关系（推荐：并存但"以 audit_logs 为准"）**：

- 保留人读日志（运维 `docker logs` 排障仍需要它），但**不要指望它承担审计**。
- **顺手修一个真 bug**：`backend/infra/logging_setup.py:33` 的 format 让所有 `extra` 不可见，建议给 formatter 加 `defaults` 或改为输出 JSON（至少把 `user_id`/`action` 渲染出来）。否则现存 53 处 `extra={...}` 是**死代码**。
- 已接入审计的事件点，逐步把"审计性"字段从 `extra` 挪走；`extra` 只留排障用（如 `record_id`、`latency`）。
- 补 `request_id`：新增 ASGI 中间件生成 `request.state.request_id`（现在 `modules/qa/router/endpoints.py:121,173` 读取它，全仓无赋值点 → 恒为 `None`，是死读取）；生成后塞进审计行与 access 日志，实现「access 日志 ↔ 审计行」双向关联。中间件插入点：`backend/main.py` 现有 **4 个**中间件（`_log_requests` `:276-293`、`_limit_body_size` `:296-307`、`_request_timeout` `:310-318`、`CORSMiddleware` `:322-328`），Starlette 语义是「前插 + `reversed` 包裹」⇒ **最后注册者最外层**，当前执行序为 `CORS → timeout → body_size → log_requests → 路由`。推荐新中间件插在 `:318` 之后、`:322` 之前（CORS 之内、其余之外）。
- ⚠️ **关键约束**：HTTP 中间件**拿不到** `Depends(get_current_user)` 解析出的 `User` —— 依赖只在端点/子依赖内执行（`core/security.py:60-82`），且全仓**没有任何地方写 `request.state.user`**。所以：① 审计中间件若要 actor，只能自行解 JWT（复用 `security.py:60-82`，代价是重复一次 DB 查询）；② 更经济的做法是**由 `require_permission` 的 `checker` 顺带写入 `request.state.audit_actor`**（`core/security.py:121-128` 是唯一必然拿到 `User` 的 choke point），中间件只补 `request_id`/`ip`/`ua`（`core/rate_limits.py:76-90` 的 `get_client_ip`，沿用同一信任模型）。这样 §3.3 第 18 条（`access.denied`）几乎是白送的。

### 3.3 必审事件表（21 条，按风险排序）

| # | 风险 | 事件 | `action` | `target_type` | 需记录的关键字段 |
|---|---|---|---|---|---|
| 1 | P0 | 角色权限集合变更 | `role.permissions_changed` | `role` | `before`/`after` 权限数组（差集可读）、`target_id`、角色是否 `is_system` |
| 2 | P0 | 角色创建 | `role.created` | `role` | 初始权限集合 |
| 3 | P0 | 角色删除 | `role.deleted` | `role` | 被删角色的权限集合（回滚唯一线索） |
| 4 | P0 | 用户角色变更 | `user.role_changed` | `user` | `before`/`after` 角色名、`target_id` |
| 5 | P0 | 用户停用 | `user.deactivated` | `user` | 目标角色名、是否为最后一个 `super_admin`（便于事后判定） |
| 6 | P0 | 用户启用 | `user.activated` | `user` | 同上 |
| 7 | P0 | 用户删除 | `user.deleted` | `user` | 目标角色名、`training_record` 计数（当时是否 0） |
| 8 | P1 | 管理员重置他人密码 | `user.password_reset` | `user` | 目标角色名（**不记密码**） |
| 9 | P1 | 用户创建 / 批量导入 | `user.created` / `user.bulk_imported` | `user` | 单条：username+role；批量：`{created, skipped, errors[:N]}` |
| 10 | P1 | API 密钥创建/更新/删除 | `secret.created`/`updated`/`deleted` | `secret` | `secret_id`、`label`；**绝不记 `ApiSecret.api_key` 本体**；且当前**没有**可安全暴露的 key 尾号列（`api_secrets.key_suffix` 已在 `backend/migrations/versions/ddl/137329b7b43c_remove_fernet_plaintext_keys.py:9` 删除）→ 若要"可辨识是哪把 key"，需另加一个只存后 4 位的列，而不要退化成记明文；其余 `before/after` 仅限 `label`/`base_url`/`status`/限额类字段 |
| 11 | P1 | 导出/下载 | `export.downloaded` | `export` | `endpoint`（或 `resource`）、`format`、`rows`、`filters` 快照、`truncated`（是否命中 `MAX_EXPORT_ROWS`） |
| 12 | P1 | 评分强制重算 | `score.rescore_forced` | `score` | `record_id`、`before`（旧总分/是否有教师复核）、`force=true` |
| 13 | P1 | 评分复核（含改分） | `score.reviewed` | `score` | `record_id`、`before`/`after` 总分、是否有评语（不记评语正文） |
| 14 | P1 | 病例发布 | `case.published` | `case` | `revision_no`、门禁结果（warnings 数）、是否首次发布 |
| 15 | P1 | 病例发布被门禁拒绝 | `case.publish_denied` | `case` | error 数/字段清单（`outcome=denied`） |
| 16 | P1 | 病例归档 / 删除 / 可见性开关 | `case.archived`/`deleted`/`visibility_changed` | `case` | `is_open` before/after；删除时 `training_count`、`assignment_count`（当时均为 0） |
| 17 | P1 | 登录成功 / 失败 / 限流 | `auth.login_succeeded`/`login_failed`/`login_rate_limited` | `session` | username（仅失败时）、`ip`、`user_agent`；失败不记密码 |
| 18 | P1 | 越权拒绝 | `access.denied` | `endpoint` | `required_permission`、`request_method/path`、`actor_id`、`ip`（**这是"谁被拒了"的唯一来源**） |
| 19 | P2 | 反馈回复（人工） | `feedback.replied` | `feedback` | `feedback_id`、是否覆盖（`overwrite`）、是否有历史回复；**需先加 `feedbacks.replied_by` 列** |
| 20 | P2 | 问卷模板 建/改/删 + 病例绑定 | `questionnaire.template_*`/`case_bound` | `questionnaire` | `template_id`、题目数、绑定病例清单 diff |
| 21 | P2 | 班级与成员变更 / 系统通知变更 | `class.*`/`class_member.*`/`system_notification.*` | `class`/`user`/`notification` | 用户清单 diff（批量时限 N 条示例 + 计数） |

> 另需登记（非 HTTP 面，走运维脚本）：**数据库备份/恢复**。建议在 `deploy/db-restore.sh`、`deploy/pre-deploy-backup.sh` 的出口写一行 JSONL 到 `backups/`，或在恢复后由运维手动补一条 `config.restored` 审计行（`[INFERENCE]`：未核对这些脚本当前的输出，需实现时确认）。

### 3.4 RBAC 集成

**新增权限键**（走既有链路：改 `backend/core/permissions.py:21-35` 追加 → `pnpm run perm:generate` / CI 自动校验 `frontend/src/config/permissions.gen.ts`）：

```python
PermissionDef("audit_view", "审计日志查看"),
PermissionDef("audit_export", "审计日志导出"),
```

**为什么拆两个键**：审计导出 = 把**全站操作者行为**（含其他管理员的行为）一次性拿走，敏感度高于"在页面上翻看"；且本仓已有"导出比查看更敏感"的先例（`export_data` 与 `stats_view` 分立）。**若想最小改动**：只加 `audit_view`，导出用现成的 `export_data` 守（`backend/modules/admin/exports.py:23` 已有 `has_permission("export_data")` 的写法可参考）。推荐前者。

**授予策略**：`SYSTEM_PERMISSIONS["super_admin"]`（`core/roles.py:4-19`）必须**手工追加**这两个键（该列表是硬编码，不是 `PERMISSION_KEYS` 的展开——**这是新增权限最常见的漏点**，且 `core/roles.py:59-61` 只校验"角色不越界"，不会提醒"super_admin 缺了新键"）。**`admin` 不建议授予 `audit_view`**：审计的用途之一就是监督 `admin`；且 `admin` 已可被审计（RB-1 修好后不再能自毁）。

**"权限/角色变更必须审计"的落点**（这是整个方案的承重墙）：

- `admin/roles.py` 的 `create`（`:120-137`）、`update`（`:139-162`，**在 `:154` 的 UoW 内、`replace_permissions` 之前抓 `before`**）、`delete`（`:164-177`）。
- `admin/users.py` 的 `update` 中 `role_id` 变更（`:200-209`）、`is_active` 变更（`:219-222`）、密码重置（`:210-216`）；`delete`（`:261-274`）；`batch_create`（`:382+`）；`bulk_assign_class`。
- `admin/secrets.py` 的 create/update/delete（`:143/148/161`）。
- **自锁守卫**：因为 `_grantable`（`users.py:179-181`、`roles.py:185-186`）已经保证"不能授予自身没有的权限"，`admin` **无法**通过创建角色或改角色给自己加 `audit_view` —— ✅ 这条无需额外实现。但要防的是 RB-1：`admin` 可以**间接消灭**唯一持有 `audit_view` 的账号 → **RB-1 必须与审计同批修复**，否则审计系统在权限模型上是不闭环的。

**审计页面自身的门禁**：`require_permission("audit_view")`（列表/详情）、`require_permission("audit_export")`（导出），并加一条前端路由：

```tsx
// frontend/src/components/shell/navigation.tsx 的 APP_ROUTES
{ path: "/admin/audit-logs", element: <AuditLogsPage />, permission: "audit_view", nav: ... }
```

`RequirePermission` 与 `Layout.tsx:130-133` 的过滤会自动生效（权限随路由继承，`navigation.tsx:308-310`）；`RolesPage.tsx:240-244` 的权限复选框用 `PERMISSION_DEFS` 渲染，**新键会自动出现**，无需改前端。

**审计日志自身的读取是否留痕**：推荐——**列表/详情查询不留痕**（否则高频翻页会淹没真正的业务事件，且会把"审计查看"变成噪声源），**导出必须留痕**（`audit.exported`，`target_type=audit`，记筛选快照与行数）。访问行为本身仍有 access 日志 + 未来的 `request_id` 可关联。

### 3.5 查询与呈现

**严格沿用 2026-09-26 定案的查询约定**（`docs/review/ui-improvement-plan-2026-09-26.md` §6.4），不另起范式。

**后端**（`backend/modules/admin/audit_logs.py`，router + service 同文件，与 `users.py`/`roles.py` 一致）：

```python
@dataclass(slots=True)
class AuditLogFilters:
    search: Annotated[str | None, Query(description="动作/目标/操作者模糊搜索")] = None
    action: Annotated[str | None, Query(description="动作类型，前缀匹配")] = None
    target_type: Annotated[str | None, Query()] = None
    outcome: Annotated[str | None, Query(pattern="^(success|denied|failure)$")] = None
    actor_id: Annotated[int | None, Query()] = None
    date_from: Annotated[str | None, Query()] = None   # 与 feedback/costs 的日期参数口径一致
    date_to: Annotated[str | None, Query()] = None


class AuditLogService:
    def _filtered_query(self, filters: AuditLogFilters): ...      # 谓词只写一次
    def list_filtered(self, filters, *, offset, limit): ...       # 列表与导出的唯一入口
    def list_all(self, filters, *, offset, limit) -> PaginatedView: ...


router = APIRouter(prefix="/audit-logs", tags=["审计日志"])
_Viewer = Annotated[User, Depends(require_permission("audit_view"))]
_Exporter = Annotated[User, Depends(require_permission("audit_export"))]  # 或 export_data

@router.get("", response_model=PaginatedResponse[AuditLogItem])          # ← /api/admin/audit-logs
def list_audit_logs(current_user: _Viewer, db: DbSession,
                    filters: Annotated[AuditLogFilters, Depends()],
                    offset: Annotated[int, Query(ge=0)] = 0,
                    limit: Annotated[int, Query(ge=1, le=200)] = 50): ...

@router.post("/export")
def export_audit_logs(current_user: _Exporter, db: DbSession,
                      filters: Annotated[AuditLogFilters, Depends()],
                      format: str = Query("csv", pattern="^(csv|xlsx)$")):
    # 取 MAX_EXPORT_ROWS + 1，超限由 infra/exporter.py:127-128 统一 400
    rows = AuditLogService(db).list_filtered(filters, offset=0, limit=MAX_EXPORT_ROWS + 1)
    ...  # ColumnDef + export_response(...)
```

- 注册：`backend/modules/admin/__init__.py:22-34` 的 `router.include_router(...)` 元组里加 `_audit_logs`（**无需改 `main.py`**；只有自带绝对前缀的 top-level router 才需要动 `get_top_level_routers()` `:46-50` 与 `main.py:349-370`）。`admin/ops.py:41-69` 是最接近的范式。
- **权限依赖形式要统一**：新端点用 `Depends(require_permission(...))`。注意本仓已有一处例外——`backend/modules/admin/exports.py:23,60` 是服务内手写 `has_permission("export_data")` + `raise AuthError(403)`；任何"权限扫描/守卫测试"必须同时识别这两种形式，否则会误判为"未保护"。
- 导出列建议：时间 / 操作者 / 角色 / 动作 / 目标 / 结果 / 摘要，`payload` 以 `json.dumps(..., ensure_ascii=False)` 折成一列（避免动态列）。
- `format` 参数：注意 §6.5 待办 3 已指出"四个导出端点重复声明 `format`"，新端点可顺带并入 DTO。

**前端**：

- `frontend/src/api/query-params.ts:9-22` 加 `export type AuditLogParams = ListQuery<"/api/admin/audit-logs">`（该文件已有 5 个域的别名，`:18-22`；OpenAPI 派生 → 后端改筛选键时前端是**类型错误**而不是静默失效）。
- 页面用 `useListFilters<AuditLogParams>(...)`（`frontend/src/hooks/useListFilters.ts:24-`；`params`/`exportParams` 同源 `:58-70`、`hasActiveFilters` `:73-78`、`reset` 同步复位防抖 `:97-104`）+ `components/ui/filter-toolbar.tsx` + `ExportButton`（照 `pages/admin/RolesPage.tsx:138` 的用法；现有 6 个使用点可作模板）。
- 筛选件：时间范围 `@mantine/dates`（已在 `ui-improvement-plan` 决策表里定案引入）、动作/目标/结果下拉（选项来自后端枚举或前端常量表，**不要手写第二份 action 词表**——建议由后端新增一个 `GET /api/admin/audit-logs/actions` 或把小词表也纳入 `permissions.gen.ts` 同款生成物，避免重演权限键漂移）。
- 详情：行展开或弹层展示 `payload`（JSON 美化）+ `request_id`（便于跳到 `docker logs` 检索）。

### 3.6 保留策略

| 维度 | 建议 | 理由/依据 |
|---|---|---|
| 热存 | **DB 保留 12 个月**（教育类数据，通常覆盖一个完整学年 + 学期复盘周期） | 与备份 `30 天` 保留（`docs/09-operations.md:242`、`docs/ops/backup-restore.md`）不同层级：备份是灾难恢复，审计是合规与追责 |
| 分区 | `PARTITION BY RANGE (created_at)` **按月**；到期 `DETACH PARTITION` 后导出再 `DROP` | 避免大表 `DELETE`（与 append-only 冲突：`DELETE` 是写操作，会破坏"只追加"的语义）；分区也让"查最近一周"只扫一个分区 |
| 若暂不分区 | `created_at` B-tree（或 BRIN）；清理走"归档到文件后再删"，且删除动作必须**由 DB owner 手工执行**，不进应用 | 与上面同因；`BRIN` 体积小、适合纯时间追加表 |
| 归档目标 | 复用备份链路：gzip JSONL 落 `backups/`（`deploy/backup-audit.sh` 已有磁盘预算审计与保留策略），或对象存储（本仓当前无 S3 配置） | 不引入新基础设施；`deploy/backup-audit.sh` 的"预算超限即告警"模式可直接复用 |
| 应用日志 | docker json-file `10m × 3`（`deploy/docker-compose.prod.yml:10-14/53-57/69-73`）。**审计事件走 DB 后，这层不必再扩容**；但建议顺手把 `extra` 渲染修好（§3.2） | 现在这 30MB 是"出事时唯一的现场"，但容量与字段都不足 |
| 清理循环载体 | 若要"遗忘"，复用既有后台循环：`backend/infra/bootstrap.py:222-229` 的 `settlement_loop`/`notification_publisher`（间隔来自 `core/config.py:129` 的 `CLEANUP_INTERVAL_SECONDS`）。**注意全仓 4 张日志型表（`llm_call_logs` / `voice_call_logs` / `training_actions` / `rate_limit_entries`）里只有 `rate_limit_entries` 有真清理机制**（`core/rate_limits.py:25-28` 的窗口 DELETE、`:56` 的 reset）；另外三张**无任何保留期/遗忘机制** —— 审计表不要重蹈这个覆辙 | 复用现成定时器比新起 cron 更稳，同时避免"日志表只增不减"的历史模式 |
| 错误/遥测档案 | 保持现状（`docs/ops/diagnostics.md:22-61`，5MB×3 / 2MB×2） | 与审计职责不同 |
| PII | `payload` 只放标识与变动；**禁止**密码/密钥/病例正文/患者自由文本/完整请求体；导出下载的审计只记 `rows`/`filters`，不记内容 | 沿用 `docs/ops/diagnostics.md:183-185` 的隐私条款；审计表若被导出，敏感度必须可控 |
| 备份一致性 | 注意周期备份会**排除 `llm_call_logs` 的行数据**（`deploy/db-backup.sh:124` 的 `--exclude-table-data=public.llm_call_logs`；`docs/ops/backup-restore.md:60,159`）。`audit_logs` **必须留在"包含行数据"的一侧**（即**不要**加进这个排除清单）—— 否则灾难恢复后建表语句在、审计历史全空 | 这是最容易搞错的一条：排除是按表名白名单式的，默认包含，但审计表体量与 `llm_call_logs` 同级，很容易被"顺手也排除掉" |

### 3.7 切片建议（按收益排序，含验收判据）

| 顺序 | ID | 目标 | 成本 | 验收判据（可观测） |
|---|---|---|---|---|
| **1** | **A1** | **审计底座**：`ddl/` 迁移建 `audit_logs` + 索引；`backend/models/audit.py` + `models/__init__.py` 登记；`backend/core/audit.py`（`record(db, ...)` 同事务 / `record_detached(...)` 独立 session；action 常量表）；`request_id` 中间件；`logging_setup` 让 `extra` 可见 | **M** | ① 迁移往返（`alembic upgrade head` → `downgrade -1` → `upgrade head`）干净，`ddl/` 文件内无 `op.execute()`；② 单测：在同一 `unit_of_work` 内 `record()` 后提交 → 表里有行；事务回滚 → **无行**；③ `record_detached` 在业务 rollback 后**仍有行**；④ 一次真实请求的响应头/日志里能看到 `request_id`，且审计行 `request_id` 与 access 日志一致；⑤ 守卫测试：`AuditLog` 无 `updated_at`、product code 无 `AuditLog` 的 update/delete 用法 |
| **2** | **A2** | **高风险面接入 + RB-1 补丁**：`roles.py` create/update/delete；`users.py` 角色变更/停用/启用/删除/密码重置/批量导入/批量分班；`secrets.py` CRUD。**同时**：`users.py:219-222` 与 `:261-274` 补 `_assert_role_within_scope`，并新增"不能停用/删除最后一个 `super_admin`"守卫 | **S** | ① 复用 `tests/admin/test_user_privilege_guard.py` 的 fixture 新增用例：`admin` 停用 `super_admin` → 403；`admin` 删除 `super_admin` → 403；删除/停用**最后一个** `super_admin` → 400/403；`super_admin` 之间的合法操作仍成功；② 每条变更产生恰 1 行审计，`before`/`after` 与实际改动一致（断言 DB 行内容，不是断言"函数被调用"）；③ 门禁拒绝路径写 `outcome=denied` 且**业务回滚后审计仍在** |
| **3** | **A3** | **可见性**：`audit_view`/`audit_export` 权限键 + `core/roles.py` 给 super_admin 追加；`admin/audit_logs.py` 列表与导出（沿用 §6.4 约定）；前端 `AuditLogsPage` + `navigation.tsx` 路由 + `query-params.ts` 类型 | **M** | ① `pnpm run check:api` 干净（`permissions.gen.ts` 与 `api-types.gen.ts` 均已重生成，无 diff）；② 无 `audit_view` 的角色访问 `/api/admin/audit-logs` → 403、前端被 `RequirePermission` 重定向；③ 筛选键只存在于后端 DTO（列表与导出都注入同一 `Depends()`），导出参数类型从 OpenAPI 派生；④ 筛选 N 条 → 导出结果与列表同集；⑤ 导出超 `MAX_EXPORT_ROWS` → 400（`infra/exporter.py:127-128`）；⑥ 导出产生 1 行 `audit.exported`，列表翻页**不**产生行 |
| **4** | **A4** | **导出与越权留痕**（半天级，覆盖面最广）：10 个导出端点统一记 `export.downloaded`；`require_permission` 的 403 记 `access.denied` | **S** | ① 真实下载一次用户列表 → 1 行含 `rows`/`filters`/`format`；② `admin` 访问一个需要 `api_manage` 的端点 → 1 行 `access.denied` 含 `required_permission` + `actor_id` + `ip`；③ 高频导出（100 次）不导致审计表异常膨胀（行数 = 100，且无重复行） |
| **5** | **A5** | **业务动作接入**：病例发布/归档/删除/`set_open`；评分复核/force 重算；反馈回复（**并新增 `feedbacks.replied_by` 列**）；问卷模板 CRUD/病例绑定；班级与成员；系统通知 | **M** | ① 每个域至少一条端到端 smoke：执行动作 → 查 `audit_logs` 得到预期 action 与字段；② `force` 重算的审计里能看到"旧分与旧复核将被删除"的 `before` 快照；③ 反馈回复后能从 `feedbacks.replied_by` + 审计行双证定位回复人 |
| **6** | **A6** | **保留与合规**：按月分区或归档任务；DB 层 append-only（触发器或受限角色）；登录失败带 IP + 账号级锁定 | **L** | ① `UPDATE audit_logs SET ...` / `DELETE FROM audit_logs` 被 DB 拒绝（触发器或权限）；② 归档任务 dry-run 输出"将归档 N 行 / 释放 X"，且**只 detach 不 drop 未导出分区**；③ 同一账号连续 5 次密码错误后可观测到锁定（接口返回 429/423 + 审计行 `auth.login_locked`）；④ `audit_logs` 出现在备份**包含**清单中（恢复演练后审计历史非空） |

**"先做哪一步收益最大"**：**A1 + A2 同批（一笔 M + 一笔 S）**。理由是这三条同时成立：① A2 里的 RB-1 是 P0，修法只在 `users.py` 两个分支各加一行 + 一个"最后管理员"守卫，**半天内可独立交付并有测试锁定**；② 权限/角色变更留痕（`roles.py`）是"审计系统自身可信"的前提，越晚做，之前的改权限史永久不可考；③ A1 的底座一旦就位，A3–A6 都是叠加。若维护者只允许做一件事，选 **RB-1 补丁**（无依赖、可立即发）；若允许两件，选 **A1 + A2**。

---

## 附：证据索引（按文件）

| 文件 | 关键事实 |
|---|---|
| `AGENTS.md:68-69`、`docs/03-database.md:150-151` | 迁移目录纪律（`ddl/` 禁 `op.execute()`、`data/` 需 data_only）+ 禁手改 `.gen.ts` |
| `backend/alembic.ini:52-54`、`backend/migrations/env.py:14,17` | 两目录 `version_locations`；`target_metadata = Base.metadata` |
| `backend/migrations/versions/ddl/c8e2a3b4d5f6_create_jobs_table.py:24-62` | **建表模板**（含部分唯一索引 `postgresql_where`） |
| `backend/migrations/versions/ddl/d9f3b4c5e6a7_add_context_policy_version.py:19-20` | **当前唯一 head** |
| `backend/migrations/versions/ddl/f4a5b6c7d8e9_drop_simulation_session_status.py:42-43` | `ddl/` 内 `op.execute()` 的唯一事实例外 |
| `scripts/create-data-migration.js:28-52`、`.husky/pre-commit:37-52`、`.husky/pre-push:95-107` | data 迁移脚手架；单 head 与目录落位门禁 |
| `backend/models/_base.py:11-15`、`backend/core/database.py:53-54` | `TimestampMixin`（日志型表**不用**它）/ `Base` |
| `backend/core/config.py:129,148` | `CLEANUP_INTERVAL_SECONDS`（清理循环间隔）/ `MAX_EXPORT_ROWS = 20000` |
| `backend/core/permissions.py:21-39` | 14 个权限键的单一真相 |
| `backend/core/roles.py:3-61` | 角色→权限映射 + import 期校验；super_admin 全量硬编码 |
| `backend/core/security.py:17-18,21-42,60-82,121-128` | 进程内权限缓存（TTL 60s）、认证校验、`require_permission` fail-closed |
| `backend/models/auth.py:17-62` | Role/RolePermission/User 与 `has_permission` |
| `backend/modules/admin/roles.py:99-118,120-177,182-241` | 角色 CRUD、反越权校验、唯一缓存失效点（`:159`） |
| `backend/modules/admin/users.py:179-189,191-274,700-781` | 反越权 scope、停用/删除缺检查、用户端点与日志 |
| `backend/modules/admin/secrets.py:143,148,161` | 密钥 CRUD，零日志 |
| `backend/modules/admin/exports.py:23,60,68,99` | 训练记录导出，零日志 |
| `backend/infra/logging_setup.py:25-55`（尤其 `:33`） | 唯一日志出口；`extra` 不渲染 |
| `backend/infra/diagnose.py:30-32, 74-85, 87-140` | 错误档案：只收 ERROR+、丢 extra |
| `backend/infra/error_archive.py:17-70` | 轮转 JSONL 档案实现 |
| `backend/infra/llm/logging.py:96-105+` | 异步批量 DB 日志先例（含"超预算丢最旧"） |
| `backend/infra/metrics.py:30-56,204-228` | 进程内指标；按路由 4xx/5xx |
| `backend/infra/diagnostics.py:110-140` | `/api/health`、`/api/metrics`（**无鉴权**）、`/api/diagnose`（token） |
| `backend/main.py:196,257-292,296-328,349-370` | 日志初始化、异常处理器、4 个中间件（`:276/296/310/322`）、router 注册（唯一 `include_router` 在 `:370`） |
| `backend/core/exceptions.py:63-76,129-138` | 领域异常与统一日志（无 user_id） |
| `backend/core/unit_of_work.py:12-27` | 事务边界（审计同事务的接入点） |
| `backend/core/rate_limits.py:76-100` | `get_client_ip` 信任模型 + 登录 10/300s 限流（无账号锁定） |
| `backend/seed.py:78-121` | 种子只在 `roles` 为空时执行 → 无自动恢复 |
| `backend/models/llm.py:45-80`、`models/voice.py:39-58`、`models/training.py:162-175`、`models/case.py:80-117`、`models/notification.py:12-36` | 落库日志型表与 `created_by` 先例 |
| `Dockerfile.backend:22`、`deploy/docker-compose.prod.yml:10-14,34,46,53-57,69-73` | `--workers 2`（跨 worker 缓存问题）+ docker 日志 10m×3 |
| `nginx.conf:100-125` | `/api/` 全量反代（`/api/metrics` 因此公网可达） |
| `docs/ops/diagnostics.md:22-61,183-185` | 错误/遥测档案保留 + 隐私条款 |
| `docs/09-operations.md:225-227,332-334,573` | 日志唯一查法（`docker logs`） |
| `docs/review/ui-improvement-plan-2026-09-26.md:217-241` | 查询实现约定（`XFilters` + `Depends()` + `useListFilters`） |
| `openapi.json` | `rg -c audit` → 0；无权限元数据（`Depends` 闭包不可反射） |
| `.github/workflows/commit-format.yml:203-210`、`package.json:31-34` | 词表/契约漂移门禁 |
| `frontend/src/components/RequirePermission.tsx:18-23`、`components/shell/navigation.tsx:111-310`、`components/Layout.tsx:130-133`、`stores/authStore.ts:26-33,66,89-93,160`、`utils/permissions.ts:6-16`、`api/query-params.ts:9-22`、`hooks/useListFilters.ts:24-` | 前端门禁、导航映射、权限来源与陈旧窗口、查询约定 |
