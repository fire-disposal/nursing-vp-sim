# 项目更新记录 — 2026.06.06 ~ 2026.06.12

> 近2周（第24-25周）按日划分的项目更新记录。

---

## 2026-06-06（周五）— 训练管道重构 & 特性开关 & 患者交互重设计

### 训练管道中间件体系
- Pipeline 中间件系统：`PipelineContext` + `Phase` 数据类 + runner（short-circuit + streaming）
- 7 个中间件：phase_guard → operation_detector → operation_executor → phase_transition → prompt_builder → llm_caller → persister → side_effects
- `PipelinePlugin` + `PipelinePluginMeta` + `register_plugin()` 注册系统
- `run_plugin_hooks()` 统一生命周期调度（on_record_create / on_end / on_exam）
- 前端 TrainingEngine + PluginRegistry + PanelHost 全新架构
- 7 个面板插件：inquiry / patient-info / physical-exam / nursing-record / emotion / initiative / portrait
- PluginRegistry：`requires` 依赖链检查（emotion→portrait→initiative）

### 特性开关体系
- 6 个 FeatureFlag 定义（physical_exam / emotion / initiative / portrait / questionnaire）
- `resolve_features(config_snapshot)` 从 DB 配置解析运行时开关
- `is_enabled(record, key)` 便捷查询，前后端统一开关列表
- physical_exam 和 patient_initiative 在 chat 端点 feature gate
- ConfigModal 特性开关覆盖 UI
- Session config flags 清理，仅保留 overrides

### 患者交互重设计
- ChatBubble 双角色设计（患者左/护士右）+ 流式光标动画
- ChatInput：自适应 textarea + 发送按钮 + 操作快捷面板

### 身份泄露检测
- Identity leak 重试静默吞错修复
- Fallback 兜底回复

---

## 2026-06-07（周六）— 前端结构大修 & 训练管道计划

### 前端架构重构
- react-router v7 Layout Routes 迁移 + ProtectedRoute
- ChatTraining 重构为 thin orchestrator：hooks + components 完全拆分
- 提取 6 个训练 hooks（timer, record loader, score polling, progress, network）
- ChatTraining 子组件拆分到 training/ 目录
- Query Key Factory 类型安全缓存管理
- api-client.ts 拆分为 domain 模块 + barrel re-export
- Admin Tab 大分解：UsersTab（+React Query）/ PromptManagementTab（724→271 行）/ CasesTab / QuestionnairesTab → 各子组件
- Feature-specific components 迁移到 feature 目录
- ScoreData 共享类型提取到 types/score.ts

### 患者交互 v2 合并
- LLM 对话框架 v2 + Feature Flag 统一管理合并入主干
- OperationPanel sync 修复、类型安全、死导入清理
- FeatureConfigResponse schema、开关 key 校验

### 训练管道计划文档
- Training pipeline refactor：Phase + Middleware 架构设计文档
- 实现计划文档

### 消息输入限制
- 聊天消息 2000 字限制，前后端双重拦截 + 前端字数计数器

### 文档体系全面重构
- 合并重复文档、删除低实用内容、统一编号与版本
- 新增团队协作指南 + 本地开发环境指南
- 终端配置科普、OpenCode Skills 安装方式修正

### 护理记录面板 & 后端重组
- 配置驱动的 HIS 风格护理记录表面板
- 后端 services 重组为 domain-driven subpackages

---

## 2026-06-08（周日）— 后端边界化上下文 & LLM 基础设施整合 & 移动端

### 后端架构 v2 — 边界化上下文
- 设计 spec + 实现计划：backend architecture v2
- contexts/training：Pipeline + 中间件 + 路由 → phases 独立上下文
- contexts/patient：emotion / initiative / guard / exam / prompt
- contexts/qa：QA 上下文提取并接入 main.py
- routers 拆分：600+ 行单文件 → sub-modules
- 异步端点全面转换（async-capable → `async def`）
- 流式端点：`SessionLocal` → `db_session` 上下文管理器
- 内联导入全部移至顶层

### LLM 基础设施整合
- 统一异常体系（`AppException` hierarchy）
- `LLMClient`：统一 LLM 调用器，retry + semaphore + circuit breaker
- `TaskQueue`：有界优先级后台 worker 池
- `EmotionCache` / `InitiativeCache` 作为可注入实例
- `LogWorker` 统一日志写入
- 共享 LLM infra 接入 app lifespan
- 结算评分 via `asyncio.create_task`（消除线程调度）
- 全部 stream 端点 db session 安全关闭

### 训练管道执行
- `current_phase` 字段添加到 TrainingRecord
- Phase advance 端点 + phase 解析/转换逻辑 + 单元测试
- chat.py 重写为薄管道调度器（356→~90 行）
- 管道注册表：per-phase 中间件链动态组装
- 管道集成测试（operation short-circuit + normal flow）
- Settlement N+1 修复、emotion cache 清理 + 孤儿扫荡

### N+1 查询消除（6 项）
- settlement: batch case lookup
- questionnaires: eager loading + batch queries
- admin_roles: batch perm/user queries
- class_summary: 单 GROUP BY 替代 per-class 循环
- record_detail: joinedload + 去重用户查询

### 移动端 UX 优化
- Sheet 组件（移动端抽屉面板），所有面板迁移到 Sheet
- 移动端键盘提示、44px 输入区、scroll-on-focus
- Button 触控目标提升至 44px minimum (a11y)
- 空间压缩：减少 padding、折叠区块、可关闭提示
- QA sidebar 按钮与 Layout hamburger 移动端重叠修复
- QA reply line spacing 修复（whitespace-pre-wrap 冲突）

### 评分 & QA 增强
- 评分 JSON schema 分阶段拆分
- QA 流式端点 + 前端 SSE 集成
- Token-aware QA history, template-var field mode
- multi-tenant leaks 修复 + school-switching UI 精简

---

## 2026-06-09（周一）— 训练插件架构 & 训练引擎修复 & API 标准化

### 训练插件架构（前后端）
- PipelinePlugin 接口 + 注册表 → 3 个后端管道插件注册
- 动态管道组装（从注册插件按 feature flag 组装）
- 前端 TrainingEngine 完整组件组装（Header/Welcome/Chat/PanelHost）
- 7 个前端插件全部就位 + TrainingEngine 编排器
- ChatInput 插件、ChatDisplay 插件（智能 auto-scroll）
- TTS 引擎核心抽象、Voice 插件、Timer 插件、DevTools 插件
- ScoreManager：评分就绪 via MessageBus 发出 `score:ready`
- SlotRenderer 动态 slot 组合 + useResponsiveLayout 视口感知 slot grid
- Plugin dashboard + Scenario composer admin pages

### 消息总线 & 统一通信
- MessageBus 插件事件通信：typed event map + queryKeys 统一
- ChatMessage 类型统一到 engine/types.ts
- PluginContext 扩展：messages、loading、tts
- 特性开关统一到 pluginRegistry，插件数组稳定化

### 训练引擎修复（多项）
- StreamManager：catch 调用 onError、UUID 生成 message ID
- InquirySidebar：DOM 查询 → ctx.messages 数组
- TimerDisplay：防止重复 endTraining，移除 ctx from effect deps
- ChatDisplay scroll trap：ref for isNearBottom，修复 effect deps
- 插件去重警告 + 导入名修正
- Grid column sizing 修复：content 1fr, panel minmax(36px,300px)
- TAB-based sidebar-host panel：问诊/病历/查体/护理，slim header
- Max tokens relax 120→512, timeout 20s→30s

### API 标准化
- 传输层响应信封 `{code, data, message}` 全端点统一
- API URL 标准化、delete 响应统一 `DeleteResponse`
- MessageResponse → DeleteResponse 类型修复

### Startup & 基础设施
- 机械化神教主题双语启动祷文 + Banner（Animus Machinae）
- 启动日志精简：移除 box-drawing header
- 后端 `backend.` prefix imports → project-root relative imports
- 集中化 datetime_utils（parse_iso_datetime + ensure_utc）
- PluginRegistry overwrite warn 抑制

### 用户个人信息完善
- gender/avatar 字段 + 自服务编辑 + Web/小程序双端适配

---

## 2026-06-10（周二）— 作业管理 & 对话 UI 重设计 & LLM 调用排查

### 作业管理系统
- Assignment 模型 + router：教师发布、过期检测、特性覆盖
- 学生端：Dashboard 作业卡片 + `start-from-assignment`
- 教师端：AssignmentsPage（批量发布+详情+学生进度）+ AssignmentDetailPage（导出+评分）
- 前端表单：病例/班级选择器 + 特性开关 + 截止时间
- 统一 CsvExporter 重构
- 集成测试覆盖

### 对话 UI 全面重设计
- 三层布局：Header（病例信息+计时+特性切换）→ Content（对话流+欢迎屏）→ Panel（TAB-based sidebar-host）
- ChatBubble React.memo + 100ms scroll 节流
- PanelHost：特性级别自动显示/隐藏 + 自适应宽度（36px→300px）

### LLM 调用排查体系
- CallLogDetail：全量请求/响应查看
- CallLogTimeline：训练记录内按时间线展示调用链
- MonitorTab：record drill-down 过滤器
- `/admin/llm-logs` 新增 `record_id` 筛选

### 插件体系全面重构
- 2D 信赖-舒适情绪模型：score[-2,2] → trust/comfort[0,100] 双维度
- 7 种意图分类 → (trust_delta, comfort_delta) 映射
- Author's Note：`【信赖:25|舒适:18|状态描述|交互建议】`
- Canvas 2D 轨迹可视化（EmotionTrajectory 组件）
- v1→v2 缓存迁移：模块级 dict → app.state
- 查体-情绪联动插件（exam_emotion_bridge）
- patient_chat prompt：7→5 规则精简（-30% tokens）

### 可用性增强
- LLM 连接池 / 超时 / JWT 失效处理 + LogWorker
- Metrics 端点 + 系统监控脚本
- 每日/每周报告自动化

### 稳定性修复（多项）
- metrics 初始化顺序 + `__slots__` 移除 + 日报样式重构
- datetime timezone 比较 + Pydantic 字段命名
- 数据库迁移多头问题（merge migration + CI heads check）
- alembic 多分支预防 + AGENTS.md 约定
- 前端：永久转圈修复、staleTime + 33 query staleTime 优化
- 插件注册 module level、test mocks 修正

---

## 2026-06-11（周三）— 评分并行化 & 训练 UX 改善 & 全面缺陷修复

### 评分体系重构
- 评分两阶段并行化 via `asyncio.gather` — ~50% 提速
- scoring 超时常量统一为 `SCORING_TIMEOUT_SECONDS` (300s)
- 消除静默异常吞没 + 线程安全 + 类型修复 + 模块副作用清理
- 解散 `service/` 文件夹 + 清理死代码

### 训练控制 UX 全面改善
- 确认弹窗 / 计时重构 / 暂停特性 / 自动结束缓冲
- 结束按钮解除限制（已完成/超时均可手动结束）
- 轮询优化 + 插件去重：轻量评分端点 + 生命周期管理
- 查体交互修复：血压解析 / 错误处理 / 插件 / 情绪标签
- ExamPanel 错误提示读取 envelope message 而非 detail
- 训练模块 9 项核心问题（事务/状态/清理/并发）全面修复

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
- queryKeys 完全统一 + MessageBus typed event map

### CI/CD 加固
- auto-diagnose workflow：LLM 驱动的故障分析 + 邮件通知 + 24h cooldown
- staging tag-only trigger（移除 branches 防止 OR 触发）
- Docker log rotation (10MB/3 files) + timestamp 日志格式
- metrics snapshot 覆写 resolved flag 修复（防止邮件轰炸）
- Node.js 20 deprecation 静默 + GHCR login 修复
- 前端端口绑定 127.0.0.1 防绕过 nginx
- cross-env 替换 Unix-only inline env vars（Windows 兼容）
- Staging deploy script + backend docker meta 修复

### 专项修复
- AssignmentsPage cases 取值兼容分页响应
- scoring.py/settlement.py 残留 AI 编辑垃圾行修复（SyntaxError）
- IndentationError（FEEDBACK_RETRY_USER 残留旧行）
- interval leak：`executeEnd` 移至 state updater 外部
- 日报布局重设计：table-based 双列对比

---

## 2026-06-12（周四）— 数据模型大修 & Practice/ScoreReview & 迁移安全

### 数据模型重构
- 新增 `Practice` + `ScoreReview` 模型：独立练习记录 + 教师复核体系
- `Assignment` / `TrainingRecord` 简化：移除冗余字段，聚焦核心关联
- `User` / `UserClass` 丰富：补充必要关联字段
- DDL migration 生成 + 分离的数据迁移（seed 数据和旧数据转换）
- 全部后端 routers + contexts 适配新 Practice/ScoreReview 模型
- 赋值和管道测试更新

### Practice 选择流程（前端）
- Practice selection flow 完整前端实现
- Sidebar UX 优化 + Patient avatar 展示
- API 类型重新生成

### 迁移安全系统
- Pre-push gate：迁移安全校验 + functional audit 文档
- 数据迁移 roundtrip 验证（path 正确性, JSONB cast, user_class downgrade）
- migration path parents[3]→parents[2] 修正
- seed query 使用 ORDER BY id 替代硬编码名称
- setval COALESCE fallback 0→1（避免空表序列越界）
- scores 列 drop 移至专用数据迁移（遵守 DDL/data 分离规则）
- auto-diagnose workflow 删除（安全考量）

### 工程质量
- .gitignore `.opencode/` + biome 架构配置文件
- biome format 全量前端文件（58 文件 CRLF 修复）
- ruff check --fix + ruff format + 补充 Score import

---

*本记录由 git log 自动提取生成，覆盖 2026-06-06 至 2026-06-12（第24-25周，7天）。*
