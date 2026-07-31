# 13 — 前端组织结构收敛计划（范式规则建议）

> 决策日期：2026-07-31 | 最后更新：2026-07-31
> 状态：**建议稿，待评审，未执行**
> 适用范围：`frontend/src/` 目录组织、类型单源、训练域边界、页面粒度、导入规则
> 背景：与后端同一批维护者 + 高频 AI agent。前端骨架比后端同期健康得多（按层目录是 React 惯例、导入纪律良好、域内聚合已有萌芽），问题集中在**类型双源、双工具目录、巨型页面、文档脱节**四件事。本文结论：**收敛而非重构**，不做后端 Phase 3 式全量迁移。

## 一、现状盘点与评价（2026-07-31 调查）

### 1.1 结构快照

`frontend/src/` 共 331 个 ts/tsx 文件（含 `__tests__/` 22 个与根级 App.tsx/main.tsx/events.ts/version.ts），主要顶层目录：

```text
api/         27 文件（含 admin/ 10）    — 数据访问，已按域分文件
components/  141 文件（ui 42 / training 28 / admin 43 / shell 11 / 散件 11）
engine/       18 文件（根 12 + tts/ 6） — 训练逻辑岛
pages/        42 文件（根 12 / admin 26（含 cost 5 + dashboard 4）/ record-detail 4）
hooks/        15 文件
stores/        6 文件（trainingStore 10.5KB）
utils/        10 文件（cn.ts 为死转发）
lib/           2 文件（utils.ts 承载 cn，95 处使用）
types/         5 文件（score / store / record / globals）
schemas/      10 文件（zod 表单契约）
config/        2 文件、showcase/ 自成一体（28 文件）、themes/ styles/ assets/ 稳定
```

文件粒度（按字节，gen 文件除外）：

| 大小 | 数量 | 占比 | 说明 |
|---|---|---|---|
| 0–1KB | 85 | 26% | 大量为 ui/ 原语与薄壳，可接受 |
| 1–5KB | 166 | 50% | 理想区间 |
| 5–15KB | 68 | 21% | 正常 |
| 15–25KB | 10 | 3% | 可接受但需清晰段落 |
| 25–35KB | 1 | — | **TrainingSelect.tsx 33.3KB / 600 行** |
| >35KB | 1 | — | api-types.gen.ts（生成物，豁免） |

导入纪律（好，需保留）：

- 相对导入最深 1 跳；218/328 文件用 `@/` 别名；54 文件混用别名+相对（小瑕疵）。
- `@/components/ui` barrel **0 使用**，284 处直连文件 —— ui/index.ts 是死 barrel。
- `@/api` barrel 29 处 vs 84 处直连文件；`@/engine` barrel 2 处 vs 29 处深路径。

### 1.2 问题清单（按严重度）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1 | **类型三角**：同一概念多处定义且已分叉 | `ScoreData` 在 `engine/types.ts`（total_score 可选）与 `types/score.ts`（total_score 必填 + rubric_version/review）各定义一份，形状已分叉；前者 17 处使用、后者 8 处。`types/record.ts` 的 `RecordExtended` 是 gen 中 `TrainingRecordBrief` 的近似超集，仅 3 处使用。gen 文件 600 个 schema 被 25 处直连 | 改字段时改错副本 = 静默类型错误 |
| P2 | **双工具目录**：`utils/` 与 `lib/` 并存 | `cn` 真身在 `lib/utils.ts`（95 处使用），`utils/cn.ts` 只是死转发（0 使用）；`lib/` 2 文件 vs `utils/` 10 文件，无边界规则 | agent 放工具函数时二选一，两处翻找 |
| P3 | **训练域跨 8 个顶层目录散布，无单一导览** | 训练代码分布在：`engine/`(18)、`components/training/`(28)、`hooks/useTrainingWS|useToolBridge|useTrainingRecord|useScoringNotifications|useTrainingTimer`(5)、`stores/trainingStore.ts`、`api/training|chat|sse.ts`、`pages/TrainingSelect|TrainingEntry|RecordDetail|History`、`config/llm-purposes.ts`、`types/score|record.ts` | 最大复杂域没有入口注释，新 agent 无法 3 跳内理解主链路 |
| P4 | **巨型页面** | `TrainingSelect.tsx` 600 行/33.3KB，一个页面混 5 个域的数据（病例列表、训练记录、作业、统计/排名/趋势、通知）+ 5 组内联子组件（Stars、CapBadges…）；`QA.tsx` 738 行/22KB 整域单文件 | 修改任一域都要滚过整页；页内组件无法复用 |
| P5 | **admin 双目录命名不一致** | `pages/admin/` 根 17 文件（4 个 <1KB 薄壳 + 11 个 8.7–19KB 实页 + 2 个中转页）；`components/admin/` 根 5 文件（4 个 Tab + ClassFilter）+ 4 个功能子目录（users 8 / cases 18 / questionnaires 6 / monitor 6）；`FeedbackTab` 18.1KB 平铺未拆、`UsersTab` 15.3KB 超壳；域 hooks 一部分藏在 `components/admin/users/useUserList.ts`，一部分在顶层 `hooks/useGradesClasses.ts` | 同一功能的归属需在 pages/admin、components/admin 根、components/admin/<域>、hooks/ 四处判断 |
| P6 | **文档脱节** | `docs/04-frontend.md` 仍记录已不存在的 `api-client.ts`、`training-state.ts`、`practices.ts`、`prompts.ts`、`rubric.ts`、`nursing-records.ts`、`components/teacher/`；hooks 列表、store 列表、training 组件数全部过时 | agent 按文档找文件直接落空，文档失去导航价值 |
| P7 | 散件无归属规则 | `components/` 根 11 个文件混三类：App 级 Provider（FeedbackProvider/ErrorBoundary/ProtectedRoute）、跨域组件（NotificationBell/FeedbackModal/QuestionnaireModal/ExportButton）、布局（Layout/Toast/NetworkBanner），无书面规则区分 | 新组件放根还是子目录靠猜 |

### 1.3 评价结论

对照后端 doc 11 的评价镜头：

| 维度 | 后端（11 号文时） | 前端（现在） |
|---|---|---|
| 平行层目录 | `routers/`+`services/`+`contexts/` 三层并存 → 必迁 | pages/components/hooks/api 单层骨架，无平行冗余 |
| 伪抽象 | `Repository` 基类 + `Registry` 扩展点 | 无 repository；tools/registry 是静态注册表（合理） |
| 类型/契约 | models + schemas 顶层收敛 | 有收敛意向但**类型三角未解决** |
| 导入纪律 | 迁移后 router→service→db 3 跳 | 别名覆盖 2/3，最深 1 跳相对导入 |
| 复杂域组织 | 唯一复杂岛 modules/training | 训练域**已有岛的雏形**（engine + components/training）但无导览、hooks 散落 |
| 文档 | 迁移后各 `__init__.py` 有域地图 | docs/04 过时，域目录无导览注释 |

**结论：前端不需要后端式的大迁移**（后端迁是因为平行层腐烂 + 伪抽象要清剿）；前端需要的是 **规则冻结 + 三处收敛 + 导览注释**。最大风险不是结构，而是类型分叉和文档说谎——两者都会让 agent 改错地方。

## 二、最终定案（范式）

采用 **按层骨架 + 域内聚合（layer-first monolith with domain islands）**：

```text
普通功能：pages/<Page>（路由壳）→ components/ 域目录 + api/<domain>.ts
训练域  ：唯一复杂岛 = engine/（逻辑）+ components/training/（UI），hooks/useTraining* 归入 engine/
管理端  ：pages/admin/<Page> + components/admin/<Tab> + components/admin/<feature>/
跨域基础：components/ui/（无业务原语）、hooks/（共享钩子）、lib/（唯一工具家）
数据契约：api/api-types.gen.ts 唯一后端类型源；schemas/ zod 表单；types/ 仅放视图类型
```

**明确不做**：

- 不建 `features/` 顶层目录做全量迁移（训练域 80% 已在岛上，缺的是注释与规则，不是目录）。
- 不引入状态管理框架替换 zustand、不引入组件再封装层。
- 不学后端的 `modules/` 化 pages/components 合并——React 惯例下按层是 agent 最快的查找路径，后端按模块是因为它没有 React 的组件/逻辑天然分层。

## 三、目标目录（演进后）

```text
frontend/src/
  App.tsx  main.tsx  events.ts  version.ts

  api/                          # 数据访问层 — 后端契约唯一入口
    client.ts                   # axios 实例（拦截器/重试）
    sse.ts  api-path.ts  query-keys.ts
    training.ts  chat.ts  qa.ts  cases.ts  assignments.ts …   # 每域一文件
    admin/                      # 管理域子目录（现状保留）

  components/
    ui/                         # 无业务原语（shadcn + 自研），现状保留
    shell/                      # 布局/导航壳
    training/                   # 训练域 UI 岛（tools/ scenes/ scoring/ 子目录）
    admin/                      # 管理端：*Tab 壳 + 功能子目录（users/cases/questionnaires/monitor/）
    citation/  record-review/   # 跨域共享组件
    <App 级>                    # FeedbackProvider/ErrorBoundary/ProtectedRoute/Layout/Toast…

  engine/                       # 训练逻辑岛（index.ts = 域地图，含域 hooks）
    index.ts                    # ← 扩展为训练域导览注释
    TrainingEngine.tsx  TrainingDataContext.tsx
    ScoreManager.ts  StreamManager.ts  MessageBus.ts
    useTrainingWS.ts  useToolBridge.ts  useTrainingRecord.ts  # ← hooks 迁入
    useScoringNotifications.ts  useTrainingTimer.ts
    tts/  capabilities.gen.ts

  hooks/                        # 仅共享/跨域钩子（useMediaQuery/useTheme/useDebouncedSearch…）
  lib/                          # 唯一工具家（cn/date/error/network/telemetry…）← utils/ 并入
  pages/                        # 路由壳 + 页面组合
    TrainingSelect.tsx          # ← 按业务阶段拆（见 Phase 4）
    QA.tsx                      # ← 按会话区拆
    admin/  record-detail/
  schemas/                      # zod 表单契约（现状保留）
  stores/                       # zustand 客户端状态（auth/training/uiPrefs…）
  types/                        # 仅视图类型（ScoreData 收敛于此）
  config/  themes/  styles/  assets/  showcase/
```

**不复存在**：`utils/`（并入 lib/）、死 barrel（`components/ui/index.ts`）、`types/record.ts`（改由 gen 类型承担）、`engine/types.ts` 中的重复 `ScoreData`。

## 四、目录职责

### `api/`

后端契约的唯一入口。每域一文件；`api-types.gen.ts` 只允许被 api/ 内文件与个别页面类型别名引用。业务代码不得出现裸 axios 调用。

### `components/ui/`

只放无业务语义的原语（Button/Card/Dialog/Table…）。出现业务词（training、case、user）即违规，应放入对应域目录。删除 `index.ts` 死 barrel，一律直连文件。

### `engine/` + `components/training/`

训练域唯一的两个家。`engine/index.ts` 承担 `modules/training/__init__.py` 的职责——顶部写域地图：pipeline 入口、评分生命周期、TTS、WS/SSE 分工、运行态归属（store）。域 hooks（useTrainingWS 等）迁入 engine/，与逻辑共居。训练主链路必须从 `@/engine` 与 `@/components/training` 进入，不新增第二套 StreamManager/MessageBus 等效物。

### `components/admin/`

每功能一个 `pages/admin/<X>Page`（路由壳）+ 一个 `<X>Tab`（壳，≤15KB）+ 一个功能子目录（组件 + hooks + types 共居，`users/` 模式）。超 15KB 的 Tab 必须拆子目录。`FeedbackTab` 18.1KB 平铺是唯一超规，按此拆。

### `lib/`

唯一工具家。`utils/` 全部并入（`cn` 已在 lib 无需搬，其余 9 文件迁入），删除 `utils/cn.ts` 转发。新工具函数一律进 lib/，禁止再建第二个工具目录。

### `types/` 与 `schemas/`

- `schemas/`：zod 表单契约，与表单字段绑定（现状正确）。
- `types/`：只放**后端契约之外的视图/客户端类型**。`ScoreData` 收敛于此单一定义；`RecordExtended` 消除，用 gen `TrainingRecordBrief` 派生。

### `pages/`

路由壳 + 页面组合。页面可以持有查询与组合逻辑，但 **>25KB 按业务阶段拆**，且不得内联 5+ 组可复用子组件（TrainingSelect 现状）。

## 五、文件粒度规则

| 文件大小 | 处理 |
|---|---|
| 0–1KB | 可接受（ui 原语、路由薄壳、type-only 文件）；非此类应考虑合并 |
| 1–5KB | 理想（组件） |
| 5–15KB | 正常（页面、引擎文件） |
| 15–25KB | 可接受，但必须有清晰段落分区；admin Tab 壳到此必须拆子目录 |
| >25KB | 按业务阶段拆分（当前唯一：TrainingSelect） |
| >35KB | 必须拆分（gen 文件豁免） |

拆分按业务阶段，不按抽象：

```text
好：TrainingSelect → TrainingHome / CaseListSection / RecordOverviewSection
坏：TrainingUtils.ts / TrainingHelper.tsx / components/xxx-manager.tsx
```

## 六、禁止新增的形态

- **第二个类型定义源**：`ScoreData`、记录形态、用户形态等已存在概念，一律从既有单源 import 或派生，禁止重写副本。
- 新顶层目录（utils 之外的家、新 layer、新岛）。
- `utils/`、`helper.ts`、`common.ts`、`manager.tsx` 等模糊文件（`lib/` 是唯一例外且须语义清晰）。
- 裸 axios/fetch 散布在组件里（必须走 api/ 模块）。
- 训练域第二套总线/流管理/评分生命周期（`MessageBus`/`StreamManager`/`ScoreManager` 已有）。
- 新死 barrel：导出但无人 import 的 index.ts（ui/index.ts 现状），新增导出必须当天有消费者。
- 把服务端状态塞进 zustand store（服务端态走 react-query，store 只放客户端态）。
- 运行时自动发现的组件/插件注册表（静态注册允许，如 `tools/registry.ts`）。
- 页内内联 5+ 组可复用子组件且不做任何导出（TrainingSelect 现状）。

## 七、类型分层（对应后端状态分层）

| 层 | 例子 | 来源 | 规则 |
|---|---|---|---|
| 后端契约 | `components["schemas"][...]` | `api/api-types.gen.ts`（600 schema） | 唯一来源，禁手改；`pnpm run api:update` 重新生成 |
| 视图类型 | `ScoreData`、`ChatMessage`、`User`（客户端形态） | `types/` | 每概念单一定义，只允许从 gen 派生/收敛 |
| 表单契约 | `loginSchema`、`profileSchema` | `schemas/` | zod，与 gen 类型对齐 |
| 客户端状态 | `trainingStore`、`authStore` | `stores/` | 单 store 单职责；服务端态一律 react-query |

任何新增字段、页面状态或 API 响应，必须先归类再落地。

## 八、迁移路线

### Phase 0 — 冻结新增形态 ✅（建议即生效）

- 不再新增顶层目录、不再新增第二类型定义源、不再往 `utils/` 写新文件、不再新建无人消费者的 barrel。
- 新页面 >25KB 前必须规划拆分点。

### Phase 1 — 导览与边界注释

- `engine/index.ts`：扩展为训练域地图（pipeline 入口、评分生命周期、TTS、WS/SSE 分工、运行态归属），仿 `modules/training/__init__.py`。
- `components/training/`：文件头或目录注释列出子目录职责（tools/scenes/scoring）。
- `api/training|chat|sse.ts`：顶部注释说明传输分工（REST 记录 / SSE 流式 / WS 状态）。
- `docs/04-frontend.md`：删除不存在的文件记录（api-client/training-state/practices/prompts/rubric/nursing-records/teacher/），目录树对齐现状。

### Phase 2 — 类型收敛

1. **ScoreData 唯一化**：以 `types/score.ts` 的完整形态为唯一定义（含 rubric_version/review，8 个消费方已依赖）；`engine/types.ts` 删除 ScoreData/ScoreDimension/ScorePhase/ScoringProgress 副本，改从 `@/types/score` import 或派生。改动点约 17 处 import。
2. **RecordExtended 消除**：`types/record.ts` 删除，3 处使用方改组合 gen 类型（`TrainingRecordBrief` + score 字段）。
3. **`utils/` → `lib/`**：9 个非 cn 文件迁入 lib/，删除 `utils/cn.ts` 转发与 `utils/` 目录。改动点约 42 处 import。

### Phase 3 — 训练域聚合

- 5 个训练 hooks（useTrainingWS/useToolBridge/useTrainingRecord/useScoringNotifications/useTrainingTimer）迁入 `engine/`，同步移动 `__tests__/training/useToolBridge.test.tsx`。
- 删除死 barrel `components/ui/index.ts`（0 使用，284 处直连不动）。
- 此后训练域新增 hooks 一律进 engine/ 或对应域目录。

### Phase 4 — 巨型页面拆分

- `TrainingSelect.tsx`（600 行）：按业务阶段拆 —— 病例选择区（列表/筛选/分页）、记录与作业概览区、统计/排名/趋势区、通知区；子组件进 `components/` 对应域或页内导出。
- `QA.tsx`（738 行）：拆会话列表栏 / 聊天区 / 建议与引用展示，参照 `components/training/` 的组织。

### Phase 5 — 可选收敛（低优先，不阻塞）

- `api/` barrel（29 用）vs 直连（84 用）规则化：倾向直连文件、barrel 仅保留公共入口；不强迁存量。
- `FeedbackTab`（18.1KB）/`UsersTab`（15.3KB）按 admin 规则拆子目录。
- 54 个混用别名+相对导入的文件收敛为 `@/`。

## 九、验收状态

| 标准 | 状态 |
|---|---|
| `grep "interface ScoreData"` 全仓库仅 1 处 | ⬜ Phase 2 |
| src 下只有 `lib/` 一个工具目录，无 `utils/` | ⬜ Phase 2 |
| 训练域主链路可从 `engine/index.ts` 3 跳内理解 | ⬜ Phase 1 |
| 训练域新增代码不再进入 `hooks/` 顶层 | ⬜ Phase 3 |
| 无 >25KB 页面（gen 文件除外） | ⬜ Phase 4 |
| `docs/04-frontend.md` 目录树与真实结构一致 | ⬜ Phase 1 |
| `pnpm typecheck` + `pnpm test` 全量通过 | ⬜ 每 Phase 结束 |

## 十、最终原则

> 前端是给少数维护者和高频 agent 使用的**按层可导航单体**：层是 React 惯例，域是复杂度容器。优先类型单源、单工具家、域内聚合与导览注释；不为企业级观感引入第二套目录哲学，不让文档与结构分叉。
