# A 阶段:前端样式对齐与来源收束 — 设计文档

**日期**: 2026-06-24
**阶段**: A（地基整理。B 阶段才做品牌视觉化）
**目标读者**: 实施该重构的工程师 / 后续 writing-plans
**容忍度**: 产品处于原型期，允许可见视觉变化与代码重构；本阶段不强制测试核对单（仅 tag push 时按仓库 hook 要求补）。

---

## 1. 背景与目标

前端是一套执行良好的 shadcn/Base-UI 脚手架 + 一次 teal 配色替换，缺少"被锁定的设计语言"，导致：
- **配色不统一**：主色是 teal，但主入口 hero、StatCard、Badge、SearchInput 等大量**硬编码 blue/green/amber/red**，主色被稀释、blue 越权当强调色。
- **样式机制三套并存**：聚焦环 `ring-3` / `ring-2+offset` / `border-blue-500` / 无；卡片描边 `ring-1` vs `border-border` vs `border-input`；圆角与阴影无统一海拔语言。
- **命名混用**：`components/ui/*` 17 个 PascalCase + 12 个小写。
- **弹层抽象重叠**：dialog / alert-dialog / Modal / ConfirmDialog / Sheet 五套，padding `p-4` vs `px-6`、遮罩 `black/10` vs `black/40` 等互相打架。

**A 阶段目标**：去硬编码、去不统一，把样式收口成单一来源，为 B 阶段品牌化打地基。

## 2. 范围与非目标

**纳入 A（本文档）**
1. Token 层重建（语义状态 token、单一聚焦环、海拔/圆角/描边规范）。
2. 配色收敛（强调轴 → teal；状态轴 → 语义 token；清除全部硬编码色）。
3. 文件命名统一（`components/ui/*` → 小写短横线）。
4. 弹层 5→3 合并（Dialog + Sheet 两基元 + confirm 便利层），含 6 处手搓 overlay 迁移。

**非目标（留 B 阶段）**
- emoji 情绪图标替换（`EmotionIndicator` 😐😟😰… 保持不动）。
- 新字体 / 展示字阶 / 插画 / 英雄图 / `bg-grid-medical` 母题化等品牌视觉。
- 装饰性渐变体系。
- `FloatingPanelHost` 浮动栏改造（属交互/功能改造）。

## 3. 执行方案（方案 1：Token 优先 · 分层）

按层推进，每层一个可审 PR，最大限度降低返工：
1. **PR-1 Token 层**：改 `frontend/src/styles/tailwind.css`，新增语义 token、`focus-ring` 工具类、海拔阴影 token。无组件改动，视觉零变化（仅新增可用 token）。
2. **PR-2 配色收敛**：各 primitive / 页面消费 token，清除硬编码色，锁 teal 单一强调色（含 §5 映射表）。
3. **PR-3 命名统一**：`components/ui/*` 改名 + import 全树清扫 + 导出风格统一。
4. **PR-4 弹层合并**：dialog/sheet/confirm 重建 + ~50 调用点迁移 + 6 处手搓 overlay。

`tsc --noEmit` + `biome check`（前端）与 `ruff/ty`（后端无关，可跳）作为每个 PR 的兜底门禁。

---

## 4. 第 1 节 — Token 层

### 4.1 核心原则：强调轴与状态轴分离
- **强调轴（单一）**：`--primary`（teal）是唯一品牌/交互/强调色。CTA、选中、hero、链接、进度、聚焦一律 teal。
- **状态轴（语义，独立）**：success / info / warning / danger / neutral 是状态信号，各自保留色相，但**全部走 token**，不再裸写 Tailwind 调色板。

### 4.2 新增语义状态 token
取值对齐现有硬编码（Badge 用 `-100/-700` 系），故视觉基本不变、仅去硬编码。StatCard 原用 `-50` 档将轻微变浅到 token 的 `-100`，原型期可接受。

`:root`（light）新增：
```css
--success: #dcfce7;            --success-foreground: #15803d;
--info: #dbeafe;              --info-foreground: #1d4ed8;
--warning: #fef3c7;          --warning-foreground: #b45309;
--danger: #fee2e2;           --danger-foreground: #b91c1c;
--neutral: #f3f4f6;          --neutral-foreground: #4b5563;
```
`.dark` 新增：
```css
--success: rgba(20,83,45,0.30);   --success-foreground: #4ade80;
--info: rgba(30,58,138,0.30);    --info-foreground: #60a5fa;
--warning: rgba(120,53,15,0.30); --warning-foreground: #fbbf24;
--danger: rgba(127,29,29,0.30);  --danger-foreground: #f87171;
--neutral: #1f2937;              --neutral-foreground: #9ca3af;
```
`@theme inline` 映射（生成 `bg-success` / `text-success-foreground` 等工具）：
```css
--color-success: var(--success);   --color-success-foreground: var(--success-foreground);
--color-info: var(--info);         --color-info-foreground: var(--info-foreground);
--color-warning: var(--warning);   --color-warning-foreground: var(--warning-foreground);
--color-danger: var(--danger);     --color-danger-foreground: var(--danger-foreground);
--color-neutral: var(--neutral);   --color-neutral-foreground: var(--neutral-foreground);
```
> 注：`--destructive`（#dc2626 填充强色）保留用于"填充式危险按钮"；新增的 `--danger`（subtle 底）用于徽章/提示等弱底场景，二者分工不同。

### 4.3 聚焦环（单一）
唯一标准：`ring-3 ring-ring/50` 无 offset。封装工具类复用：
```css
@utility focus-ring {
  @apply outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50;
}
```
废除：`FormField` 的 `ring-2 + ring-offset-2`、`SearchInput` 的 `focus:border-blue-500`；补 `Pagination` 缺失的聚焦态。

### 4.4 卡片表面（单一）
一律 `ring-1 ring-foreground/10`（即海拔 `e0`）。`StatCard` 由 `border border-border` 收口到此。

### 4.5 海拔尺度（4 级，阴影按中性色着色，非纯黑）
```css
/* :root 与 @theme inline 中定义，生成 shadow-e1/e2/e3 工具 */
--shadow-e1: 0 1px 2px 0 rgb(15 23 42 / 0.06);
--shadow-e2: 0 4px 12px -2px rgb(15 23 42 / 0.10);
--shadow-e3: 0 12px 32px -8px rgb(15 23 42 / 0.18);
```
- `e0` 仅 ring（卡片/对话框）
- `e1`（hover/抬起，取代各处 `shadow-sm`）
- `e2`（下拉/Select/弹出，取代 `shadow-md`）
- `e3`（Sheet/全屏 overlay，取代 `shadow-2xl/xl/lg`）

### 4.6 圆角应用规则（锁定语义）
| 半径 | 用途 |
|---|---|
| pill (`rounded-4xl`/full) | Badge、筹码、头像、图标圆 |
| `rounded-xl` | 卡片、对话框（modal） |
| `rounded-lg` | 按钮、输入、Select 触发器；**浮层**(下拉/Select 内容/Tooltip/Popover) |
| `rounded-md` | 列表项、内层元素 |
| `rounded`(4px) | 骨架线 |

> 浮层(floating popup)与对话框(modal)分属两类：浮层一律 `rounded-lg`，仅 modal 用 `rounded-xl`。Select/Dropdown 内容现为 `rounded-lg`，正确，不改。

消除越界：`Pagination`(md→lg)、`FormField` 内 select/textarea(md→lg)。

### 4.7 描边语义二分
- **表单控件**（input/select/textarea/触发器）→ `border-input`
- **卡片/分隔/结构** → `border`
两者当前同值（#e2e8f0），保留双名以备 B 阶段分化，但用法锁死，不再混用。

---

## 5. 第 2 节 — 配色收敛映射表

### A. 强调越界 → 收敛到 teal
| 位置 | 现状 | 改为 |
|---|---|---|
| `StudentDashboard.tsx:306,317` hero 图标圈 + "病例库 N 例"筹码 | `bg-blue-50 text-blue-600` | `bg-accent text-accent-foreground` |
| `StudentDashboard.tsx:640` 快捷 QA 提示筹码 | `bg-blue-50 text-primary` | `bg-primary/10 text-primary` |
| `StudentDashboard.tsx:533` 技能分 | `text-blue-600` | `text-primary` |
| `SearchInput.tsx:18` 聚焦态 | `focus:border-blue-500` | `focus-ring`（§4.3） |

### B. 状态语义 → 收敛到语义 token（视觉基本不变）
| 位置 | 现状 | 改为 |
|---|---|---|
| `Badge.tsx:23-29` success/info/warning/danger/neutral | 裸 `green-100`… | `bg-{token} text-{token}-foreground` |
| `StatCard.tsx:6-27` color 映射 | 5 组裸色 | blue→info、green→success、amber→warning、red→danger、teal→primary |
| `ConfirmDialog` 图标圈 | `bg-red-50/amber-50` | `bg-danger / bg-warning` |
| `ConfirmDialog` 关闭键 | `text-gray-400 hover:text-gray-600` | `text-muted-foreground hover:text-foreground` |
| `ChatBubble` 系统消息 | `border-blue-200 bg-blue-50 text-blue-800` | info token |
| `ChatBubble` 主动发问标签 | `bg-amber-50 text-amber-600` | warning token |
| `TrainingHeader` 计时器红/琥珀态 | `bg-red-50 border-red-200`… | danger / warning token |
| 师生表格成绩色 `text-green/amber/red-600` | 裸色 | `text-{success/warning/danger}-foreground` |
| 难度徽章 `bg-green-100/amber-100/red-100` | 裸色 | success/warning/danger token |

### C. 结构性顺手收口
- **难度星统一**：废弃 `StudentDashboard.tsx:381` 的 `★/☆` 字符，统一用 `CaseSelect` 的 Lucide `<Star>` 填色法。
- **PluginDashboard**：`bg-blue-100 text-blue-700` 静态 span → `Badge variant`；裸 `<h1>` → `PageHeader`。

### D. 渐变处理
- **保留**：`TrainingConfigModal` 的 `from-primary/5 to-primary/[0.02]`（teal 基、和谐）。
- **拍平**：`CaseSelect` 的 `from-amber-50 to-yellow-50` → warning token 纯色面（离散装饰渐变留 B 阶段统一）。

---

## 6. 第 3 节 — 命名统一 + 改名映射

### 6.1 约定（明确二分）
- `components/ui/*` 设计基元 → **小写短横线**文件名（库层）。
- 功能/页面组件（`FeedbackModal.tsx`、`pages/*`）→ **保持 PascalCase**（应用层）。
- **组件标识符不变**：`button.tsx` 仍 `export { Button }`；仅改文件名 + import 路径。

### 6.2 改名映射
`Modal.tsx` / `ConfirmDialog.tsx` 由 §7 弹层合并处理，不在此表。

| 现 | 新 | 现 | 新 |
|---|---|---|---|
| Button.tsx | button.tsx | PageHeader.tsx | page-header.tsx |
| Badge.tsx | badge.tsx | StatCard.tsx | stat-card.tsx |
| Tabs.tsx | tabs.tsx | EmptyState.tsx | empty-state.tsx |
| Tooltip.tsx | tooltip.tsx | LoadingState.tsx | loading-state.tsx |
| Sheet.tsx | sheet.tsx | LoadingSkeleton.tsx | loading-skeleton.tsx |
| FormField.tsx | form-field.tsx | SearchInput.tsx | search-input.tsx |
| Pagination.tsx | pagination.tsx | ChartTooltip.tsx | chart-tooltip.tsx |
| ModeToggle.tsx | mode-toggle.tsx | | |

已小写的 12 个不动（`alert-dialog.tsx` 将由 §7 删除）。

### 6.3 执行要点
1. **Windows 大小写陷阱**：仅改大小写的改名（如 `Button.tsx→button.tsx`）在 win32（大小写不敏感 FS）下 git 检测不到。必须用 **`git mv` 两步法**（`Button.tsx`→`button.tmp.tsx`→`button.tsx`）或 `git mv -f`，逐个验证已被 git 记录。
2. **import 全量清扫**：`@/components/ui/Button` → `@/components/ui/button` 等，跨全树替换；`tsc --noEmit` + `biome check` 兜底查漏。
3. **导出风格统一**：`ui/*` 内 default 导出（`Sheet`）改 named 导出（`Modal` 将删除，无需处理）。

---

## 7. 第 4 节 — 弹层 5→3 合并

### 7.1 目标文件结构
| 文件 | 角色 | 来源 |
|---|---|---|
| `dialog.tsx` | 基元①·居中弹窗 | 合并 dialog + alert-dialog + Modal |
| `sheet.tsx` | 基元②·侧/底面板 | Sheet 迁到 Base UI（补焦点陷阱/ARIA/退场动画） |
| `confirm.tsx` | 便利层·确认 | ConfirmProvider + useConfirm + ConfirmDialog，内部渲染 `Dialog variant="confirm"`，去重 ~90% |
| ~~alert-dialog.tsx~~ | 删除 | 并入 dialog |
| ~~Modal.tsx~~ | 删除 | 并入 dialog（`variant="dialog"` + 便利 `title`） |
| ~~ConfirmDialog.tsx~~ | 删除 | 被 confirm.tsx 替换 |

### 7.2 `DialogContent` 目标 API
```ts
interface DialogContentProps {
  variant?: "dialog" | "alert" | "confirm";   // 默认 dialog
  size?: "sm" | "md" | "lg";
  showCloseButton?: boolean;                    // dialog 默认 true；alert/confirm 默认 false
  maxWidth?: number;                            // 覆盖 size
  title?: ReactNode;                            // 便利：省去 <DialogHeader><DialogTitle>
}
```
吸收子组件：`DialogAction`（Button）、`DialogCancel`（outline Button + Close）、`DialogMedia`（图标容器）。

### 7.3 统一样式值（全弹层唯一，对齐 §4）
| 项 | 值 |
|---|---|
| 内边距 | `p-6` |
| 圆角 | `rounded-xl`（Sheet 底 `rounded-t-2xl`） |
| 表面 | `ring-1 ring-foreground/10`（e0）；Sheet 用 `shadow-e3` |
| 遮罩 | `bg-black/30 backdrop-blur-xs z-50`（收口 black/10、black/40） |
| 关闭键 | `top-3 right-3 size-9 rounded-lg hover:bg-muted` |
| 动画 | 进出皆 `duration-200` |
| 最大高 | `max-h-[85vh]` |
| size:dialog | sm 400 / md 480 / lg 640 |
| size:alert·confirm | sm 360 / md 420 / lg 480 |
| 页脚 | `-mx-6 -mb-6 border-t bg-muted/50 px-6 py-4 rounded-b-xl` |

### 7.4 迁移面（~50 + 6）
- **30 个 Modal** → `<Dialog open onOpenChange><DialogContent title size>…</DialogContent></Dialog>`；5 处带 `footer` 拆为 `<DialogFooter>`；`TrainingHeader.tsx:282,305` 两处手搓确认改用 `useConfirm`。
- **18 个 confirm**（16 `useConfirm` + 2 `ConfirmDialog` 声明式 + `App.tsx:81` Provider + 1 测试）→ 仅改 import `…/ConfirmDialog`→`…/confirm`（机械）。
- **1 个 Sheet**（`CallLogDetail.tsx:85`）→ `…/sheet`、named 导出、props 规范化。
- **6 处手搓 overlay 纳入 A**：
  - 直迁 Dialog：`ScoreCard.tsx:143`、`CitationCard.tsx:68`、`QuestionnaireOverlay.tsx:106`
  - 直迁 Sheet（底）：`PanelHost.tsx:54`
  - **需现场核对 UX 不变**：`NotificationBell.tsx:91`（实为定位浮层，迁 Dialog 后确认列表位置/交互不变）、`ReviewEditor.tsx:77`（全屏 `z-[200]`，需 dialog 全屏处理或保留专用 fullscreen 变体）
- **`FloatingPanelHost.tsx` 留 B**（浮动栏交互改造）。

---

## 8. 验证

每个 PR：
```bash
cd frontend; npx tsc --noEmit; npx biome check
```
- PR-1（token）：构建通过、视觉零变化。
- PR-2/3/4：tsc + biome 全绿；人工冒烟关键面（学生首页 hero、CaseSelect、训练对话/评分、各 admin 表单弹窗、确认删除、CallLog 侧栏、通知浮层）。
- 原型期不强制测试核对单；若后续 tag push，按仓库 pre-push hook 另补 `docs/testing/checklist-{tag}.md`。

## 9. 风险与缓解
| 风险 | 缓解 |
|---|---|
| 30 处 Modal→Dialog JSX 重构出错 | 便利 `title` prop 压低改动；逐文件改 + tsc 兜底；`CaseForm.tsx:236`(maxWidth 900 复杂表单) 单独仔细测 |
| Windows 大小写改名丢失 | `git mv` 两步法，逐个 `git status` 验证 |
| 手搓 overlay 迁移改变 UX | NotificationBell / ReviewEditor 两处迁移后人工核对；必要时保留专用变体 |
| 语义 token 取值与原硬编码细微差异 | 取值对齐 Badge `-100/-700` 系；StatCard 由 `-50` 轻微变浅，原型期接受 |

## 10. Stage B 跟进（不在本阶段）
emoji→自有情绪图标；Geist 展示字阶 + `tabular-nums`；`bg-grid-medical` 母题化；插画/英雄图；装饰渐变体系；`FloatingPanelHost` 改造；把 ScoringOverlay 终端美学 / 情绪配色提炼为全局母题。
