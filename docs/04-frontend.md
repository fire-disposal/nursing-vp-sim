# 04 — 前端设计

> 适用版本: current | 最后更新: 2026-06-22

## 技术栈

| 技术 | 用途 |
|------|------|
| React 19 | 函数组件 + Hooks |
| TypeScript 5.8 | 类型安全，`strict: true` |
| Vite 8 | 构建工具 + 开发服务器 |
| Tailwind CSS v4 | 原子化 CSS 框架，`@tailwindcss/vite` 集成 |
| shadcn/ui (Base UI + Radix) | 组件库 — Button, Card, Dialog, Table, Badge, Tabs, Form 等 |
| react-router-dom v7 | 客户端路由 |
| @tanstack/react-query v5 | 服务端状态管理 + 缓存 |
| zustand v5 | 客户端状态管理 (authStore, gradesClassesStore) |
| axios | HTTP 客户端，120s 超时 + 自动重试 |
| sonner | Toast 通知系统 |
| react-hook-form + zod | 表单状态管理 + 校验 |
| recharts | 图表 (ComposedChart) |
| lucide-react | 统一图标库 |
| react-markdown + remark-gfm | QA 答案 Markdown 渲染 |
| Biome | 代码格式化 + Lint |
| Vitest + Testing Library | 单元测试 |
| lottie-web | 登录页插画动画 |
| next-themes | 暗色模式切换 |

## 项目结构

前端按层目录组织（`api/` 数据访问 · `components/` UI · `engine/` 训练逻辑岛 · `pages/` 路由页）。结构快照与收敛建议见 [13-前端组织范式建议](13-frontend-organization-plan.md)，目录细节不在此维护。

## 路由设计

| 路径 | 页面 | 权限 | 布局 | 说明 |
|------|------|------|------|------|
| `/login` | Login | 公开 | 居中卡片 | 渐变背景 + Lottie 插画 |
| `/` | → `/home` | 登录 | Layout | 根路径重定向 |
| `/home` | DashboardHome | 登录 | Layout | 角色分流仪表盘 |
| `/cases` | CaseSelect | training_access | Layout | 病例选择 + 难度筛选 |
| `/training/:recordId` | TrainingEntry | training_access | 全屏独立 | 流式对话训练 |
| `/history` | History | 登录 | Layout | 训练记录列表 |
| `/record/:id` | RecordDetail | 登录 | Layout | 记录详情 + 评分 |
| `/qa` | QA | 登录 | Layout | 护理专业问答 |
| `/stats` | StatsPage | 登录 | Layout | 训练统计图表 |
| `/my-responses` | MyResponses | 登录 | Layout | 我的问卷应答 |
| `/profile` | Profile | 登录 | Layout | 用户个人资料 |
| `/admin` | Admin | score_review | Layout | 训练管理 (问答记录) |
| `/admin/debug` | AdminDebugPage | score_review | Layout | 调试工坊 |
| `/admin/plugins` | PluginDashboard | score_review | Layout | 插件注册中心 |
| `/admin/llm` | LLMManagementPage | llm_monitor | Layout | API/Provider/Key/Prompt 管理 |
| `/admin/cases` | CasesPage | case_manage | Layout | 病例管理 |
| `/admin/practices` | PracticesPage | case_manage | Layout | 练习管理 |
| `/admin/users` | UsersPage | user_manage | Layout | 用户管理 |
| `/admin/users/:userId` | UserDetailPage | user_manage | Layout | 用户详情 |
| `/admin/grades-classes` | GradesClassesPage | grade_class_manage | Layout | 年级班级管理 |
| `/admin/feedback` | FeedbackPage | feedback_review | Layout | 反馈管理 |
| `/admin/roles` | RolesPage | role_manage | Layout | 角色管理 |
| `/admin/questionnaires` | AdminQuestionnaires | questionnaire_manage | Layout | 问卷管理 |
| `/admin/assignments` | AssignmentsPage | score_review | Layout | 作业管理 |
| `/admin/assignments/:id` | AssignmentDetailPage | score_review | Layout | 作业详情 |
| /admin/system-ops | SystemOpsPage | api_manage | Layout | 系统运维面板 |
| /admin/system-notifications | SystemNotificationsPage | api_manage | Layout | 系统通知管理 |
| /admin/costs | CostManagementPage | llm_monitor | Layout | 成本/用量管理 |
| `*` | → `/login` | - | - | 未匹配路由 |

## 设计系统

### 颜色令牌 (shadcn 主题)

所有颜色通过 CSS 自定义属性定义，支持暗色模式 (next-themes)：

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

**shadcn/ui (基于 Base UI + Radix):**
| 组件 | 文件 |
|------|------|
| Button | `Button.tsx` — variant: default/outline/secondary/ghost/destructive/link, size: xs/sm/default/lg/icon |
| Badge | `Badge.tsx` — variant: default/secondary/destructive/outline + 兼容旧 success/info/warning/danger/neutral |
| Card | `card.tsx` — Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter |
| Dialog | `dialog.tsx` — 模态框，含 overlay + 动画 |
| AlertDialog | `alert-dialog.tsx` — 确认弹窗 |
| Tabs | `Tabs.tsx` — 包含 LegacyTabs 兼容包装器 |
| Input / Select / Textarea | `input.tsx`, `select.tsx`, `textarea.tsx` |
| Form | `form.tsx` — react-hook-form 集成 (Form, FormField, FormItem, FormLabel, FormControl, FormMessage) |
| Table | `table.tsx` — Table, TableHeader, TableBody, TableRow, TableHead, TableCell |
| DropdownMenu | `dropdown-menu.tsx` |
| Separator | `separator.tsx` |
| Sonner | `sonner.tsx` — Toaster 组件 |
| Label | `label.tsx` |
| Sheet | `Sheet.tsx` — 侧滑面板 |

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
- 右侧插件面板 (fixed drawer, 引擎驱动)
- 评分弹窗 `backdrop-blur` 毛玻璃效果

## 状态管理

| 工具 | 用途 |
|------|------|
| `@tanstack/react-query` | 服务端数据获取 + 缓存 + 自动刷新 (staleTime: 30s, gcTime: 10min) |
| `zustand` | 客户端状态 — authStore (登录/用户), gradesClassesStore (年级班级 CRUD) |
| `sonner` | 全局 Toast 通知 |

## 训练引擎 (Engine System)

引擎系统替代了原单体 ChatTraining 中的职责耦合，采用插件化架构：

| 模块 | 职责 |
|------|------|
| `TrainingEngine.tsx` | 训练循环编排 — 初始化、暂停、结束、评分触发 |
| `MessageBus.ts` | 发布/订阅消息总线，插件间解耦通信 |
| `PanelContext.tsx` | 共享上下文 Provider — EmotionProvider (情绪状态) + 插件注册 |
| `PatientProvider.tsx` | 患者数据上下文，提供患者信息给所有插件 |
| `StreamManager.ts` | SSE 流式响应管理，处理 LLM 消息流 |
| `ScoreManager.ts` | 评分流程管理 — 触发评分、轮询状态、获取结果 |
| `tts/` | TTS 语音合成 — TTSManager 总控 + browser-tts Web Speech API 实现 |

### 训练架构

```
TrainingEngine
├── PatientProvider (患者数据上下文)
├── PluginContext (插件上下文 + 注册)
│   ├── patient-info     — 患者信息面板
│   ├── emotion          — 情绪状态面板
│   ├── initiative       — 主动提问面板
│   ├── inquiry          — 采集进度追踪
│   ├── nursing-record   — 护理记录表单
│   ├── physical-exam    — 体格检查结果
│   ├── questionnaire    — 训练后问卷
│   └── scoring-display  — 评分结果展示
├── StreamManager (SSE 流)
├── ScoreManager (评分)
├── ChatArea (对话 UI)
│   ├── ChatDisplay      — 消息气泡 (ChatBubble)
│   └── ChatInput        — 输入 + 发送
└── PanelHost (侧边面板)
```

## 语音系统

| 功能 | 实现 |
|------|------|
| 语音输入 | Web Speech Recognition API，zh-CN |
| 自动朗读 | Web Speech Synthesis API，年龄感知语速/音调/停顿 |
| 默认状态 | 首次访问默认开启 (`localStorage` 无值时返回 true) |
| 首条招呼 | 训练开始自动朗读患者首条消息 |
| 流式朗读 | 按句子切分，句间自动停顿 |

## 护理记录 (nursing-record 插件)

训练页左侧面板内嵌可编辑护理记录表单，由 nursing-record 插件驱动：

| 字段 | 说明 | 控件类型 |
|------|------|----------|
| 主诉 | 患者主要不适及持续时间 | Textarea |
| 现病史 | 起病情况、症状特点、伴随症状、诊治经过 | Textarea |
| 既往史 | 既往疾病、手术、过敏、输血史 | Textarea + CheckboxGroup |
| 个人史 | 出生地、职业、生活习惯、婚育史 | Textarea + Select |
| 家族史 | 家族成员健康及遗传病史 | Textarea |
| 生命体征 | T/P/R/BP 等 | VitalSignItem (联动输入) |

- 表单配置驱动 (`config.ts`)，字段类型支持 Input/Textarea/Select/Radio/CheckboxGroup/VitalSign
- localStorage 按患者名称隔离存储
- 输入防抖自动保存

## 韧性特性

- **ErrorBoundary**: 全局异常边界，可展开堆栈详情，重试/刷新按钮
- **ProtectedRoute**: 路由级权限守卫，支持 role + permission 双重校验
- **AbortController**: 组件卸载时取消进行中 LLM 请求
- **axios 重试**: 网络错误/超时自动重试 1 次（不重试 4xx）
- **beforeunload 守卫**: 训练进行中关闭页面弹出确认
- **Lazy Loading**: 所有路由页面 `React.lazy()` + Suspense 加载指示器
- **超时配置**: axios 120s，Vite proxy 120s（匹配 LLM 评分耗时）
- **useNetworkStatus**: 网络连接状态实时检测

## 测试

- 框架: Vitest 4 + @testing-library/react 16 + jsdom
- 10 个测试文件
- 覆盖: Toast, ConfirmDialog, authStore, axios-instance, stores
