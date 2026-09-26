# 01 — 系统架构

> 适用版本: current | 最后更新: 2026-09-14

## 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 后端框架 | Python FastAPI | 异步高性能Web框架，lifespan 生命周期 |
| 前端框架 | React 19 + TypeScript + Vite | SPA单页应用 |
| 前端路由 | react-router-dom v7 | 客户端路由 |
| 状态管理 | Zustand | 客户端状态（authStore / trainingStore / workspaceStore 工作区局部 UI / uiPrefsStore / feedbackStore）；**服务端状态（含 manifest、活动可用性、完成条件）一律走 TanStack Query** |
| 数据请求 | TanStack Query | 服务端状态缓存 + 自动刷新 |
| UI组件 | Mantine v9（core/form/hooks/modals/notifications/spotlight） | 唯一设计系统组件库：主题 token + 内联样式，无原子化 CSS 依赖 |
| HTTP客户端 | axios (前端) / httpx (后端) | 前端 30s 超时 + 幂等请求指数退避重试（≤3 次）；后端共享单个 `httpx.AsyncClient` 连接池 |
| 数据库 | PostgreSQL 15 + SQLAlchemy 2.0 ORM + Alembic 迁移 | 生产级关系型数据库 |
| 认证 | JWT (PyJWT) | 无状态 Token；`token_version` 可强制全端过期 |
| 密码哈希 | bcrypt | 安全密码存储 |
| LLM API | 多 Provider 路由（DeepSeek / OpenAI 兼容 / 自定义） | 优先级加权路由、熔断、健康检查 |
| LLM 可靠性 | 每 purpose 一份 profile（`infra/llm/profile.py`）：超时 / 重试 / 并发 / 输出上限 | 例：patient_chat 30s·2 次、scoring 120s·3 次·16k 输出；并发信号量 200–500；全局超时预算分摊 |
| 加密 | 无（API Key 明文存 `api_secrets`） | 旧的对称加密方案已由迁移 `137329b7b43c` 移除；2.0 目标与取舍见 `docs/16` |
| 语音 | 火山引擎 ASR + TTS | 服务端语音识别 + 情感语音合成 |
| 图表 | recharts (ComposedChart) | 关联训练统计（双Y轴：次数+时长、次数+得分） |
| 图标 | @tabler/icons-react | 统一 SVG 图标库 |
| 评分标准 | `modules/training/scoring/rubric.json`（2 维度 19 条目，raw_max 38）+ 训练时 rubric 快照（**无 DB Rubric 表**） | 逐条目评分 → raw（Σ条目分）/ display（0-100）双轨 + `mapping_version`；evidence+reason 证据化 |
| 教师复核 | ScoreReview 独立表 + `components/record-review/ReviewEditor.tsx` | 教师逐项修改分数 + 备注，复核记录可追溯（成绩口径 = `COALESCE(reviewed_total, total_score)`） |
| 患者保护 | `modules/training/patient_ai/guards.py` | 角色泄露/诊断泄露检测，隐藏信息规则引擎，fallback 回复 |
| Prompt 管理 | prompt 常量按域放在 `modules/*/prompts*`；`core/template.py`（`{#var#}` 渲染）+ `core/template_variables.py`（类型化变量契约） | 无 DB 模板表；变量缺失即硬失败；启动时（非致命）校验占位符契约，防 `{#unresolved#}` 漂移 |
| API Key 管理 | `modules/admin/secrets.py` + `api_secrets` 表 | 明文存储（见"加密"行）、连通性测试、per-key 用量与成本统计、超额/连续失败降级 |
| 配置管理 | python-dotenv | .env 文件自动加载（`core/config.py` 直接读 os.environ） |
| 速率限制 | `core/rate_limits.py`（PostgreSQL 滑动窗口） | 多 worker 口径一致，无需 Redis |
| LLM 调用日志 | `infra/llm/logging.py`（异步批量写 `llm_call_logs` 表） | 调用/错误/token/成本/延迟可查，供 `/api/diagnose`、`pnpm run health:cost` 消费 |
| 容器化 | Docker + docker compose | 前后端 + 数据库 + nginx |
| CI/CD | GitHub Actions | `commit-format.yml`（PR 门禁）+ `deploy.yml`（tag 触发单实例部署，需 `production` 环境审批）/ `rollback.yml`（回滚） |

## 项目结构

后端结构以 [11-后端组织结构收敛](11-backend-organization-plan.md) 为现行定义（可导航单体：`core/` 内核 + `modules/` 业务域 + `infra/` 外部依赖，无 repository 分层）。
前端结构与 2.0 约束见 [16-2.0 可维护单体目标](16-v2-maintainable-monolith-objectives.md)；目录细节不在本总览中重复维护，避免双源腐化。


## 布局系统

当前项目使用两种布局，用于不同场景：

| 布局 | 使用页面 | 结构 |
|------|---------|------|
| **Sidebar (AppShell/Layout)** | Dashboard、Practice选择、QA、统计、历史、管理后台 | 响应式侧边栏 + 主内容区 |
| **TrainingEngine 全屏** | 训练对话页 | 全屏训练界面 + 插件面板 (患者信息、问诊进度、体格检查、护理记录等) |

训练能力以 **Workflow / Activity 两层协约**承载（决策见 `docs/15-workflow-activity-contract.md`）：
后端 `modules/training/activities.py` 是唯一登记表，`modules/training/manifest.py` 解析出会话 manifest
（`activities[].availability`、`artifacts`、`completion.eligible/conditions/blockers`、`actions[].enabled`）；
前端只消费 manifest，`components/training/workspace/renderers.ts` 是一张**纯映射**（`ui.renderer → 组件`），
**不判断**某个病例有没有某能力——可用性与能否结束一律由服务端决定。旧的 `tools/registry.ts` 与
`engine/capabilities.gen.ts` 已删除。

## 架构设计原则

1. **前后端分离**：React SPA通过HTTP API与FastAPI后端通信，使用标准HTTP状态码 + JSON。查询走 TanStack Query（`frontend/src/hooks/`），写操作用 `useApiMutation`（统一 toast + 缓存失效），401 由 axios 拦截器单飞刷新并排队重放
2. **可导航单体（后端）**：业务按产品领域划分 `modules/`，普通模块 router/service 直持 Session，训练域为唯一复杂领域岛；不做有界上下文/repository 分层（详见 [11-后端组织结构收敛](11-backend-organization-plan.md)）
3. **两层扩展协约**：Workflow 负责过程与生命周期，Activity 负责能力与产物；前端由 manifest 驱动（纯 RendererMap），后端训练流程走中间件链（`modules/training/pipeline/builder.py` 按 `PipelineStage` 装配）。新增能力必须满足 `docs/15 §十` 的准入质量门槛，不在前端另建能力真相源
4. **管道架构 (Pipeline)**：每轮对话按固定阶（`pipeline/stages.py` 的 `PipelineStage`）执行：`guard → transition → analysis → prompt → llm → persist → side_effects`。当前已装配 `emotion_analysis` / `prompt_builder` / `llm_caller` / `persister` / `side_effects`；`guard`、`transition` 是已声明、待用的扩展点（阶段定义与装配的唯一事实源见 `pipeline/__init__.py`）
5. **JWT无状态认证**：登录颁发Token，前端存储到localStorage，每次请求携带。支持 token_version 强制过期
6. **角色权限控制 (RBAC)**：Role → RolePermission 模型，API层和前端路由层双重守卫
7. **后端分层纪律**：thin router → service（业务规则 + 事务），service 直持 `db: Session`（无 repository 层）；跨切面使用 `core/exceptions` (AuthError/NotFoundError/ConflictError/ValidationError) + `core/unit_of_work` (commit/rollback) + `core/deps` (DbSession/CurrentUser DI)。analytics/流式/导出路由保持胖路由
8. **LLM服务封装**：统一通过 `infra/llm/` 进行调用，支持多Provider优先级加权路由、熔断、健康检查
9. **Practice/Scenario 分离**：Practice 从 Case 中独立出来，支持训练(training)、考核(assessment)、自由练习(free_play)三种模式

## 数据流

```
用户浏览器 → React 前端 (TrainingEngine)
    ↓ SSE：POST /api/chat/{id}/message/stream
活动面板 ← manifest/query cache（服务端真相源）；MessageBus 仅承载局部 UI 与流式事件
    ↑                                        ↓
  HTTP 工具指令面                          管道中间件链（按 PipelineStage 执行）
  POST /api/training/{id}/tools           emotion_analysis → prompt_builder
  (revision 乐观并发 + idem_key 幂等)      → llm_caller → persister → side_effects
    ↑                                        ↓
  WS /api/training/ws                     PostgreSQL
  (仅服务端推送事件：评分/心跳)             (训练记录/消息/评分/护理记录)
                                             ↓
                          多 Provider LLM API (DeepSeek / OpenAI 兼容 / 自定义)
```

### 训练流程

```
用户输入消息
   → SSE 请求到 POST /api/chat/{record_id}/message/stream
  → emotion_analysis: 情绪/主动性分析（最佳努力）
  → prompt_builder: 构建完整 Prompt（系统提示 + 患者信息 + 对话历史 + 评分标准）
  → llm_caller: 调用 LLM API（流式响应，落 llm_call_logs）
  → persister: 单个事务内保存消息 + runtime_state（必须成功，失败即中止请求）
  → side_effects: 情绪/主动性更新、护理记录更新、体检发现、SSE 事件（最佳努力）
  → 流式返回给前端 StreamManager →（局部 UI 事件；业务状态仍以 query cache 为准）→ UI 更新
```

工具调用（查体、护理记录、问诊指引等）不经过对话管道，走 HTTP 指令面
`POST /api/training/{record_id}/tools`：`revision` 乐观并发（旧版本 409）+ `idem_key` 幂等回放。

### 运行时状态的写入契约（一个事实，一个 owner）

`TrainingRecord.runtime_state` 是裸 JSONB，多个流程各写自己的键：

| 键 | owner（唯一写入路径） |
|---|---|
| `exam_results` / `quiz_answers` / `nursing_diagnoses` | HTTP 工具指令面（`tools/service.py` 的行锁 + revision CAS 内） |
| `scene` | 会话创建写初值（`router/session.py:_create_record`）+ 工具指令面写 vitals 增量 |
| `message_correction` | 对话回合（`pipeline/middleware/persister.py`） |
| `patient_walkout` / `terminal` | 会话终结（`session/finalize.py`） |
| `force_rescore_snapshot` | 评分重评（`router/scoring.py`） |
| `paused_*` / `questionnaire_paused_*` | 计时暂停（`router/session.py`） |

不在工具行锁事务内的写入者必须调用 `session/state.patch_runtime_state`：**行锁 →
重读（`populate_existing`）→ 只改自己的键**（对话修正、会话终结原因、评分重评快照已全部改走它）。
禁止用「已加载实例 + 整列回写」——对话回合的事务 A 与 LLM 之间隔几十秒，期间工具写入的
`exam_results` 会被整列回写静默抹掉（审计 PIP-15）。唯一例外是计时暂停
（`paused_*` / `questionnaire_paused_*`，`router/session.py`）：它在同一请求内就地读写自己的键、
不跨外部调用，因此不属于该缺陷类；若要收口需先补端点级测试。

实时通道只做通知与流式，不改状态：WS（`/api/training/ws`）只推送评分/心跳事件，前端收到后
只更新或失效 query cache（`useScoringNotifications`）；聊天写入只发生在 SSE 命令
`POST /api/chat/{id}/message/stream` 的事务 A/B 内。

### 评分流程

```
训练结束
  → 评分引擎 (`modules/training/scoring/engine.py`) 构建评分 Prompt（按阶段：评分 → 反馈）
  → LLM 评分（scoring profile：120s 超时、3 次重试，全局超时预算约束整条链）
  → 超时/解析失败 → fallback 标记（llm_empty / llm_partial / dims_injected …），不静默吞掉
  → 校验与钳制 (`scoring/validation.py`) → 总分 = Σ条目分（`raw_total`）
  → raw → display(0-100) 映射 (`scoring/mapping.py`，`Score.mapping_version` 记录策略版本)
  → 存入 scores 表（`training_records.scoring_status`: pending → processing → completed / failed）
  → 教师可创建 ScoreReview 复核；写回 `reviewed_total`（成绩口径 = COALESCE(reviewed_total, total_score)）
```

