# 04 — 前端设计

> 适用版本: v2026.06.04-5 | 最后更新: 2026-06-04

## 技术栈

| 技术 | 用途 |
|------|------|
| React 19 | 函数组件 + Hooks |
| TypeScript 5.8 | 类型安全，`strict: true` |
| Vite 8 | 构建工具 + 开发服务器 |
| Tailwind CSS v4 | 原子化 CSS 框架，`@tailwindcss/vite` 集成 |
| shadcn/ui (Base UI) | 组件库 — Button, Card, Dialog, Table, Badge, Tabs, Form 等 |
| react-router-dom v7 | 客户端路由 |
| @tanstack/react-query v5 | 服务端状态管理 + 缓存 |
| zustand v5 | 客户端状态管理 (auth, gradesClasses, llm) |
| axios | HTTP 客户端，120s 超时 + 自动重试 |
| sonner | Toast 通知系统 |
| react-hook-form + zod | 表单状态管理 + 校验 |
| recharts | 图表 (ComposedChart) |
| lucide-react | 统一图标库 |
| react-markdown + remark-gfm | QA 答案 Markdown 渲染 |
| Biome | 代码格式化 + Lint |
| Vitest + Testing Library | 单元测试 |

## 项目结构

```
frontend/src/
├── App.tsx                    # 路由 + Providers (QueryClient, Toaster, Confirm, Feedback, ErrorBoundary)
├── main.tsx                   # 入口，导入 tailwind.css
├── version.ts                 # APP_VERSION 常量
├── api/
│   ├── api-client.ts          # 后端 API 封装函数
│   ├── api-types.gen.ts       # OpenAPI 自动生成类型 (5,616行)
│   └── axios-instance.ts      # axios 实例 + 拦截器
├── assets/avatars/            # 10 张患者/护士头像 PNG
├── components/
│   ├── ErrorBoundary.tsx      # 类组件全局异常边界
│   ├── FeedbackModal.tsx      # 用户反馈表单 (5 级表情评分)
│   ├── FeedbackProvider.tsx   # 反馈弹窗 Context
│   ├── Layout.tsx             # 主布局 — 响应式侧边栏 + 移动端汉堡菜单
│   ├── PatientPortrait.tsx    # 患者信息面板 — 头像 + 可编辑护理记录 (localStorage)
│   ├── ScoreCard.tsx          # 评分报告弹窗 — 总分 + 维度分数 + 证据展开
│   ├── Toast.tsx              # sonner Toast 封装 (useToast hook)
│   ├── TrainingDurationChart.tsx  # Recharts 训练趋势图
│   ├── teacher/               # 教师端 Tab 组件 (13 个)
│   └── ui/                    # shadcn/ui 组件 + 自研组件 (21 个)
├── hooks/
│   └── useVoice.ts            # 语音识别 + TTS 朗读
├── lib/
│   └── utils.ts               # cn() — clsx + tailwind-merge
├── pages/                     # 路由页面 (10 个)
│   └── admin/                 # 教师端独立页面 (6 个)
├── stores/                    # Zustand 状态 (3 个)
├── styles/
│   └── tailwind.css           # Tailwind 入口 + shadcn 主题变量 + 自定义 tokens
├── types/                     # 全局类型定义
└── utils/
    └── avatar.ts              # 患者/护士头像映射
```

## 路由设计

| 路径 | 页面 | 权限 | 布局 | 说明 |
|------|------|------|------|------|
| `/login` | Login | 公开 | 居中卡片 | 渐变背景 + 品牌卡片 |
| `/home` | DashboardHome | 登录 | Layout | 角色分流仪表盘 |
| `/cases` | CaseSelect | 学生 | Layout | 病例选择 + 难度筛选 |
| `/training/:recordId` | ChatTraining | 学生 | 全屏独立 | 流式对话训练 |
| `/history` | History | 登录 | Layout | 训练记录列表 |
| `/record/:id` | RecordDetail | 登录 | Layout | 记录详情 + 评分 |
| `/qa` | QA | 登录 | Layout | 护理专业问答 |
| `/stats` | StatsPage | 登录 | Layout | 训练统计图表 |
| `/admin` | Admin | 教师 | Layout | LLM 管理 Tabs |
| `/admin/llm` | LLMManagementPage | 教师 | Layout | API/Prompt/评分标准 |
| `/admin/cases` | CasesPage | 教师 | Layout | 病例管理 |
| `/admin/users` | UsersPage | 教师 | Layout | 用户管理 |
| `/admin/users/:userId` | UserDetailPage | 教师 | Layout | 用户详情 |
| `/admin/grades-classes` | GradesClassesPage | 教师 | Layout | 年级班级管理 |
| `/admin/feedback` | FeedbackPage | 教师 | Layout | 反馈管理 |
| `*` | → `/login` | - | - | 未匹配路由 |

## 设计系统

### 颜色令牌 (shadcn 主题)

所有颜色通过 CSS 自定义属性定义，支持暗色模式：

| Token | 浅色值 | 用途 |
|-------|--------|------|
| `--primary` | `#2563eb` (blue-600) | 主色 — 按钮、链接、激活态 |
| `--background` | `#f5f6f8` | 页面背景 |
| `--foreground` | `#111827` | 主文字 |
| `--card` | `#ffffff` | 卡片背景 |
| `--muted` | `#f3f4f6` | 次级背景 |
| `--muted-foreground` | `#6b7280` | 次级文字 |
| `--border` | `#e5e7eb` | 边框 |
| `--destructive` | `#dc2626` | 危险操作 |
| `--ring` | `#2563eb` | 聚焦环 |

### UI 组件库

**shadcn/ui (基于 Base UI):**
| 组件 | 文件 |
|------|------|
| Button | `button.tsx` — variant: default/outline/secondary/ghost/destructive/link, size: xs/sm/default/lg/icon |
| Badge | `badge.tsx` — variant: default/secondary/destructive/outline + 兼容旧 success/info/warning/danger/neutral |
| Card | `card.tsx` — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| Dialog | `dialog.tsx` — 模态框，含 overlay + 动画 |
| AlertDialog | `alert-dialog.tsx` — 确认弹窗 |
| Tabs | `tabs.tsx` — 包含 LegacyTabs 兼容包装器 |
| Input / Select / Textarea | `input.tsx`, `select.tsx`, `textarea.tsx` |
| Form | `form.tsx` — react-hook-form 集成 (Form, FormField, FormItem, FormLabel, FormControl, FormMessage) |
| Table | `table.tsx` — Table, TableHeader, TableBody, TableRow, TableHead, TableCell |
| DropdownMenu | `dropdown-menu.tsx` |
| Separator | `separator.tsx` |
| Sonner | `sonner.tsx` — Toaster 组件 |
| Label | `label.tsx` |

**自研组件:**
| 组件 | 文件 | 用途 |
|------|------|------|
| Modal | `Modal.tsx` | 基于 shadcn Dialog 的兼容包装器 |
| ConfirmDialog | `ConfirmDialog.tsx` | 基于 shadcn AlertDialog 的 Context 驱动确认弹窗 |
| PageHeader | `PageHeader.tsx` | 页面标题 (title + subtitle + icon + actions + back) |
| Pagination | `Pagination.tsx` | 分页组件 |
| StatCard | `StatCard.tsx` | 统计卡片 (5 色主题 + trend) |
| FormField | `FormField.tsx` | 表单字段封装 (label + error + help) |
| LoadingState | `LoadingState.tsx` | 加载指示器 |
| LoadingSkeleton | `LoadingSkeleton.tsx` | 骨架屏 (card/stats/table/text 变体) |
| EmptyState | `EmptyState.tsx` | 空状态占位 (icon + title + description + action) |

## 布局系统

### Sidebar 布局 (Layout 组件)

```
┌──────────┬──────────────────────────────────────┐
│ Sidebar  │  Main Content                        │
│ w-60     │  ml-60                               │
│ 浅色背景 │  p-4 sm:p-6 lg:p-8                   │
│ 导航菜单 │  页面内容                             │
│ 用户信息 │                                       │
└──────────┴──────────────────────────────────────┘
```

- 侧边栏固定定位，`bg-card` 浅色背景
- 移动端 `translate-x` 抽屉式滑入，汉堡菜单按钮
- 激活项 `bg-primary/10 text-primary` 高亮
- 底部用户信息块 + 关于/退出按钮

### Training 全屏布局 (ChatTraining)

```
┌─────────────────────────────────────────────────┐
│ [←] (头像) 患者名 · 病例名  ⏱计时 [进度] [朗读] [结束] │
├─────────────────────────────────────────────────┤
│                 对话消息区                       │
│         学生蓝色靠右 · 患者白色靠左              │
├─────────────────────────────────────────────────┤
│ [🎤语音] [____________输入框____________] [→发送] │
└─────────────────────────────────────────────────┘
```

- `h-dvh` 全屏，顶栏 `flex-wrap` 移动端自动换行
- 移动端安全区 `env(safe-area-inset-top)` 适配刘海屏
- 左侧可折叠患者信息面板 (300px，护理记录可编辑)
- 右侧采集进度侧栏 (fixed drawer)
- 评分弹窗 `backdrop-blur` 毛玻璃效果

## 状态管理

| 工具 | 用途 |
|------|------|
| `@tanstack/react-query` | 服务端数据获取 + 缓存 + 自动刷新 (staleTime: 30s) |
| `zustand` | 客户端状态 — authStore (登录/用户), gradesClassesStore (年级班级 CRUD), llmStore (Tab 状态) |
| `sonner` | 全局 Toast 通知 |
| `useVoice` | 语音识别 + TTS 朗读 (Web Speech API) |

## 语音系统

| 功能 | 实现 |
|------|------|
| 语音输入 | Web Speech Recognition API，zh-CN |
| 自动朗读 | Web Speech Synthesis API，年龄感知语速/音调/停顿 |
| 默认状态 | 首次访问默认开启 (`localStorage` 无值时返回 true) |
| 首条招呼 | 训练开始自动朗读患者首条消息 |
| 流式朗读 | 按句子切分，句间自动停顿 |

## 护理记录 (PatientPortrait)

训练页患者面板内嵌可编辑护理记录：

| 字段 | 说明 |
|------|------|
| 主诉 | 患者主要不适及持续时间 |
| 现病史 | 起病情况、症状特点、伴随症状、诊治经过 |
| 既往史 | 既往疾病、手术、过敏、输血史 |
| 个人史 | 出生地、职业、生活习惯、婚育史 |
| 家族史 | 家族成员健康及遗传病史 |

- 纯前端实现，`localStorage` 按患者名称隔离存储
- 输入 800ms 防抖自动保存
- focus 时蓝色边框高亮，未保存提示

## 韧性特性

- **ErrorBoundary**: 全局异常边界，可展开堆栈详情，重试/刷新按钮
- **AbortController**: 组件卸载时取消进行中 LLM 请求
- **axios 重试**: 网络错误/超时自动重试 1 次（不重试 4xx）
- **beforeunload 守卫**: 训练进行中关闭页面弹出确认
- **Lazy Loading**: 所有路由页面 `React.lazy()` + Suspense 加载指示器
- **超时配置**: axios 120s，Vite proxy 120s（匹配 LLM 评分耗时）

## 测试

- 框架: Vitest 4 + @testing-library/react 16 + jsdom
- 5 个测试文件，21 条用例
- 覆盖: Toast, ConfirmDialog, authStore, axios-instance, stores
