# BUG 修复路线图 — 设计规格 (Spec)

**日期**: 2026-07-10
**状态**: 待用户复核
**类型**: 缺陷修复路线图（跨域，多阶段）

---

## 1. 背景与目标

对系统进行了五路并行 BUG 扫描，覆盖：

1. 后端 services/repositories/事务层
2. 后端 routers/schemas/API 契约层
3. 后端 LLM/scoring/infrastructure/async 层
4. 前端 engine/plugins/training 层
5. 前端 API/hooks/state/组件层

扫描共产出约 50 项发现。本 spec 将其按严重度整理为三个 Tier，每一 Tier 对应后续实现计划中的一个执行阶段，阶段间设 checkpoint，确保**按优先级有序推进**。

**验证策略**（用户决策）：仅 Tier 0（Critical）逐条读源码复核；Tier 1/2 信任子代理报告，不确定项标注 `待复核`，由实现阶段验证。

**目标**：
- 消除会永久损坏数据 / 导致用户可见崩溃的缺陷（Tier 0）。
- 修复安全暴露、资源泄漏、事务一致性问题（Tier 1）。
- 清理其余正确性与健壮性问题（Tier 2）。

**非目标（YAGNI）**：见第 5 节。

---

## 2. Tier 0 — Critical（已逐条复核）

> 复核修正了原始报告：3 项"Critical"经读源码后调整了根因或严重度。以下为复核后的准确结论。

### T0-1 评分超时预算重构（合并原 Critical #1/#2/#3）

**位置**:
- `backend/core/config.py` — `SCORING_TIMEOUT_SECONDS = 180`
- `backend/contexts/training/router/scoring.py:262-271`（超时→failed 处理）
- `backend/contexts/training/router/scoring.py:376-378`（retry 锁守卫 300s + 提示"超过5分钟"）
- `backend/contexts/training/router/session.py:69`（`allow_retry` SQL 含 `processing`）
- `backend/contexts/training/score_engine.py:626`（Score 在 evaluate_training 内 commit）
- `backend/infrastructure/llm/client.py:386` + `backend/core/llm_profile.py:46`（scoring profile timeout=120, max_retries=3, per-attempt 130s×4）
- `backend/main.py:87-96`（启动恢复无条件标 failed）

**根因**（复核确认）:
1. **超时预算错配**（原 #3，确认）：外层 `asyncio.wait_for` 预算 180s，但单次 LLM 流式尝试就 130s，重试 4 次 + 两阶段并行，重试逻辑永远来不及生效，所有失败统一坍缩为超时。
2. **孤儿 Score + 记录 failed**（原 #2，确认）：Score 在 `evaluate_training` 内部 commit（durable），若外层 180s 超时在 commit 之后、状态置 completed 之前触发，`_handle_scoring_failure` 把记录标 failed，产生"有 Score 但状态 failed"。**更可靠的触发点**：`main.py` 启动恢复把 pending/processing 记录无条件标 failed，无视已存在 Score。
3. **超时数字三处不一致**（原 #1 降级后的真实根因）：`SCORING_TIMEOUT_SECONDS=180` vs retry 守卫 `300s` vs 提示文案"超过5分钟"。`session.py:69` 的 `allow_retry` SQL WHERE 包含 `'processing'`，当前被 180s 超时掩盖，但一旦超时值调高至 >300s 即成为"活跃任务被重复抢占→永久卡死"的隐患。

**修复方向**:
- 统一超时语义：定义清晰的预算分层——单次 LLM attempt 超时、stage 级重试次数、外层全局超时三者对齐，使全局超时 = f(attempt 超时 × 重试次数 × 阶段数)，或向下传递递减 deadline。修正提示文案与 retry 守卫使其与实际全局超时一致。
- 超时/失败处理前先检查 `Score` 是否已存在：存在则置 `completed` 并清 error，而非标 failed。同一逻辑应用于 `main.py` 启动恢复。
- 从 `session.py:69` `allow_retry` SQL 的 WHERE 移除 `'processing'`（仅允许从 `completed`/`failed`/NULL 重试）；对真正卡死的 `processing` 记录改用基于时间戳的独立超时守卫。

**验收标准**:
- 全局超时值、retry 守卫窗口、用户提示文案三者数值一致，且有单一配置来源。
- 存在有效 Score 的记录在任何超时/失败/启动恢复路径下都不会被标为 `failed`。
- 重试无法抢占一个仍在 `processing` 且未超时的记录。
- 新增/更新单元测试覆盖：超时后有 Score、启动恢复有 Score、并发 retry 三个场景。

**可逆性/回归风险**: 中。改动集中在评分状态机，需回归 end_training / retry_scoring / 启动恢复三条路径。所有改动可通过配置与逻辑回退。

---

### T0-2 训练选择页搜索完全失效

**位置**: `frontend/src/pages/TrainingSelect.tsx:80-90`

**根因**（已读源码确认）: `queryKey`（第 81 行）包含 `search`，但 `getCases()`（第 83-88 行）构造的 params 只传 `offset/limit/training_type/difficulty`，`search` 从未传给后端，也无客户端过滤。每次击键改变 queryKey 触发 refetch，但后端收不到搜索词——搜索框完全无效。

**修复方向**:
- 将 `search` 传入 `getCases`（后端支持的字段名，按 API 类型确认，如 `name`）。
- 输入去抖，避免每次击键 refetch（复用 `useDebouncedSearch`）。确认后端 `/cases` 列表接口支持对应查询参数。

**验收标准**:
- 在搜索框输入关键字后，列表按后端返回结果过滤。
- 输入去抖生效，连续击键不产生每字符一次的请求。

**可逆性/回归风险**: 低。单文件改动。

---

### T0-3 登录按钮无提交中状态

**位置**: `frontend/src/pages/Login.tsx:45,75,88,93`

**根因**（已读源码确认）: `submittingRef = useRef(false)`，`isSubmitting = submittingRef.current`（第 93 行）在渲染期读取 ref，`submittingRef.current = true`（第 75 行）不触发重渲染。按钮文案（"登录中…"/"登 录"）永不切换到 loading 态，用户点击后至导航成功/报错前无任何视觉反馈；同时防重复提交依赖 ref（该部分有效）。

**修复方向**:
- 将 loading 状态改为 `useState(false)`，在 `onSubmit` 中 set，`finally` 中复位（保留 `mountedRef` 卸载守卫）。防重复提交可保留 ref 或合并入 state。

**验收标准**:
- 点击登录后按钮立即显示 loading 文案/禁用态，直至成功导航或显示错误。
- 提交进行中重复点击不触发第二次请求。

**可逆性/回归风险**: 低。单文件改动。

---

## 3. Tier 1 — High（信任报告，实现阶段逐条验证）

### 后端 — 事务一致性 / 安全

- **T1-1 `unit_of_work` 绕过 + TOCTOU（唯一性校验）**
  `backend/services/auth.py:83-113/180-222`、`backend/services/user.py:99-127`。
  check-then-commit 绕过 `unit_of_work`，并发注册/绑定微信/批量建用户触发 IntegrityError→原始 500 而非 409。修复：把校验移入 `unit_of_work` 块，依赖 DB 唯一约束 + IntegrityError→ConflictError 映射。`auth.py` 其余直接 `db.commit()`（wechat_register/update_me/change_password/logout）一并纳入 UOW。
- **T1-2 鉴权暴露**
  `backend/routers/profiles.py:18`（无鉴权公开）、`backend/routers/health.py:54`（`/api/metrics` 无鉴权泄漏运维内部指标）。修复：加 `CurrentUser` 或与 `/diagnose` 一致的 token 守卫。
- **T1-3 export 端点无分页（DoS/OOM）**
  `feedback.py:74`、`cases.py:200`、`admin/users.py:103`、`admin/roles.py:73`、`admin/secrets.py:142,179`、`assignments.py:172`、`notes.py:59`。修复：加 limit/offset 或服务端游标 `yield_per`。
- **T1-4 越权赋角色**
  `backend/routers/admin/users.py:114` + `backend/schemas/user.py:37`。持 `user_manage` 者可给任意用户赋任意角色（含 admin），无角色层级防护。修复：加不得授予高于自身权限的守卫。
- **T1-5 评分失败静默吞异常**
  `backend/contexts/training/router/scoring.py:60,170`（通知/failure 处理内层异常静默）、`scoring.py:159-166`（同步处理器 `asyncio.ensure_future` fire-and-forget，异常丢失）。修复：改 async 并被 await，或加 `add_done_callback` 错误处理；failure 更新失败需升级日志并保证最终一致。

### 前端 — 泄漏 / 崩溃 / 会话

- **T1-6 定时器/监听器卸载泄漏**
  `components/training/InitiativeBar.tsx:47-58`（interval）、`EmotionIndicator.tsx:55-56`（timeout）、`SceneRenderer.tsx:55-64`（drag 全局监听器面板中途关闭泄漏）。修复：在 `useEffect` cleanup 中统一清理。
- **T1-7 场景卡无 Error Boundary**
  `components/training/SceneRenderer.tsx:117-122`、`engine/TrainingEngine.tsx:300-320`。单卡崩溃拖垮整个训练会话。修复：为每张卡与引擎内容包 Error Boundary + fallback UI。
- **T1-8 authStore 网络错误误登出**
  `stores/authStore.ts:91-96`。`refreshAuth` 的 catch 在任何网络错误（非仅 401）时清空会话，训练中断网即被登出。修复：仅 401 清会话，网络/超时错误保留 token 下个周期重试。
- **T1-9 useTrainingWS 引用计数竞态**
  `hooks/useTrainingWS.ts:109-115`。refCount 归零清理与挂起重连定时器竞态，可能留下无消费者的连接。修复：`_connect` 创建前检查 `_aborted`，`onmessage` 内加 `_aborted` 守卫。

> 注：原报告的前端 StreamManager 竞态经复核降级——`StreamManager.ts:125` 的 `if(this._loading) return` 守卫已挡住并发 send。其原地 mutate（`:160,167`）为真实但低影响问题，归入 Tier 2。

---

## 4. Tier 2 — Medium/Low（信任报告，实现阶段验证）

按域列表，逐条标 `待复核`。实现阶段进入本 Tier 时对每条先读源码确认再修。

### 后端
- `contexts/qa/api.py:471-483` — 流式生成器 SessionLocal 断连泄漏（commit/close 可能不执行）。
- `routers/notes.py:63-81` — `record_id` 无归属校验；`NoteResponse` 泄漏 `user_id`。
- 各 delete 端点响应形状不一致（`DeleteResponse` vs `{message}` vs `{ok}`）：`questionnaires.py:178`、`admin/roles.py:84`、`admin/grades.py:44`。
- `routers/cases.py:162` — Pydantic 错误细节直传客户端（泄漏内部 schema）。
- `routers/students.py:16` — 列表无分页。
- `services/case.py:146`、`class_.py:94`、`grade.py:57`、`practice.py:107`、`role.py:103` — delete 前置校验在 UOW 之外（TOCTOU）。
- `services/llm.py:37-38` — N+1（per-secret count）。
- `core/unit_of_work.py:24` — `except Exception` 吞 KeyboardInterrupt/SystemExit。
- `infrastructure/llm/router.py:249` — 多 worker 成本上限仅进程内，可被 N× 超限。
- `infrastructure/scoring_progress.py` — tracker 条目在任务未启动时永久泄漏。
- `infrastructure/llm/logging.py:126` — `_drain_count` 无 overflow_dir 时无界增长。
- `contexts/training/score_engine.py:308-311` — retry 返回不可解析 JSON 时未调用 `fallback_fn`，丢弃首次数据。
- `contexts/training/pipeline/middleware/llm_caller.py:143-175` — 身份泄漏重试后修正内容未推送 stream_queue，前后端内容分歧。
- `routers/asr.py:80` — JWT 走 query param 可被代理日志记录。
- `core/security.py:85-111` — `_decode_token_allow_expired` 复用风险。

### 前端
- `api/client.ts:69-74` — 403 刷新后不重试原请求、无排队。
- `components/admin/CasesTab.tsx:112-116` — 用 `{}` 失效化 query，保存后列表不刷新（应传实际 params）。
- `engine/StreamManager.ts:160,167,177-179` — 消息对象原地 mutate（低影响，React 19 memo 隐患）。
- `hooks/useLayoutMode.ts:7-12` — `tablet` 断点死代码，480-1023px 全判为 phone。
- `components/NotificationBell.tsx:36-47` — 多页乐观更新失败后局部 stale。
- `engine/TrainingEngine.tsx:206`、`engine/tts/TTSManager.ts:64` — `EmotionState` 无校验强转。
- `engine/tts/TTSManager.ts:69` — `attach()` 重复调用覆盖 unsubs 泄漏。
- `hooks/useTrainingRecord.ts:38-61`、scene-cards 多处 — API 响应 `as` 强转无运行时校验。
- `components/training/panels/scoring-display/ScoringOverlay.tsx:208` — index 作 key。
- `components/training/body-exam/ExamBodyScene.tsx:105` — flash timeout 无 cleanup。
- `components/training/scene-cards/registry.ts:41-46` — `getSceneCards` 每次渲染新引用未 memo。
- `hooks/useDebouncedSearch.ts:8-12` — `delay` 未纳入依赖。

---

## 5. 非目标（YAGNI）

- 不做与缺陷无关的架构重构（例如全面引入 zod 运行时校验、重写 LLM 客户端）。
- 不改动已入链的迁移文件。
- 不改 auto-generated `.gen.ts` / `openapi.json`。
- 不新增功能特性。
- Tier 2 中被复核判定为误报/不可复现的条目直接从计划移除，不强行修改。

---

## 6. 执行顺序与 Checkpoint

交由 writing-plans 拆分为分阶段实现计划，建议：

- **阶段 1 = Tier 0**：T0-1（评分超时，含测试）→ T0-2 → T0-3。Checkpoint：评分状态机测试全绿 + 前端手测搜索/登录。
- **阶段 2 = Tier 1**：先后端事务/安全（T1-1..T1-5），后前端（T1-6..T1-9）。Checkpoint：`pnpm run check:full` + 关键路径回归。
- **阶段 3 = Tier 2**：进入每条前先读源码复核，误报移除。Checkpoint：`pnpm run check`。

每阶段结束运行推送前检查（AGENTS.md / local.md 所列 ruff + pytest + ty + tsc + biome）。
