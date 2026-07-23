# Nursing VP Sim — 代码审计报告（供高级 AI 分析）

> **项目**: 护理虚拟患者模拟训练系统
> **技术栈**: React 19 + TypeScript + Vite + Tailwind CSS v4 / FastAPI + SQLAlchemy + PostgreSQL 15
> **代码规模**: 前端 ~43,000 行 (310 文件) + 后端 ~29,000 行 (319 文件)
> **审计日期**: 2026-07-23

---

## 致高级 AI：你的角色

请以**高级产品经理 + 高级前端/全栈工程师**双重视角审阅本报告。对每个问题：
1. **先判断**：这真的是问题吗？还是合理取舍？
2. **再决策**：如果改，选什么方案？为什么？
3. **后评价**：实施复杂度与预期收益的比值是否值得？

**核心诉求**: 前端交互流畅度优化、训练流程的体验设计、管理员后台的信息架构重排。你的产出应是**决策备忘录**而非代码——给出方向、理由、优先级即可。

---

## 说明：已排除的浅层问题

以下 12 个局部 bug 由当前 DeepSeek V4 agent 自行修复，无需关注：

| # | 问题 | 位置 |
|---|------|------|
| 1 | `endTraining` 空 catch → 加 toast | `TrainingEngine.tsx:158` |
| 2 | 通知失败静默丢弃 → 加日志 | `assignment.py:414,429` |
| 3 | N+1 COUNT → 批量查询 | `llm.py:28` |
| 4 | WS onerror 空函数 | `useTrainingWS.ts:62` |
| 5 | WS _send 不检查 readyState | `useTrainingWS.ts:92` |
| 6 | nursing_record raw commit → uow | `nursing_record.py:69` |
| 7 | refreshUser 误登出 → 仅 401 | `authStore.ts:125` |
| 8 | batch_create 全退 → SAVEPOINT | `user.py:161` |
| 9 | LLM 成本计数非原子 → SQL delta | `llm.py:270` |
| 10 | 删除/弃置记录 raw commit → uow | `session.py:618,637` |
| 11 | 硬编码默认凭据 → 移除 | `config.py:20` |
| 12 | 模型变更在 UoW 外 → 移入块内 | `case.py:132`, `auth.py:134` |

**以下每个问题都需要你的架构判断和产品决策。**

---

## 1. 项目架构速览

```
frontend/src/ (310 .ts/.tsx)
├── engine/          — TrainingEngine(331行,12个useEffect), MessageBus, StreamManager, ScoreManager
├── components/      — admin(34), training(12), ui(37), showcase(21)
├── pages/           — 15 page + 13 admin sub-pages
├── api/             — axios client, SSE, TanStack Query hooks, 9607行 auto-gen types
└── hooks/           — useVoice, useTrainingWS, useTrainingTimer, etc.

backend/
├── main.py          — FastAPI lifespan(180行单体)
├── contexts/training/ — scoring, pipeline(7), router(8), tools(7), settlement
├── infrastructure/  — LLM client(767行), TTS, ASR, logging, monitoring
├── services/        — 22 files (costs 110行 get_dashboard, assignment 432行)
└── routers/         — 24 files total
```

---

## 2. 架构级问题（需要架构设计判断力）

### 2.1 TrainingEngine：12 个 useEffect 需要重构为状态机

**文件**: `frontend/src/engine/TrainingEngine.tsx`（331 行，12 个 `useEffect`）

训练生命周期本质是状态机：idle → loading → active → scoring → ended。当前 12 个独立 `useEffect`，6 个依赖同一个 `recordNum`，生命周期逻辑分散难以推理。

**请决策**:
1. 重构为 `useReducer` 是否足够？还是需要 xstate 的显式状态转换图？
2. React 19 的 `useActionState` / `useOptimistic` 在此场景是否有用？
3. 重构的 ROI：当前 useEffect 有没有实际产生过 bug？还是仅仅是"不够优雅"？
4. 训练引擎同时管理 WS、SSE、TTS、Scoring 四种通道——拆分到独立 hooks vs 集中 reducer，哪种更适合这个项目？

### 2.2 评分系统的并发竞争（3 条路径冲突）

**路径 A — SSE 推送**: 后端 LLM 评分完成后通过 SSE 推送进度
**路径 B — HTTP 轮询**: 前端每 1.5s 轮询 `/scoring/status`（最多 200 次 = 5 分钟）
**路径 C — 结算扫尾**: 后端 settlement 扫描超时记录自动触发评分

**冲突点 1**: SSE 有阶段进阶校验，但 HTTP 轮询总是 `{ phase: "processing" }` 可能覆盖 SSE 已推进的阶段。
**冲突点 2**: settlement 的 `_handle_scoring_failure` 可能与 `_run_scoring_background` 并发更新 `scoring_status`。

**请决策**:
1. 应保留哪条路径作为"唯一真相源"？SSE 优先 + 轮询兜底？还是彻底干掉轮询只靠 SSE？
2. 后端是否需要乐观锁（version 字段）或 advisory lock 消除竞态窗口？
3. 作为 PM：评分 5 分钟超时的体验是否合理？是否应该让用户"后台评分 + 通知推送"而非阻塞等待？

### 2.3 ScoringProgressTracker 仅进程内有效

**文件**: `backend/contexts/training/router/scoring.py:23-24`

评分进度用内存 `dict`。多 worker 部署时轮询可能落在无数据的 worker。
- **请决策**: 当前生产环境是单 worker 还是多 worker？如果是单 worker，这是不是"假问题"？如果是多 worker，Redis pub/sub vs DB 字段 vs 不做（接受偶尔进度不准确），推荐哪个？

### 2.4 全局可变状态（Singleton 反模式）

```python
# session.py:70-75
_infra_client = None
_infra_router = None
_infra_log_worker = None
_main_loop = None
```

通过 `set_training_infra()` 从 `main.py` 注入；`_ensure_loop()` 没有时自旋事件循环线程。
- **请决策**: 这是历史遗留的"能用就行"还是真正的架构隐患？FastAPI 的 `app.state` + DI 能否彻底替代？多 worker 下的语义是否需要重新审视？

---

## 3. 超大类分解（需要组件/函数设计判断力）

### 3.1 前端：需要 PM+工程师联合决策的拆分

| 文件 | 行数 | 拆分难点 |
|------|------|---------|
| `components/admin/FeedbackTab.tsx` | 636 | 图表(chart)+列表(table)+回复(dialog) 三者是否有必要同时可见？ |
| `pages/admin/TeacherRecordsPage.tsx` | 578 | filter/search/sort/table/bulk-action 的交互联动多 |
| `pages/admin/AssignmentsPage.tsx` | 569 | CRUD 表单内联 + 7 处 `as any` 类型缺失 |
| `pages/Stats.tsx` | 513 | 学生/教师双角色视图，是否应该拆为两个独立页面？ |
| `pages/admin/AssignmentDetailPage.tsx` | 378 | 14 处 `as any`，学生数据完全无类型 |

**请决策**（逐个回答）:
1. FeedbackTab: 保持单页 vs 拆为独立路由(`/admin/feedback`+`/admin/feedback/:id`)？图表是否应该只在 Dashboard 而非列表页？
2. TeacherRecords: 当前筛选/搜索/排序/批量操作都在一个文件——拆分边界在哪里才不会导致 prop drilling 地狱？
3. Assignments: 创建作业需要填 case/practice/class/time/mode 等多个字段——是独立创建页好还是 drawer/modal 就够？为什么？
4. Stats: 作为 PM，学生和个人数据在统计页的价值是否对等？默认展示策略应该是什么？
5. AssignmentDetail: 14 处 `as any` 的类型补全工作是否优先于拆分？

### 3.2 后端大型函数

| 函数 | 行数 | 设计问题 |
|------|------|---------|
| `lifespan()` | 180 | 启动序列能否拆为独立 lifecycle hooks？ |
| `call_with_tools()` | 161 | 流式/非流式/retry 是否该拆到不同 private method？ |
| `evaluate_training()` | 149 | scoring pipeline 已有 infrastructure，为何还有这么大的编排函数？ |
| `_run_scoring_background()` | 126 | worker 循环+验证+backfill+timeout——能否用 pipeline pattern 重构？ |
| `get_record_detail()` | 117 | 响应包含 5 个关联+授权+评分+问卷+人格+情绪——是否该用 DTO 构造器模式？ |
| `get_dashboard()` | 110 | 多时间维度聚合是否该用 SQL VIEW 或物化视图？ |

**请判断**: 哪些拆分有实际维护价值，哪些只是"审美问题"不值得动？

---

## 4. 性能优化（需要全局视角 + 成本评估）

### 4.1 流式渲染策略：React.memo vs React 19 Compiler

聊天流高频更新，`ChatBubble`、`ScoreItem`、`StatCard` 等组件未 memo，每次全量重渲染。
- **请决策**: React 19 的 Compiler（React Forget）能否覆盖此项目的重渲染优化？实际测试过吗？如果不能，手动 memo 的投入产出比？`ChatBubble` 是否需要配合虚拟列表（`react-window`）处理长对话？

### 4.2 StreamManager O(n) 字符级重建

```typescript
this.messages = this.messages.map(...)  // 每字符分片 O(n)
```
- **请决策**: 长消息 1000+ 字符时真实卡顿概率多大？用 requestAnimationFrame 批量通知 vs 可变数组+ref vs Immer？是否值得为此引入额外依赖？

### 4.3 训练列表 joinedload 笛卡尔积

分页列表 `joinedload` 预加载 4 个关联 (case/user/score/assignment)。
- **请决策**: 改为 `selectinload` 是否能显著降低查询时间？当前数据和分页量查一次耗时多少？不值得优化的阈值是多少？

### 4.4 Showcase 营销页的首屏影响

21 文件 ~2,000 行，GSAP + Three.js 重量级依赖。
- **请决策**: Code splitting 是否已彻底隔离？首屏是否加载了 Three.js？是否能证明当前分割方案没问题？

---

## 5. 前端交互优化 & 产品决策（核心诉求）

> 以下问题需要同时以**高级产品经理**和**高级前端工程师**双重视角进行判断。请对每个问题给出明确的产品决策 + 技术方案。

### 5.1 训练主流程的交互摩擦

**现状**: 学生从"看到作业 → 开始训练 → 对话 → 结束 → 评分"走完整条链路，以下环节存在交互摩擦：

| 环节 | 当前体验 | 潜在问题 |
|------|---------|---------|
| 开始训练 | 一键进入 | 无确认弹窗，无"上次未完成记录"提示 |
| 对话中 | 输入框 + 发送按钮 | 无快捷操作（预设问候语/模板）、无草稿保存 |
| 工具使用 | 侧栏/底部面板切换工具 | 工具间切换需要额外点击，打断对话流 |
| 训练结束 | 手动点击结束按钮 | 超时自动结束无倒计时可见提醒 |
| 评分等待 | 全屏评分 Loading | 无进度条、无预估时间、无法取消（最差 5 分钟） |
| 评分结果 | 分数卡片展示 | 无法逐项展开看细分、无历史对比 |

**请回答**:
1. 作为 PM，当前流程中优先级最高的 3 个优化点是什么？
2. 作为工程师，每项的技术实现方案和风险？
3. 评分 5 分钟等待是架构问题还是交互问题？应该"缩短等待"还是"让等待可忍受"？

### 5.2 聊天界面的交互深度不足

**现状**: 训练核心是"学生向虚拟患者问诊 → 患者回复"的对话流。目前是纯文本聊天，交互模式类似微信。

**请评估以下增强方案的产品价值和技术可行性**:
1. **快捷问诊模板**: 输入框上方提供"主要症状是什么？""疼痛程度如何？"等常用问句一键发送（会不会让训练太简单？）
2. **对话分支提示**: LLM 检测到学生卡住时，轻提示"试试询问过敏史"（会不会破坏沉浸感？）
3. **关键信息高亮**: 患者回复中的重要临床信息（血压值、过敏药物）自动高亮/标记
4. **语音输入**: 已有 TTS + ASR 基础设施（`useVoice.ts`、`TTSManager.ts`），但当前语音功能的使用率和交互设计如何评价？
5. **Markdown 渲染**: 患者回复已用 `react-markdown`，但医学术语、检查结果的格式化程度够不够？

### 5.3 管理员后台的信息架构

**现状**: 管理后台有 13 个子页面，所有入口集中在左侧 `AdminSidebar` 一条竖列。

**请评价**:
1. 当前侧栏是否过载？是否需要二级分组（用户管理/内容管理/监控/系统）？
2. `FeedbackTab`（636 行）同时包含反馈图表+列表+回复功能——作为 PM，反馈管理的工作流应该是怎样的？列表页 → 详情抽屉？还是列表内 inline 回复？
3. `AssignmentsPage`（569 行）内联创建/编辑表单——作业创建流程是否需要独立页面（步骤多、字段复杂），还是当前弹窗/Drawer 足够？
4. 数据看板（`Stats.tsx` 513 行）学生/教师双视图的默认展示策略——按角色自动切换？还是两者都可见？

### 5.4 移动端体验策略

**现状**: 已有 `useLayoutMode` hook + `isCompact` 模式、`ResponsiveTable`、`ResponsiveDialog`。

**请决策**:
1. 移动端是"能用"还是"好用"的目标？训练聊天在手机上是否需要特殊布局（全屏输入、隐藏工具栏）？
2. 管理后台是否需要支持手机端？还是只保证 PC/平板？
3. 移动端评分结果展示：当前 `ScoreCard` + `ScoringOverlay` 在窄屏下的信息密度是否合理？

### 5.5 过滤与分页脱节（2 个页面受影响）

`MyFeedback.tsx` 和 `FeedbackTab.tsx` 在前端按 tag/状态过滤列表，但分页用服务器 `total`。显示"共 50 条"但过滤后仅 3 条可见，翻页出现空页。
- **请决策**: 改为服务端过滤（增加 API 参数，修改后端）还是前端过滤后重算分页（纯前端，但大列表有性能问题）？

### 5.6 关键状态无 UI 反馈

- WS 连接状态无指示 → 用户不知道物理检查/护理记录功能是否可用
- StreamManager send 被拦截时无 toast → 用户输入消息后无反应
- authStore hydration 期间闪白屏 → 需要 skeleton/loading 态

**请建议**: 全局连接状态 Indicator 的视觉方案？顶部状态条 vs 角落图标 vs 仅弱提示？StreamManager 错误 toast 的文案策略？

### 5.7 硬编码配置治理

| 值 | 位置 | 影响 |
|----|------|------|
| `1500`ms 评分轮询 / `200` 次最大 | ScoreManager | 超时 5 分钟 |
| `500` 字符 TTS max | TTSManager | 长文本拆分策略 |
| `25_000`ms SSE 超时 | sse.ts | LLM 慢时误杀流 |
| `8000`ms 最大重试 | client.ts | 网络恢复体验 |
| `20` 分钟默认限时 | PatientProvider + session.py | 训练时长 |
| `3` 次重试 / `30_000`ms | chat.ts | 聊天可靠性 |

**请决策**: 哪些应前端本地 config 文件 → 哪些应后端 API 动态下发（允许教师/管理员调整）→ 哪些应环境变量？

---

## 6. 类型安全：API 类型同步的根因修复

`AssignmentDetailPage.tsx` (14 处)、`AssignmentsPage.tsx` (7 处)、`AssignmentCardList.tsx` (4 处) 的 `as any` 都因 API 生成的类型缺少字段：`max_attempts`、`is_closed`、`attempt_count`。

**请决策**:
1. 后端 schema 是否缺这些字段？还是 openapi-typescript 生成器漏了？应该补后端 → `pnpm run api:update` 重生成，还是前端写本地 interface 覆盖（短期方案）？
2. CI 已有 `check:api` 但仍有不同步——如何加固门禁？
3. 作为工程决策：`api-types.gen.ts` 是 9,607 行的自动生成文件——继续依赖它还是考虑迁移到 tRPC/TanStack Start 等端到端类型安全方案？后者改动成本 vs 长期收益？

## 7. 无障碍性 & 国际化准备

| 问题 | 位置 |
|------|------|
| 头像 `alt=""` | `Layout.tsx:83` |
| 搜索输入无 `<label>` | 多处 |
| `motion/react` 不响应 `prefers-reduced-motion` | Layout.tsx |
| Tab 键盘导航在动态聊天界面可能不佳 | ChatArea, QA |

**请决策**:
1. a11y 修复是全量审计还是随需求迭代？是否引入 axe-core？
2. 全站中文硬编码——是否有国际化(i18n)计划？如果没有，是否至少该抽离文案为常量？

## 8. 测试覆盖策略

前端 16 个测试 / 后端 ~60 个测试，关键缺失：训练引擎、admin 页面、LLM/TTS/ASR 独立测试。

**请决策**:
1. 前端训练引擎：Cypress/Playwright E2E vs vitest 单元测试，投资比？
2. 后端 LLM mock 策略：录播 replay vs fake server vs mock 库？
3. 优先级：先补核心流程（训练-评分-结果）E2E，还是先补关键单元（ScoreManager, StreamManager）？

## 9. 技术债务的偿还节奏

- `pyproject.toml` 压制 70+ lint 规则（ANN/C901/PLR/PTH）
- `os.path` 100+ 处需迁移到 `pathlib`
- 196 个公开函数缺返回类型注解

**请决策**: 每项的逐步启用的优先级和里程碑？按月/季度制定清理计划还是不做（成本太高）？

## 10. 核心决策请求汇总

请按以下 5 个维度输出**决策备忘录**，每项给结论+理由+优先级（不要代码）：

### A. 前端交互优化（最高优先级）
1. **训练聊天体验**: 快捷模板/对话提示/关键信息高亮/语音输入——哪些值得做，哪些破坏训练价值？
2. **评分等待体验**: 5 分钟阻塞等待 vs 后台评分+通知推送——产品决策是什么？
3. **移动端策略**: 训练页 mobile-first 还是 desktop-only？后台需要移动端吗？
4. **全局状态反馈**: 连接状态 Indicator 的视觉方案和位置

### B. 组件/页面信息架构
1. **管理后台侧栏**: 是否需要二级分组？
2. **反馈管理**: 列表页 vs 列表+抽屉 vs 独立路由？
3. **作业创建**: Drawer vs 独立页面？
4. **统计页**: 学生/教师双视图的默认策略？
5. **5 个超大文件的拆分方案**（每个给结论即可）

### C. 架构优化
1. **TrainingEngine 状态机重构**: useReducer vs xstate vs 保持现状？
2. **评分并发一致性**: 三路径统一方案？
3. **全局 mutable state**: 重构优先级和方向？
4. **API 类型同步**: 短期修复 vs 长期迁移方案？

### D. 性能优化
1. **React.memo 策略**: Compiler 是否够用？还是手动优化？
2. **StreamManager O(n)**: 真实影响评估 + 方案选择
3. **joinedload → selectinload**: 真实查询耗时评估

### E. 工程质量
1. **测试投资优先级**: E2E vs 单元，核心流程 vs 边缘？
2. **技术债偿还节奏**: lint 规则逐步启用计划
3. **配置治理**: 硬编码值的统一管理方案

**每项输出格式**:
```
[结论]: 一句话决策
[理由]: 2-3 句论证（产品视角 + 技术视角）
[优先级]: P0(立即)/P1(本迭代)/P2(下迭代)/P3(暂缓)
[风险]: 如有风险请指出
```

---

## 附录

| 关键依赖 | 版本 |
|----------|------|
| React | 19.2 |
| Vite | 8 |
| TanStack Query | 5 |
| Zustand | 5 |
| FastAPI | 0.115+ |
| SQLAlchemy | 2.0 |
| PostgreSQL | 15 |
