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
- 形成旧版训练系统收敛路线（现已清理）；持久架构约束见 [16](16-v2-maintainable-monolith-objectives.md)，当前训练计划见 [19](19-training-experience-next-generation-plan.md)
- 延续病例数据隔离、工具事务与幂等、上下文边界、模型简化及分诊体系退场方向

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

### 临床推理模拟：离散舱室生理引擎（B 方案落地）

- **四舱室隐藏状态** `hidden.physio`：血容量 vol / 外周阻力 svr / 乳酸 lactate / 血红蛋白 hb，随病例绑定 `PhysiologySpec`，随 BLEEDING_PROGRESS 每 tick 差分推进
- **反馈环与涌现行为**：压力感受器（vol↓→svr↑→代偿性升 HR/护 BP）、乳酸积分器（低灌注蓄积、容量恢复后清除，ABG 呈时间依赖趋势）、干预作用力（补液扩容、输血提 Hb+扩容），替代原平铺公式映射
- **多轴耦合**：额外疾病轴（如 infection）经引擎耦合进观察（发热心动过速/血管扩张/促乳酸），`PhysiologySpec.step(values, physio, flags, dt)` 确定性纯函数
- **兼容与迁移**：旧会话 `state_from_dict` 自动派生 physio；采样快照携带 physio/transfused，实验室结果仍反映采样时状态；`fluid_bp_mask_per_unit` 移除（补液效应经 vol 表达）
- 测试：新增耦合/乳酸蓄积与清除/迟查 ABG 趋势/输血提 Hb/旧会话迁移 6 项，全量 75 项通过

### 临床推理模拟：固化、横向扩展与对话命令组

- **引擎泛化（病例工厂）**：`CompartmentPhysiology(axis, params)` 关闭共享舱室引擎 + `_make_lab_kinds` 构建实验室目录；`_build_case(...)` 一行定义新病例
- **第二病例 MVP-I（感染轴）**：`mvpi-1` 腹部术后腹腔感染——发热（T=37+2×sev）、白细胞显著升高、乳酸蓄积、血压下降，`/case mvpi-1` 即换生理与文案；Hb 不受感染排空（区别于出血轴）
- **对话命令组 TALK**：`/talk patient|family <你的话>`（2min/次），LLM 扮演患者/家属角色，仅基于已知观察作答、不泄露隐藏病程（复用 consult 的已知信息摘要与 provider 边界，失败降级为中性回复）；引擎纯函数不变，LLM 在 service/router 边界
- **锚点回归与重放确定性测试**：恶化@48min/失败@90min/报警@24min/好路径在恶化前收尾/补液输血延迟恶化 + 相同动作序列重放状态逐字节一致
- 测试：新增感染病例 8 项 + TALK 9 项 + 锚点/重放 9 项，全量 101 项通过

### 临床推理模拟：药物动力学 + 命令面通用化（Casualties: Unknown 方向）

- **药物动力学子系统**：`hidden.physio["meds"]` 每药血浆浓度（半衰期指数衰减）+ 累积量 + 给药次数；`/give <药物> [剂量]`，剂量超上限/格式错误被拒
- **副作用引擎**：吗啡→呼吸抑制（RR↓、SpO2↓）+ 镇静（意识↓）→ 过量累积触发 DRUG_ADVERSE 事件；补液→容量超负荷；抗生素→过敏；给氧→提 SpO2 但掩盖呼吸问题
- **意识状态轴**：`conscious` 由灌注/氧合/镇静共同驱动（失血性昏迷）——嗜睡时对话不可靠，昏迷时无法对话，需处理病因；狂打止痛剂 = 真实后果而非脚本
- **命令面声明（SurfaceSpec）**：病例声明自己的评估目标/备药/对话角色/等待目标，帮助文本、前端补全面板、快照 surface 全部数据驱动；感染病例备抗生素不备输血（专科差异实证）
- **命令统一**：`/give fluids|transfuse|analgesia` 三命令 → `/give <药物> [剂量]`；`/wait cbc` → `/wait [检查]` 通用；删除 FLUIDS/TRANSFUSE/ANALGESIA/WAIT_CBC 独立动作类型
- 测试：新增药物动力学/副作用/意识/命令面 14 项，全量 115 项通过

### 临床推理模拟：通用内科状态机 + 药物名录 + 指令中立化

- **通用内科状态机（内核固定，病例=初始条件+轴耦合）**：`InternalMedicineKernel(axis, coupling)` 一份方程服务所有病例——vol/svr/lactate/hb/meds/conscious 六舱室 + 呼吸/容量/循环/代谢方程全部通用；病例只提供 start_severity（初始条件）+ coupling 轴耦合表（轴如何移动共享舱室）+ 叙事 + 备药，新病例是数据不是代码（`_BLEEDING_COUPLING` / `_INFECTION_COUPLING`）
- **药物分类名录**：`DrugSpec.category`（液体与容量/镇痛/呼吸支持/抗感染/循环支持）；`/give` 无目标或 `?` 打印分类名录，前端补全按分类分组；药物副作用不写在名录里
- **指令中立化**：移除给药/评估/诊断中的全部指导性描述（"掩盖血压""过量危险""警惕活动性出血""如 /diag 疑诊…"）——副作用留给玩家从体征自己发现，命令只报告事实
- **横向扩充**：新增布洛芬 NSAID（镇痛无呼吸抑制）、呋塞米 DIURETIC（排容量降 BP）、去甲肾上腺素 VASOPRESSOR（升 SVR/BP），出血病例备药扩至 7 种
- 测试：新增分类名录/NSAID 对比/利尿/升压/备药 6 项 + 轴耦合按病例语义重写，全量 120 项通过

### 临床推理模拟：通用读数容器 + 内科病例扩充 + 临床指南校准 + 分片化时间

- **通用读数容器**：`SessionState.readings: dict[target, list[Reading]]` 替代四个硬编码字段；新评估目标 = 一个 AssessSpec 注册 + 一个 Reading 类型，引擎/快照/状态行/会诊摘要全部数据驱动迭代，不再碰 state/序列化/快照
- **内科病例扩充（4 例）**：新增 DKA `mvpd-1`（血糖轴：高血糖+脱水+酸中毒，指南=胰岛素+补液）、急性心衰 `mvph-1`（容量轴：肺水肿湿啰音，指南=利尿减容，补液有害）；新评估目标血糖 glucose、肺部听诊 breath；新药胰岛素/静脉葡萄糖/沙丁胺醇
- **临床指南校准测试**：`test_clinical_guidelines.py` 用真实诊疗思路反向审计内核——DKA 胰岛素+补液降糖、延误恶化、胰岛素过量低血糖；心衰利尿缓解啰音、补液加重、过度利尿致低血压；吗啡止痛但抑呼吸、NSAID 无呼吸抑制；输血恢复 Hb 而补液只扩容
- **分片化时间**：`clock_text(minute, start_clock)` 病例起始时钟参数化，早班 08:30 / 急诊夜班 22:00 / ICU 凌晨 02:00 各自成片，快照 clock/lab due 按病例时钟输出
- 测试：新增医疗病例 13 项 + 临床指南校准 11 项 + 时间分片 2 项，全量 143 项通过

- **学生成绩排名** `GET /api/scoreboard/ranking`：按学生平均分排名，支持病例（单例/全部）、班级、指定作业、作业状态（进行中/已结束）、统计范围（仅作业/含自主训练）、姓名学号检索、分层过滤与多维度排序（平均分/最高分/平均用时/训练次数/进步幅度）
- **好中差分档**：按 0-100 分制固定阈值自动分层（好 ≥85 / 中 60-85 / 差 <60），概览卡 + 分层分布条 + 排名行级徽标
- **进步幅度**：成绩序列按时间平分前后两半，delta = 后半均分 − 前半均分，±2 分内判平稳；无数据学生排末位
- **学生趋势** `GET /api/scoreboard/students/{user_id}/trend`：单学生逐次成绩/用时/病例/作业明细，前端 recharts 可视化（分数趋势折线 + 单次用时柱状 + 统计卡）
- 权限沿用 `assignment_manage`，新页「成绩管理」挂载教学导航组

## 2026.09 — 机房旧浏览器崩溃修复 & 取证口径

**旧浏览器渲染崩溃修复（Chromium 92）** 机房镜像停在 Edge/Chrome 92，react-markdown 10 与
recharts 调用 ES2022 `Object.hasOwn`（需 Chromium 93+）时抛 `TypeError`，被 ErrorBoundary 整页
接管——机房会话 55% 请求来自该类浏览器，表现为「前端渲染坏了」。修复：`utils/polyfills.ts`
垫 `Object.hasOwn` / `crypto.randomUUID`（入口首行引入）+ `build.target` 固定浏览器下限。

**前端遥测跨 worker 聚合** 遥测此前是进程内缓冲，`--workers 2` 下计数按 worker 分裂
（同一端点返回两套互斥计数）。改为每个 worker 写共享 JSONL 归档、快照合并增量与归档，
并把上报里已有的 `ua` 透出到 `frontend_errors.groups`——环境问题（旧浏览器）与代码缺陷
一眼可分。诊断归档挂 `ai_vp_diagnostics` 卷，跨发版保留。

**患者走人评分入队丢失** `_end_by_patient_walkout` 在延迟执行的闭包里回读 `ctx.record.id`，
worker 阶段 session 已关闭 → `DetachedInstanceError`，评分静默不入队。改为入队前捕获标量。

### 训练语义与教学闭环修复

- **训练模式统一**：作业明确选择引导或独立考核；考核隐藏问诊任务清单、精确情绪 HUD 和消息修正，服务端同步拒绝修正请求
- **计时统一**：引导/盲盒离页暂停，独立考核保持墙钟计时；必做训练前问卷单独冻结计时，完成前不挂载训练场景
- **记录完整性**：护理记录草稿进入全局训练状态，发送、离开、交卷前等待 HTTP 工具写入；训练引擎重挂载时重绑 MessageBus
- **查体恢复**：训练详情中的 `exam_results` 重建查体卡片；无学生消息但已有查体操作时直接进入对话回放
- **状态入库**：`runtime_state` 是裸 JSONB，工具 handler 浅拷贝后就地改嵌套结构，会让 ORM 的旧值一起变、flush 判定「未修改」——查体与测验结果因此从不落库（重进训练只剩初始基线）。改从 `copy_runtime_state` 深拷贝起步；解读文案随结果冻结，引导模式重进后仍能还原教学反馈
- **查体交互**：以可访问的部位导航和检查卡片替代小型人体图；增加完成进度、就地复查、异常汇总，并移除虚假监护仪占位值与无关的 WebSocket 门控
- **问诊任务清单**：清单保留勾选与完成度配色（绿/琥珀/红），但只由关键词命中推断、会漏判，从交卷门槛降级为自检参考，并移除「全部覆盖」结算弹窗
- **问卷闭环**：管理页正式接入导航；训练前按病例一次作答，评分后按训练记录逐次作答，学生结果页直接触发；该分域迁移的 downgrade 会先清理评分后作答行，避免回滚时旧唯一约束创建失败而中止（`deploy/rollback.sh`）
- **作业次数**：新作业默认最多 1 次，`0` 明确表示不限制

### 诊断口径收束（`/api/diagnose` schema_version 3）

- **每块自带 scope/window**：`process`（本 worker）/`workers`（跨 worker 档案合并）/`db`（数据库全局）× `now`/`since_start`/`m5`/`h1`/`h24`/`rolling_24h`/`rolling_<N>m`/`day_cn`/`month_cn`；删除只覆盖半数字段、且表达不了同块混口径的顶层 `windows` 表
- **修掉伪窗口**：`errors.count.last_5min/last_hour` 原为「命中窗口的组的**历史累计**」，改为**窗口内发生次数**（跨 worker 档案 + 本进程未落盘增量，按事件时间）；`total_captured` 与前端的同名字段统一为「24h 内不同签名数」（与 `unique_24h` 同义）；删除与 `last_5min` 重复的 `burst_5min`
- **同形化**：`frontend_errors` 与 `errors` 由同一 builder 产出（公开端点与 admin 端点共用），消费者只需一份解析
- **LLM 降级证据收拢**：`llm.router`（process/now）为唯一规范位置，原 `runtime.llm_router` 移除；`metrics.llm.degraded_*` 保留为宿主日报的兼容别名
- **删掉恒 0 的死字段**：`runtime.active_sessions` 删除，新增 `sessions.active`（db/now = 进行中训练数）；`metrics.active_sessions` 的 supplier 首次接线，宿主监控与日报据此判断「无会话」不再是假安全
- **陈旧度显式化**：`runtime.cache_ttl_seconds`/`cached_age_seconds`（快照最长 120s）
- **删掉第二份契约**：`schemas/ops.py` 中未被引用且已漂移的 `Diagnose*`/`Metrics*`/`Ops*` pydantic 模型移除（只留 `HealthResponse`/`FallbackStateResponse`）
- **同步消费方**：PiOps 诊断 prompt 改读 `llm.router`（此前降级证据根本进不了 prompt）、admin 看板、宿主日报兼容说明与本仓 5 份运维文档；告警文案修正（「LLM 5 分钟突发错误」实为后端 ERROR 日志突发）、p95 告警标注本进程口径

### 运行时写入收敛（一个事实，一个 owner）

- **`runtime_state` 单一写入契约**：新增 `modules/training/session/state.patch_runtime_state`（行锁 → `populate_existing` 重读 → 只改本键，`remove` 只删本键），对话修正计数、会话终结原因、评分重评快照全部改走它。此前这些写入都是「读已加载实例 → 整列回写」，而对话回合的事务 A 与 LLM 调用之间隔几十秒 —— 期间工具命令写入的 `exam_results`（学生查体结果）会被随后的整列回写静默抹掉（审计 PIP-15）。新增 `tests/training/test_runtime_state_contract.py` 守住四条不变式（其余键保留 / 以库内现值为基准 / 整键覆盖 / remove 只删本键），并用「旧写法丢 exam_results、新写法保留」的对照实验确认回归覆盖成立
- **传输边界写死**：工具/活动状态只由 HTTP 命令面 `POST /api/training/{id}/tools` 写（`router/tools.py` 不再自称「旧协议适配层」）；对话回合只由 SSE 命令写；WS（`router/ws.py`）只推送评分/心跳事件，服务端不在该通道落任何业务行。前端相应删除无消费者的残余：`useToolBridge` 的空订阅、`training-ws:reconnected` 广播（全仓无监听者）、离线客户端命令队列（工具已走 HTTP，队列里只有被丢掉的 ping）与 `TrainingWS.send` 公开 API；`useToolBridge` / `useTrainingWS` / `api/sse.ts` / `docs/01-architecture.md` 的注释与文档改为描述真实边界

### 临床判断训练病例作者面（临床推理 Slice 1）

- **`clinical_reasoning` 登记为「仅作者面就绪」的 workflow**：`WorkflowDefinition.runtime_ready`
  区分「可编写/发布/编目」与「可开始训练」。该闭包不挂 Activity、不声明患者对话 prompt、不声明
  评分 rubric；三个训练入口（自主练习/作业/盲盒）一律 409 `workflow_not_startable`，绝不落地一条
  无法渲染的训练记录，盲盒的随机池也排除不可开始的病例。「病例必须声明 workflow」的收紧判据改为
  **可开始**的闭包条数 —— 存量未声明病例保持兼容（登记 ≠ 可以开始）。
- **病例六个声明面 + 发布门禁**：`scenario` / `findings` / `initial` / `progression` / `objectives` /
  `rubric` 有类型化 schema（保存即 422，拼错子键不再静默失效）与发布门禁：关键证据必须可获取
  （否证 = 永远拿不到）、引用必须存在（目标/证据/推进触发）、每个目标至少被一个确定性锚点覆盖、
  空 must-act/cue 声明被拒 —— 每条 error 都指向作者可见的 JSON 路径并给出修复方向。
- **目录投影**：`CaseBrief.workflow` 增加 `runtime_ready`，运行期未就绪的 workflow 不投影任何能力；
  学生目录在服务端过滤不可开始的 workflow，不展示临床病例禁用卡；教师作者面仍可见。见 `docs/15 §十六`。后续接入承诺已由 [18](18-clinical-reasoning-disposition.md) 撤销。

### 评分作业队列可见性（`/api/diagnose` 新增 `jobs` 块）

- **块本身**：`jobs`（db/now）给出各 kind 的状态计数、最老 pending 等待秒数、过期租约数。`SCORING_EXECUTION=job`
  时评分不走进程内 `TaskQueue`，`metrics.queue.task_queue` 恒为 0 —— 队列是否在跑、是否堆积此前在运维面
  **不可见**。顶层键 15 → 16，块表与 job 模式口径同步进 `docs/ops/diagnostics.md`、`docs/09-operations.md`
  与 `skill://ops-interfaces`；契约由顶层键集断言 + 部署冒烟（断言 `jobs.by_kind` 存在，防"旧代码在跑却判成功"）守卫。
- **管理面**：admin 看板新增作业队列卡片（无数据 / 旧后端缺块均显式降级，不静默空白）。
- **接口定位**：`/api/diagnose` 与 `/api/feedback/bot` 明确为**按需调用入口**，刻意不配周期性消费者或调度器；
  与之并行的 `PiOps` 修复/发布流水线（工具包与 workflow）从仓库移除，接口与其载体解耦。

### 评分重试链路修复（2026-09-26 生产校验发现）

- **重试只作用于目标记录**：`acquire_scoring` 的 `WHERE id = :id AND {status_cond}` 缺括号，`AND` 优先级高于 `OR`
  使 allow_retry 分支退化为 `(id = :id AND …) OR scoring_status IN ('completed','failed')` —— **重试一条记录会把
  全库 completed/failed 记录一并置为 pending**；若此时后端重启，job 模式的启动重放会据此对全库真实记录发起
  重评分（成本 + 覆盖成绩）。生产一次 `retry-scoring` 已复现：420 条被清扫按"已有 Score"静默还原，仅多出
  1 条重复通知，未造成重评分。
- **清扫按"本次尝试"衡量新鲜度**：`_sweep_stale_scoring_records` 原先只看 `end_time < now − 10min`，因此对
  结束超过 10 分钟的记录重试**必然**被下一轮清扫打回 failed，排队作业随即空跑 —— 「可手动重试」在真实场景下
  失效。改为按 `runtime_state.scoring_requested_at`（由 `acquire_scoring` 在同一语句内与 CAS 一起写入；
  无标记的历史行回退旧口径）。
- **未执行不得记成成功**：`run_scoring_background` 从静默 `return` 改为返回未执行原因，jobs 层据此抛
  `ScoringNotExecuted` → job 记 failed + `last_error`。此前「一条 succeeded 的评分作业」与「库里没有任何分」
  可以同时成立，队列读面（`jobs` 块）因此报假健康；记录已被其他执行者评完（`scoring_status=completed`）
  仍视为目的达成，不算失败。

### 审计覆盖补齐（A5 收尾）与账号级登录锁定（A6）

- **审计写入面补齐**：`score.review_submitted`（评分复核，payload 含复核前后总分与评审态，**不落评论正文**）、
  `score.retry_requested`（手动重试/force 重算，含"即将被删除的旧分与旧复核"before 快照）、
  `class.created|updated|deleted`、`class.members_added|removed`（成员名单只记样本与计数，≥20 条不整份落库）、
  `notification.created|updated|deleted`、`questionnaire_template.created|updated|deleted`（含病例绑定集合的
  前后差异与**题目指纹** sha256[:12] —— 只改题目正文也会留痕，但正文不入审计）、`auth.login_blocked`。
  全部与业务写**同一事务**（回滚则一起回滚）；拒绝/失败类仍走独立 session 的 `record_detached`。
  至此 A5 清单（病例生命周期、反馈回复、评分复核、问卷模板、班级与成员、系统通知）全部接入。
- **账号级登录失败锁定（代码就位，默认关闭）**：`users.failed_login_count` + `locked_until`（迁移 `a9b8c7d6e5f4`），
  阈值 5 次 / 15 分钟（`LOGIN_MAX_FAILED_ATTEMPTS` / `LOGIN_LOCK_SECONDS` 可覆盖）。锁定期内即使密码正确也拒绝
  并**明确提示"账号已锁定，请 N 分钟后再试"**；成功登录清零；未知用户不计数、不落状态。
  维护者决定**默认不启用**（`LOGIN_LOCKOUT_ENABLED=false`）：该特性带负向副作用（拿错密码就能锁住别人的号），
  与项目"实验性 / 体验优先"的标准不符。模型列、迁移、审计动作与判据全部保留，开启只需设一个环境变量；
  关闭时连"读锁定期"都不做，存量锁立即失效。
- **测试基础设施**：测试库 schema 改为**会话级 drop + create**（`conftest.py::_schema_matches_models`，库名不含
  `test` 时直接停止）——`create_all` 不会给既有表补列，"模型加了列而库里没有"此前会让用例报
  `UndefinedColumn`，并诱使测试模块各自写 `ADD COLUMN IF NOT EXISTS` 绕过（本轮已删除这类补丁）。
  后端全量 1539 → **1564 通过**。

### UI 深色态 token 收口（S2/S3）与筛选栏迁移（U1）

- **固定色阶清零**：全仓 `var(--mantine-color-gray-N)`（135 处 / 54 文件）与
  `var(--mantine-color-<色>-0/1)`（53 处）替换为 scheme 感知 token（`default-hover` / `default-border` /
  `dimmed` / `{色}-light` / `{色}-light-color` / `{色}-outline`）—— 这些固定档不随 color scheme 翻转，
  深色态下浅底/浅描边会失效。表头灰底（theme 唯一来源）同步改为 `default-hover`。
- **顺带修**：`VoiceTokenCard` 的圆点色值写成 `var(--mantine-color-red.5)` —— 点号不是合法的自定义属性名，
  浏览器**整条丢弃**该声明，四个状态的圆点此前根本没有颜色（实测 computed=transparent；连字符形式正常解析）。
- **`VoiceTokenCard` 三层自绘边框**收敛为"同层只保留一层描边"（S3 第二波）。
- **U1**：`/admin/versions` 与 `/my-feedback` 的手写筛选行接入 `FilterToolbar`（含一键复位与 `hasActiveFilters`）；
  版本页的归因维度仍是 `SegmentedControl`（属视图切换，不入筛选栏），该页是聚合页、**不加搜索框**。

### 训练方向收敛与评分校准计划（2026-09-27，仅文档）

- 新增 [18-临床推理去向](18-clinical-reasoning-disposition.md)：独立实验模块、作者面契约与历史引用保留，冻结功能扩展；删除必须接入第二工作流的旧承诺，不删除代码或迁移数据。
- 新增 [19-正式训练下一代深化计划](19-training-experience-next-generation-plan.md)：病例蓝图与迁移变式、响应性互动、可信状态、评分/等第校准、证据复盘与再练习，明确 W0–W6 代码落点、依赖和验收。
- 纳入维护者报告的评分偏严与无优秀现象；本地评分标准渲染实跑确认行为锚点未被输出，只读部署取证确认相同 rubric 标识对应多种历史量尺。记录事实与局限，不据此认定完整因果，不调高线上分数或覆盖旧成绩。
- 删除 15/16、根训练备忘/TODO、临床旧 brief 和训练体验分析中的过时实施路线；保留实现事实、历史证据与维护约束，统一文档导航。
- 本次未修改业务代码、配置、迁移、生成类型或生产数据；未提交、推送或发布。计划中的评分与训练能力尚未实施。

### 训练深化批次：评分证据与量尺、可信链路、蓝图与迁移（docs/19 W0–W6，2026-09-27）

> 代码侧交付；教师校准**未完成**，因此**未启用能力等第**，也未宣称教学有效性。详见
> [评分校准工作区](calibration/README.md) 与 [历史验收记录](review/training-deepening-verification-2026-09-27.md)。

**评分证据与量尺（W4）**

- **锚点真的送达模型**：`build_scoring_criteria` 逐条输出每个 rubric 条目的 0/1/2 行为锚点，
  标题与真实量尺一致；此前只发条目名称，行为评分实际上按清单覆盖在判。评分输入同时补上
  **已记录查体结果与已提交护理评估**（此前只注册进 PromptContext，模板里无人引用 → 模型从没见过查体证据）。
- **原始精度与展示投影分离**：新增 `scores.raw_detail_scores`（0-`raw_scale` 的逐项分/上限/状态/证据引用）
  与 `scores.score_meta`（适用原始满分、`not_applicable_items`、rubric 内容身份、评分/反馈提示词内容身份、
  等第政策身份、辅助条件）；`detail_scores` 退回纯展示投影。迁移 `b1c2d3e4f5a6`；历史行保持 NULL = 不可比。
- **适用性由病例声明**：`blueprint.not_applicable_items` 让"本次任务不适用"的条目不进分母（例如没有实施
  干预与观察机会时的 `nr_05`），模型不能用"没答上来"缩小分母；未声明不适用却判空的条目记为
  `unscored_by_model` 并落记录级 fallback（不进统计），不再冒充学生得 0 分。
- **证据引用可定位**：条目的 `evidence` 由服务端确定性映射到真实 `Message`/`TrainingAction`/提交产物
  （滑窗匹配，纯函数），定位失败标 `evidence_verified=false`，不伪造"第几轮"式主键。
- **取消凑反馈**：`weaknesses`/`missed_content` 允许为空数组并附 `explained_empty`，空值不再触发补全重试；
  前端对空反馈给明确空态而不是"AI 未生成"。
- **等第政策单源**：新增 `scoring/grade_policy.py`；数值分层（85/60）只是数值描述，能力等第在
  `CALIBRATION_STATE=calibrated` 之前**恒为空**；学生页/教师页/导出/统计共同消费同一份标签与阈值。
- **可比性分组**：新增 `scoring/comparability.py`；跨量尺/跨辅助条件/身份不明的记录不再混合计算"进步"，
  趋势与排名随附可比组说明。
- **教师复核改在原始条目上**：复核请求/响应走原始层与适用分母（响应带 `review_basis`），
  不改条目提交时总分不变；AI 判据与教师判据分列保存，互不覆盖。
- **前端消费同一口径**：教师复核编辑器改为读 `GET /records/{id}/review` 的 `original_raw_detail_scores`
  + `raw_scale`（不再拿展示投影当基准；不适用条目只读并标「本次不适用」；`review_basis=legacy_display_derived`
  时显式提示「复核基准由展示分反推」）。训练记录列表新增「成绩来源」列（按 `score_reviewed` 显示教师复核/AI 初评，
  降级标记以详情为准，历史列表载荷没有降级字段就不猜）；成绩管理页的分段标签与阈值全部取自响应 `policy`
  （数值分段标签不再是「好中差」措辞、页面不含 85/60），未校准时只显示「尚未校准能力等第」。

**核心可信链路（W1）**

- 学生结果页显示**教师复核**（复核人/时间/备注与复核分），并显式区分 AI 初评、教师复核与系统降级。
- 评分等待改为按终态自动查询（GET），「重新评分」是独立的 POST 动作且只在失败时出现；删除合成百分比
  （`ScoreManager._applyFakeProgress` 与横幅的 30 步伪进度）与「定时器宣布已保存」。
- 学生自视图不再借用全体排名权限（`/stats/ranking` 需 `stats_view`，学生 403），改用自己的记录与趋势。
- 暂离/离页暂停改为**带鉴权**的 keepalive 请求：服务器未确认时不宣称"已暂停"，也不再承诺无法兑现的暂停。
- 语音/TTS 降级与 ASR 失败可见；WS 断线只报"通知通道不可用"，不再误报"工具不可用"；产物提交状态走出 tooltip。
- **修复 P0**：`patch_runtime_state` 重读整行（`autoflush=False`）会吞掉同事务未 flush 的列改动，
  导致 `/end` 返回 `completed` 而库里仍是 `in_progress` —— 学生会卡在"已有一条进行中训练"、结果页与重练入口
  永远拿不到完成记录。修复为写入器先 `db.flush()`，并加生产语义回归用例（真库 + `autoflush=False`）。

**病例蓝图与迁移变式（W2/W5）**

- `CaseDataSchema.blueprint`：学习目标、前置能力、关键线索（含获取途径与评估意义）、必须覆盖/情境相关/关键遗漏、
  可接受证据整合、典型错误、不适用条目、干预可观察性、家族与变式关系、审阅留痕（draft/teacher_reviewed）。
- 发布门禁校验引用完整性、rubric 条目存在性（按病例启用能力解析后的 rubric）、家族角色自洽与审阅留痕；
  作者面新增蓝图编辑器（未声明时不注入默认值，保存保持内容一致）。
- 运行时消费：评分任务边界、不适用分母、引导提示（领域 + 意义，而不是问句清单）、再练习目标解析。
- **复盘—重练—迁移闭环**：结果页置顶"关键选择"（条目 + 原始分 + 证据 + 判定理由 + 下一次练习原则 +
  常见错误），并提供同例纠正与变式迁移入口 —— 目标病例、revision 与"内容是否已更新"全部由服务端解析；
  无可用变式时不渲染假入口。再练习记录在 `practice_snapshot.practice` 留痕（种类/来源/目的），不带作业归属，
  因此不占作业次数、不进作业成绩；作业次数限制也不会因此被绕过。

**响应性互动（W3）**

- 患者按**问题含义**作答（不要求固定问法或关键词）；患者已主动说过的信息不逼学生换句式重问；
  学生确认/整合时自然确认而不是复述整段；顺着已提到线索追问会给出对应细节，但不新增或改动病例事实。
- 情绪只影响语气与展开程度，不再是信息门锁（低信任/低配合分支的"回避细节""需要先说明原因"改写为如实回答）；
  示例对话明确"含义相同即应给出信息"。
- 引导模式提示改为"还需弄清的领域 + 其意义"，独立考核与盲盒不披露提示。

**测试与验证**

- 后端全量 1615 通过；新增锚点送达/适用分母/证据定位/等第政策/判例入选/终态持久化等用例。
- 真实 LLM 端到端验收（本地 verify 库）：完成一次训练 → 后台评分到终态 → 原始层 24 条（含 1 条不适用）、
  证据引用 21/23 可定位、溯源与政策身份齐备、教师复核不改条目总分为 41 = AI 41、学生可见复核、
  同例与变式入口与留痕、迁移记录不计入作业。
- **未做**：教师判例与留出集、阈值登记、重复评分稳定性 —— 见校准工作区（尚无签字阈值）；不要求多位教师联合宣判或教师间一致性。

### 训练上下文收敛与 U0 固定候选计划（2026-09-27，仅文档）

- 将 19 从已完成的 W0–W6 深化路线改为当前 C0/U0 计划：先删除上下文运行时的单命名空间注册器、伪跨轮缓存、只写不读状态和无消费者接口，再打磨患者自然度、任务衔接、SUS 配置与候选冻结。
- 历史 W0–W6 保留为已交付事实，不再把教师校准、六个迁移情境或能力等第列为 U0 前置；能力等第继续保持未校准关闭状态。
- U0 后若出现真实的重复实验需求，只考虑不可变上下文 revision、作业发布时固定 arm、训练开始冻结快照和按 batch/arm 导出；不热改进行中会话，不做请求级覆盖或自动胜者。
- 本次未修改业务代码、配置、数据库与历史成绩，未执行 tag 或部署。

### C0：患者上下文运行时收敛（2026-09-27）

- **装配合一**：唯一纯入口 `context/compiler.py::compile_patient_prompt`（吸收原 `ContextAssembler` 类、
  `assemble_patient_messages` 双入口与 `patient_state.py`），返回 messages 而非内部账本；槽位权限
  （ROLE/SCENARIO 内核保留、PATIENT_STATE 需声明、GUARD 只认内核来源）在同一函数内执行。
- **删除无消费者抽象**：`pipeline/prompt_context.py`（单命名空间注册器）、
  `pipeline/prompt_context_builder.py`、伪跨轮缓存 `STATE_PATIENT_CONTEXT_KWARGS`、只写不读的
  `STATE_ASSEMBLER`、无消费者的 `WorkflowDefinition.context_profile`。
- **归属归位**：病例模板变量 → `context/case_vars.py::build_case_vars`（并按 trait 表 + 组合加成
  拆分降低复杂度）；病例生成侧文本块 → `modules/cases/prompt_format.py`；评分/反馈变量直接用字典。
- **策略与身份**：预算收敛为单一 `ContextPolicy`（`context/budget.py`）；`context_policy_version`
  改为覆盖策略字段 + `COMPILER_SCHEMA` + 槽位/示例/摘要标记，消除"只改算法身份不变"的盲区。
- **删除未接线链路**：token 账本、`resolve_token_scale`、`MAX_TOKEN_SCALE`、`reconcile_tokens` /
  `TokenReconciliation`（无生产消费者）；截断与折叠改为由消息结构 + 告警日志观测，真实用量仍由
  `llm_call_logs` 承载。越权与超预算贡献从"只记账本"改为 warning 日志。
- **行为诚实化**：PROMPT 阶段不再写任何 `ctx.state`；动态模板渲染失败不再静默退化成空病例块。
- **验证**：21 组夹具（短/长/饱和历史、零预算、示例段、场景状态、片段截断/丢弃/越权、守卫追加）的
  messages 与收敛前实现**逐字节一致**（临时工作树对比 HEAD）；后端全量测试 + `ruff` + `ty` 全绿；
  真实 provider 冒烟（真实病例编译 → 患者回复 → 泄漏守卫命中 → 守卫修正重试）通过。

### U0-A：患者自然度（2026-09-27）

- `prompts/patient.py`：删除全局句数上限（“每次回答 1-3 句话”）与“问一句答一句是常态”，改为
  **说多少由情境决定**（性格/说话风格/当前情绪/问题分量），并显式禁止每轮同长度同句式；同时允许
  犹豫、含糊、啰嗦、跑题、抱怨与反问，并明确禁止用故意拒答或“没说对关键词就不开口”制造难度。
- `patient_ai/emotion/behavior.py`：逐轮情绪注记去掉数字句长（1 句以内 / 1～3 句 / 2～4 句），改为
  相对详略描述；语气里的“问一句答一句”同步改写。情绪标量与阈值未动（只改对模型的措辞）。
- 新增 `tests/training/test_prompt_builder.py`：钉住 `runtime_state["scene"]` → PER-TURN 患者状态消息的
  场景注入链路，以及坏场景降级不失败（此前该链路无覆盖）。
- 保留契约：含义问法即算问到、已说信息不重问、顺线索给细节、事实跨轮一致、不知道就说不知道、
  情绪不是信息门锁、辱骂升级与边界。
- 验证：真实 provider + 真实病例 7 轮脚本化问诊——四类对话齐备、0 次不问就说、换问法不改口（均答 3 天）、
  换词追问仍作答、篇幅 20–71 字 / 句数 3–6（未退化）；后端全量 1627 项 + `ruff` + `ty` 全绿。

### U0-B：开场、交卷与反馈衔接（训练 UI 迭代，2026-09-27）

- **开场屏**：`WelcomeScreen` 改为自读 manifest（不再由 `ChatArea` 透传）。首屏给出角色、按服务端活动生成的
  步骤（必交产物标「必交」+ 产物状态徽章、不可用活动单列原因）、「还缺什么」（原样引用 `blocker.message`）、
  必交产物说明、如何交卷、结束后路径；「建议开场」下移，把契约留给手机首屏（390x844 实测四项均在首屏内）。
- **交卷一跳**：`CompletionChecklist` 新增 `onNavigated`——结束确认弹窗内的「去处理」打开面板的同时收起弹窗
  （此前弹窗压住面板，跳了等于没跳）；blocker 有 `target` 但定位不到落点时给「请手动打开处理」，不给假按钮。
- **失败归因分开**：草稿落盘失败提示「护理记录未能保存到服务器，交卷已中止」并打开护理记录面板（不再报
  「结束训练失败」）；到点自动交卷被拦下时重新摆出完成清单（不再只留一条会消失的 toast）；评分重试的退避窗口
  改为类型化 `RetryCooldownError`，如实转述「请等待 N 秒后重试」。
- **产物状态一致**：首次草稿落盘（服务端 `empty → draft`）后立即失效 manifest 查询，消除侧栏/能力条
  「未填写」最多滞后一个 15s 轮询周期的问题（判据是服务端状态，不是前端自算）。
- **问卷可见性**：`has_pending` 为真但题目拿不到 → 结果页与训练前必答问卷都**可见且可重试**
  （「问卷加载失败 / 你的作答尚未被记录…」）；`has_pending=false` 不误报；`check` 失败单列黄色提示且不阻塞成绩。
- **结果页口径**：逐项判定行新增来源徽章（`AI 初评` / `教师复核`），以服务端 `score.review.detail_scores`
  为准（非空则展示教师判定，否则标注 AI 初评并说明与已复核总分的关系）；删除无生产者的 `_reviewed` 死分支。
- **移动端与触摸**：新增 `usePatientStageMode()`（宽 <768 或高 ≤500 → compact）；竖屏患者区收为 88px 紧凑头
  （头像 36 + 姓名/主诉一行，大图按需展开，情绪行常驻）、横屏收为 88px 窄条；侧栏/能力条命中区提到 44px；
  删除 `ChatArea` 里与 `TrainingEngine` 叠加的重复顶部退避（曾让对话列比患者列低一个顶栏高度）。
- 验证：真实浏览器 1440x900 / 390x844 / 844x390（宿主互斥、无重复抽屉、触摸目标 44px、一跳成立）；
  前端 93 文件 **629 用例通过**（1 skipped）+ `tsc` 干净 + `biome` 仅 2 条存量告警；真实 LLM 全链
  （3 轮对话 + ADPIE 提交 + 交卷 + 结束 + 结果页）走通。
- **本轮实测发现并当场修复（阻断 U0 数据质量）**：一次完整训练的评分落 **0 分 + `fallback=llm_empty`**，重试复现。
  三次 scoring 调用的 `completion_tokens` 为 14000 / 7882 / 6633（`max_tokens=16384`，评分 profile 开启
  thinking），落库 `response_text` 的 `{` 比 `}` 多 1（顶层对象未闭合）→ `safe_parse_json` 三层兜底全部失效 →
  `_stream_attempt` 视作空 → `scoring_fallback_zero` 写 0。另有一处独立偏差：模型把分值写成
  `"total_score": "20(0~48)"`、`"score": "13(0~28)"`，`_coerce_numeric_fields` 明确「无法转换」并保留字符串。
  修复与验证见下一节。

### 评分链路：截断不再被当成"空响应"，且不再写假 0 分（2026-09-27）

- **解析分层**：`infra/llm/parsing.py` 新增 `TruncatedJSONError(ValueError)` 与 `_looks_truncated()`，
  把**截断**（要压缩输出后重试）与**不是 JSON**（重试无用）分开；`_repair_truncated_json` 重写为
  转义感知扫描 + 补完必须自身可解析，字符串内部截断时丢掉不完整字段而不是补空串。
- **重试分工**：`_stream_attempt` 返回 `(结果, 是否截断)`；截断时改用压缩输出专用重试提示
  （`SCORING_RETRY_TRUNCATED_USER` / `FEEDBACK_RETRY_TRUNCATED_USER`），不再用同一套提示重发同样长的输出。
- **输出约束**：评分提示词新增篇幅与数值纯度要求（`reason` ≤ 60 字、`evidence` ≤ 40 字；分值必须是纯整数，
  不得写成 `"20(0~48)"`；不输出 `max`；必须完整闭合）。
- **数值批注**：`_coerce_numeric_fields` 现在能把 `"20(0~48)"`→20、`"13(0~28)"`→13、`"35.5分"`→35.5
  转换过来（忽略的批注记 info 日志）；`"N/A"`、`"分20"` 仍保持字符串并 warning。
- **不写假 0**：两次尝试都没有可用结果时抛 `ScoringUnavailableError`，执行器置 `scoring_status=failed` +
  `scoring_error`，前端展示失败态并可重试。历史 `llm_empty` 行仍可读，但不再新写 —— 0 分是对学生的错误陈述，
  降级标记不足以抵消它。
- 验证：故障原文经修复后的 `safe_parse_json` **完整还原**（3 维度 / 24 条目）；真实 provider 复评同一记录
  由 `0 分 + llm_empty` 变为 **50 分（原始 24 分）、条目级证据齐全、`fallback=null`**；后端全量 1646 项通过。
