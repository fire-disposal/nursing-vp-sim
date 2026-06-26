# 01 — 系统架构

> 适用版本: current | 最后更新: 2026-06-22

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端框架 | Python FastAPI | 异步高性能Web框架，lifespan 生命周期 |
| 前端框架 | React 19 + TypeScript + Vite | SPA单页应用 |
| 前端路由 | react-router-dom v7 | 客户端路由 |
| 状态管理 | Zustand | 轻量状态管理 (authStore, gradesClassesStore) |
| 数据请求 | TanStack Query | 服务端状态缓存 + 自动刷新 |
| UI组件 | shadcn/ui 风格 + Tailwind CSS v4 | 设计系统组件库 |
| HTTP客户端 | axios (前端) / httpx (后端) | 前端120s超时+自动重试；后端共享连接池 |
| 数据库 | PostgreSQL 15 + SQLAlchemy 2.0 ORM + Alembic 迁移 | 生产级关系型数据库 |
| 认证 | JWT (PyJWT) | 无状态Token认证 |
| 密码哈希 | bcrypt | 安全密码存储 |
| LLM API | 多 Provider 路由（DeepSeek / OpenAI 兼容 / 自定义） | 优先级加权路由、熔断、健康检查 |
| LLM 可靠性 | 分离超时(聊天30s/评分120s)+重试(2-3次)+限流(10并发)+JSON容错 | 防止API限流和瞬时故障 |
| 加密 | Fernet 对称加密（独立 FERNET_KEY） | API Key 加密存储 |
| 语音 | 火山引擎 ASR + TTS | 服务端语音识别 + 情感语音合成 |
| 图表 | recharts (ComposedChart) | 关联训练统计（双Y轴：次数+时长、次数+得分） |
| 图标 | lucide-react | 统一 SVG 图标库 |
| 评分标准 | rubrics/ JSON 文件 + DB Rubric 模型 | 19项条目动态生成 Prompt，evidence+reason 证据化，100分制显示 |
| 教师复核 | ScoreReview 独立表 + ReviewEditor | 教师逐项修改分数 + 备注，复核记录可追溯 |
| 患者保护 | patient/guards.py | 角色泄露/诊断泄露检测，隐藏信息规则引擎，fallback 回复 |
| Prompt 管理 | infrastructure/prompt/ + DB 模板 | 多模板版本化、变量渲染、激活/停用、热重载 |
| API Key 管理 | infrastructure/llm/crypto_utils.py + Fernet 加密 | 加密存储、连通性测试、per-key 用量统计 |
| 配置管理 | python-dotenv | .env 文件自动加载 |
| 速率限制 | 内存滑动窗口（infrastructure/cache） | 无需 Redis，线程安全 |
| 审计日志 | infrastructure/llm/logging.py | JSON 格式，控制台+文件，请求ID追踪 |
| 容器化 | Docker + docker compose | 前后端 + 数据库 + nginx |
| CI/CD | GitHub Actions | deploy-staging.yml (tag触发) + deploy-production.yml (手动生产部署) |

## 项目结构（当前）

```
nursing-vp-sim/
├── backend/                                    # 后端服务
│   ├── main.py                                 # FastAPI入口 + lifespan生命周期 + 种子数据
│   ├── models.py                               # SQLAlchemy ORM模型 (30+张表)
│   ├── schemas.py                              # Pydantic请求/响应模型
│   ├── core/                                   # 核心基础设施
│   │   ├── database.py                         # 数据库引擎 + 会话工厂
│   │   ├── config.py                           # 全局配置 (SCORING_TIMEOUT_SECONDS 等)
│   │   ├── security.py                         # JWT认证 + 权限验证
│   │   ├── pagination.py                       # 分页工具
│   │   └── login_strategies/                   # 登录策略 (密码/微信/OAuth2/CAS)
│   ├── contexts/                               # 有界上下文 — 业务逻辑层
│   │   ├── training/                           # 训练上下文（核心）
│   │   │   ├── score_engine.py                 # 评分引擎
│   │   │   ├── pipeline/                       # 训练管道架构
│   │   │   │   ├── context.py                  # 管道上下文数据类
│   │   │   │   ├── phase.py                    # 训练阶段定义
│   │   │   │   ├── registry.py                 # 管道注册表
│   │   │   │   ├── runner.py                   # 管道执行器
│   │   │   │   ├── stages.py                   # 管道阶段枚举 + 排序
│   │   │   │   ├── builder.py                  # 管道中间件链装配
│   │   │   │   └── middleware/                 # 中间件链
│   │   │   │       ├── phase_guard.py           # 阶段守卫
│   │   │   │       ├── prompt_builder.py        # Prompt构建
│   │   │   │       ├── llm_caller.py            # LLM调用
│   │   │   │       ├── persister.py             # 消息持久化
│   │   │   │       ├── phase_transition.py      # 阶段转换
│   │   │   │       └── side_effects.py          # 副作用处理
│   │   │   └── router/                         # 训练路由
│   │   │       ├── chat.py                     # LLM对话 (流式SSE)
│   │   │       ├── session.py                  # 训练会话管理
│   │   │       ├── scoring.py                  # 评分 + 复核
│   │   │       ├── nursing.py                  # 护理记录
│   │   │       ├── progress.py                 # 采集进度
│   │   │       ├── score_review.py             # 教师评分复核
│   │   │       ├── physical_exam.py            # 体格检查API
│   │   │       └── _config.py                  # 会话配置端点
│   │   ├── patient/                            # 患者上下文
│   │   │   ├── guards.py                       # 患者角色边界保护
│   │   │   ├── emotion.py                      # 患者情绪管理
│   │   │   ├── exam.py                         # 体格检查
│   │   │   ├── initiative.py                   # 患者主动发起
│   │   │   ├── note_source.py                  # NoteSource 抽象基类
│   │   │   ├── note_collector.py               # NoteCollector 管道收集器
│   │   │   └── prompt.py                       # 患者相关Prompt
│   │   └── qa/                                 # 问答上下文
│   │       ├── api.py                          # QA路由
│   │       ├── logic.py                        # QA业务逻辑
│   │       ├── _citations.py                   # QA引用管理
│   │       └── _sessions.py                    # QA会话管理
│   ├── infrastructure/                         # 基础设施层
│   │   ├── cache.py                            # 内存缓存（速率限制等）
│   │   ├── queue.py                            # 异步任务队列
│   │   ├── settlement.py                       # 结算循环（月度费用统计）
│   │   ├── metrics.py                          # 指标收集
│   │   ├── export.py                           # 数据导出
│   │   ├── wechat.py                           # 微信集成
│   │   ├── sse_manager.py                      # SSE 流管理
│   │   ├── scoring_progress.py                 # 评分进度轮询
│   │   ├── llm/                                # LLM 基础设施
│   │   │   ├── client.py                       # LLM API客户端
│   │   │   ├── router.py                       # 多Provider优先级加权路由
│   │   │   ├── circuit.py                      # 熔断器
│   │   │   ├── logging.py                      # LLM调用审计日志
│   │   │   ├── parsing.py                      # JSON响应解析 + 容错
│   │   │   ├── crypto_utils.py                 # Fernet加密 (API Key)
│   │   │   └── token_counter.py                # Token 用量统计
│   │   └── prompt/                             # Prompt 基础设施
│   │       ├── manager.py                      # DB模板加载/渲染/缓存
│   │       ├── registry.py                     # Prompt注册表
│   │       └── static.py                       # 静态Prompt管理
│   ├── middleware/                              # FastAPI 中间件
│   ├── repositories/                           # 数据访问层
│   ├── routers/                                # API路由 (通用)
│   │   ├── auth.py                             # 登录 / 注册 / Token刷新
│   │   ├── cases.py                            # 病例列表 / 详情
│   │   ├── assignments.py                      # 作业发布
│   │   ├── notes.py                            # 训练笔记 CRUD
│   │   ├── stats.py                            # 训练统计 + 趋势 + 排名
│   │   ├── export.py                           # CSV/文本导出
│   │   ├── feedback.py                         # 用户反馈
│   │   ├── ops.py                              # 运维API (dashboard/report/errors)
│   │   ├── admin/                              # 管理后台路由
│   │   │   ├── base.py                         # 管理基础
│   │   │   ├── practices.py                    # 练习管理
│   │   │   ├── rubrics.py                      # 评分标准管理
│   │   │   ├── ops.py                          # 运维管理子路由
│   │   │   ├── system_notifications.py         # 系统通知管理
│   │   │   └── export.py                       # 管理导出
│   │   ├── admin_api.py                        # API Secret/Config 管理
│   │   ├── admin_prompts.py                    # Prompt 模板管理
│   │   ├── admin_schools.py                    # 学校管理
│   │   ├── admin_roles.py                      # 角色权限管理
│   │   ├── admin_grades.py                     # 年级管理
│   │   ├── admin_classes.py                    # 班级管理
│   │   ├── admin_voice.py                      # 语音成本管理
│   │   └── questionnaires/                     # 问卷路由
│   │       ├── templates.py                    # 模板CRUD
│   │       ├── questions.py                    # 题目CRUD
│   │       ├── responses.py                    # 作答提交
│   │       └── stats.py                        # 问卷统计
│   ├── prompts/                                # Prompts 静态文件
│   ├── data/                                   # 种子数据
│   │   ├── cases/                              # 病例 JSON 文件
│   │   ├── rubrics/                            # 评分标准 JSON
│   │   └── session_configs/                    # 会话配置 JSON
│   ├── migrations/                             # Alembic 数据库迁移
│   │   └── versions/                           # 迁移版本文件
│   ├── pyproject.toml                          # uv 项目配置
│   └── tests/                                  # 后端测试 (pytest)
│
├── frontend/                                   # 前端应用
│   ├── src/
│   │   ├── App.tsx                             # 路由配置 + 权限守卫 + lazy loading
│   │   ├── main.tsx                            # React入口
│   │   ├── version.ts                          # 版本标记 (构建时注入)
│   │   ├── api/                                # API 客户端层
│   │   │   ├── client.ts                       # axios实例 + auth/retry 拦截器
│   │   │   ├── api-client.ts                   # 统一API客户端
│   │   │   ├── api-types.gen.ts                # 自动生成的类型定义
│   │   │   ├── query-keys.ts                   # TanStack Query key 管理
│   │   │   ├── auth.ts                         # 认证API
│   │   │   ├── training.ts                     # 训练API
│   │   │   ├── chat.ts                         # 对话API (SSE流式)
│   │   │   ├── cases.ts                        # 病例API
│   │   │   ├── practices.ts                    # 练习API
│   │   │   ├── assignments.ts                  # 作业API
│   │   │   ├── stats.ts                        # 统计API
│   │   │   ├── export.ts                       # 导出API
│   │   │   ├── qa.ts                           # 问答API
│   │   │   ├── nursing-records.ts              # 护理记录API
│   │   │   ├── questionnaires.ts               # 问卷API
│   │   │   ├── prompts.ts                      # Prompt管理API
│   │   │   ├── rubric.ts                       # 评分标准API
│   │   │   ├── training-state.ts               # 训练状态API
│   │   │   ├── grades-classes.ts               # 年级班级API
│   │   │   └── admin/                          # 管理API
│   │   ├── engine/                             # 训练引擎（核心运行时）
│   │   │   ├── index.ts                        # 引擎导出
│   │   │   ├── TrainingEngine.tsx              # 训练引擎主组件
│   │   │   ├── MessageBus.ts                   # 消息总线（组件通信）
│   │   │   ├── PanelContext.tsx               # 插件上下文Provider
│   │   │   ├── PatientProvider.tsx             # 患者数据Provider
│   │   │   ├── StreamManager.ts                # SSE流管理器
│   │   │   ├── ScoreManager.ts                 # 评分状态管理器
│   │   │   ├── types.ts                        # 引擎类型定义
│   │   │   └── tts/                            # TTS 语音引擎
│   │   │       ├── index.ts
│   │   │       ├── TTSManager.ts               # TTS管理器
│   │   │       ├── browser-tts.ts              # 浏览器TTS实现
│   │   │       └── types.ts
│   │   ├── components/training/                # 训练子组件 + 插件面板
│   │   │   ├── panels/                         # 面板组件
│   │   │   │   ├── emotion/                    # 情绪追踪面板
│   │   │   │   ├── initiative/                 # 患者主动发起面板
│   │   │   │   ├── inquiry/                    # 问诊采集进度面板
│   │   │   │   ├── nursing-record/             # 护理记录面板
│   │   │   │   ├── patient-info/               # 患者信息面板
│   │   │   │   ├── physical-exam/              # 体格检查面板
│   │   │   │   ├── questionnaire/              # 问卷面板
│   │   │   │   └── scoring-display/            # 评分展示面板
│   │   ├── stores/                             # 状态管理 (Zustand)
│   │   │   ├── authStore.ts                    # 认证状态
│   │   │   └── gradesClassesStore.ts           # 年级班级状态
│   │   ├── hooks/                              # 自定义 Hooks
│   │   │   ├── useVoice.ts                     # 语音输入/输出
│   │   │   ├── useChartTheme.ts                # 图表主题
│   │   │   ├── useMediaQuery.ts                # 响应式断点
│   │   │   ├── useQuestionnaire.ts             # 问卷流程
│   │   │   ├── useScoreProgress.ts             # 评分进度
│   │   │   ├── useTrainingTimer.ts             # 训练计时器
│   │   │   └── useNetworkStatus.ts             # 网络状态检测
│   │   ├── pages/                              # 页面组件
│   │   │   ├── admin/                          # 管理后台页面
│   │   ├── components/                         # 通用组件
│   │   │   ├── ui/                             # 设计系统组件库
│   │   │   ├── dashboard/                      # Dashboard组件
│   │   │   ├── login/                          # 登录组件
│   │   │   ├── teacher/                        # 教师端组件
│   │   │   │   ├── cases/                      # 病例管理
│   │   │   │   ├── users/                      # 用户管理
│   │   │   │   ├── prompts/                    # Prompt管理
│   │   │   │   └── questionnaires/             # 问卷管理
│   │   │   └── training/                       # 训练组件
│   │   ├── styles/                             # 样式
│   │   ├── lib/                                # 工具库
│   │   ├── utils/                              # 通用工具
│   │   ├── types/                              # TypeScript 类型
│   │   ├── schemas/                            # Zod/验证 schemas
│   │   └── __tests__/                          # 前端测试 (Vitest)
│   ├── index.html
│   ├── vite.config.ts                          # Vite配置 (Tailwind整合 + API代理 + 路径别名)
│   ├── biome.json                              # Biome linter/formatter
│   └── package.json
│
├── deploy/                                     # 部署配置
│   ├── docker-compose.staging.yml              # Staging 环境
│   ├── docker-compose.prod.yml                 # Production 环境
│   ├── nginx/                                  # nginx 配置
│   │   ├── sites-enabled/
│   │   ├── snippets/
│   └── monitor/                                # 监控配置
│
├── .github/workflows/                          # CI/CD
│   ├── deploy-staging.yml                      # Staging部署 (v* tag 触发)
│   ├── deploy-production.yml                   # Production 部署 (手动触发)
│   └── rollback-production.yml                 # 紧急回滚
│
├── scripts/                                    # 辅助脚本
├── docs/                                       # 项目文档
└── AGENTS.md                                   # 项目规约
```

## 布局系统

当前项目使用两种布局，用于不同场景：

| 布局 | 使用页面 | 结构 |
|------|---------|------|
| **Sidebar (AppShell/Layout)** | Dashboard、Practice选择、QA、统计、历史、管理后台 | 响应式侧边栏 + 主内容区 |
| **TrainingEngine 全屏** | 训练对话页 | 全屏训练界面 + 插件面板 (患者信息、问诊进度、体格检查、护理记录等) |

TrainingEngine 采用插件化架构，通过 PanelContext 动态注册功能面板，支持 emotion、inquiry、physical-exam、nursing-record 等面板并行运行。

## 架构设计原则

1. **前后端分离**：React SPA通过HTTP API与FastAPI后端通信，使用标准HTTP状态码 + JSON，`useApiQuery` hook 统一消解 AxiosResponse
2. **有界上下文 (Bounded Contexts)**：业务逻辑按领域划分为 `contexts/training`、`contexts/patient`、`contexts/qa`，每个上下文独立拥有自己的路由、业务逻辑和数据访问
3. **插件化架构**：前端 TrainingEngine 和后端 training/pipeline 均采用插件/中间件模式，功能模块可独立开发、注册、启用/停用
4. **管道架构 (Pipeline)**：训练流程采用中间件链：phase_guard → prompt_builder → llm_caller → persister → phase_transition → side_effects，每轮对话经过完整管道处理
5. **JWT无状态认证**：登录颁发Token，前端存储到localStorage，每次请求携带。支持 token_version 强制过期
6. **角色权限控制 (RBAC)**：Role → RolePermission 模型，API层和前端路由层双重守卫
7. **多租户数据隔离**：School 模型实现学校级数据隔离，Grade/Class 层级管理学生
8. **LLM服务封装**：统一通过 infrastructure/llm/ 进行调用，支持多Provider优先级加权路由、熔断、健康检查
9. **Practice/Scenario 分离**：Practice 从 Case 中独立出来，支持训练(training)、考核(assessment)、自由练习(free_play)三种模式

## 数据流

```
用户浏览器 → React前端 (TrainingEngine)
    ↓ SSE Stream
插件面板 ← MessageBus ← StreamManager ← FastAPI后端
    ↓                                       ↓
管道中间件链                              PostgreSQL
(phase_guard → prompt_builder            (训练记录/消息/评分/护理记录)
 → llm_caller → persister
 → phase_transition → side_effects)
    ↓
多 Provider LLM API (DeepSeek / OpenAI 兼容 / 自定义)
```

### 训练流程

```
用户输入消息
   → SSE 请求到 /training/chat
  → phase_guard: 检查训练阶段权限
  → prompt_builder: 构建完整 Prompt（系统提示 + 患者信息 + 对话历史 + 评分标准）
  → llm_caller: 调用 LLM API（流式响应）
  → persister: 保存消息到数据库
  → phase_transition: 检测阶段切换条件
  → side_effects: 触发护理记录更新、体检发现等
  → 流式返回给前端 StreamManager → MessageBus → UI 更新
```

### 评分流程

```
训练结束
  → 评分引擎 (score_engine.py) 构建评分 Prompt
  → LLM 评分 (120s超时, 3次重试)
  → 57分制 → 100分制转换 (raw_scale)
  → 评分容错验证 (_scoring_validation.py)
  → 存入 scores 表
  → 教师可创建 ScoreReview 进行复核
```

