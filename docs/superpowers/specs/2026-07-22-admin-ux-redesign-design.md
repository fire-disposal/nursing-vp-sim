# Admin UX Redesign — 设计规格

**版本**: v2026.07.22  
**范围**: 管理员端信息架构 + 页面布局去模板化 + UI 微交互  
**新增依赖**: `motion`（动画库，~12KB gzipped）

---

## 一、设计愿景

当前管理端 UX 的本质是 **"API 资源 → 路由 → 菜单项"的 1:1:1 直线映射**：后端一个表，前端一个页面，侧边栏一个菜单项。13 个管理菜单平铺在一个标签下，14 个页面共用 `PageHeader + Filters + Table + Pagination` 模板。

目标：将管理端从 **"接口目录"** 重构为 **"任务中心"**，按教师/管理员的心智模型组织信息架构，用合适的容器类型承载不同本质的信息。

### 指导性原则

| 原则 | 说明 |
|------|------|
| **信息本质决定容器** | 病例是"内容"→ 卡片画廊；用户是"人"→ 人员目录；日志是"流"→ 时间线；数据是"表"→ 保留表格 |
| **现有组件组装优先** | 所有新页面用现有的 `Card`、`StatCard`、`Badge`、`Button`、`EmptyState`、`LoadingSkeleton` 组装，不引入新 npm 包（`motion` 除外） |
| **渐进迁移** | 旧页面保留不动，新页面并行开发，路由逐个切换，零回滚风险 |
| **风格闭环** | 颜色、圆角、间距、字体全部引用 `tailwind.css` token，不新增魔法值 |

---

## 二、新增依赖

```
pnpm add motion
```

| 用途 | 对应组件 |
|------|---------|
| 页面路由过渡 | `AnimatePresence` 包裹 `<Outlet />` |
| 列表入场 stagger | `motion.div` + `staggerChildren` |
| 卡片 hover 微交互 | `whileHover={{ y: -2 }}` |
| 侧边栏折叠展开 | `animate={{ height }}` |
| 面包屑/通知等微入场 | `initial + animate` |

现有 GSAP 保留不动（Three.js 场景使用），不与 motion 重叠。

---

## 三、Phase 1 — 侧边栏信息架构重构

### 3.1 当前问题

```
▼ 管理 (一个标签，13 项平铺)
  用户管理     Users
  角色管理     Shield
  班级管理     GraduationCap
  病例管理     UserSearch
  作业管理     ClipboardList      ← 图标1
  训练管理     Settings
  训练记录管理  ClipboardList      ← 同一图标，两个入口
  评分标准     BookOpen
  成本管理     Coins
  用户反馈     MessageSquare
  问卷管理     ClipboardCheck
  系统运维     Activity
  系统通知     Megaphone
```

问题：无分组、图标重复、命名混淆（"训练管理"/"训练记录管理"）、排序无逻辑（dashboard 排第 6）。

### 3.2 目标结构

按**用户工作场景**重组为 4 个可折叠分组：

```
┌─ 虚拟患者系统 ─────────────────────┐
│                                    │
│  ▼ 教学中心              ← 教师日常，默认展开
│    📊 教学看板    (/admin)              ← 原"训练管理"
│    📋 作业管理    (/admin/assignments)
│    📝 训练记录    (/admin/records)      ← 原"训练记录管理"
│    📚 病例库      (/admin/cases)        ← 原"病例管理"
│    📏 评分标准    (/admin/rubric)
│    📄 问卷管理    (/admin/questionnaires)
│                                    │
│  ▶ 人员管理              ← 默认折叠
│    👥 用户管理    (/admin/users)
│    🏫 班级管理    (/admin/grades-classes)
│    🔐 角色管理    (/admin/roles)
│                                    │
│  ▶ 系统运维              ← super_admin 专属，默认折叠
│    📡 运维仪表盘  (/admin/system-ops)
│    💰 成本管理    (/admin/costs)
│    📢 系统通知    (/admin/system-notifications)
│                                    │
│  ▶ 反馈中心              ← 默认折叠
│    💬 用户反馈    (/admin/feedback)
│                                    │
├────────────────────────────────────┤
│  👤 张三 · 教师                    │
│  🌙  退出                          │
└────────────────────────────────────┘
```

### 3.3 命名修正

| 原名 | 改为 | 原因 |
|------|------|------|
| 训练管理 | **教学看板** | 它是 dashboard，不是"管理" |
| 训练记录管理 | **训练记录** | 去掉冗余"管理" |
| 病例管理 | **病例库** | 病例是内容资产，不是管理对象 |
| 系统运维 | **运维仪表盘** | 它是监控面板，不是操作台 |

### 3.4 图标重新分配（消除重复）

| 菜单项 | 新图标 | 原图标 |
|--------|--------|--------|
| 作业管理 | `ClipboardList`（保留） | — |
| 训练记录 | `ScrollText`（新） | `ClipboardList`（重复） |
| 用户反馈 | `MessageSquare`（保留） | — |
| 用户管理 | `Users`（保留） | — |
| 班级管理 | `GraduationCap`（保留） | — |

新增 `ScrollText` 来自 lucide-react（已有依赖），无需新包。

### 3.5 折叠行为

- 教学中心默认展开，其余三组默认折叠
- 点击组标题展开/折叠，带 200ms 高度过渡（`motion.div animate`）
- 用户偏好存入 `localStorage`（key: `admin-sidebar-groups`），刷新保持
- 当前活跃页面所在组自动展开（即使之前手动折叠）
- 移动端侧边栏保持 overlay 模式不变

### 3.6 底部栏简化

```
当前:
  [avatar+name] [🌙] [🔔] [反馈] [关于] [退出]

改为:
  [avatar+name+role]  [🌙] [退出]
```

- 通知铃铛移入顶部栏（main content header），而非侧边栏底部
- 反馈按钮移入导航区"反馈中心"组内
- "关于"通过点击版本号触发

### 3.7 实现文件

| 文件 | 改动 |
|------|------|
| `components/shell/navigation.tsx` | NavItem 新增 `group` 字段；新增 `NAV_GROUPS` 定义；修正 label 和 icon |
| `components/Layout.tsx` | `SidebarNav` 替换分组渲染逻辑；新增 `NavGroup` 折叠组件；移除底部栏多余按钮 |
| `components/ui/nav-group.tsx` | **新文件** — 可折叠导航组组件 |

### 3.8 NavGroup 组件规格

```typescript
interface NavGroupProps {
  label: string;          // 组标题
  icon: LucideIcon;       // 组图标
  defaultOpen: boolean;   // 默认展开
  storageKey: string;     // localStorage key
  children: ReactNode;    // NavLink 列表
}
```

- 用 `motion.div` 的 `animate={{ height: open ? "auto" : 0 }}` 实现折叠
- 展开时 `ChevronRight` 旋转 90°
- 低权限用户：整组无可见项时，该组完全隐藏
- 高亮态：当前活跃路由所在组标题加粗

---

## 四、Phase 2 — 教学看板 Bento Grid 重设计

### 4.1 当前状态

`/admin` 页面（`Admin.tsx` → `AdminDashboard.tsx`）：
- 4 个 `StatCard`（学生数/总训练/完成/今日）
- 4 个 outline 快捷按钮
- 训练记录表格

问题：信息平面化，无优先级差异。教师不知道"今天该先看什么"。

### 4.2 目标布局

```
┌──────────────────────────────────────────────────────────┐
│  下午好，张老师                    本周截至 7月22日       │
├────────────────────┬──────────┬──────────────────────────┤
│                    │          │                          │
│   今日活跃学生      │ 待批阅    │  本周训练完成率           │
│      12 人         │  3 份     │   ████████░░ 76%        │
│   ↑ 20% 较上周     │ 作业      │   15人 / 20人           │
│                    │          │                          │
│  (大号 StatCard    │ (StatCard │  (StatCard +            │
│   col-span-2)      │  small)   │   环形进度 SVG)          │
│                    │          │                          │
├────────────────────┴──────────┴──────────────────────────┤
│  📋 进行中的作业              到期时间      完成     操作  │
│  ┌──────────────────────────────────────────────────────┐│
│  │ 内科护理问诊训练  ·  护理3班  ·  7.25 到期             ││
│  │ ██████████░░░░░░ 8/15 人完成   [查看详情]             ││
│  └──────────────────────────────────────────────────────┘│
│  ┌──────────────────────────────────────────────────────┐│
│  │ 外科术后评估     ·  护理1班  ·  7.28 到期             ││
│  │ ████░░░░░░░░░░░ 3/20 人完成   [查看详情]              ││
│  └──────────────────────────────────────────────────────┘│
│  (col-span-4, Card 列表)                                 │
├──────────────────────────────────────────────────────────┤
│  最近训练动态                                             │
│  ┌──────────────────────────────────────────────────────┐│
│  │ 14:32  李同学  完成了 糖尿病护理        ·  85分 优秀  ││
│  │ 13:15  王同学  开始了 心衰评估                        ││
│  │ 11:48  赵同学  完成了 肺炎护理          ·  62分 一般  ││
│  │ 09:30  孙同学  提交了 反馈评价                         ││
│  └──────────────────────────────────────────────────────┘│
│  (col-span-4, 时间线组件)                                 │
└──────────────────────────────────────────────────────────┘
```

### 4.3 组件规格

#### `ActivityTimeline`（新组件）
```typescript
interface ActivityEvent {
  id: string;
  time: string;           // "14:32"
  studentName: string;
  action: string;         // "完成了 糖尿病护理"
  meta?: string;          // "85分 优秀"
  scoreColor?: string;    // success / warning / danger
}
```
- 垂直时间线，左侧时间 + 圆点，右侧内容
- 最新事件带入场动画（`motion.div` stagger）

#### 环形进度图
- 纯 SVG，不引入 chart 库
- `stroke-dasharray` + `stroke-dashoffset` 动画
- 颜色：≥80% green / ≥60% amber / <60% red
- 内圈显示 "15/20"

### 4.4 数据来源

所有数据通过现有 API 聚合，不新增后端接口：

| 数据 | API |
|------|-----|
| 今日活跃学生 | `getStats()` → 新增 `today_active_students` 字段（后端小改） |
| 待批阅作业 | `getAssignments()` → 筛选 `completed > 0 && not reviewed` |
| 本周完成率 | `getStats()` + `getRecords()` → 前端计算 |
| 进行中作业 | `getAssignments()` → `status === "active"` |
| 最近动态 | `getRecords({ limit: 10, sort: "-start_time" })` |

### 4.5 实现文件

| 文件 | 改动 |
|------|------|
| `pages/Admin.tsx` | 替换 `AdminDashboard` 引用为新组件 |
| `components/dashboard/TeachingDashboard.tsx` | **新文件** — 教学看板 |
| `components/dashboard/ActivityTimeline.tsx` | **新文件** — 动态时间线 |
| `components/dashboard/RingProgress.tsx` | **新文件** — 环形进度图 |
| `components/dashboard/AssignmentOverview.tsx` | **新文件** — 作业概览卡片 |

---

## 五、Phase 3 — 病例库画廊 + 用户目录

### 5.1 病例库（`/admin/cases`）

#### 当前问题
`ResponsiveTable` 展示病例，每列：名称/类型/难度/患者/时限/训练次数/开关/操作。病例是**教学内容**，不是数据行。表格无法传达病例的场景感和教学价值。

#### 目标布局
```
┌─ 病例库 ─────────────── [搜索...] [+ 新建] [AI 生成] ─┐
│                                                        │
│  [全部] [病史采集] [分诊]  [⭐初级] [⭐⭐中级] [⭐⭐⭐高级] │
│                                                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │  🫀       │ │  🩻       │ │  🫁       │ │  🩸       │  │
│  │ 急性心梗  │ │ 社区肺炎  │ │COPD急性   │ │ 糖尿病    │  │
│  │ ⭐⭐ 中级 │ │ ⭐ 初级   │ │⭐⭐⭐ 高级 │ │ ⭐⭐ 中级 │  │
│  │          │ │          │ │          │ │          │  │
│  │男·58岁   │ │女·72岁   │ │男·65岁   │ │女·55岁   │  │
│  │胸痛2小时 │ │发热咳嗽  │ │呼吸困难  │ │多饮多尿  │  │
│  │          │ │          │ │          │ │          │  │
│  │[患者自主]│ │[护理查体]│ │[患者自主]│ │[护理查体]│  │
│  │[护理记录]│ │          │ │[护理查体]│ │[护理记录]│  │
│  │          │ │          │ │[护理记录]│ │          │  │
│  │12次训练  │ │8次训练   │ │45次训练  │ │5次训练   │  │
│  │[开始训练]│ │[开始训练]│ │[开始训练]│ │[开始训练]│  │
│  │[编辑][×] │ │[编辑][×] │ │[编辑][×] │ │[编辑][×] │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                        │
│                         ◀ 1 2 3 ▶                      │
└────────────────────────────────────────────────────────┘
```

#### 特性
- 3 列网格（`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`）
- 每张卡片：顶部大色块（病例类型色）、病例名、难度星、患者摘要、能力标签、训练次数、操作按钮
- 顶部色块替代缺失的病例插图：不同病例类型用不同 emoji 和渐变色（纯 CSS 渐变，不引入图片）
- 筛选 chip pills 替代下拉框（更直观）
- 编辑/删除操作在卡片底部（而非表格操作列）
- 保留现有模态框创建/编辑流程（不重写 CaseForm）

#### CaseCard 组件（新）
```typescript
interface CaseCardProps {
  case: CaseManageItem;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleOpen: (id: string, open: boolean) => void;
  onStartTraining: (id: string) => void;
}
```
- 内部使用 `Card` + `DifficultyBadge` + `Badge` + `Button`
- 卡片 hover: `motion.div whileHover={{ y: -2, scale: 1.01 }}`

### 5.2 用户管理（`/admin/users`）

#### 当前问题
`ResponsiveTable` 展示用户列表，每行：复选框/头像/姓名/用户名/角色/学号/班级/训练次数/最后登录/操作。用户是**人**，需要头像、身份标识、活跃状态——而非 Excel 行。

#### 目标布局
```
┌─ 用户管理 ────── [搜索...] [角色▼] [班级▼] [+ 注册] [批量导入] ─┐
│                                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐               │
│  │   👤 头像     │ │   👤 头像     │ │   👤 头像     │               │
│  │   张三        │ │   李四        │ │   王五        │               │
│  │   教师 🔵     │ │   学生 🟢     │ │   学生 🟢     │               │
│  │              │ │              │ │              │               │
│  │  2021级      │ │  2021级      │ │  2021级      │               │
│  │  护理3班     │ │  护理1班     │ │  护理2班     │               │
│  │              │ │              │ │              │               │
│  │  训练 24次   │ │  训练 8次    │ │  训练 15次   │               │
│  │  最后登录    │ │  最后登录    │ │  最后登录    │               │
│  │  今天 14:32  │ │  昨天 09:15  │ │  3天前       │               │
│  └──────────────┘ └──────────────┘ └──────────────┘               │
│                                                                   │
│  ☐ 已选 3 人  [批量分配班级] [批量重置密码]  ← 选择浮现           │
└───────────────────────────────────────────────────────────────────┘
```

#### UserCard 组件（新）
```typescript
interface UserCardProps {
  user: UserManageItem;
  selected: boolean;
  onSelect: (id: string) => void;
  onEdit: (user: UserManageItem) => void;
  onDelete: (id: string) => void;
}
```
- 3 列网格（同上）
- `RoleBadge` 已存在，直接使用
- 搜索即时过滤（客户端，非 debounced）
- 批量选择 → 浮现底部操作栏（类似 Gmail/文件管理器交互）

### 5.3 实现文件

| 文件 | 改动 |
|------|------|
| `pages/admin/CasesPage.tsx` | 无需改动（thin wrapper） |
| `components/admin/CasesTab.tsx` | 替换表格为卡片画廊 |
| `components/admin/cases/CaseCard.tsx` | **新文件** — 病例卡片 |
| `pages/admin/UsersPage.tsx` | 无需改动 |
| `components/admin/UsersTab.tsx` | 替换表格为用户目录 |
| `components/admin/users/UserCard.tsx` | **新文件** — 用户卡片 |
| `components/admin/users/BatchActionBar.tsx` | **新文件** — 批量操作栏 |

---

## 六、Phase 4 — 导航抛光

### 6.1 页面过渡动画

当前路由切换是瞬间闪现——无过渡动画。

**方案**：在 `Layout.tsx` 的内容区域用 `AnimatePresence` 包裹 `<Outlet />`：

```tsx
<AnimatePresence mode="wait">
  <motion.div
    key={location.pathname}
    initial={{ opacity: 0, y: 8 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.15, ease: "easeOut" }}
  >
    <Outlet />
  </motion.div>
</AnimatePresence>
```

注意：`/training/:recordId` 和 `/qa` 不走过渡（它们是特殊 shell），通过 `location.pathname` 判断跳过。

### 6.2 面包屑导航

在以下页面增加面包屑（替换纯 back 按钮）：

| 页面 | 面包屑 |
|------|--------|
| `/admin/assignments/:id` | 教学中心 > 作业管理 > 内科护理问诊训练 |
| `/admin/users/:userId` | 人员管理 > 用户管理 > 张三 |
| `/record/:id` | 训练记录 > 糖尿病护理 · 张三 · 2024-07-22 |

#### Breadcrumb 组件（新）
```typescript
interface BreadcrumbProps {
  items: { label: string; to?: string }[];
}
```
- 纯 `<span>` + `/` 分隔符，无导航库依赖
- 最后一项无链接（当前页），加粗
- 使用 `PageHeader` 的 `backTo` 字段生成自动面包屑

### 6.3 列表入场 stagger

病例卡片画廊和用户目录使用 `motion.div` + `staggerChildren`：

```tsx
<motion.div
  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
  initial="hidden"
  animate="visible"
  variants={{
    hidden: {},
    visible: { transition: { staggerChildren: 0.04 } },
  }}
>
  {items.map((item) => (
    <motion.div
      key={item.id}
      variants={{
        hidden: { opacity: 0, y: 16 },
        visible: { opacity: 1, y: 0 },
      }}
    >
      <CaseCard case={item} />
    </motion.div>
  ))}
</motion.div>
```

仅在新加载时播放（`initial="hidden" animate="visible"`），筛选/搜索时不重播（因为 key 不变）。

### 6.4 卡片微交互

```tsx
<Card className="transition-shadow hover:shadow-e2 cursor-pointer" />
// 或 motion:
<motion.div whileHover={{ y: -2 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
  <Card>...</Card>
</motion.div>
```

仅在可点击的卡片上使用，静态展示卡片不加 hover 动画。

### 6.5 实现文件

| 文件 | 改动 |
|------|------|
| `components/Layout.tsx` | 包裹 `<Outlet />` 为 `AnimatePresence` |
| `components/ui/breadcrumb.tsx` | **新文件** — 面包屑 |
| `components/ui/page-header.tsx` | 增加 `breadcrumb` prop，自动生成面包屑 |

---

## 七、组件架构总览

### 7.1 新增组件清单（全部基于现有基元组件）

| 组件 | 文件 | 依赖 |
|------|------|------|
| `NavGroup` | `components/ui/nav-group.tsx` | `motion`、`lucide-react` |
| `Breadcrumb` | `components/ui/breadcrumb.tsx` | 无 |
| `ActivityTimeline` | `components/dashboard/ActivityTimeline.tsx` | `motion` |
| `RingProgress` | `components/dashboard/RingProgress.tsx` | 无（纯 SVG） |
| `AssignmentOverview` | `components/dashboard/AssignmentOverview.tsx` | `Card`、`Badge`、`Button` |
| `TeachingDashboard` | `components/dashboard/TeachingDashboard.tsx` | 以上全部 + `StatCard` |
| `CaseCard` | `components/admin/cases/CaseCard.tsx` | `Card`、`Badge`、`DifficultyBadge`、`Button`、`motion` |
| `UserCard` | `components/admin/users/UserCard.tsx` | `Card`、`RoleBadge`、`motion` |
| `BatchActionBar` | `components/admin/users/BatchActionBar.tsx` | `Button`、`motion` |

### 7.2 修改的现有文件

| 文件 | 改动摘要 |
|------|---------|
| `components/shell/navigation.tsx` | NavItem 增加 `group`、修正 label/icon、新增 `NAV_GROUPS` |
| `components/Layout.tsx` | SidebarNav 重构 + AnimatePresence |
| `components/ui/page-header.tsx` | 增加 `breadcrumb` prop |
| `pages/Admin.tsx` | 引用新 `TeachingDashboard` |
| `components/admin/CasesTab.tsx` | 表格 → CaseCard 画廊 |
| `components/admin/UsersTab.tsx` | 表格 → UserCard 目录 |

### 7.3 不受影响的文件

以下文件零改动，风险为零：

- 所有 student 端页面（`DashboardHome`、`TrainingSelect`、`History`、`QA`、`Profile`、`Stats` 等）
- 训练引擎（`TrainingEngine`、`ChatArea`、`PatientMonitor` 等）
- 全部 API 层（`api/`、`query-keys`）
- 全部后端文件
- 现有 CRUD 模态框（`CaseForm`、`UserForm`、`AssignmentModal`）
- 权限系统
- 全局样式（`tailwind.css`）

---

## 八、迁移策略

### 8.1 每个 Phase 独立可发布

每个 Phase 完成后即可合并到 master，不依赖后续 Phase：

- Phase 1 完成后：侧边栏即刻改善，旧页面不变，零回归风险
- Phase 2 完成后：教学看板替换旧 dashboard
- Phase 3 完成后：病例库和用户管理替换旧表格视图
- Phase 4 完成后：全局过渡动画激活

### 8.2 回滚方案

- 旧 `AdminDashboard` 组件保留不删，重命名为 `AdminDashboardLegacy`
- 旧 `SidebarNav` 逻辑通过 feature flag 切换（`?legacy_sidebar=1` 或环境变量）
- 每个 Phase 合并后若出问题，一行代码切回旧版

### 8.3 验证清单

每个 Phase 完成后的验证项：

- [ ] `pnpm run check`（ruff + ty + biome + tsc）全绿
- [ ] 所有 4 种角色登录后侧边栏正确显示对应分组
- [ ] 权限过滤：无权限的组/菜单项不出现
- [ ] 暗色模式正常渲染
- [ ] 移动端侧边栏 overlay 正常
- [ ] 页面导航不出现白屏
- [ ] localStorage 持久化导航折叠状态

---

## 九、不在此次范围内的改进

以下明确不纳入本次设计，避免范围蔓延：

- **训练界面（immersive）重构**：emoji → 图标替换、体检身体图 SVG 替代等。另立独立设计。
- **学生端 Dashboard 改进**：另立独立设计。
- **新功能开发**：本次纯 UX 重构，不增加业务功能。
- **后端改动**：仅在 Phase 2 教学看板需要额外统计字段时，做最小后端变更（增加 API 返回字段）。
- **通知系统改进**：另立独立设计。
