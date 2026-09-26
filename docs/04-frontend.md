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

前端按层目录组织（`api/` 数据访问 · `components/` UI · `engine/` 训练逻辑岛 · `pages/` 路由页）。2.0 的维护约束见 [16-2.0 可维护单体目标](16-v2-maintainable-monolith-objectives.md)，目录细节不在此维护。

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
| `/profile` | Profile | 登录 | Layout | 用户个人资料 |
| `/admin` | Admin | score_review | Layout | 训练管理 (问答记录) |
| `/admin/debug` | AdminDebugPage | score_review | Layout | 调试工坊 |
| `/admin/plugins` | PluginDashboard | score_review | Layout | 插件注册中心 |
| `/admin/llm` | LLMManagementPage | llm_monitor | Layout | API/Provider/Key/Prompt 管理 |
| `/admin/cases` | CasesPage | case_manage | Layout | 病例管理 |
| `/admin/practices` | PracticesPage | case_manage | Layout | 练习管理 |
| `/admin/users` | UsersPage | user_manage | Layout | 用户管理 |
| `/admin/users/:userId` | UserDetailPage | user_manage | Layout | 用户详情 |
| `/admin/classes` | ClassesPage | grade_class_manage | Layout | 班级管理（按届别组织，含花名册/成员批量增删） |
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
- 左侧为患者区，右侧为**按 manifest 装配**的活动面板（桌面侧栏 / 移动底部面板）
- 护理查体、护理记录等工具通过 HTTP 指令面读写服务端状态
- 评分弹窗 `backdrop-blur` 毛玻璃效果

## 状态管理

| 工具 | 用途 |
|------|------|
| `@tanstack/react-query` | 服务端数据获取 + 缓存 + 自动刷新 (staleTime: 30s, gcTime: 10min) |
| `zustand` | 客户端状态 — authStore (登录/用户 + 班级成员归属), trainingStore (会话瞬态), workspaceStore (工作区展开的面板)。**不保存服务端业务状态**（manifest/可用性/完成条件均来自 query cache） |
| `sonner` | 全局 Toast 通知 |

## 训练引擎 (Engine System)

引擎系统替代了原单体 ChatTraining 中的职责耦合，采用 **manifest 驱动的工作区**（`docs/15`）：

| 模块 | 职责 |
|------|------|
| `TrainingEngine.tsx` | 训练循环编排 — 初始化、模式计时、结束与评分触发（完成前置读 `manifest.completion.blockers`） |
| `engine/manifest.ts` | manifest 读取层（窄化服务端载荷；**不做任何能力推断**） |
| `workspace/renderers.ts` | 纯 RendererMap（`ui.renderer → 组件`）；可用性来自服务端 |
| `workspace/ActivityRail.tsx` / `ActivityBar.tsx` | 桌面侧栏 / 移动能力条 + 底部面板 |
| `workspace/CompletionStrip.tsx` / `CompletionChecklist` | 完成条件与阻塞项的可读呈现 |
| `MessageBus.ts` | 仅承载**局部 UI 与流式事件**；事件只说明"发生了什么"，不作为状态保存位置 |
| `PatientProvider.tsx` | 患者数据上下文，提供患者信息给所有插件 |
| `StreamManager.ts` | SSE 流式响应管理，处理 LLM 消息流 |
| `ScoreManager.ts` | 评分流程管理 — 触发评分、轮询状态、获取结果 |
| `tts/` | TTS 语音合成 — TTSManager 总控 + browser-tts Web Speech API 实现 |

### 训练架构

```
TrainingDataProvider (React Query 训练详情)
└── TrainingEngine
    ├── trainingStore (会话瞬态) + workspaceStore (展开的面板)
    ├── TrainingHeader (模式化计时 / 离开 / 交卷)
    ├── PatientStage
    ├── ChatArea
    │   ├── WelcomeScreen
    │   ├── ChatDisplay (消息 + 持久化查体结果)
    │   └── ConversationComposer
    ├── ActivityRail (桌面) / ActivityBar + Bottomsheet (移动)
    │   ├── "inquiry"          — 问诊任务清单（内置面板，仅引导模式）
    │   ├── "physical_exam"    — 床旁检查
    │   ├── "nursing_record"   — 护理评估（ADPIE；草稿/提交/重开）
    │   └── "quiz"             — 随堂测验（仅声明了该活动的病例可见）
    ├── StreamManager (SSE 对话流)
    └── ScoreManager (评分状态)

QuestionnaireModal 由 TrainingEntry（训练前）或 RecordDetail（评分后）触发，不属于训练工具。
```

## 语音系统

| 功能 | 实现 |
|------|------|
| 语音输入 | Web Speech Recognition API，zh-CN |
| 自动朗读 | Web Speech Synthesis API，年龄感知语速/音调/停顿 |
| 默认状态 | 首次访问默认开启 (`localStorage` 无值时返回 true) |
| 首条招呼 | 训练开始自动朗读患者首条消息 |
| 流式朗读 | 按句子切分，句间自动停顿 |

## 护理记录 (nursing-record 工具)

右侧工具面板提供服务端持久化的护理评估记录：

| 字段 | 说明 |
|------|------|
| 主观资料 (S) | 患者主诉、症状感受、现病史与既往史要点 |
| 客观资料 (O) | 生命体征、查体结果与检验数据 |
| 评估 (A) | 护理诊断与风险评估 |
| 计划 (P) | 护理措施、预期目标与健康教育 |
| 评价 (E) | 措施效果、病情变化与后续计划 |

- 草稿由 Zustand 保存，工具重挂载不会丢失未落盘修改
- 输入 3 秒后自动保存；发送消息、离开与交卷前通过工具命令屏障等待保存完成
- 服务端版本冲突使用返回的 revision 重试一次；失败时阻止继续问诊或交卷
- 重新进入训练时从 `nursing_record_sheet` 恢复；查体结果从 `exam_results` 恢复到对话区

## 护理查体

- 按身体部位分组展示检查项目；部位、检查和复查均使用可聚焦按钮
- 顶部进度和部位计数标示已检查项目；结果、状态、异常汇总在当前面板内即时反馈
- 同一时间只执行一个检查，避免重复提交；查体 HTTP 工具不依赖 WebSocket 连接状态
- 所有模式展示原始结果与异常状态；仅引导模式展示教学解读
- 重新进入训练时从 `exam_results` 恢复进度、结果与解读文案（考核/盲盒模式仍隐藏解读）


## 训练模式与问卷

- `guided` / `blind_box`：离开页面暂停倒计时；`assessment`：离开后继续墙钟计时
- 必做训练前问卷会在场景挂载前冻结倒计时；完成后才进入训练
- 独立考核隐藏问诊任务清单、精确情绪 HUD 与消息修正；查体操作仍可用，但不显示教学解读
- 问诊任务清单（仅引导模式）保留勾选与完成度配色，判定只看关键词命中，可能漏判；
  它不阻止交卷，也不参与实时结算
- 评分完成后，学生结果页按训练记录触发训练后问卷；同一模板可对每次训练分别作答

## 韧性特性

- **ErrorBoundary**: 全局异常边界，可展开堆栈详情，重试/刷新按钮
- **ProtectedRoute**: 路由级权限守卫，支持 role + permission 双重校验
- **AbortController**: 组件卸载时取消进行中 LLM 请求
- **axios 重试**: 网络错误/超时自动重试 1 次（不重试 4xx）
- **beforeunload 守卫**: 训练进行中关闭页面弹出确认
- **Lazy Loading**: 所有路由页面 `React.lazy()` + Suspense 加载指示器
- **超时配置**: axios 120s，Vite proxy 120s（匹配 LLM 评分耗时）
- **useNetworkStatus**: 网络连接状态实时检测

### 浏览器下限与垫片

支持下限：**Chromium/Edge 92+、Firefox 91+、Safari 15.4+**（学校机房镜像为 Chromium 92，
2026-09-24 实测）。`vite.config.ts` 的 `build.target` 固定在该下限降级语法；
**内置 API 只能靠 `src/utils/polyfills.ts` 垫片**（打包器不会补 API）：

- `Object.hasOwn`：react-markdown（markdown chunk）与 recharts（charts chunk）依赖它。
  机房 Edge 92 缺该 API → 渲染期 `TypeError` → ErrorBoundary 整页接管（线上事故根因）。
- `crypto.randomUUID`：训练会话消息 id 依赖它（Firefox < 95 缺失）。

垫片必须在 `main.tsx` 首行 import —— ESM 先求值被 import 的模块，只有独立模块才能早于
React/Mantine/懒加载 chunk 执行。新增依赖若引入新的内置 API（如 `structuredClone`、
`Array.prototype.findLast`），需同步补垫片或抬高下限；`structuredClone` 目前只在
markdown 的 `typeof` 守卫分支与 recharts 的 Error 深拷贝分支出现，未垫片。

## 测试

- 框架: Vitest 4 + @testing-library/react 16 + jsdom
- 10 个测试文件
- 覆盖: Toast, ConfirmDialog, authStore, axios-instance, stores
