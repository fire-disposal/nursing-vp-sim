# 01 — 系统架构

> 适用版本: current | 最后更新: 2026-08-01

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
| Prompt 管理 | `core/template.py` + `core/template_variables.py` + DB `prompt_templates` 表 | 多模板版本化、变量渲染、激活/停用、热重载、启动时占位符契约校验 |
| API Key 管理 | `infra/llm/crypto_utils.py` + Fernet 加密 | 加密存储、连通性测试、per-key 用量统计 |
| 配置管理 | python-dotenv | .env 文件自动加载 |
| 速率限制 | `core/rate_limits.py`（内存滑动窗口） | 无需 Redis，线程安全 |
| 审计日志 | `infra/llm/logging.py` | JSON 格式，控制台+文件，请求ID追踪 |
| 容器化 | Docker + docker compose | 前后端 + 数据库 + nginx |
| CI/CD | GitHub Actions | commit-format.yml (PR门禁) + deploy-staging.yml (tag触发) + deploy-production.yml (手动) |

## 项目结构

后端结构以 [11-后端组织结构收敛](11-backend-organization-plan.md) 为现行定义（可导航单体：`core/` 内核 + `modules/` 业务域 + `infra/` 外部依赖，无 repository 分层）。
前端结构以 [13-前端组织范式建议](13-frontend-organization-plan.md) 为准。目录细节不再在本总览中重复维护，避免双源腐化。


## 布局系统

当前项目使用两种布局，用于不同场景：

| 布局 | 使用页面 | 结构 |
|------|---------|------|
| **Sidebar (AppShell/Layout)** | Dashboard、Practice选择、QA、统计、历史、管理后台 | 响应式侧边栏 + 主内容区 |
| **TrainingEngine 全屏** | 训练对话页 | 全屏训练界面 + 插件面板 (患者信息、问诊进度、体格检查、护理记录等) |

TrainingEngine 采用插件化架构，通过 PanelContext 动态注册功能面板，支持 emotion、inquiry、physical-exam、nursing-record 等面板并行运行。

## 架构设计原则

1. **前后端分离**：React SPA通过HTTP API与FastAPI后端通信，使用标准HTTP状态码 + JSON，`useApiQuery` hook 统一消解 AxiosResponse
2. **可导航单体（后端）**：业务按产品领域划分 `modules/`，普通模块 router/service 直持 Session，训练域为唯一复杂领域岛；不做有界上下文/repository 分层（详见 [11-后端组织结构收敛](11-backend-organization-plan.md)）
3. **插件化架构**：前端 TrainingEngine 和后端 training/pipeline 均采用插件/中间件模式，功能模块可独立开发、注册、启用/停用
4. **管道架构 (Pipeline)**：训练流程采用中间件链：phase_guard → prompt_builder → llm_caller → persister → phase_transition → side_effects，每轮对话经过完整管道处理
5. **JWT无状态认证**：登录颁发Token，前端存储到localStorage，每次请求携带。支持 token_version 强制过期
6. **角色权限控制 (RBAC)**：Role → RolePermission 模型，API层和前端路由层双重守卫
7. **后端分层纪律**：thin router → service（业务规则 + 事务），service 直持 `db: Session`（无 repository 层）；跨切面使用 `core/exceptions` (AuthError/NotFoundError/ConflictError/ValidationError) + `core/unit_of_work` (commit/rollback) + `core/deps` (DbSession/CurrentUser DI)。analytics/流式/导出路由保持胖路由
8. **LLM服务封装**：统一通过 `infra/llm/` 进行调用，支持多Provider优先级加权路由、熔断、健康检查
9. **Practice/Scenario 分离**：Practice 从 Case 中独立出来，支持训练(training)、考核(assessment)、自由练习(free_play)三种模式

## 数据流

```
用户浏览器 → React前端 (TrainingEngine)
    ↓ SSE Stream
插件面板 ← MessageBus ← StreamManager ← FastAPI后端
    ↓                                       ↓
管道中间件链                              PostgreSQL
(emotion_analysis → prompt_builder       (训练记录/消息/评分/护理记录)
 → llm_caller → persister
 → side_effects)
    ↓
多 Provider LLM API (DeepSeek / OpenAI 兼容 / 自定义)
```

### 训练流程

```
用户输入消息
   → SSE 请求到 /training/chat
  → emotion_analysis: 情绪/主动性分析（最佳努力）
  → prompt_builder: 构建完整 Prompt（系统提示 + 患者信息 + 对话历史 + 评分标准）
  → llm_caller: 调用 LLM API（流式响应）
  → persister: 保存消息到数据库
  → side_effects: 触发情绪/主动性更新、护理记录更新、体检发现等
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

