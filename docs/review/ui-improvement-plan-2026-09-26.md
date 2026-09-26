# UI 改善计划（2026-09-26 起）

> **输入**：`docs/review/ui-audit-2026-09-26.md`（44 条问题 + 两轮线上实测证据）。
> **主线**：**尽量用 Mantine 原生组件与 theme 默认值对齐**（审计 `UI-MAN-1`）——不新增自研范式，页面不再手写外观。
> **边界**：不做逐像素还原，只保证整体观感与一致性到位；不重写训练引擎/工作区（manifest 驱动已达标）；不改后端契约（除 F1/F2/F4 明确列出的端点）。
> **兼容底线**：Chromium/Edge 92+、Firefox 91+、Safari 15.4+（`build.target` 降级语法 + `utils/polyfills.ts` 垫片，见 `docs/01-architecture.md` 浏览器下限节）。
> 与审计清单的差别：**本文件含"状态"列**（计划需要追踪进度），审计清单只记录问题事实。

---

## 0. 执行约定

**分支与发布**：本次实施在 `ui/improve-2026-09` 分支；`master` 不动；不执行 `pnpm run tag`（合并与发版由维护者决定）。每切片一次提交，提交格式 `<emoji> <type>: <描述>`。

**验证闸门（每个切片必须全过，缺一不算完成）**：

| # | 闸门 | 命令 / 方式 | 基线 |
|---|---|---|---|
| 1 | 类型与构建 | `cd frontend && pnpm build`（含 `tsc --noEmit`） | 干净 |
| 2 | Lint | `cd frontend && pnpm lint` | 2 warnings，不得新增 |
| 3 | 单测 | `cd frontend && pnpm test` | 74 文件 / 487 通过 / 1 skip |
| 4 | 视觉回归 | 本地 `dist` + `/api` 反代线上（harness：静态服务 + 反代线上，必须 HTTP/1.1，否则分块响应被当字面内容；脚本在证据包 `round2/verify-harness.py`），只读页面浅/深两态各复核一次；触及布局的切片另跑几何探针（网格行形状、控件坐标） | — |
| 5 | 语义回归 | 触及 a11y 的切片用 DOM 断言（`aria-label`/`label for`/`role`/触控尺寸），不靠肉眼 | — |

**禁止**：直接改 master、发 tag、覆盖审计清单里的既有结论（新证据只追加）。

**待维护者拍板的决策点**（未定前按"推荐"执行，落地后回填此表）：

| 决策 | 推荐 | 影响切片 |
|---|---|---|
| 深色模式默认值 | 先维持 `light` 并把开关做诚实；浅色字面量替换 + 深色回归完成后转 `auto` | Q3、S2 |
| 是否引入 `@mantine/dates` | 引入（替代原生 `<input type="date">` 的英文占位与无 i18n） | S1、S6 |
| 用户"删除"语义 | 软删（`is_active=false`，默认从列表隐藏，可筛"已停用"）+ 硬删仅在无训练记录时允许 | F1 |
| 评分标准（rubric）是否可写 | 暂缓：先只读展示 + 写明变更流程 | F4 |
| 深色态主色档位（filled 按钮对比度） | 深色 `primaryShade` 5 → 7（`#247f6b`，白字 4.86:1，观感更沉），或保留 5 号并接受 filled 按钮 2.68:1 | S2 |

---

## 1. 切片清单

### 阶段 Q —— 快修（每个 ≤ 半天，独立可发）

| ID | 目标 | 触及文件 | 改法 | 验收（可观测） | 状态 |
|---|---|---|---|---|---|
| **Q1** | 勾选后批量操作条出现在视口内（审计 `UI-LAY-1`，P0） | `components/shell/ShellTransition.tsx`、`components/admin/users/BatchActionBar.tsx` | 去掉包裹层的常驻 `will-change`（并写注释防回潮）；批量条改用 Mantine `Affix`（Portal 到 body，不再受祖先包含块影响） | 勾选一张用户卡后，JS 断言 `bar.getBoundingClientRect().top < innerHeight` | **已完成** · 实测 `top=798 / bottom=868`（视口 884），宿主 `Affix` ✅ |
| **Q2** | 训练"结束训练"按钮在桌面端可读、可访问、文案一致（`UI-TRN-1`，P0） | `components/training/TrainingHeader.tsx` | 去掉 `hiddenFrom="xs"`（标签常显）；可见文案与 `aria-label` 共用同一变量；状态语义进 aria 而非只靠 `title` | 1408px 与 484px 两视口下 `innerText` 与 `aria-label` 均含"结束训练" | **已完成** · 两视口实测 `innerText=结束训练`、`aria=结束训练，完成条件尚未满足`；红色 4.52:1（曾试橙色 3.62:1 不合规，已回退并记注释）✅ |
| **Q3** | 主题开关诚实且首点生效（`UI-DS-2`） | `components/ui/mode-toggle.tsx` | 删除本地 `mode` 影子状态，图标与 `aria-label` 直接来自 `useMantineColorScheme().colorScheme` | 点击一次即切换 `data-mantine-color-scheme`，且 `aria-label` 同步变化 | **已完成** · 实测首点 `light → dark` 生效，aria 同步为"当前深色模式…"；深色 dimmed 仍为 `#94a3b8` 未被压暗 ✅ |
| **Q4** | 次级文字与品牌色达 WCAG AA（`UI-A11Y-1`） | `theme/index.ts`、`main.tsx` | `cssVariablesResolver` 按浅/深分别给 `--mantine-color-dimmed`；`primaryShade.light` 6→7（品牌色两种用法都 ≥4.8:1） | 同一探针复测低对比计数 | **已完成（原目标部分达成）** · `/admin/records` 365→**112**、`/admin/users` 298→**91**、`/training` 18→**0**；剩余集中为徽章类，拆为 Q5 ✅ |
| **Q5** | 徽章与彩色小字的 AA 收口（承接 Q4 残留） | `theme/index.ts` | ① `variant="light"` 改「color-0 底 + 按需压暗的字」；② `--mantine-color-{名}-text` 从鲜艳 -6/-7 档改取 -9（个别压暗）——后者一次性覆盖全站 `c="色名"` 文字，无需改调用点 | 同一探针复测低对比计数 | **已完成** · `/admin/records` 112→**0**、`/admin/users` 91→**0**、`/admin/feedback` 100→**0**（阳性对照已注入 #cccccc 文本确认探针有效，非假阴性）✅ |

### 阶段 S —— 结构对齐（Mantine 原生，消除"拼装感"）

| ID | 目标 | 覆盖审计条目 | 要点 | 状态 |
|---|---|---|---|---|
| **S1** | theme 成为唯一外观来源 | `UI-DS-3`、`UI-MAN-1` 第 1/2 步 | 补齐 `Paper/Table/Tabs/Select/TextInput/Modal/Drawer/Pagination/SimpleGrid/Tooltip` 等 `defaultProps`；radius/icon/type 三套 scale 写进 theme；`cssVariablesResolver` 定义深色安全语义变量 | 待办 |
| **S2** | 浅色字面量清零 + 深色回归 | `UI-DS-1` | `gray.0/1/3`、`yellow.0`、`blue.1`、`#fff` 假设 → token/`light` 变体；完成后把 `defaultColorScheme` 转 `auto` 并补首屏引导脚本 | **待办**（Q5 已产出深色实测残项作为输入，见下） |

**S2 的深色残项（Q5 实测，学生首页 `/training` 深色态共 5 处低对比）**：
1. `进行中` 12px dimmed 文字压在硬编码 `yellow.0` 行上 → 2.42:1；
2. `已完成` 12px dimmed 压在 `green.0` 底上 → 2.39:1；
3. `待做作业` 12px dimmed 压在 `red.0` 底上 → 2.40:1；
4. 统计数字 20px 白字压在 `green.0` 底上 → 1.15:1（浅底未随深色反转）；
5. 主色 filled 按钮 `选择病例`：深色 `primaryShade=5`（#3cb094）上白字 **2.68:1** —— Mantine `autoContrast` 对中间调选白字而非黑字（黑字可达 5.59:1），需在「保持鲜艳 accent」与「AA」之间取舍，见决策点表。 |
| **S3** | 面板与卡片层级收敛 | `UI-NEST-1/2/3` | 一层描边容器；内层用 `Card.Section`/`Stack`；`ui/card.tsx` 子组件删除；`responsive-table` 的 `bare` 策略统一 | 待办 |
| **S4** | 网格与留白规则 | `UI-LAY-2/3/4` | `SimpleGrid` 响应式 `cols` + `align="start"`；3 项用 `sm:3`；筛选区末格移出网格 | 待办 |
| **S5** | 控件位置与页头规范 | `UI-POS-1/2` | `PageHeader.actions` = 主操作 filled；导出/批量 outline 靠左于主操作；列表页"筛选在上、工具行在下"；"共 N 条"固定位 | 待办 |
| **S6** | 表格与分页形态 | `UI-ADM-4/5`、`UI-POS-2` | 全部表格走 `DataTable`/`ResponsiveTable` + `Table.ScrollContainer`；分页默认 50、常驻（sticky/Affix）；日期控件换 `@mantine/dates` | 待办 |

### 阶段 F —— 功能与数据

| ID | 目标 | 覆盖审计条目 | 要点 | 状态 |
|---|---|---|---|---|
| **F1** | 用户管理 CRUD 补齐 | `UI-CRD-1/5` | 接回删除（复用 `_handleDeleteUser`）+ 停用/启用（后端 `UserUpdateRequest.is_active`）+ 从卡片进入 `UserDetailPage`；软删语义由决策点 3 定 | 待办 |
| **F2** | 问卷列表筛选打通 | `UI-CRD-2` | 后端 `list_templates` 增 `search`/`is_active`（服务层透传）或前端降级为"仅当前页"并标注 | 待办 |
| **F3** | 导出遵循当前筛选 | `UI-CRD-4` | 4 个调用点传入筛选对象；后端导出端点透传 | 待办 |
| **F4** | 仪表盘数据可信 | `UI-ADM-1` | 后端聚合（今日/本周/待批阅真实计数）；动态流显示日期；rubric 只读说明（决策点 4） | 待办 |
| **F5** | 导航 IA | `UI-NAV-1…5` | nav 标签 = 页面标题；图标唯一；折叠组随路由展开；无权限渲染 403 页而非静默重定向 | 待办 |
| **F6** | a11y 批量 | `UI-A11Y-2/3/4/5`、`UI-ADM-6` | 表单补 `label`；点击容器换 `UnstyledButton`；图标按钮 `ActionIcon` + `aria-label`；触控目标 ≥28/44；图表 `role="img"` + 摘要 | 待办 |
| **F7** | 移动端 | `UI-MOB`、`UI-ADM-9`、`UI-STU-4` | 筛选面板默认折叠；QA 去 `calc(100dvh - 6.5rem)` 改 flex；训练移动工具条尺寸；管理端移动支持范围写明 | 待办 |

---

## 2. 顺序与依赖

- **Q1–Q4 相互独立**，且不与 S/F 冲突，先做（都是 P0/P1，成本 S）。
- **S1 必须先于 S2/S3**（token 与默认值层是前提）。
- **S2 必须先于"深色默认 auto"**（否则半坏状态被默认暴露）。
- **F1 依赖决策点 3**；**F4 的 rubric 部分依赖决策点 4**。
- F 阶段中 F2/F3 与后端耦合最小，可先于 F1/F4 并行。

---

## 3. 进度记录

> 每完成一个切片追加一行：`日期 · 切片 · 提交 · 验收结果摘要`。

| 日期 | 切片 | 提交 | 验收结果 |
|---|---|---|---|
| 2026-09-26 | 计划建立 | — | 基线：`pnpm build`/`tsc` 干净、biome 2 warnings、vitest 74 文件 487 通过 1 skip |
| 2026-09-26 | Q5 | `a3993d57` | 四闸门全过；实测浅色低对比 112→0（records）、91→0（users）、100→0（feedback）；阳性对照验证探针有效；深色残 5 处转为 S2 输入 |
| 2026-09-26 | Q1–Q4 | `3e29bc2f` / `ab532f0d` | 四闸门全过（build/tsc 干净、lint 无新增、487 通过）；实测：批量条回到视口内（top 2616→798）、交卷按钮两视口可见且有名（4.52:1）、主题首点生效、低对比 365→112 / 298→91 / 18→0 |

---

## 4. 明确不做

1. 视觉重设计、逐像素还原、换设计语言（保持现有品牌青绿 + Mantine 范式）。
2. 训练引擎/工作区重构（`docs/15` 的 manifest 驱动已是达标实现）。
3. 引入 Tailwind 或第二套组件库（审计 `UI-DS-5` 的结论是删幽灵、不是补依赖）。
4. 后端表结构变更（F1 的软删如需新列，先出迁移方案再定）。
