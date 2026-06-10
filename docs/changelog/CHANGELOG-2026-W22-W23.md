# 项目更新记录 — 2026.05.29 ~ 2026.06.05

> 近2周（第22-23周）按日划分的项目更新记录。

---

## 2026-05-29（周四）— 项目初始化 & PostgreSQL 迁移

### 基础设施
- 初始化仓库 `nursing-vp-sim`（从 `xunihuanzhe` 重命名），LLM 驱动的护理虚拟病人模拟器
- 新增 PostgreSQL 原生初始 Alembic 迁移，默认 DATABASE_URL 切换为 PG 连接串
- 移除 UtcDateTime type decorator，改用 PG 原生 TIMESTAMPTZ
- 移除 SQLite 特定代码，适配 PostgreSQL 连接池
- 添加 psycopg2-binary 依赖

### CI/CD
- 生产 compose 新增 PostgreSQL service 和 `ai_vp_pg_data` 数据卷
- `deploy.sh` 动态 compose 生成包含 PostgreSQL service
- `cd.yml` backend 移除冗余 `DATABASE_URL`，内联 compose 同步新增 PG service
- CD docker meta 改用 match 正则匹配，兼容日期风格版本号 `2026.05.29`

### 文档 & 规范
- 项目 README 切换为中文，新增 repo secrets 和 commit 规范说明
- SQLite → PostgreSQL 迁移设计文档及实施计划
- 完善 Husky：validate-commit 中文注释、pre-push 校验 tag 格式

### 修复
- 移除 cases 卷挂载，防止空目录覆盖镜像内置病例文件
- 添加浏览器 favicon 并清理冗余资源
- frontend healthcheck 改用 127.0.0.1 避免 IPv6 解析
- 新增 17 条 PostgreSQL 集成测试

---

## 2026-05-30（周五）— 分页系统 & API 管理 & QA 历史

### 分页标准化（全栈）
- 新增 `PaginatedResponse` 泛型模型和分页辅助函数
- 后端迁移至 DB 级分页：`admin/users`、`cases`、`training/records`、`llm-logs`
- 性能优化：`stats/ranking` 用 SQL JOIN + 窗口函数重写，`stats/duration` 用 GROUP BY，`stats/trends` 用 LEFT JOIN
- 前端新增 `Pagination` 组件，接入所有列表页（History、RecordsTab、UsersTab、CasesTab、MonitorTab、Stats、DashboardHome）
- 添加 `start_time`、`case_id`、`record_id` 性能索引

### 多 API 管理（MVP）
- 新增 `api_providers`、`api_keys`、`api_key_rules` 数据模型和加密工具
- 实现 `LLMRouter`：priority routing + circuit breaker 机制
- 新增 admin CRUD API 和启动种子数据
- 新增 API 管理 admin 页面（provider/key/rule CRUD）

### QA 历史记录
- 新增 `QARecord` 模型和迁移
- 后端新增 QA history API（GET/DELETE history、教师全部记录）
- 前端新增 QA 历史页面、状态+日期筛选、QA Records tab
- 新增 QA API 测试（10 条覆盖 ask、history、delete、admin）

### 患者头像 & 评分体验
- 新增 8 位患者 + 2 位护士头像素材，聊天气泡头像展示
- 拆分护士头像为男女双版本
- AI 评分加载遮罩 + 10s 进度条（JS 驱动，15s 预估，评分完成加速）
- 评分报告中新增操作按钮
- 修复评分后台线程污染共享 HTTP 客户端 Bug

### 启动与运维
- 启动 Banner + 统一 nursing logger + 脱敏 config dump
- 优雅关闭 signal handler + shutdown 日志
- `backup` 端点支持 PostgreSQL via `pg_dump` + zip 下载
- `devstart.bat` 本地后端开发服务器
- `about` 按钮 + 版本号 modal，版本号贯穿 FastAPI → Docker build arg → git tag
- 移除 SQLite 备份支持，本地 PG 默认 `postgres/postgres@5432/vptest`

---

## 2026-05-31（周六）— 反馈系统 & Prompt 管理 & 模板引擎

### 反馈系统
- 后端新增 feedback 模型 + API
- 前端新增 feedback modal、provider、admin tab、sidebar 入口
- 反馈统计图表：7 天周视图、prev/next 周导航、日期筛选、中文标签
- 反馈入口移至 about modal 内，修复分页参数偏移问题

### Prompt 模板管理
- 新增 `prompt_templates` 模型、迁移、schema
- 实现 `PromptManager` service（DB + hardcoded fallback + verify/seed 启动逻辑）
- 新增 prompt CRUD API + validate 端点
- 前端新增 Prompt 管理 tab：master-detail 布局、双列场景卡片、activate 按钮、view-active modal
- 编辑器自适应高度、每启动 force-upsert v1 模板

### 变量模板引擎
- `{#var#}` 模板引擎重写 + 评分弹性增强
- Prompt 变量转义 `{}` 防注入
- Prompt 调用站点接入 `PromptManager`

### API 管理重构
- 合并 `ApiKeyRule` 进 `ApiKey`，新增 purpose/priority 列
- `LLMRouter.select_key` 简化为 provider-ordered weighted-random
- 前端 ApiManagementTab 重设计：场景分组、weight slider、purpose select
- DeepSeek 一键添加（官方默认值自动填充）
- API key 连通性测试按钮 + QA 错误详情展示

### 工程优化
- ESLint → Biome 全量切换（格式化 + lint）
- Pre-commit hook for biome format + pre-push 门禁
- 纯 npm dev workflow（concurrently 前后端）
- 移除 `KEY_ENCRYPTION_KEY`，Fernet key 统一从 `SECRET_KEY` 派生
- 清理 `.env` / `.env.example`：local/deploy/optional 分区

---

## 2026-06-01（周日）— API 简化 & 变量注册 & AI 病例生成

### API 管理简化（ApiSecret + LLMConfig）
- 新增 `ApiSecret` + `LLMConfig` 模型（废弃旧的 ApiKey/ApiProvider/ApiKeyRule）
- 前端 ConfigModal（form + JSON 双视图）、SecretModal、Model 预设下拉
- 重写 ApiManagementTab：secrets + configs 状态感知 UI
- 批量健康检查按钮、API key 有效性验证
- Alembic 迁移 + seed 数据更新 + CI 迁移验证（真实 PG 容器）

### VariableRegistry 变量注册中心
- 中央化 prompt 变量定义（metadata、type、source、default）
- 新增 `VariableRegistry`、验证逻辑、测试覆盖
- 拆分 `scoring_rubric` 为 `criteria` / `required_inquiries` / `json_schema`
- 调用站点使用 registry defaults，模板渲染错误信息增强
- 前端变量展示卡片（desc/source/type/example）+ 内联编辑

### AI 病例生成
- 新增 `POST /api/cases/generate` 端点 + case_generation v1 prompt
- 前端 CasesTab 新增 AI 面板 + 逐字段 AI 生成按钮
- `CaseGenerateRequest/Response` Pydantic schema

### 语音交互优化
- `useVoice` hook + 流式逐句 TTS + 最佳中文语音选择（AZURE）
- 一键语音自动播放 toggle（localStorage 持久化）

### 多轮 QA 对话
- 后端：sessions 数据模型 + API 重写 + 测试
- 前端：侧边栏会话列表 + 对话区 + 教师面板预览
- Markdown 渲染支持（react-markdown + remark-gfm）
- QA 输入框始终可见、建议点击直接发送、新对话自动聚焦

### 安全 & 修复
- emergency env-key fallback、UTF-8 编码强制、line-buffered stdout
- LLM 错误 → nursing.log + audit.log 双日志
- 评分通配 `*` fallback、DB config 缺失时 env 兜底状态卡片
- 移除 SQLite 支持、强制 PostgreSQL

---

## 2026-06-02（周一）— RBAC 底座 & 班级/年级 & 部署流水线

### RBAC 多租户
- 新增 `Role`、`RolePermission`、`Grade`、`Class`、`UserClass` 模型
- `User.role` FK + `has_permission` 权限判断
- 启动种子角色/权限（幂等）
- `get_current_user` 预加载 permissions cache

### 班级 & 年级管理
- 年级 CRUD + 班级 CRUD API 路由
- 前端新增 `GradesClassesPage`、`ClassFilter`、AppShell 导航入口
- 用户列表添加班级/年级列、统计排名/按班级汇总
- `UserBrief` schema 增强（class 字段）
- 集成测试覆盖 grades/classes APIs

### 评分标准（Rubric）数据库化
- Rubric DB 模型 + CRUD API + format 验证器
- Admin UI RubricTab，评分读取 DB（替代硬编码）
- 评分 prompt 工程：few-shot、temperature=0、CoT 引导

### 状态管理 & TypeScript 迁移启动
- Zustand 全量迁移，消除 prop drilling
- TypeScript 类型定义、toolchain 配置（移除 ESLint）
- `request_text` / `response_text` 入 LLMCallLog

### 备份页面
- `BackupPage` 路由 + `BackupTab` 组件 + `downloadBackup` API

### Staging CI/CD
- Tag → staging 自动部署，workflow_dispatch → production（同镜像不重编）
- staging → production 晋升门禁，compose 文件入库
- 紧急回滚 pipeline + 服务端回滚脚本

---

## 2026-06-03（周二）— 前端重建 & LLM 管理增强

### OpenAPI 驱动的 TypeScript 前端重建
- 所有 router 补充 `response_model`，导出 OpenAPI spec
- `openapi-typescript` 生成 API types + typed `api-client`
- **Login → DashboardHome → CaseSelect → ChatTraining → History → RecordDetail → QA → Stats → 全部 admin pages** 用 typed API + Radix UI 重建
- 全量 Tab 切换至 TanStack Query（useQuery + useMutation + invalidateQueries）
- 消除所有 `Record<string, unknown>` 类型绕过、`as unknown as` 断言
- Radix UI primitives 替代自定义 Modal/ConfirmDialog/Tabs
- 共享组件：Layout、PatientPortrait、ScoreCard、Feedback、Chart、avatar utils
- 新增 23 个前端单元测试（API client、stores、Toast、ConfirmDialog）

### LLM 管理增强
- ProfileRouter 替代 ConfigRouter：用途行视图 + 优先级自动递增
- ConfigModal 一键创建模式 + 复制配置按钮
- 移除 JSON 视图，纯表单模式
- LLM 管理 UI 精简：9 列 → 5 列、兜底折叠、图标操作

### 安全 & 编码规范
- CORS hardening、SLSA provenance、seed credentials 隔离
- `SECRET_KEY` 强制校验、移除 backup endpoint 和 seed 硬编码凭据
- 统一标准 logging、重写 seed 机制、修复中文编码

---

## 2026-06-04（周三）— 微信小程序 & Tailwind 迁移 & 启动重构

### 微信原生小程序学生端
- 项目骨架 + 6 页面 + API 通信层
- 微信登录适配：openid 绑定 + code2session + 迁移
- `wechat/register` 一键注册端点（含频控）
- TabBar 4 tabs：首页 / 训练 / 记录 / 我的
- 登录页：WeChat 登录 + Lottie 动画 + mode toggle
- 反馈页：星评 + 标签 + 文本输入
- 个人页：用户信息 + 微信绑定 + 菜单列表
- Lottie 播放器组件（require() JS 模块化）
- 小程序单元测试 + 鉴权风暴防护 + 客户端健壮性修复
- 小程序 API 自动生成脚本 `npm run api:generate:miniapp`
- 三套 baseUrl toggle（dev/staging/prod）+ nginx 扫描拦截

### Tailwind CSS + shadcn/ui 全量迁移
- 颜色令牌统一、间距标准化、空态组件化
- UI 一致性优化：所有组件重写
- 全局 UI polish：design tokens、typography、spacing

### 启动流程全面重构
- SQLAlchemy 2.0 modern types（`DeclarativeBase` + `Mapped[]`）
- `python-jose` → `PyJWT`，`psycopg2` → `psycopg3`
- 依赖注入重构、启动流程优化
- Seed data 异步后台任务、服务器立即可用
- Critical race conditions 修复 + FastAPI best practices
- 彩色日志输出（所有 application logger）

### Prompt 安全护栏
- Patient guard 二次 LLM 修正 + 兜底装傻回复
- Guard 仅长文本触发 + 提示词限制连问
- SSE 前端 sanitized 事件处理
- 离开训练页面时中止语音，关闭播报时中断朗读

### 评分标准全面修复
- Migration 压缩：15 个线性迁移合并为单一 initial 迁移
- Rubric 评分系统修复 + 前端交互重构
- 迁移幂等化、`init_db` 智能回退

---

## 2026-06-05（周四）— RBAC 多租户上线 & 自动结算 & Admin UX

### RBAC 多租户 + 前端权限
- 多租户模型数据隔离 + 学校选择器
- 全路由 `require_permission` 鉴权 + 学校/角色管理路由
- 前端 RBAC：权限路由 + 动态菜单 + 学校/角色管理页
- Role 唯一约束 `(school_id, name)` 复合键
- `LoginStrategy` 抽象 + SSO 骨架
- 种子数据幂等 + migration 0005 修复旧权限

### 自动结算（Auto-Settlement）
- `TrainingRecord` 新增 `time_limit` 字段（与 `case_data` 解耦）
- Auto-score gate：`covered_inquiries` 计数达标自动评分
- 背景清理循环：超时训练会话自动结束
- 已完成记录跳过 timer、显示手动评分触发器
- 结算配置常量（cleanup 间隔 & 评分阈值）

### Admin UX 打磨
- 全部 admin 列表页新增搜索/筛选、空状态、加载 spinner
- Sidebar：role `display_name`、Building2 图标（学校）、admin 分区线
- Modal 关闭时重置表单、RolePage 未保存编辑拦截
- 统一删除确认 `useConfirm` hook
- RBAC 硬编码清理、共享常量、sidebar 排序

### 高可用性修复（6 项）
- Token 自动刷新 + 离线检测
- 密码修改（miniprogram API）
- 权限缓存 + 校验
- Zod 前端 schema 校验
- GHCR pull retry + staging rollback

### 其他修复
- 评分两阶段拆分 + prompt 缓存分片 + QA 缓存 + 事件循环安全
- QA 页面 markdown 行距优化
- FastAPI `Annotated[Query]` default 修复
- Pre-commit 改为 lint-staged（加速），pre-push 仅 tag 验证

---

*本记录由 git log 自动提取生成，覆盖 2026-05-29 至 2026-06-11（共 14 天，500+ commits）。*

---

## 2026-06-06（周五）— 训练管道重构 & 特性开关体系

### 训练管道中间件体系
- 新增 Pipeline 插件注册系统：`PipelinePlugin` + `PipelinePluginMeta` + `register_plugin()`
- 7 个中间件：phase_guard → phase_transition → prompt_builder → llm_caller → persister → side_effects
- 插件中间件链动态组装（`build_pipeline(feature_flags)`）
- `run_plugin_hooks()` 统一生命周期调度（on_record_create / on_end / on_exam）

### 特性开关统一
- 6 个 FeatureFlag 定义（physical_exam / emotion / initiative / portrait / questionnaire）
- `resolve_features(config_snapshot)` 从 DB 配置解析运行时开关
- `is_enabled(record, key)` 便捷查询
- 前后端统一开关列表

### 前端训练引擎重建
- TrainingEngine + PluginRegistry + PanelHost 全新架构
- 7 个面板插件：inquiry / patient-info / physical-exam / nursing-record / emotion / initiative / portrait
- PluginRegistry：`requires` 依赖链检查（emotion→portrait→initiative）
- 滑块式侧边栏标签页

### 身份泄露检测修复
- Identity leak 重试静默吞错修复
- Fallback 兜底回复（7 条）

---

## 2026-06-07（周六）— 对话 UI 重设计 & 小程序

### 会话页面完全重写
- 三层布局：Header（病例信息+计时+特性切换）→ Content（对话流+欢迎屏）→ Panel（侧边面板宿主）
- ChatBubble 双角色设计（患者左/护士右）+ 流式光标动画
- ChatInput：自适应 textarea + 发送按钮 + 操作快捷面板
- PanelHost：特性级别自动显示/隐藏 + 自适应宽度（36px→300px）
- ScoreManager + StreamManager + TTSManager 引擎分离

### LLM 调用链排查
- CallLogDetail：全量请求/响应查看
- CallLogTimeline：训练记录内按时间线展示调用链
- MonitorTab：record drill-down 过滤器
- 实时监控 /admin/llm-stats

### 小程序核心页面
- 登录 / 首页 / 病例 / 训练 / 记录 / 详情 / QA / 问卷
- 流式 SSE 训练对话
- 问卷反馈流程

---

## 2026-06-08（周日）— 作业系统 & 后端边界化 & 滚动发布

### 作业管理系统
- Assignment 模型 + router：教师发布、过期检测、特性覆盖
- 学生端：Dashboard 作业卡片 + `start-from-assignment`
- 教师端：AssignmentsPage（批量发布+详情+学生进度）+ AssignmentDetailPage（导出+评分）
- 前端表单：病例/班级选择器 + 特性开关 + 截止时间
- 集成测试（test_assignment_flow.py）

### 后端上下文边界化
- contexts/patient: emotion / initiative / guard / exam / prompt → 独立上下文
- contexts/training: pipeline / plugins / router → 独立上下文
- 消除跨模块直接引用，接口清晰

### 基础设施加固
- LLM 连接池 / 超时 / JWT 失效处理
- Metrics 端点 + 系统监控
- 每日/每周报告自动化

---

## 2026-06-10（周二）— 2D 情绪模型 & 提示词工程优化 & 部署

### 2D 信赖-舒适情绪模型
- score[-2,2] → trust/comfort[0,100] 双维度
- 7 种意图分类 → (trust_delta, comfort_delta) 映射
- Author's Note：`【信赖:25|舒适:18|状态描述|交互建议】`
- Canvas 2D 轨迹可视化（EmotionTrajectory 组件）
- v1→v2 缓存迁移：模块级 dict → app.state（EmotionCache/InitiativeCache）

### 查体-情绪联动插件
- `exam_emotion_bridge`：EXAM_EMOTION_IMPACT 映射表（3 级分类 × 有/无解释 × 累计阈值）
- 体检专属 API（斜杠指令机制移除）
- Author's Note 注入 `_exam_impact_note`

### 提示词工程优化
- 全部 6 个 purpose 启动播种
- Author's Note 统一 `{#author_note#}` 语法
- patient_chat：7→5 规则精简（-30% tokens）
- QA_SYSTEM：user_name/user_role 变量
- 评分 retry 消息模板化

### 生产部署现代化
- 测试/正式双环境全量重建（DB volume → PostgreSQL 15 + 新 schema）
- 历史数据迁移（users/cases/records/messages/scores）
- Docker Compose 规范对齐

### 稳定性修复
- 数据库迁移多头问题修复（merge migration + CI heads check）
- 学生评分展示权限（score_review → 所有权检查）
- TrainingHeader 计时器 ref 优化（每秒重建→单实例）
- ChatBubble React.memo + 100ms scroll 节流
- TOCTOU/LLM 线程安全/N+1 查询修复
- SSE reader finally cancel + emotion schema 对齐
- 前端 envelope 错误处理 + 「加载中」永久转圈修复

---

## 2026-06-11（周三）— 质量保证 & 工具体系

### 全面缺陷修复（16 项）
- P0：initiative trigger 缺少 cache 参数导致崩溃
- P1：auth refresh 拒绝过期 token / 评分轮询超时不匹配 / envelope 错误键 / 评分锁永不解
- P2：classes/grades/cases 5 端点缺学校权限校验 / case 全局可见详情 404 / LLM 删 key 后 router 未重载
- P3：authStore username/grade/className 填充 / StreamManager abort 清理 / Login 死代码移除 / feature_overrides 并发

### 开发工具体系
- `npm run check` 一键检查：biome+tsc(前端) + ruff+ty(后端)
- pre-push 新增 tsc --noEmit
- pre-commit 新增 alembic heads + ty 类型检查
- ruff 规则豁免清理（57→0 errors）
- biome CRLF 全量修复（58 文件）
- pytest-alembic 迁移测试（2 pass, 1 xfail）

### 小程序优化
- API 类型重新生成
- 学生作业功能适配
- 小程序类型同步

### 文档
- AGENTS.md 项目约定（--autogenerate 迁移规则 + 测试 + 提交格式）
