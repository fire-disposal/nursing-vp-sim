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
| 是否引入 `@mantine/dates` | **已定案：引入**（2026-09-26 完成，提交 `3b74f894` / `c62c00eb`） | S1、S6 |
| 是否迁移到 `@mantine/charts` | 待定：**新图用 Mantine Charts，存量 recharts 先做主题化**（整体迁移 L 级） | S6、F4 |
| 自研件替换范围 | 已定方向：**默认迁 Mantine 原生**（维护者 2026-09-26 指示），清单见 S7 | S7 |
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
| **S1** | theme 成为唯一外观来源 | `UI-DS-3`、`UI-MAN-1` 第 1/2 步 | ① 两档圆角显式化（容器/按钮 `md`，控件/小件 `sm`）；② 徽章锁定 12px 字号下限；③ 字号离群收口（10px→11px、UI 文本 11px→12px）；④ `theme.other.uiScale` 记下比例尺；⑤ 清 126 处冗余 `<Paper radius="md">` | theme 成为唯一来源且行为不变 | **已完成** · 实测三页 `minTextFz=12px`（原本 `/admin/cases` 徽章 9px、`/admin/users` 9px）、Badge 统一 `4px/12px`、两档圆角 `8px`/`4px` 不变、codemod 后 Paper 仍 8px（视觉零变化）✅ |
| **S2** | 浅色字面量清零 + 深色回归 | `UI-DS-1` | `gray.0/1/3`、`yellow.0`、`blue.1`、`#fff` 假设 → token/`light` 变体；完成后把 `defaultColorScheme` 转 `auto` 并补首屏引导脚本 | **待办**（Q5 已产出深色实测残项作为输入，见下） |

**S2 的深色残项（Q5 实测，学生首页 `/training` 深色态共 5 处低对比）**：
1. `进行中` 12px dimmed 文字压在硬编码 `yellow.0` 行上 → 2.42:1；
2. `已完成` 12px dimmed 压在 `green.0` 底上 → 2.39:1；
3. `待做作业` 12px dimmed 压在 `red.0` 底上 → 2.40:1；
4. 统计数字 20px 白字压在 `green.0` 底上 → 1.15:1（浅底未随深色反转）；
5. 主色 filled 按钮 `选择病例`：深色 `primaryShade=5`（#3cb094）上白字 **2.68:1** —— Mantine `autoContrast` 对中间调选白字而非黑字（黑字可达 5.59:1），需在「保持鲜艳 accent」与「AA」之间取舍，见决策点表。 |
| **S3** | 面板与卡片层级收敛 | `UI-NEST-1/2/3` | 一条规则：**同层只保留一层描边** —— 内层浮框改「无边框 + `--mantine-color-default-hover` 底色」，外层留唯一描边；虚线空态框保留（表达「空位」而非「面板」） | 边框口径下「框套框」计数 = 0 | **第一波已完成** · 实测框套框：`/admin/users` 50→0、`/admin/feedback` 39→0、`/my-feedback` 1→0，`/admin/records`、`/admin/costs`、`/admin/classes`、`/record/:id`、`/admin` 均 0；`/training` 保留 1 处刻意虚线空态 ✅　**第二波待做**：`cost/VoiceTokenCard` 的三层自绘边框、其余手绘 `1px solid` 中嵌在面板内的部分 |
| **S4** | 网格与留白规则 | `UI-LAY-2/3/4` | ①固定项数网格的档位与项数对齐；②条数随数据的磁贴改 flex-wrap；③内容量差异大的行改 `alignItems: start`；④筛选区末格移出网格 | 固定项数网格无末行空缺；行内无拉伸留白 | **已完成** · 训练首页左卡 358px→**134px**、单子项两列网格改单列、趋势磁贴改 flex-wrap、3 张 KPI 与 3 字段表单改 `lg:3`、角色 14 项与 SystemOps 5 处静态 `cols={2}` 改响应式、`/admin/records` 错位末格拆为对齐工具行 ✅ |
| **S5** | 控件位置与页头规范 | `UI-POS-1/2` | `PageHeader.actions` = 主操作 filled；导出/批量 outline 靠左于主操作；列表页"筛选在上、工具行在下"；"共 N 条"固定位 | 待办 |
| **S6** | 表格与分页形态 | `UI-ADM-4/5`、`UI-POS-2` | 全部表格走 `DataTable`/`ResponsiveTable` + `Table.ScrollContainer`；分页默认 50、常驻（sticky/Affix）；日期控件换 `@mantine/dates` | 待办 |

### 阶段 F —— 功能与数据

| ID | 目标 | 覆盖审计条目 | 要点 | 状态 |
|---|---|---|---|---|
| **F1**（本轮已完成） | 用户管理 CRUD 补齐 | `UI-CRD-1/5` | ① 删除接回（原 `_handleDeleteUser` 被下划线屏蔽）；② **停用/启用**（软删：`UserUpdateRequest.is_active` + `User.is_active` 过滤 + 不能停用自己）；③ 卡片改为**显式动作**（详情/编辑/停用/删除）+ 姓名链接进 `UserDetailPage`（原孤儿路由）；④ 筛选栏加「显示已停用」（默认隐藏） | 实测：卡片 3 个具名动作 + 2 个详情链接；停用确认写明「无法登录、数据保留、可重新启用」；删除确认「此操作不可恢复」；详情页 `/admin/users/74` 正常渲染 ✅ |
| **F1 遗留** | 硬删仍受后端限制（有训练记录的账号拒绝硬删）——已有「停用」作为替代路径；批量停用/删除未做 | — |
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
| 2026-09-26 | F1 用户管理 CRUD 补齐 | 见下条提交 | 删除接回 + 停用/启用（软删，不能停用自己）+ 详情入口打通（原孤儿路由）+ 卡片显式动作（a11y）+ 显示已停用筛选；两个危险操作均有确认弹窗 |
| 2026-09-26 | AI 生成 A3+A4（取消/进度/用量/白名单） | `f5f1531d` | 前端 75 文件 493 通过；后端 1480 通过；实测：Stepper/计时/取消（8s 内无结果）/字段状态点；`api:update` 已重生成 openapi 与 TS 类型 |
| 2026-09-26 | AI 生成 A2（暂存+差异+逐项接受） | 见下条提交 | 新增 `ai/staging.ts` + 4 单测；差异面板端到端实测（13 项待确认 → 部分接受 12 项 → 撤销可用）；4 个受影响测试按新契约更新（2 个 AI 测试重写 + 1 个防呆用例 + 2 个日期选择器交互改用测试替身） |
| 2026-09-26 | 病例管理专项 + AI 生成 A0 | 见下条提交 | AI 面板配色对齐品牌（紫→青绿，实测 brand-0）；空骨架禁用「生成教学细节」+ 原因说明（实测 `disabled=true`）；深挖 10 条问题与 A1–A4 重建切片已入档 |
| 2026-09-26 | CRUD 基础体验 + 表格列集 | 见下条提交 | `FilterToolbar` 推广至用户管理（补一键复位）、批量条换 `ActionBar`、登录换 `PasswordInput`；records 11→10 列/行高 57px、history 8→7 列、cases 名称列给足 |
| 2026-09-26 | 依赖升级 + `@mantine/dates` | `3b74f894` / `c62c00eb` / `22c7e8c0` | Mantine → 9.6.3（7 包一致）；10 处原生日期框换 `DatePickerInput`（中文 locale 实测通过）；outline 变体对比度修复（`/admin/users` 45→0）；闸门全过 |
| 2026-09-26 | S3+S4（第一波） | `106a73b3` | 四闸门全过；框套框 50/39/1 → **0**；拉伸留白 358px→134px；固定项数网格与筛选末格修正 |
| 2026-09-26 | S1 | 见下条提交 | 四闸门全过；实测最小正文号 9px → **12px**，Badge 统一 12px，两档圆角显式化，126 处冗余 `Paper radius` 清除后视觉零变化 |
| 2026-09-26 | Q5 | `a3993d57` | 四闸门全过；实测浅色低对比 112→0（records）、91→0（users）、100→0（feedback）；阳性对照验证探针有效；深色残 5 处转为 S2 输入 |
| 2026-09-26 | Q1–Q4 | `3e29bc2f` / `ab532f0d` | 四闸门全过（build/tsc 干净、lint 无新增、487 通过）；实测：批量条回到视口内（top 2616→798）、交卷按钮两视口可见且有名（4.52:1）、主题首点生效、低对比 365→112 / 298→91 / 18→0 |

---

## 3.1 S1 的边界与遗留

- 已清：`<Paper radius="md">` 126 处（tehem 默认同值，属纯噪声）与全仓 <12px 的正文文本。
- 未清（**有意**）：`Button/ActionIcon/Card/Modal/Notification` 上的 `radius="md"` 覆盖保留 —— 与 theme 默认同值、数量小，随触碰该文件时顺带清；强行全量 codemod 的收益不足以承担误伤（例如 `Badge/Tooltip` 的显式 `sm` 被误删会改变观感）。
- 图表轴刻度统一 11px（`theme.other.uiScale.chartAxisTick`），圆形序号/选项标记类 pill 允许 11px；这两类不适用 12px 正文下限。


### 3.2 实施中核实/更正的两条

- **日期输入框的 `yyyy / mm / dd` 是浏览器 locale 现象，不是硬编码**：Chromium（zh locale）实测渲染为「年/月/日」，Firefox 英文 locale 下才是 `yyyy/mm/dd`（我此前的审计结论来自 Firefox 侧）。因此该项从「英文占位」降级为「跨浏览器不一致」；是否引入 `@mantine/dates`（可锁定 `valueFormat` 与 locale）仍由决策点决定。
- **表格列宽挤压**：`/admin/records` 在 1408px 下「状态」徽章被截成「已…」，时长/开始时间/来源 列换行 —— 属 `Table` 列宽策略问题（非本轮改动引入），作为 **S6 表格与分页形态** 的输入证据记录。

---

## 5. Mantine 9.6 特性评估（2026-09-26）

> 触发：升级到 9.6.3 时评估新特性是否值得实装；原则沿用维护者指示「**默认倾向 Mantine 原生**，只要不明显增加复杂度/风险」。

| 9.6 特性 | 与本项目的关系 | 判断 | 成本 |
|---|---|---|---|
| **`ActionBar`**（core） | 直接替代我们手写的 `components/admin/users/BatchActionBar.tsx`（Affix + Paper + 关闭按钮）：官方组件自带 fixed/Portal 语义与关闭按钮，避免再踩「祖先包含块」那类坑 | **实装**（S7） | S |
| **`PasswordInput.visibilityToggleFocusable`** | 登录页没有密码可见性切换（审计 UI-LOGIN-3）；换 `PasswordInput` 顺带让切换键进入 Tab 序（a11y） | **实装**（S7） | S |
| **`@mantine/lightbox`**（新包） | 反馈截图预览现为自研 `previewUrl` 状态 + 简易弹层；Lightbox 自带缩放/缩略图/键盘/多图轮播 | **实装**（S7，需装新包） | S–M |
| **`Stepper` 状态语义 + `labelPosition`** | 训练头部四步条是手写的、四步状态无区分（审计 UI-TRN-5）；`Stepper` 有 current/completed/error 与 aria 语义 | **实装**（S7，需把 manifest 完成状态映射为 step.status） | M |
| `Notifications layout="stacked"` / `renderNotification` | 部署更新提示、反馈回复通知；`renderNotification` 可做「带操作按钮」的通知 | 候选（会改全局通知观感，需先定观感） | S |
| Charts：`GaugeChart`/`WaffleChart`/`MatrixChart`/`CandlestickChart`、reference areas/dots、streamgraph、右 Y 轴 | 我们直接用 recharts（审计：图表 svg 无 aria、配色不随主题）。reference areas 适合「评分达标线」，Waffle/Matrix 适合成绩分布 | **决策点**：新图用 `@mantine/charts`，存量图先主题化（整体迁移 L 级、涉及 5+ 页） | L |
| `@mantine/dropzone`（react-dropzone 20） | 反馈图片上传若仍为自写 file input，可换官方 Dropzone（校验/预览/拖拽） | 候选（随反馈上传改造一起评估） | S |
| RichTextEditor 表格/Details、Schedule 系列、ColorInput/FloatingWindow/use-scroll-spy 增强 | 项目未使用这些组件 | 不需要 | — |

### 5.1 自研件 → Mantine 原生替换清单（S7）

| 自研 | Mantine 原生 | 收益 | 成本 |
|---|---|---|---|
| `components/ui/bottomsheet.tsx`（手写拖拽抽屉：无 `role="dialog"`/焦点陷阱，自实现 Escape 与滚动锁，审计 UI-DS-4） | `Drawer position="bottom"`（三级态由 size 状态驱动） | a11y 达标、少约 200 行维护 | M |
| `components/ui/confirm.tsx`（20 个调用点） | `@mantine/modals` 的 `modals.openConfirmModal`（依赖已在） | 少一层包装、Promise 语义 | M |
| `components/ui/data-table.tsx` / `responsive-table.tsx` | `Table` + `Table.ScrollContainer` + `Pagination` | 修整页横滚（UI-ADM-4）、去掉 `<Tr role="button">`（UI-A11Y-4） | M |
| `components/ui/card.tsx` 的 `CardHeader/CardTitle/…` 子组件 | `Card.Section` + `Stack`/`Group` | 去掉无布局契约的中间层（UI-NEST-3） | S |
| `components/ui/pagination.tsx` | Mantine `Pagination`（若已是包装则仅统一 a11y） | 尺寸/aria 一致 | S |
| `components/admin/users/BatchActionBar.tsx` | `ActionBar` | 见上表 | S |

> 实施顺序建议：先做 S（ActionBar / PasswordInput / card 子组件），再做 M（Drawer / confirm / data-table），避免同时改太多渲染路径。

### 5.2 本轮踩坑（写给后来者）

- **Mantine 的变体颜色在 JS 侧按 `primaryShade` 解析成字面量**，不是 CSS 变量引用：`theme.components.X.styles` 里覆盖 `--badge-color`/`--button-color` **无效**（`[data-variant]` 属性选择器优先级更高），覆盖 `--mantine-color-{c}-filled` 同样无效。要动 outline/filled 取色只有两条路：改 `primaryShade`（影响全局主色观感）或改调用点 variant/color。
- **`node_modules` 指向已失效的 pnpm store**（仓库迁址后路径变化）会让任何安装失败；`pnpm install --frozen-lockfile` 可只重链、不动 lockfile。
- **共享浏览器 profile 下 `/login` 会因已有 token 直接跳走**，本地验证前先清 localStorage。


---

## 6. CRUD / 操作页基础体验专项（2026-09-26）

> 触发：维护者要求针对纯操作页与 CRUD 页的**筛选、搜索、多选、二级页面**做完整性与对齐优化。下表为线上实测矩阵（1408×884，2026-09-26），是"对齐"的判断依据。

### 6.1 实测矩阵

| 页面 | 筛选控件 | 搜索 | 一键复位 | 多选 | 批量条 | 详情入口 | 表格列数 |
|---|---|---|---|---|---|---|---|
| `/admin/records` | 7（5 下拉） | 有 | **有** | 1 | — | 50（按钮） | 11 → **10** |
| `/admin/users` | 3（+ 卡内复选） | 有 | **已补** | ✅ 50 复选 | ✅ 已换 `ActionBar` | **0**（点卡=编辑） | — （卡片网格） |
| `/admin/cases` | 3 | 有 | 缺 | ✅ 11 行复选 | 缺 | 0（行内图标） | 6 |
| `/admin/assignments` | 4 | 有 | 缺 | 缺 | — | 行内"详情" | 7 |
| `/admin/classes` | 2 | 有 | 缺 | 缺 | — | 2 | 2 |
| `/admin/feedback` | 2 | 有 | 缺 | 缺 | — | 行内 | — |
| `/admin/questionnaires` | 3 | 有 | 缺 | 缺 | — | 行内 | 6 |
| `/admin/system-notifications` | 2 | 有 | 缺 | 缺 | — | 行内 | — |
| `/admin/roles` | 1 | 有 | 缺 | 缺 | — | 行内 | — |
| `/admin/versions` | 1 | **无** | 缺 | 缺 | — | 只读 | 7 |
| `/history`（学生） | 1（状态） | **无** | 缺 | 缺 | — | 48（按钮） | 8 → **7** |

### 6.2 本轮已做

| 项 | 做法 | 验收 |
|---|---|---|
| 筛选栏统一 | `/admin/users` 的手写筛选行改用 `FilterToolbar`（`summary | filters | search + 清除`），补上缺失的一键复位 | 该页"清除"生效；`FilterToolbar` 消费者由 1 → 2 |
| 批量操作条 | 自研 `BatchActionBar` → Mantine `ActionBar`（官方 fixed/Portal 语义 + `CloseButton`） | 勾选后条在视口内（沿用 Q1 断言） |
| 登录密码框 | `TextInput type="password"` → `PasswordInput` + `visibilityToggleFocusable`（可见性切换进入 Tab 序） | 登录页出现切换键；`tsc`/测试通过 |
| 表格列集 | `/admin/records` 删「类型」（恒定"问诊"）、`/history` 删同列与移动端后缀；两表合并重复入口（"待复核"与"查看详情"同指一个详情页） | records 11→**10 列**、行高 68→**57px**、操作列 234→**150px**；history 8→**7 列** |
| 列宽分配 | 主信息列给足、数字/时间列 nowrap：records 学生 59→88px、病例 155→201px；cases 名称 280→400px、能力列 344→240px（徽章组不再压过名称） | 实测无截断（`anyCellTruncated=false`） |
| 表格滚动容器 | `/admin/records` 手写 `div overflow-x` → Mantine `Table.ScrollContainer` | 实测容器存在；窄屏不再整页横滚 |
| **F2** 问卷死筛选（`UI-CRD-2`） | 后端补 `search`/`is_active` 并收敛为 `QuestionnaireTemplateFilters`（`Depends()` + 服务层单一谓词） | 免库判据（编译成 PG SQL）通过；前端原本就传参，零改动生效 |
| **F3** 导出无视筛选（`UI-CRD-4`） | 四类导出与列表共用同一筛选 DTO/服务入口；前端 `useListFilters.exportParams` → `ExportButton` | 浏览器实测：用户页/病例页列表与导出筛选键一致，导出后筛选不被清空 |
| **一键复位补齐** | cases/feedback/questionnaires/roles/users 全部走 `FilterToolbar` + 钩子 `reset()`；"有活跃筛选"由 `useListFilters.hasActiveFilters` 统一判定（默认值如 `include_inactive=false` 不算活跃） | 浏览器实测：反馈页选标签 → 出现「清除」→ 点击后按钮消失、输入框清空、列表回退全量 |
| **筛选控件下拉化** | 反馈页 7 个标签按钮、`/my-feedback` 标签按钮行（窄屏要横向滚动）→ 统一为 `Select`（clearable + 占位符），与工具栏其它筛选同形 | 实测：反馈页选「BUG反馈」→ 请求带 `tag=bug`；按钮行消失、下拉就位 |
| **查询实现统一**（见 §6.4） | 后端「筛选 DTO + `Depends()`」、导出取数一律 `MAX_EXPORT_ROWS + 1`、前端 `useListFilters` + 契约类型别名 | 后端 1483 通过 / 前端 496 通过 / `tsc`+`biome` 干净 / 构建通过 |

**已核实合理、不动**：`/admin/scoreboard` 11 列的列宽（67–156px）与数字右对齐已够用；`/admin/versions` 7 列身份/记录/评分列宽均衡。

### 6.3 待办（按价值排序）

1. **"一键复位"补齐剩余 8 页**（cases/assignments/classes/feedback/questionnaires/notifications/roles/versions/history）：统一走 `FilterToolbar`，每页提供 `hasActiveFilters` + `onClear`（users 已完成，可作模板）。
2. **多选与批量扩展到其他实体**：cases（已有行复选，只需挂 `ActionBar`）；records/feedback/questionnaires 需先有后端批量端点（`UI-CRD-6` 已登记）。
3. **搜索补齐**：`/admin/versions`、`/history` 无搜索框（history 50 行只能靠状态筛选）。
4. **二级页面一致性**：`/admin/records/:id`、`/admin/users/:userId`、`/admin/classes/:classId`、`/admin/assignments/:id` 的返回、标题层级、空/错态尚未统一（并入 S5/S6 收尾）。
5. ~~`/admin/users` 详情入口缺失~~ → **已解决（F1）**：卡片姓名与「详情」图标均进入 `/admin/users/:id`。
6. ~~用户卡是 `div onClick`，无 `role`/`tabindex`~~ → **已解决（F1）**：整卡点击已移除，改为卡片内显式动作按钮（`aria-label`）+ 姓名链接；复选框不再嵌套在可点击容器中。归档原文：用户卡是 `div onClick`，无 `role`/`tabindex`（`UserCard` → `openEditUser`）：键盘与读屏用户**无法进入编辑表单**，自动化也只能靠坐标点击（2026-09-26 实测：`observe()` 里不存在该卡片元素，坐标点击反复命中复选框）。修法：卡片改用 `UnstyledButton`/`component="button"`（或整卡包一层 link），与 `UI-A11Y-4` 同批处理。

### 6.4 查询实现约定（2026-09-26 定案，新增代码一律照此）

**后端：一个域一个筛选 DTO。**
```python
@dataclass(slots=True)
class UserFilters:                      # 定义在服务类之前（注解在 def 时求值）
    search: Annotated[str | None, Query(description="…")] = None
    …

@router.get("/users")                   # 列表与导出都这样注入，不再各自声明筛选参数
def list_users(filters: Annotated[UserFilters, Depends()], …): …

class UserService:
    def _filtered_query(self, filters: UserFilters): …   # 谓词只写一次（私有接缝）
    def list_filtered(self, filters, *, offset, limit): …  # 列表与导出的唯一入口
```
- 筛选键的**唯一事实来源**是 DTO：新增筛选不可能只加到一端（导出漏筛这类 bug 的结构性根因）。
- 导出取数一律 `MAX_EXPORT_ROWS + 1`（`core.config`），超限由 `infra/exporter.py::export_response` 统一 400；**服务层不得再写别的上限魔数**（LLM 日志的 50000、训练记录的无上限都已收口）。
- DTO 放服务模块而非 router：注解求值 + router 已 import service，避免循环导入（`users.py` 是 router+service 同文件所以无此问题）。

**前端：一个页面一个 `useListFilters`。**
- `hooks/useListFilters.ts` 持有筛选值 → `params`（列表）与 `exportParams`（去分页）**一次构造、两处使用**；空值不进请求，`false`/`0` 保留；改筛选（含搜索）自动 `offset` 归零。
- 参数类型从 OpenAPI 生成物取（`api/query-params.ts` 的 `ListQuery<path>` / `ExportParams<T>`）：后端改了筛选而前端没跟 → **类型错误**，而不是线上静默失效的死控件。
- Tab 通过 `onExportParamsChange` 把 `exportParams` 交给页头的 `ExportButton`；`ClassFilter` 这类非受控筛选件用 `key` 重挂载来响应"清除"。

### 6.5 新增待办（2026-09-26 记录）

1. **列表接口在挂载时重复请求**：`/admin/users` **已修**——该查询是唯一没有 `staleTime` 的列表查询，壳过渡短暂再挂载时会二次取数；补 `staleTime: 60_000` 后实测由 2 次降为 1 次。`/admin/cases` 曾观测到 2 次同参 `GET`，但用 XHR 调用栈探针复测只出现 1 次（间歇性、根因未定），先记在此：已排除双根/双 `QueryClientProvider`（`main.tsx` 单根、`App.tsx` 单 Provider）与 axios 重试（仅对 5xx/网络错误重试）。
2. ~~`useListFilters` 的搜索归零~~ → **已修**（`onSearchChange` 现归零 offset）。**新增两条同源缺陷也已修**：① 防抖后的搜索值没暴露 → 各页 `hasActiveFilters` 恒假（现由钩子统一判定并暴露 `activeValues`）；② `useDebouncedSearch.setSearchInput` 只改输入框不改防抖值 → 「清除」后请求仍带旧搜索词（现钩子自管防抖，`reset()` 同步复位）。**常驻回归已补**：`frontend/src/__tests__/hooks/useListFilters.test.ts`（6 条，覆盖"空值不进请求 / 改筛选归零 offset / 搜索防抖 / 清除同步复位防抖值 / hasActiveFilters 以偏离初始值判定 / exportParams 与 params 同源"）。回归有效性已验证：把修复退回后其中 2 条确实失败。
3. **导出参数仍手写 `format`**：四个导出端点重复声明 `format` 参数，可考虑并入各自 DTO（与筛选键同源）。
4. **其余域未纳入 DTO 对齐**：records/assignments/classes/versions/notifications 的列表筛选仍是散参数（本次只做了 users/cases/feedback/questionnaires/roles）；`/my-feedback`（学生端）也是手写 params，可一并迁移到 `useListFilters`。
5. **版本页（`/admin/versions`）仍是手写筛选行**：无 `FilterToolbar`/一键复位；其"归因维度"用 `SegmentedControl`（属视图切换，保留）。

---

## 7. 病例管理专项与 AI 生成重建（2026-09-26）

> 触发：维护者要求深入分析病例管理相关功能，并**翻新重做 AI 辅助生成病例**。

### 7.1 现状盘点（代码 + 线上实测）

- 前端病例域 `components/admin/cases/**` 18 个文件 2509 行；核心是 `CaseForm.tsx`（**651 行**，含 AI 面板、表单/JSON 双模式、版本历史、保存/发布）。
- 流程：`CasesPage → CasesTab`（列表 + 筛选）→ 编辑/新建**弹窗**（`CaseForm`）→ 表单或 JSON 模式编辑 → 保存时跑服务端门禁（`CaseValidationReportView`）→ 发布/归档/追加版本（`docs/15` 的病例版本契约）。
- AI 生成：前端面板（两步向导 + 快速/参考模式 + 16 个逐字段按钮）→ `POST /api/cases/generate` → `modules/cases/generation.py`（293 行）：阶段校验、`activities` 逐项合并、`call_json(purpose="case_generation")`、**校验失败自动修复一轮**。

### 7.2 深挖发现（按风险排序）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| 1 | **生成结果直接覆盖编辑态，无字段级差异预览与逐项接受**（原表述写重了：编辑态**已有**最多 10 步快照 + `撤销` 按钮，`fillJson` 前会 `PUSH_SNAPSHOT`；真正缺的是"看到改了什么、只接受其中一部分"） | `CaseForm.tsx` `generateStage`/`generateField` 直接 `SET_JSON`/`SET_FIELD`；`CaseEditorState.tsx:150-157` 快照栈 | 教师手写内容会被一次生成整体覆盖，只能事后整份回退，无法部分采纳 |
| 1b | **本轮已修（A2）**：生成 → 字段级差异 → 逐项勾选 → 应用选中（应用前自动快照） | `components/admin/cases/ai/staging.ts`（纯函数 + 4 条单测）＋ `CaseForm` 差异面板 | 实测：13 项待确认、未应用前无快照、应用后 toast「已应用 12 项（可用撤销回退）」＋撤销按钮出现；未勾选的「病例名称」未写入，并自动触发空骨架防呆 |
| 2 | **无来源标记（provenance）** | 编辑态 JSON 不记录字段来源 | 事后无法审计"哪些内容是 AI 写的"，也无法回溯 |
| 3 | **无进度/计时/取消** | 只有按钮文案变"生成中…"（`:504-510`）；`generateCase` 无 AbortController | LLM 30–120s 期间界面像卡住；关弹窗无法取消（白耗 token） |
| 4 | **失败表达弱** | `setAiError(e.response?.data?.detail \|\| "AI 生成失败")`（`:266/:288`） | 教师只看到一行红字，不知道下一步做什么 |
| 5 | **两步向导不是真 Stepper** | 状态用两个 Badge 的绿/灰（`:455-459`） | 无法表达"当前步/已完成/失败"；且原可空骨架直达第二阶段（**本轮已加防呆**） |
| 6 | **紫色面板是全站唯一紫** | `bg=grape-0` / `c=grape`（10 处） | 与品牌青绿不一致（**本轮已改品牌色**） |
| 7 | **16 个逐字段按钮平铺、无字段状态** | `:516-540` 两组按钮 | 看不出哪些字段还是空的；逐个试的成本高 |
| 8 | **AI 逻辑内联在 651 行表单里** | `aiError/aiBusy/aiMode/generateStage/generateField` 全在 `CaseForm.tsx` | 难测难改，任何调整都碰主表单 |
| 9 | 无成本可见 | 前端不显示本次生成的 tokens/耗时 | 教师无法判断"再生成一次"的代价 |
| 10 | 生成后不提示"距可发布还差什么" | 生成后仅 toast 成功；门禁只在保存/发布时跑 | 教师需再点一次保存才知道不合格 |

### 7.3 重建设计（切片 A0–A4）

**目标**：把 AI 生成从"一键覆盖式黑箱"改成「**可控、可回退、可追溯的协作生成**」。

| 切片 | 内容 | 验收 |
|---|---|---|
| **A0**（本轮已完成） | 配色对齐（紫→品牌青绿）；空骨架禁用"生成教学细节"并给出原因 | 面板背景 `rgb(238,250,246)`（brand-0）；新建病例时该按钮 `disabled=true` + title 说明 ✅ |
| **A1** | 抽出 `components/admin/cases/ai/useCaseAiGeneration.ts` + `AiGenerationPanel.tsx`（行为不变、纯重构）：状态机 `idle/describing/generating/reviewing/applying/error` | `CaseForm.tsx` 行数显著下降；AI 面板行为与现状一致（回归测试：生成/错误/防呆三态） |
| **A2**（本轮已完成） | **暂存 + 差异预览**：生成结果进 staging，展示字段级 diff（当前 → 生成），逐项勾选「应用选中（N）」/「丢弃」，应用前自动 `PUSH_SNAPSHOT`（可撤销） | 生成后编辑态未变；接受后才写入 ✅ |
| **A2 遗留** | 应用后的字段级 provenance 标记（哪些字段来自 AI）未做；差异面板目前只列本次生成涉及的路径 | — |
| **A3**（本轮已完成） | **状态与进度**：字段状态点（灰=空/绿=已填/橙=待应用）、Mantine `Stepper` 表达两步状态、生成计时 + 取消（AbortController） | 实测：Stepper 显示「待生成」；生成中「已用 1s」+ 取消；取消后 8s 内不出现结果（请求确被中断）；字段状态点随暂存变橙 ✅ |
| **A4**（本轮已完成） | **后端增强**：`CallContext.usage` 输出；`/cases/generate` 返回 `elapsed_ms` / `usage`（跨自动修复轮累计）/ `warnings`；逐字段白名单 `KNOWN_GENERATION_FIELDS`；取消走 `CancelledError`（`except Exception` 不吞） | 10 条新单测（用量累计 + 白名单）通过；后端 1480 通过；前端渲染「上次生成：X s · N tokens · 修复提示」有契约测试 ✅（本地 harness 连线上后端，故线上要等部署后才显示真实值） |

### 7.4 病例管理其他待办（非 AI）

1. 病例编辑是**大弹窗**，与 `/admin/records/:id`、`/admin/users/:userId` 等**整页二级页**范式不一致 → 并入 S5 统一（弹窗 vs 整页的判据：是否有多段内容 + 版本/预览等辅助信息）。
2. 病例发布/归档**单向不可撤销**（`UI-CRD-6` 已记）→ 需后端反向端点或明确提示。
3. 生成后未直接展示"距可发布还差什么" → A2 的应用前校验可复用 `CaseValidationReportView`。
4. 病例列表的「学生可见」开关、能力徽章等在 C 端与 JSON 端展示不完全一致（列表列集已在 §6.2 优化）。

## 4. 明确不做

1. 视觉重设计、逐像素还原、换设计语言（保持现有品牌青绿 + Mantine 范式）。
2. 训练引擎/工作区重构（`docs/15` 的 manifest 驱动已是达标实现）。
3. 引入 Tailwind 或第二套组件库（审计 `UI-DS-5` 的结论是删幽灵、不是补依赖）。
4. 后端表结构变更（F1 的软删如需新列，先出迁移方案再定）。
