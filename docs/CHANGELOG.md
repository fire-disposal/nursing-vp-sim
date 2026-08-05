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

### 训练倒计时重构（墙钟语义统一）
- 单一时间源：deadline = `start_time + time_limit` 墙钟，chat 守卫 / 倒计时视图 / 结算循环同源（`modules/training/timing.py`）
- 移除自动暂停计时（`timer_started_at`/`timer_consumed_seconds` 列及 persister 逻辑），迁移 `f1a2b3c4d5e6` 删除两列
- 结算循环新增超时自动结算：到期 + 60s 宽限后自动结束并入队评分，关页/断网不再滞留 `in_progress`（复用 `finalize_training` 幂等逻辑）
- 前端倒计时改 `Date.now()` 基准（免疫后台 tab 节流），autoEnd 弹窗不可关闭（消除"叉掉后永不自动结束"），5/2 分钟提醒改区间触发
- stale 判定改最后活跃时间（最后消息时间，无消息回退创建时间）

### 训练系统近期方向确立
- 形成[训练系统收敛与演进路线](10-training-system-roadmap.md)：近期聚焦“问诊—体查—护理评估—评分”闭环
- 明确病例数据隔离、工具事务与幂等、三段式上下文、模型简化及分诊体系退场方向

### 线上反馈 07-31 修复：倒计时锚点契约
- `TrainingStartResponse.session` 增加 `start_time`。此前 session 被前端直接缓存为 detail（staleTime 5min），倒计时唯一锚点缺失导致新开训练显示 `--:--`（feedback id=30）；新增后端回归测试锁定该契约，杜绝静默回归
- 测试库 teardown 改 `DROP SCHEMA public CASCADE`（metadata 未声明 users→classes FK，`drop_all` 排序报 DependentObjectsStillExist）

### 线上反馈 07-31 修复：查体→情绪桥接
- 体温 ≥38°C（FEVER 事件）、NRS 疼痛 ≥4（PAINFUL_EXAM）、同类测量重复 ≥3 次（LONG_WAIT）产生确定性 4D 情绪事件（feedback id=30），与查体结果同事务提交，前端工具结果即时驱动情绪条

### 查体体验与内涵升级
- **生理联动网络**：体征围绕病例配置自动内聚——发热→心率代偿↑、低血压→代偿性心动过速、低血氧→呼吸代偿↑、剧痛→应激性心率/血压↑；仅作用于未配置体征，作者配置始终尊重；确定性纯函数，零新 schema（TRAINING-ARCH-MEMO 前瞻的最小实现）
- **测量值告知患者**：OperationNoteSource 携带测得值，患者对自身发烧/剧痛有言语反应（feedback id=30 的言语侧补全）
- **对照解读与异常汇总**：测量结果携带 interpretation（status + 参考范围文案），前端 chip 对照着色 + 异常发现汇总条；解读文案仅引导模式展示
- **mode 管道**：`behavior.mode`（guided/assessment）从作业配置下发到 session/detail 响应，前端据此门控引导内容

### AI 病历生成重构
- **两阶段生成**：临床骨架（core）→ 教学衍生（derivative）分步生成，每阶段独立校验；full 模式链式执行（原单次大 JSON 一次成型，任一字段失败即整例失败）
- **校验-修复循环**：阶段校验失败时把错误喂回 LLM 做一次修复，再失败才报错，大幅提升成功率
- **字段级生成泛化**：任意顶层字段可单独生成/重生成（原仅 3 个字段），以当前编辑内容为上下文
- **提示词拆分**：CASE_GENERATION_CORE / DERIVATIVE 两套模板 + 交叉一致性要求（查体锚点匹配主诉等）；修正过时注释（查体锚点只需关键异常体征，其余自动联动）
- **零测试 → 16 个测试**：阶段校验、修复循环、full 链式、字段模式、prompt 组装全覆盖

### 病历编辑器体验优化（激进）
- **两步生成向导**：AI 面板改为「1 临床骨架 → 2 教学细节」分步生成，每步独立可重试，互不污染
- **逐字段 AI 完善**：临床字段（主诉/现病史/既往史/人格/患者信息…）+ 教学字段（隐藏信息/必询要点/深层背景/查体锚点/示例对话）一键生成，以当前编辑内容为上下文
- **撤销栈**：每次 AI 填充前快照，可一键回退（上限 10 步）
- **草稿自动保存**：800ms 防抖写 localStorage，重新打开可恢复/丢弃未保存的编辑
- **病例预览**：只读学生视角摘要（患者/主诉/开场白/必询/隐藏信息计数）

## 2026.08 — 成绩管理（作业管理子模块）

- **学生成绩排名** `GET /api/scoreboard/ranking`：按学生平均分排名，支持病例（单例/全部）、班级、指定作业、作业状态（进行中/已结束）、统计范围（仅作业/含自主训练）、姓名学号检索、分层过滤与多维度排序（平均分/最高分/平均用时/训练次数/进步幅度）
- **好中差分档**：按 0-100 分制固定阈值自动分层（好 ≥85 / 中 60-85 / 差 <60），概览卡 + 分层分布条 + 排名行级徽标
- **进步幅度**：成绩序列按时间平分前后两半，delta = 后半均分 − 前半均分，±2 分内判平稳；无数据学生排末位
- **学生趋势** `GET /api/scoreboard/students/{user_id}/trend`：单学生逐次成绩/用时/病例/作业明细，前端 recharts 可视化（分数趋势折线 + 单次用时柱状 + 统计卡）
- 权限沿用 `assignment_manage`，新页「成绩管理」挂载教学导航组
