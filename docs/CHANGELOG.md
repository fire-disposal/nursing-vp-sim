# 项目演进里程碑

> 从项目初始化至今的主要功能变更，按里程碑组织（非逐日流水账）。
> 每日细节见 `git log --oneline`。

## 2026.05 — 项目奠基

**PostgreSQL 迁移** 从 SQLite 全量迁至 PostgreSQL 15，含连接池、TIMESTAMPTZ、psycopg3。

**分页标准化** 全栈 `PaginatedResponse` 泛型模型，后端 DB 级分页 + 前端 `Pagination` 组件，覆盖全部列表页。

**API 管理** `ApiSecret` + `LLMConfig` 模型（后精简为两表），`LLMRouter` 优先级路由 + 熔断，Admin 管理页。

**反馈系统** 反馈模型 + API + 前端弹窗 + 统计图表 + 管理列表，Feedback Bot API（外部 AI 接入读写）。

**Prompt 模板引擎** `prompt_templates` 版本化管理 + `{#var#}` 模板引擎 + `VariableRegistry` 变量注册中心。

**RBAC 权限** Role / RolePermission / Grade / Class / UserClass 模型，全路由 `require_permission`，前端动态菜单。

## 2026.06 上旬 — 训练管道 & 前端重建

**训练管道中间件** Pipeline 插件系统：7 个中间件（phase_guard → operation_detector → ... → side_effects），动态组装 + 生命周期钩子。

**前端 TypeScript 全量重建** OpenAPI 驱动的 typed API client → 全部页面用 TanStack Query + Radix UI 重建，消除 `as` 类型绕过。

**作业管理** Assignment 模型：教师发布 + 过期检测 + 特性覆盖 + 学生进度 + 批量导出。

**训练引擎 & 插件架构** TrainingEngine + PluginRegistry + PanelHost 前端架构，7 个面板插件（inquiry / emotion / physical-exam / nursing-record 等），MessageBus 插件通信。

**2D 情绪模型** trust[-2,2] → trust/comfort[0,100] 双维度，7 种意图分类 → 增量映射，Author's Note 注入，Canvas 轨迹可视化。

**特性开关体系** 6 个 FeatureFlag，`resolve_features()` 运行时解析，前后端统一。

**自动结算** 超时训练自动结束 + 评分，`covered_inquiries` 计数达标自动触发。

**对话 UI 重设计** 三层布局（Header → Content → Panel），ChatBubble 双角色，流式光标动画，TAB-based sidebar-host。

**数据模型大修** Practice + ScoreReview 独立模型，TrainingRecord 精简，迁移 roundtrip 安全校验。

## 2026.06 下旬 — 架构深化 & 多模态

**后端边界化上下文** contexts/training、contexts/patient 等独立上下文，LLM 统一调用器 + TaskQueue + 缓存注入。

**AI 核心重构** NoteCollector pipeline 统一上下文采集，QA RAG（pgvector + 教材知识库），Emotion 系统 LLM 化。

**场景系统 (Scene)** Scene protocol types + 前端 Scene 架构，TriageScene（分诊 + MEWS），HistoryTakingScene（问诊/查体/护理面板），3D 诊所 Demo。

**语音 v3 全栈** Volcengine TTS (SeedTTS 2.0) + ASR (BigASR WS 流式)，双 provider TTS 前端，voice input UI。

**患者自主追问 (Initiative)** 纯 LLM 驱动主动追问 + 指数退避 + TTS 暂停 + 情绪惩罚。

**流式评分** thinking 模式 + 0.3s 推送间隔 + 推送式浮层。

## 2026.07 — 批处理加固 & 体验打磨

### 评分体系加固 (Batch 1-3)
- 快照固化：训练开始时冻结 case_data + rubric + prompt
- 评分韧性：失败自动重试 + settlement 扫超时置 failed
- 评分校验：幻觉维度过滤 + 越界裁剪 + 总分重算
- 复核重构：ScoreReview 独立存储 + 前端合并展示 + 重评守卫
- 低质量训练不评分、作业取最高分、护理记录自动保存

### 角色 & 权限精简
- school_admin → admin，移除 role_manage，4 角色种子幂等
- 管理员学生视角预览 (previewAsStudent)
- is_test 标记全域排除

### LLM 管理 UI 重设计
- SecretList + PurposeCard + PurposeCardGrid 全新布局
- model_override 字段，env 兜底响应透出

### 学生端移动优先 UI
- 三层 Shell 路由架构 + BottomSheet 场景工具
- 训练记录卡片列表 + 紧凑顶栏 + 悬浮结束按钮
- 移动端底部 Tab "我的" 聚合入口

### 批量化 & 反馈增强
- 批量导入学生（CSV 智能识别 + 班级自动创建）
- 反馈图片附件 + 版本戳 + 回复刷新
- 钉钉 Webhook 部署通知 + 告警双通道（钉钉 + SMTP）

### 运维增强
- 通用导出封装（CSV/XLSX）+ 7 页覆盖
- Repository[T] 基类 + Unit of Work 事务 + ValidationError
- 监控告警全覆盖（限流/评分排队/语音预算/inode）

### 工具协议统一 & TTS 2.0
- ToolHandler + ToolRegistry 统一工具协议（替代旧 scene-card/WS 分支）
- PhysicalExam / NursingRecord / Quiz / Mews 工具组件
- TTS 句级流式管线 v3（二进制帧 + 连接池 + Web Audio 流式播放）
- TTS 管理页完全重写（状态条/配置表单/流式试听）

### Admin UX 全面重设计
- 卡片画廊 + 用户目录 + 面包屑 + 页面过渡
- 教学 Dashboard（bento grid + 环形进度 + 活动时间线）
- NavGroup 可折叠侧边栏

### 训练体验优化
- WS 连接状态指示 + 评分失败一键重试
- 患者消息 Markdown 渲染 + 头像合并分组
- 病例编辑器重设计（domain-section 架构）
- 人格系统扩展（mood/compliance + 组合加成）
- 问诊进度 chip + 完成弹窗
