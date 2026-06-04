# 虚拟患者训练系统 — 项目文档

基于大语言模型的护理学生病史采集训练平台。

## 文档目录

| 文档 | 说明 |
|------|------|
| [01-系统架构](01-architecture.md) | 技术栈、项目结构、架构设计 |
| [02-API接口文档](02-api-reference.md) | 完整API端点、请求/响应格式 |
| [03-数据库设计](03-database.md) | 表结构、字段说明、关系映射 |
| [04-前端设计](04-frontend.md) | 页面组件、路由设计、两种布局系统 |
| [05-LLM与评分设计](05-llm-design.md) | 虚拟患者Prompt、评分Prompt、病例结构 |
| [06-开发日志](06-dev-log.md) | 开发进度、修改记录、当前状态 |
| [07-启动指南](07-startup-guide.md) | 环境配置、启动步骤、账号信息 |
| [08-商业化打磨交接记录](08-polish-handoff.md) | 本轮完善重点、剩余问题、下次继续开发摘要 |
| [09-概念设计与创新方向](09-conceptual-design.md) | 系统未来演进方向的概念探索：生理模拟引擎、护理记录书写训练、情感模型等 |
| [10-运维安全指南](10-operations.md) | 生产环境运维：CD流程、紧急回滚、备份、监控、安全加固 |

## 当前版本

- **版本**: v2026.06.04-5
- **最后更新**: 2026-06-04
- **仓库**: [fire-disposal/nursing-vp-sim](https://github.com/fire-disposal/nursing-vp-sim)
- **状态**: 生产就绪。CI/CD 完整（GitHub Actions + Docker → GHCR → VPS），前后端测试全通过，Husky 提交规范已启用。

## 快速了解

1. 先看 [06-开发日志](06-dev-log.md) 了解**当前进度**（含 v1.16 布局优化 + v1.15 百分制 + v1.14 评分升级）
2. 再看 [01-系统架构](01-architecture.md) 了解整体设计
3. 查看 [04-前端设计](04-frontend.md) 了解**前端组件、设计系统、布局**
4. 查看 [07-启动指南](07-startup-guide.md) 了解如何运行

## 核心功能

- 学生/教师登录后进入角色专属仪表盘
- **学生仪表盘**：PageHeader + 状态栏 + 2列布局(65/35) + 训练Hero + 推荐病例 + 最近记录 + 侧面板(最新反馈/快速提问/周统计)
- **教师仪表盘**：PageHeader + 5 StatCard 统计卡片 + 训练趋势图 + 2列布局(最近动态 + 快捷操作/数据概览)
- 训练时与 LLM 驱动的虚拟患者进行对话，模拟真实病史采集
- **采集进度侧栏**：客户端中文关键词匹配，追踪关键问询覆盖，不调 LLM 不泄露答案
- 训练页含倒计时器（20分钟限制，<5分钟警告，到时自动结束评分 + ConfirmDialog 确认对话框）
- 结束训练后系统自动评分（沟通技能14项 + 病史采集5项 = 原始57分制 → 显示100分制）
- **证据化评分**：每项附带对话证据 + 评分理由，可点击展开查看
- **教师复核**：教师可逐项修改 AI 评分 + 添加备注，复核徽章区分"AI初评"/"教师已复核"
- **评分版本化**：评分标准独立 JSON 文件，版本追踪（rubric_version + model_name + prompt_version）
- **统计图表**：关联 ComposedChart（次数+时长、次数+得分），双Y轴对比
- **病例难度分级**：5个病例覆盖1-3级难度（初级1例/中级2例/高级2例），前端星级徽章+筛选器
- 教师端管理后台：4个Tab（训练记录/用户管理/病例管理/LLM调用监控），每个Tab含多维过滤、CSV导出、批量操作
- **设计系统**：tokens.css（CSS变量体系）+ 14个UI组件（Button/Card/Badge/ConfirmDialog/EmptyState/LoadingState/Tabs/Table/PageHeader/StatCard/Modal/FormField/Toolbar/Drawer）
- Toast 通知系统（成功/错误/警告/信息四种类型，自动消失）
- **流式对话**：SSE 逐字显示 + 闪烁光标动画，首字延迟 <1s
- **韧性保护**：Error Boundary 全局异常边界 + beforeunload 离开守卫 + 输入恢复 + 定时器防绕过
- **安全防护**：速率限制（登录/注册/聊天/问答）、密码强度统一（最低6位）、审计日志（JSON格式，控制台+文件，请求ID追踪）
- 前后端测试套件（61 条测试，覆盖认证/训练/CRUD/组件）

---

## 当前开发状态总结

### 系统概览

虚拟患者训练系统（Virtual Patient Training System）是一个基于大语言模型的护理学生病史采集训练平台。学生通过与 LLM 驱动的虚拟患者进行自然语言对话，模拟真实临床病史采集过程。系统自动对学生的沟通技能（14项）和病史采集（5项）进行 19 项细粒度评分（100分制），并提供证据化评分和教师复核机制。支持多 LLM Provider 优先级加权路由、Prompt 模板管理与版本化。

### 技术栈

| 层级 | 技术 |
|------|------|
| 后端框架 | Python FastAPI (异步) |
| 数据库 | PostgreSQL 15 + SQLAlchemy 2.0 ORM + Alembic 迁移 |
| 前端框架 | React 19 + TypeScript + Vite 8 (SPA) |
| UI 框架 | Tailwind CSS v4 + shadcn/ui (Base UI) |
| 状态管理 | @tanstack/react-query v5 + zustand v5 |
| 前端路由 | react-router-dom v7 |
| 认证 | JWT (python-jose) + bcrypt 密码哈希 |
| LLM API | 多 Provider 路由（DeepSeek / OpenAI 兼容 / 自定义），SSE 流式 |
| 图表 | recharts (ComposedChart) |
| 图标 | lucide-react |
| 图表 | recharts (ComposedChart) |
| 表单 | react-hook-form + zod |
| 通知 | sonner |
| Lint | Biome |

### 已完成功能 (v1.0 → v1.16)

**核心业务**:
- 5个病例覆盖5个学科方向（呼吸/内分泌/消化/风湿免疫/心血管），1-3级难度（初级1/中级2/高级2）
- 虚拟患者对话（SSE流式，首字<1s）+ 自动评分（19项，100分制）+ 护理问答
- 训练倒计时（20分钟限制，<5分钟警告，到时自动结束）+ 采集进度侧栏（客户端关键词匹配）
- 证据化评分（evidence + reason 可展开）+ 教师复核（逐项修改 + 备注 + 复核徽章）
- 评分标准版本化（rubrics/nursing_history_v1.json）+ 评分容错

**前端设计系统 (21 个 UI 组件)**:
- shadcn/ui (14个): Button, Badge, Card, Dialog, AlertDialog, Tabs, Input, Select, Textarea, Form, Table, DropdownMenu, Separator, Label
- 自研 (7个): Modal, ConfirmDialog, PageHeader, Pagination, StatCard, FormField, LoadingState, LoadingSkeleton, EmptyState

**页面状态**:
- 9个路由页面全部使用新设计系统组件
- DashboardHome: 完整的 StudentDashboard / TeacherDashboard 角色分流
- Admin: 拆分为 4 个独立 Tab 组件（RecordsTab / UsersTab / CasesTab / MonitorTab）
- ChatTraining: 独立极简全屏布局 + SSE 流式对话 + 采集进度侧栏
- 所有学生端页面已使用 PageHeader 统一标题栏

**基础设施**:
- JWT 认证 + 角色权限（student/teacher）
- 速率限制（4端点）+ 密码强度统一（≥6位）+ .env API Key 保护
- 审计日志（JSON格式，控制台+文件，请求ID追踪）+ LLM 调用审计日志
- /health 健康检查 + 数据库一键备份（教师）+ CSV 流式导出
- 韧性: Error Boundary + beforeunload + AbortController + Axios 重试 + UtcDateTime 时区保护
- **多 API 管理**: 多 Provider/Key 优先级加权路由、熔断、健康检查、API Key 加密存储
- **Prompt 管理**: 数据库模板化，支持变量渲染、版本激活、热重载
- **DeepSeek 一键添加**: 仅需 API Key，自动配置官方参数

**测试**: 61 条（后端 pytest 40 条 + 前端 Vitest 21 条），全部通过

**并发**: 验证可支撑 40 人同时在线训练

### 当前版本架构快照

```
frontend/src/
├── App.tsx                        # 路由 + Providers
├── main.tsx                       # 入口 (导入 tailwind.css)
├── api/
│   ├── api-client.ts              # API 封装
│   ├── api-types.gen.ts           # OpenAPI 自动生成类型
│   └── axios-instance.ts          # axios 实例
├── pages/
│   ├── Login.tsx                  # 登录 (渐变背景 + 品牌卡片)
│   ├── DashboardHome.tsx          # 角色分流仪表盘
│   ├── ChatTraining.tsx           # 流式对话训练
│   ├── CaseSelect.tsx             # 病例选择 + 难度筛选
│   ├── QA.tsx                     # 护理问答
│   ├── Stats.tsx                  # 训练统计
│   ├── History.tsx                # 历史记录
│   ├── RecordDetail.tsx           # 记录详情
│   └── admin/                     # 教师端页面
├── components/
│   ├── Layout.tsx                 # 响应式侧边栏
│   ├── Toast.tsx                  # sonner 封装
│   ├── PatientPortrait.tsx        # 患者信息 + 护理记录
│   ├── ScoreCard.tsx              # 评分报告
│   ├── TrainingDurationChart.tsx  # 趋势图
│   ├── ErrorBoundary.tsx          # 异常边界
│   ├── FeedbackModal.tsx          # 反馈弹窗
│   ├── ui/                        # shadcn + 自研组件 (21个)
│   └── teacher/                   # 教师端 Tab 组件 (13个)
├── hooks/useVoice.ts              # 语音识别 + TTS
├── stores/                        # Zustand (auth, gradesClasses, llm)
├── lib/utils.ts                   # cn() 工具
└── styles/tailwind.css            # Tailwind + shadcn 主题
```

### 未完成事项

| 优先级 | 事项 | 预估工作量 |
|--------|------|-----------|
| Phase 5 | 暗色模式切换开关 | 1-2h |
| 第四梯队 | 断网检测 + 消息重试 + 病例长度校验 + Token刷新 | 1-2h |
| 第五梯队 | 补齐导出/统计/问答/批量导入/LLM失败路径测试覆盖 (~30条) | 2-3h |

### 快速启动

```bash
# 后端 (端口 8000)
cd backend && uv sync && uv run uvicorn main:app --host 127.0.0.1 --port 8000 --reload

# 前端 (端口 3000)
cd frontend && npm install && npm run dev
```

默认账号: 教师 admin/admin123 | 学生 student1/123456 ~ student5/123456

### Docker 部署

```bash
# 根目录 .env 配置 DEEPSEEK_API_KEY 和 SECRET_KEY 后
docker compose up -d
```

### 关键约定

- 文件名/变量名使用英文，用户可见文本使用中文
- 病例名称使用症状描述（不泄露医学诊断）
- 所有 API 路径以 `/api/` 为前缀
- 前端通过 Vite proxy 转发 `/api` 请求到后端 8000 端口
- 后端 `.env` 存储敏感配置，`.env.example` 为模板
- Provider/Key/Prompt 配置在教师管理面板操作，无需修改环境变量
