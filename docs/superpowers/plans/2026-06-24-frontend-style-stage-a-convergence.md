# A 阶段：前端样式对齐与来源收束 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去除前端硬编码颜色与不统一的样式机制，把设计 token 收口为单一来源，并将 5 套弹层抽象合并为 2 基元 + 1 便利层，为 B 阶段品牌化打地基。

**Architecture:** 分 4 个有序 PR：① 重建 token 层（不改组件、视觉零变化）；② 各组件/页面消费 token、清除硬编码色、锁 teal 单一强调色；③ `components/ui/*` 文件改名为小写短横线 + import 清扫；④ 弹层 dialog/alert-dialog/Modal/ConfirmDialog/Sheet 重建为 `dialog.tsx`+`sheet.tsx`+`confirm.tsx` 并迁移 ~50+6 调用点。每 PR 以 `tsc --noEmit` + `biome check` 为门禁。

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind CSS v4（CSS-first 配置，`@theme inline`）+ @base-ui/react + vitest。

**设计依据:** `docs/superpowers/specs/2026-06-24-frontend-style-stage-a-convergence-design.md`

---

## 全局约定

- **验证命令**（在 `frontend/` 下执行）：
  - 类型：`npx tsc --noEmit`
  - 词法：`npx biome check`
  - 单测（弹层回归）：`npx vitest run src/__tests__/admin`
- **提交信息编码**：Windows PowerShell 直接 `git commit -m "中文"` 可能乱码。**含中文的提交一律 `git commit -F <utf8文件>`**（用 Write 工具把信息写到 `C:\Users\FIREDI~1\AppData\Local\Temp\opencode\msg.txt` 再 `-F`）。纯 ASCII 信息可直接 `-m`。
- **提交格式**：`<emoji> <type>: <描述>`（仓库 commit-msg hook 强制）。本计划用到：`🎨 style`、`♻️ refactor`、`🔧 chore`。
- **改动仅限 `frontend/`**；不碰后端、不碰 `*.gen.ts`。

---

## PR-1：Token 层

**File Structure:** 仅改一个文件 `frontend/src/styles/tailwind.css`。新增语义状态 token、`focus-ring` 工具类、海拔阴影 token。**不改任何组件**，本 PR 后视觉零变化（只是多了可用工具类）。

### Task 1.1：新增语义状态 token（light + dark + @theme 映射）

**Files:**
- Modify: `frontend/src/styles/tailwind.css`

- [ ] **Step 1: 在 `@theme inline { ... }` 块内追加颜色映射**

在现有 `--color-*` 映射后追加：
```css
	--color-success: var(--success);
	--color-success-foreground: var(--success-foreground);
	--color-info: var(--info);
	--color-info-foreground: var(--info-foreground);
	--color-warning: var(--warning);
	--color-warning-foreground: var(--warning-foreground);
	--color-danger: var(--danger);
	--color-danger-foreground: var(--danger-foreground);
	--color-neutral: var(--neutral);
	--color-neutral-foreground: var(--neutral-foreground);
```

- [ ] **Step 2: 在 `:root { ... }`（light）块内追加变量**

```css
		--success: #dcfce7;
		--success-foreground: #15803d;
		--info: #dbeafe;
		--info-foreground: #1d4ed8;
		--warning: #fef3c7;
		--warning-foreground: #b45309;
		--danger: #fee2e2;
		--danger-foreground: #b91c1c;
		--neutral: #f3f4f6;
		--neutral-foreground: #4b5563;
```

- [ ] **Step 3: 在 `.dark { ... }` 块内追加变量**

```css
		--success: rgba(20, 83, 45, 0.3);
		--success-foreground: #4ade80;
		--info: rgba(30, 58, 138, 0.3);
		--info-foreground: #60a5fa;
		--warning: rgba(120, 53, 15, 0.3);
		--warning-foreground: #fbbf24;
		--danger: rgba(127, 29, 29, 0.3);
		--danger-foreground: #f87171;
		--neutral: #1f2937;
		--neutral-foreground: #9ca3af;
```

- [ ] **Step 4: 验证类型与词法**

Run（在 `frontend/`）：`npx tsc --noEmit; npx biome check`
Expected: 通过（CSS 变量不参与 tsc，biome 不报错）。

### Task 1.2：新增 `focus-ring` 工具类与海拔阴影 token

**Files:**
- Modify: `frontend/src/styles/tailwind.css`

- [ ] **Step 1: 在 `@theme inline` 块内追加阴影 token**

```css
	--shadow-e1: 0 1px 2px 0 rgb(15 23 42 / 0.06);
	--shadow-e2: 0 4px 12px -2px rgb(15 23 42 / 0.1);
	--shadow-e3: 0 12px 32px -8px rgb(15 23 42 / 0.18);
```
（生成 `shadow-e1` / `shadow-e2` / `shadow-e3` 工具。）

- [ ] **Step 2: 在文件末尾（`@layer utilities` 之外或内）追加 `focus-ring` 工具**

```css
@utility focus-ring {
	@apply outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50;
}
```

- [ ] **Step 3: 验证**

Run：`npx tsc --noEmit; npx biome check`
Expected: 通过。

- [ ] **Step 4: 提交（纯结构，视觉零变化）**

```bash
git add frontend/src/styles/tailwind.css
git commit -F <utf8 msg: "🎨 style: 新增语义状态 token、focus-ring 工具类与海拔阴影 token">
```

---

## PR-2：配色收敛（消费 token + 锁 teal）

**File Structure:** 逐组件/页面把硬编码色替换为 PR-1 的 token；把越权的 blue 强调收敛到 teal。按"基元 → 页面"顺序，便于回归。

### Task 2.1：基元组件消费 token

**Files:**
- Modify: `frontend/src/components/ui/Badge.tsx`
- Modify: `frontend/src/components/ui/StatCard.tsx`
- Modify: `frontend/src/components/ui/SearchInput.tsx`
- Modify: `frontend/src/components/ui/FormField.tsx`
- Modify: `frontend/src/components/ui/Pagination.tsx`

- [ ] **Step 1: Badge.tsx — 5 个语义变体改用 token**

将 `success/info/warning/danger/neutral` 变体的 className 改为：
```
success: "bg-success text-success-foreground"
info:    "bg-info text-info-foreground"
warning: "bg-warning text-warning-foreground"
danger:  "bg-danger text-danger-foreground"
neutral: "bg-neutral text-neutral-foreground"
```
删除原 `bg-green-100 text-green-700 dark:...` 等硬编码（含各自 dark 变体）。

- [ ] **Step 2: StatCard.tsx — color 映射改用 token**

把 `colorConfig`（第 6-27 行）5 组裸色映射改为 token：
```
blue  → "bg-info text-info-foreground"
green → "bg-success text-success-foreground"
amber → "bg-warning text-warning-foreground"
red   → "bg-danger text-danger-foreground"
teal  → "bg-accent text-accent-foreground"
```
并把外层容器 `border border-border`（第 54 行）改为 `ring-1 ring-foreground/10`（统一卡片表面 e0）；hover 的 `hover:shadow-sm` 改为 `hover:shadow-e1`。

- [ ] **Step 3: SearchInput.tsx — 聚焦态改 focus-ring**

第 18 行 `focus:border-blue-500 focus:bg-card` → `focus-ring focus-visible:bg-card`；容器 `border-border` 保持（结构描边）。

- [ ] **Step 4: FormField.tsx — 内部 select/textarea 统一**

把内部 `<select>`/`<textarea>` 的 `rounded-md ... focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`（第 52、72 行）改为 `rounded-lg ... focus-ring`；`h-10` 改 `h-8` 与 Input 对齐；`border` 用 `border-input`。

- [ ] **Step 5: Pagination.tsx — 补聚焦态、对齐圆角/描边**

按钮 `rounded-md border border-border`（第 35、42 行）→ `rounded-lg border border-input focus-ring`。

- [ ] **Step 6: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check`
Expected: 通过。
```bash
git add frontend/src/components/ui/Badge.tsx frontend/src/components/ui/StatCard.tsx frontend/src/components/ui/SearchInput.tsx frontend/src/components/ui/FormField.tsx frontend/src/components/ui/Pagination.tsx
git commit -F <utf8 msg: "🎨 style: 基元组件消费语义 token，统一聚焦环/圆角/描边">
```

### Task 2.2：训练域配色收敛

**Files:**
- Modify: `frontend/src/components/training/...`（ChatBubble、TrainingHeader、EmotionIndicator 除外）
- 具体：`ChatBubble.tsx`、`TrainingHeader.tsx`

- [ ] **Step 1: ChatBubble.tsx**

系统消息 `rounded-xl border border-blue-200 bg-blue-50 ... text-blue-800` → `... border-transparent bg-info text-info-foreground`；主动发问标签 `text-amber-600 ... bg-amber-50` → `bg-warning text-warning-foreground`。

- [ ] **Step 2: TrainingHeader.tsx 计时器状态色**

低时 `border-red-200 bg-red-50 text-red-600` → `bg-danger text-danger-foreground border-transparent`；中时 amber 同理 → warning token。

- [ ] **Step 3: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check`
```bash
git add frontend/src/components/training/ChatBubble.tsx frontend/src/components/training/TrainingHeader.tsx
git commit -F <utf8 msg: "🎨 style: 训练域配色收敛到语义 token">
```

> 注：`EmotionIndicator` 的 emoji 图标**不动**（留 B 阶段）。

### Task 2.3：学生首页 hero 去 blue 越权 + 难度星统一

**Files:**
- Modify: `frontend/src/pages/StudentDashboard.tsx`

- [ ] **Step 1: hero 强调收敛到 teal**

- 第 306、317 行 hero 图标圈 + "病例库 N 例"筹码：`bg-blue-50 text-blue-600` → `bg-accent text-accent-foreground`。
- 第 640 行快捷 QA 提示筹码：`bg-blue-50 text-primary hover:bg-blue-100` → `bg-primary/10 text-primary hover:bg-primary/15`。
- 第 533 行技能分：`text-blue-600` → `text-primary`。

- [ ] **Step 2: 难度星统一为 Lucide Star**

第 381 行的 `"★".repeat(d) + "☆".repeat(3-d)` 字符渲染，替换为 `CaseSelect.tsx` 同款 Lucide `<Star>` 填色法（`fill="#f59e0b"` 用 `text-warning-foreground` + `fill="currentColor"`，空星 `fill="none"`）。从 `lucide-react` 引入 `Star`。

- [ ] **Step 3: 难度徽章底色**

难度徽章 `bg-green-100/amber-100/red-100`（若存在于本页）→ success/warning/danger token。

- [ ] **Step 4: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check`
```bash
git add frontend/src/pages/StudentDashboard.tsx
git commit -F <utf8 msg: "🎨 style: 学生首页 hero 收敛到 teal、难度星统一为图标">
```

### Task 2.4：表格成绩色、CaseSelect 渐变、PluginDashboard

**Files:**
- Modify: `frontend/src/pages/TeacherDashboard.tsx`（成绩色）
- Modify: `frontend/src/pages/CaseSelect.tsx`（amber→yellow 渐变拍平）
- Modify: `frontend/src/components/.../PluginDashboard.tsx`（裸 h1 + 静态色 span）

- [ ] **Step 1: 表格成绩色**

师生表格中 `text-green-600 / text-amber-600 / text-red-600` 的成绩分级色 → `text-success-foreground / text-warning-foreground / text-danger-foreground`。（保留 `text-primary` 档不变。）

- [ ] **Step 2: CaseSelect 提示横幅拍平渐变**

`rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-yellow-50` → `rounded-xl border-transparent bg-warning`，文字色 `text-warning-foreground`。
> 保留 `TrainingConfigModal` 的 `from-primary/5 to-primary/[0.02]` teal 渐变不动。

- [ ] **Step 3: PluginDashboard 规范化**

- 裸 `<h1 class="text-2xl font-bold">` → 改用 `PageHeader` 组件（从 `@/components/ui/PageHeader` 引入；title 传原文案）。
- 静态 `bg-blue-100 text-blue-700` 状态 span → 改用 `Badge`（`@/components/ui/Badge`）对应语义 variant（`info`/`success` 视语义）。

- [ ] **Step 4: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check`
```bash
git add frontend/src/pages/TeacherDashboard.tsx frontend/src/pages/CaseSelect.tsx <PluginDashboard 路径>
git commit -F <utf8 msg: "🎨 style: 成绩色/CaseSelect 横幅/PluginDashboard 收敛">
```

### Task 2.5：全局残余硬编码色扫尾

**Files:** 全 `frontend/src` 扫描

- [ ] **Step 1: 扫描残余硬编码 Tailwind 状态色**

Run（在 `frontend/`）：
```bash
npx rg "(bg|text|border)-(blue|green|amber|red|yellow|gray|slate)-(50|100|200|600|700|800|900)" src --glob "!**/*.gen.ts" -l
```
逐文件核对：属"状态语义"的改为对应 token；属"强调"的改 primary；`gray-*` 文本改 `muted-foreground`/`foreground`。**保留**：图表色（`chart-*` 体系）、`EmotionIndicator` emoji、明确属 B 阶段的装饰。

- [ ] **Step 2: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check`
```bash
git add -A frontend/src
git commit -F <utf8 msg: "🎨 style: 清除残余硬编码状态色">
```

---

## PR-3：命名统一（components/ui 改小写短横线）

**File Structure:** 17 个 PascalCase 文件改名 + 全树 import 路径更新 + ui 内 default 导出改 named。`Modal.tsx`/`ConfirmDialog.tsx`/`alert-dialog.tsx` 不在本 PR（PR-4 处理）。

### Task 3.1：批量改名（Windows 大小写两步法）

**Files:** 见映射表（不含 Modal/ConfirmDialog）

改名映射：
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

- [ ] **Step 1: 逐个 `git mv` 两步法**

对每个仅改大小写/驼峰的文件（在 `frontend/src/components/ui/`），执行两步（示例 Button）：
```bash
git mv Button.tsx button.tmp.tsx
git mv button.tmp.tsx button.tsx
```
多词驼峰（如 `StatCard.tsx → stat-card.tsx`）大小写不冲突，可一步 `git mv StatCard.tsx stat-card.tsx`，但仍 `git status` 确认已记录为 rename。

- [ ] **Step 2: 确认全部改名被 git 记录**

Run：`git status --short`
Expected: 每个文件显示 `R  old -> new`，无残留旧名。

### Task 3.2：import 路径全树清扫 + 导出风格统一

**Files:** 全 `frontend/src`

- [ ] **Step 1: 替换 import 路径**

对每个改名文件，全树替换 `@/components/ui/<旧名>` → `@/components/ui/<新名>`。建议逐个用 rg 定位：
```bash
npx rg "@/components/ui/(Button|Badge|Tabs|Tooltip|Sheet|FormField|Pagination|ModeToggle|PageHeader|StatCard|EmptyState|LoadingState|LoadingSkeleton|SearchInput|ChartTooltip)" src -l
```
逐文件编辑改为新路径。**仅改路径字符串，不改导入的标识符**（`{ Button }` 不变）。

- [ ] **Step 2: ui 内 default 导出改 named**

`sheet.tsx` 若为 `export default function Sheet` → 改为 `export function Sheet`；其调用点 `import Sheet from ".../sheet"` → `import { Sheet } from ".../sheet"`。（`Modal` 将于 PR-4 删除，不处理。）

- [ ] **Step 3: 验证（关键门禁）**

Run：`npx tsc --noEmit; npx biome check`
Expected: 通过（任何漏改的 import 会被 tsc 报 `Cannot find module`）。

- [ ] **Step 4: 跑一次单测确保无破坏**

Run：`npx vitest run`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
git add -A frontend/src
git commit -F <utf8 msg: "♻️ refactor: components/ui 文件名统一为小写短横线并清扫 import">
```

---

## PR-4：弹层 5→3 合并

**File Structure（目标）:**
- `frontend/src/components/ui/dialog.tsx` — 基元①，合并 dialog + alert-dialog + Modal。
- `frontend/src/components/ui/sheet.tsx` — 基元②，迁到 Base UI。
- `frontend/src/components/ui/confirm.tsx` — 便利层（ConfirmProvider + useConfirm + ConfirmDialog）。
- 删除：`alert-dialog.tsx`、`Modal.tsx`、`ConfirmDialog.tsx`。

**统一样式值（写入 dialog.tsx / sheet.tsx）:** 内边距 `p-6`；圆角 `rounded-xl`（Sheet 底 `rounded-t-2xl`）；表面 `ring-1 ring-foreground/10`（Sheet `shadow-e3`）；遮罩 `bg-black/30 backdrop-blur-xs z-50`；关闭键 `top-3 right-3 size-9 rounded-lg hover:bg-muted`；动画进出皆 `duration-200`；`max-h-[85vh]`；size:dialog `sm400/md480/lg640`、alert·confirm `sm360/md420/lg480`；页脚 `-mx-6 -mb-6 border-t bg-muted/50 px-6 py-4 rounded-b-xl`。

### Task 4.1：扩建 dialog.tsx（吸收 alert-dialog + Modal）

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx`
- Read first: 现 `dialog.tsx`、`alert-dialog.tsx`、`Modal.tsx`（理解现 Base UI API 用法后再合并）

- [ ] **Step 1: 先读三文件**，确认 `@base-ui/react/dialog` 现用法与 `alert-dialog` 的 Media/Action/Cancel 子组件实现。

- [ ] **Step 2: 扩展 `DialogContent` props 与样式**

`DialogContent` 增加 props（保留向后兼容默认值）：
```ts
type DialogContentProps = DialogPrimitive.Popup.Props & {
  variant?: "dialog" | "alert" | "confirm"; // 默认 "dialog"
  size?: "sm" | "md" | "lg";                 // 默认 "md"
  showCloseButton?: boolean;                 // dialog 默认 true；alert/confirm 默认 false
  maxWidth?: number;                          // 覆盖 size
  title?: React.ReactNode;                    // 便利：内部渲染 DialogHeader>DialogTitle
};
```
内容 className 按统一样式值改：`p-6`、`rounded-xl`、`ring-1 ring-foreground/10`、`max-h-[85vh]`、动画 `duration-200`（进出一致）；size→max-w 用 data-attr 或内联（dialog sm/md/lg = 400/480/640，alert·confirm = 360/420/480）；`maxWidth` 走内联 style 覆盖。遮罩改 `bg-black/30 backdrop-blur-xs z-50`。关闭键 `top-3 right-3 size-9 rounded-lg hover:bg-muted`。

- [ ] **Step 3: 吸收 alert-dialog 子组件**

把 `AlertDialogMedia` / `AlertDialogAction` / `AlertDialogCancel` 迁入本文件，分别导出为 `DialogMedia` / `DialogAction` / `DialogCancel`（`DialogAction`、`DialogCancel` 基于现有 `Button`）。`variant="alert"|"confirm"` 时 Header 居中、无自动关闭 X。

- [ ] **Step 4: 页脚 negative-margin 适配 p-6**

`DialogFooter` 的 `-mx-4 -mb-4 ... p-4` → `-mx-6 -mb-6 ... px-6 py-4`。

- [ ] **Step 5: 验证类型**

Run：`npx tsc --noEmit`
Expected: dialog.tsx 自身通过（调用点暂未迁移，会有其它报错，聚焦看本文件无类型错）。

### Task 4.2：迁移 sheet.tsx 到 Base UI

**Files:**
- Modify: `frontend/src/components/ui/sheet.tsx`

- [ ] **Step 1: 用 `@base-ui/react/dialog` 重写 Sheet**

以 Dialog Portal/Backdrop/Popup 为底，Popup 用 `side`（left/right/bottom）定位 + 进出 translate 动画（`duration-200`）。保留 props：`open/onClose/side/size/children`，导出为 named `Sheet`。样式：遮罩 `bg-black/30 backdrop-blur-xs z-50`；面板 `shadow-e3`，bottom 变体 `rounded-t-2xl`；关闭键 `top-3 right-3 size-9 rounded-lg`。补焦点陷阱/ARIA（Base UI 自带）。

- [ ] **Step 2: 更新唯一调用点**

`frontend/src/components/teacher/CallLogDetail.tsx:85`：确保 `import { Sheet } from "@/components/ui/sheet"`，props 不变。

- [ ] **Step 3: 验证**

Run：`npx tsc --noEmit`（聚焦 sheet.tsx 与 CallLogDetail 无类型错）

### Task 4.3：新建 confirm.tsx，删除 ConfirmDialog.tsx

**Files:**
- Create: `frontend/src/components/ui/confirm.tsx`
- Delete: `frontend/src/components/ui/ConfirmDialog.tsx`

- [ ] **Step 1: 写 confirm.tsx**

导出 `ConfirmProvider`、`useConfirm`、`ConfirmDialog`，三者共用一个内部渲染函数（消除原 ~90% 重复），底层渲染 `<Dialog open><DialogContent variant="confirm" size="md">`，含 `DialogMedia`（AlertTriangle，danger 用 `bg-danger text-danger-foreground`、normal 用 `bg-warning text-warning-foreground`）、标题/描述、`DialogCancel`/`DialogAction`（danger 用 `bg-destructive hover:bg-destructive/90`）。`useConfirm` 保持 `confirm(opts): Promise<boolean>` 签名。关闭键文本色用 `text-muted-foreground hover:text-foreground`。`ConfirmOptions` 去掉未用的 `confirmText` 字段。

- [ ] **Step 2: 删除旧文件**

```bash
git rm frontend/src/components/ui/ConfirmDialog.tsx
```

- [ ] **Step 3: 更新 confirm 调用点 import 路径（机械，18 处）**

把以下文件的 `@/components/ui/ConfirmDialog` → `@/components/ui/confirm`（API 不变）：
`App.tsx:81`(ConfirmProvider)、`pages/QA.tsx`、`pages/History.tsx`、`pages/admin/SchoolsPage.tsx`、`RolesPage.tsx`、`PracticesPage.tsx`、`GradesClassesPage.tsx`、`AssignmentsPage.tsx`、`pages/admin/SystemNotificationsPage.tsx`(ConfirmDialog 声明式)、`components/teacher/ApiManagementTab.tsx`、`PromptManagementTab.tsx`、`components/teacher/cases/useCaseMutations.ts`、`UsersTab.tsx`、`QuestionnairesTab.tsx`、`components/teacher/RubricTab.tsx`(ConfirmDialog 声明式)、测试 `src/__tests__/admin/ConfirmDialog.test.tsx`。

用定位：`npx rg "components/ui/ConfirmDialog" src -l`，逐文件改路径。

- [ ] **Step 4: 验证（含单测）**

Run：`npx tsc --noEmit; npx vitest run src/__tests__/admin`
Expected: 通过（ConfirmDialog.test.tsx 作为回归门禁）。

### Task 4.4：删除 alert-dialog.tsx，迁移 30 处 Modal → Dialog

**Files:**
- Delete: `frontend/src/components/ui/alert-dialog.tsx`、`frontend/src/components/ui/Modal.tsx`
- Modify: 30 处 Modal 调用点（见表）

**标准迁移模式（每处套用）:**
```tsx
// 旧：
<Modal open={open} onClose={onClose} title="标题" maxWidth={480}>
  {body}
</Modal>
// 新：
<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
  <DialogContent title="标题" maxWidth={480}>
    {body}
  </DialogContent>
</Dialog>
```
带 `footer={<>...</>}` 的：把 footer 内容放进 `<DialogFooter>...</DialogFooter>` 作为 children 末尾。`import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog"`。

- [ ] **Step 1: 删除 alert-dialog.tsx（已被 dialog.tsx 吸收）**

```bash
git rm frontend/src/components/ui/alert-dialog.tsx
```
确认无残余 import：`npx rg "components/ui/alert-dialog" src`（应为空；confirm.tsx 已改用 dialog）。

- [ ] **Step 2: 逐处迁移 Modal 调用点**

调用点清单（file:line，maxWidth/footer 标注）：
| 文件 | 行 | maxWidth | footer |
|---|---|---|---|
| components/Layout.tsx | 314 | 560 | 无 |
| components/FeedbackModal.tsx | 80 | 480 | 无 |
| components/QuestionnaireModal.tsx | 97 | 700 | 无 |
| pages/Profile.tsx | 212 | 默认 | 无 |
| pages/MyResponses.tsx | 38 | 默认 | 无 |
| components/training/TrainingHeader.tsx | 324 | 420 | 无 |
| components/training/TrainingConfigModal.tsx | 46 | 480 | 无 |
| components/teacher/cases/CaseForm.tsx | 236 | 900 | 有 |
| components/teacher/ConfigModal.tsx | 167 | 默认 | 有 |
| components/teacher/PromptManagementTab.tsx | 303 | 800 | 无 |
| components/teacher/QARecordsTab.tsx | 163 | 默认 | 无 |
| components/teacher/SecretModal.tsx | 88 | 480 | 有 |
| components/teacher/RubricTab.tsx | 315 | 默认 | 无 |
| components/teacher/users/UserForm.tsx | 159, 280 | 默认/780 | 有/无 |
| components/teacher/users/BatchImport.tsx | 124 | 默认 | 无 |
| components/teacher/questionnaires/QuestionnaireEditor.tsx | 80 | 800 | 无 |
| components/teacher/questionnaires/QuestionnaireAssign.tsx | 58 | 默认 | 无 |
| pages/admin/SchoolsPage.tsx | 205 | 默认 | 无 |
| pages/admin/RolesPage.tsx | 258 | 默认 | 无 |
| pages/admin/PracticesPage.tsx | 226 | 默认 | 无 |
| pages/admin/GradesClassesPage.tsx | 327 | 默认 | 无 |
| pages/admin/AssignmentsPage.tsx | 271 | 默认 | 无 |
| pages/admin/SystemNotificationsPage.tsx | 155 | 默认 | 无 |
| pages/admin/cost/VoiceTokenCard.tsx | 114 | 560 | 无 |

每处按标准模式套用。

- [ ] **Step 3: TrainingHeader 两处手搓确认改用 useConfirm**

`TrainingHeader.tsx:282`（结束训练）、`:305`（训练时间到）原是 Modal + 手搓按钮 → 改用 `useConfirm`（`const ok = await confirm({ title, message, danger })`），删除内嵌按钮 JSX。

- [ ] **Step 4: 删除 Modal.tsx**

```bash
git rm frontend/src/components/ui/Modal.tsx
```
确认无残余：`npx rg "components/ui/Modal" src`（应为空）。

- [ ] **Step 5: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check; npx vitest run src/__tests__/admin`
Expected: 全绿。
```bash
git add -A frontend/src
git commit -F <utf8 msg: "♻️ refactor: 弹层合并为 dialog+sheet+confirm，迁移 Modal/Confirm 调用点">
```

### Task 4.5：6 处手搓 overlay 迁移

**Files:**
- Modify: `frontend/src/components/training/panels/scoring-display/ScoreCard.tsx:143`
- Modify: `frontend/src/components/qa/CitationCard.tsx:68`
- Modify: `frontend/src/components/training/panels/questionnaire/QuestionnaireOverlay.tsx:106`
- Modify: `frontend/src/components/training/PanelHost.tsx:54`
- Modify: `frontend/src/components/NotificationBell.tsx:91`（需现场核对 UX）
- Modify: `frontend/src/components/RecordReview/ReviewEditor.tsx:77`（全屏，需现场核对）

- [ ] **Step 1: 直迁 Dialog（3 处）**

`ScoreCard`、`CitationCard`、`QuestionnaireOverlay`：把手搓 `fixed inset-0 z-50 bg-black/...` + 内层卡片，替换为 `<Dialog open onOpenChange><DialogContent size="lg">…</DialogContent></Dialog>`，删除手搓遮罩/定位 className，由 Dialog 统一。

- [ ] **Step 2: 直迁 Sheet 底（1 处）**

`PanelHost.tsx:54` 移动端底部面板 → `<Sheet open onClose side="bottom" size="lg">`。

- [ ] **Step 3: NotificationBell 迁移 + 核对**

`NotificationBell.tsx:91` 现为 `fixed inset-0 bg-black/40` + `max-w-sm` 浮层 → 迁 `<Dialog><DialogContent size="sm">`。**迁后人工核对**：通知列表的弹出位置/滚动/关闭行为与原一致；若原为"贴右上角"定位且产品需要保留，则保留为浮层但统一遮罩为 `bg-black/30 backdrop-blur-xs` 并复用关闭键样式（不强迁 Dialog）。

- [ ] **Step 4: ReviewEditor 迁移 + 核对**

`ReviewEditor.tsx:77` 全屏 `bg-background/80 backdrop-blur-sm z-[200]` → 迁 `<Dialog>` 全屏变体（`maxWidth` 给大值或加 fullscreen 处理）。**迁后人工核对**全屏编辑布局不变。

- [ ] **Step 5: 验证 + 提交**

Run：`npx tsc --noEmit; npx biome check`
```bash
git add -A frontend/src
git commit -F <utf8 msg: "♻️ refactor: 6 处手搓 overlay 迁移到统一 Dialog/Sheet">
```

---

## 收尾验证（全 PR 完成后）

- [ ] **全量门禁**

Run（在 `frontend/`）：`npx tsc --noEmit; npx biome check; npx vitest run`
Expected: 全绿。

- [ ] **残余审计**

Run：`npx rg "components/ui/(Modal|ConfirmDialog|alert-dialog)" src`（应为空）；`npx rg "ring-offset-2|focus:border-blue" src`（应为空）。

- [ ] **人工冒烟**（dev 启动后）

学生首页 hero（teal）、CaseSelect、训练对话/评分卡、各 admin 表单弹窗、确认删除、CallLog 侧栏、通知浮层、全屏复核编辑 — 均显示正常、深浅色模式无回归。

---

## 自检记录（计划 vs spec）

- spec §4 Token 层 → PR-1 ✔
- spec §5 配色收敛（A/B/C/D 全部）→ PR-2 Task 2.1-2.5 ✔（emoji 明确不动）
- spec §6 命名 + Windows 大小写 + import 清扫 + 导出统一 → PR-3 ✔
- spec §7 弹层 5→3 + 统一样式值 + ~50+6 迁移 + 2 处现场核对 → PR-4 Task 4.1-4.5 ✔
- spec §8 验证（tsc/biome/vitest + 冒烟）→ 各 PR 末 + 收尾 ✔
- 类型一致性：`DialogContent` props、`useConfirm` 签名、`Sheet` named 导出在 PR-3/PR-4 间一致 ✔
