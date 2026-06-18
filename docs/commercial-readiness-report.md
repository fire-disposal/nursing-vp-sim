# 商业化验收评估报告

评估日期: 2026-06-18
评估范围: 全代码仓库 (backend + frontend + miniprogram + infrastructure)
评估方法: 基于实际代码库实现情况的模块化评估

## 总体进度: 77%

| 模块 | 进度 | 状态 | 主要短板 |
|------|------|------|----------|
| 认证授权 | 90% | 🟢 | 缺少"忘记密码"流程；无账号锁定机制 |
| 病例管理 | 80% | 🟢 | 病例 schema 实际使用宽松（`extra="ignore"`）；缺少批量导入/导出；无病例版本管理 |
| 训练引擎 | 85% | 🟢 | Pipeline 架构合理；情绪/主动性/查体/护理记录全部实现；缺少训练回放功能 |
| LLM 集成 | 85% | 🟢 | Provider 路由 + 熔断 + 费用追踪 + 提示词版本管理 + 日志全部完备；生产级别 |
| 评分系统 | 80% | 🟢 | AI 评分两阶段 + 教师复核 + 进度追踪均实现；评分进度 tracker 为内存态（重启丢失）；无批量评分 |
| 问答系统 | 75% | 🟡 | Session + 流式/非流式 + 缓存齐全；功能较简单，无 RAG/文档引用/联想追问 |
| 管理后台 | 85% | 🟢 | 用户/学校/角色/班级/作业/反馈/问卷/LLM 监控/评分标准全部有前端页面；UI 可进一步优化 |
| 学生端 | 80% | 🟢 | 仪表盘 + 选例 + 训练 + 问答 + 历史 + 统计齐全；部分页面功能较基础 |
| UI/UX | 75% | 🟡 | 组件库较完整（29 个 ui 组件）；骨架屏/错误边界/空状态均有；但动画/过渡较少，错误提示友好度不够 |
| 微信小程序 | 70% | 🟡 | 登录/选例/训练/问答/历史/个人页均存在；训练页功能较基础（无情绪/查体等面板） |
| 基础设施 | 85% | 🟢 | Docker + CI/CD + 迁移 + 监控 + 备份完整；缺少 Sentry/APM 集成；日志轮转配置合理 |
| 测试 | 55% | 🔴 | 后端 33 个测试文件、前端 8 个、小程序 2 个；关键路径有测试但不充分；无 e2e；无集成测试覆盖 LLM 调用 |
| 技术债务 | 60% | 🟡 | Schema/路由分层清晰；Repository 模式部分采用（很多路由仍直写 SQL）；插件系统已重构为 pipeline + 面板组件；异常层级完整 |

## 模块详情

### 1️⃣ 认证授权 (90% 🟢)

**已实现:**
- 用户名密码登录、微信 code 登录、微信注册/绑定
- JWT token 签发 + 过期 + `token_version` 失效机制（修改密码/登出时递增）
- `require_permission` 权限校验中间件（Decorator/DI 方式）
- 登录 + 注册 + 对话 + QA 四路限流（RateLimiter，内存窗口）
- 多学校租户隔离（`resolve_school_filter` 全局可用）
- Token 刷新端点 (`/auth/refresh`)
- 个人资料更新（头像/姓名/学号/性别）
- 审计日志（所有认证事件记录 user_id + role + action）

**缺口:**
- 无"忘记密码"自助重置流程
- 无连续失败登录锁定机制
- 无一次性 refresh token / refresh token 轮换
- Token 过期时间硬编码（`ACCESS_TOKEN_EXPIRE_MINUTES`），无管理端可配置

### 2️⃣ 病例管理 (80% 🟢)

**已实现:**
- 病例 CRUD（带学校隔离 + 权限控制）
- `CaseDataSchema` Pydantic 校验（read-time + write-time）
- AI 生成病例（`POST /cases/generate`，支持全量/增量字段、参考病例）
- 10 个预置 seed 病例（`backend/data/cases/`）
- 练习配置（`Practice` 模型：mode/features/behavior/assessment JSONB）
- 作业发布到班级（`Assignment` 模型，含起止时间 + 进度统计）
- 评分标准集成（`rubrics` 表 + `Rubric` ORM 模型）

**缺口:**
- `CaseDataSchema` 使用 `extra="ignore"`，schema 校验较宽松
- 无病例版本管理（每次编辑覆盖）
- 无批量导入/导出（JSON/CSV）
- 无病例分类/标签体系

### 3️⃣ 训练引擎 (85% 🟢)

**已实现:**
- 完整会话生命周期：创建 → 开始 → 对话 → 结束 → 评分（6 状态流转）
- SSE 流式对话（`/chat/{record_id}/message` 支持 stream + non-stream）
- Pipeline 管道架构：6 阶段（Guard → PluginEarly → Transition → Prompt → LLM → Persist → SideEffects）
- 阶段转换系统（自动/手动，支持 min_messages/min_operations 条件）
- 情绪系统：6 态（withdrawn/defensive/neutral/relaxed/open + 监测心态变量）
- 患者主动性系统（可配置计时器 + 性格驱动的主动追问）
- 查体系统（10+ 操作类型，含解释检查教育机制，情绪联动）
- 护理记录（`NursingRecord`：sheet_data JSONB，C/S 架构）
- 功能开关系统（6 个 feature flags，按 practice 配置）
- 异步后台结算循环（超时会话自动完成 + 缓存清理）
- Note collector（跨中间件收集关键信息）

**缺口:**
- 无训练回放功能（重放对话历史 + 时间线）
- 无训练中"保存退出 / 断点续训"
- 情绪系统的并发读写取决于 GIL（单进程场景无问题）
- Plugin 面板注册在 frontend 侧，无统一降级策略

### 4️⃣ LLM 集成 (85% 🟢)

**已实现:**
- `ProfileRouter` 多 Provider 路由（DB 配置 + 环境变量兜底）
- API 密钥加密存储（`crypto_utils`，AES-GCM）
- Provider 熔断器（连续 5 次失败后降级 300s）
- 指数退避重试（`async_retry`，可配置重试次数）
- Per-purpose 并发信号量（scoring=10, chat=50, generation=3）
- 费用追踪（按 provider 月度预算、调用次数/Token/费用统计）
- 提示词模板管理（DB 存储 + 版本控制 + 热切换 + JS 渲染变量）
- 完整调用日志（`LogWorker` 异步批量写入，含 request/response/status/cost）
- Provider 目录（可用的模型列表）
- 环境变量兜底状态检查 + 统计

**缺口:**
- 无批量 Provider 健康检查（目前单 endpoint 测试）
- 无自动 provider 切换的 SLA 配置
- 日志查看页面的 aggregation 逻辑较复杂（分开 patient_chat 和其他）

### 5️⃣ 评分系统 (80% 🟢)

**已实现:**
- AI 自动评分两阶段：`scoring`（逐项评分）→ `scoring_feedback`（综合反馈）
- 多次校验：空值检查、数值强制转换、百分制转换、内容验证、schema 验证
- 评分重试机制（校验失败可重试 LLM 调用）
- 教师复核（`ScoreReview` 独立表，可逐项覆盖评分 + 评价）
- 评分进度追踪（`ScoringProgressTracker`，4 阶段 + 百分比 + 消息）
- 并发评分防重（原子 DB 更新 `scoring_status` + generation 计数器）
- 评分超时检测（`SCORING_TIMEOUT_SECONDS` 可配置）
- 评分标准（rubric）版本管理（`rubric_version_id` + rubric_snapshot 冻结）

**缺口:**
- `ScoringProgressTracker` 为内存态（服务重启后丢失）
- 无批量评分功能（教师一键为全班评分）
- 评分通知未实现（评分完成 → 推送给学生）

### 6️⃣ 问答系统 (75% 🟡)

**已实现:**
- 问答会话 CRUD（创建/列表/删除/历史查看）
- 非流式提问（`POST /sessions` → LLM 完整响应）
- 流式 SSE 提问（`GET /sessions/{id}/stream`）
- 会话消息历史（`QARecord` 模型，含 role/content）
- 管理员查看全部会话（按学校筛选）
- 提问限流（5 次/60s）
- 缓存支持（`get_qa_cache`）

**缺口:**
- 无 RAG / 文档引用能力（只能靠 LLM 内部知识）
- 无联想追问 / 相关问题推荐
- 无对话总结/归档
- 无 Export 功能

### 7️⃣ 管理后台 (85% 🟢)

**已实现（后端 + 前端页面全链条）：**

| 功能 | 后端子路由 | 前端页面 |
|------|-----------|----------|
| 用户管理 | `/admin/users` + CRUD | UsersPage, UserDetailPage |
| 批量建用户 | `/admin/batch-create` | UserDetailPage |
| 学校管理 | `/admin/schools` | SchoolsPage |
| 角色管理 | `/admin/roles` | RolesPage |
| 年级/班级 | `/admin/grades`, `/admin/classes` | GradesClassesPage |
| 病例管理 | `/cases/manage/list` | CasesPage |
| 练习管理 | `/admin/practices` | PracticesPage |
| 作业管理 | `/assignments` | AssignmentsPage, AssignmentDetailPage |
| 评分标准 | `/rubrics` | PluginDashboard |
| 反馈管理 | `/admin/feedback` | FeedbackPage |
| 问卷管理 | `/questionnaires/*` | AdminQuestionnaires |
| LLM 管理 | `/admin/api/*` | LLMManagementPage |
| LLM 监控 | `/admin/llm-stats`, `/admin/llm-logs` | LLMManagementPage |
| API 密钥 | `/admin/api/secrets` | LLMManagementPage |
| 系统提示词 | `/admin/prompts` | PluginDashboard |
| 数据导出 | `/export/records` | — |
| 调试页 | — | AdminDebugPage |

**缺口:**
- 无系统级配置页面（如 JWT 过期、评分超时等）
- 无审计日志查看页面（虽然后端记录 audit log）
- 导出格式仅 CSV，无 Excel/PDF
- 仪表盘缺乏关键指标聚合

### 8️⃣ 学生端 (80% 🟢)

**已实现:**
- 首页仪表盘（最近作业、近期训练、快捷入口）
- 病例选择页面（列表 + 筛选 + 难度/摘要）
- 训练页面（ChatTraining，含所有面板、SSE 流式聊天、计时器、查体等）
- QA 页面（提问/流式回答/历史会话）
- 历史记录页面（分页 + 搜索）
- 个人资料页面（编辑 + 微信绑定）
- 学习统计页面（持续时间趋势、排行、班级统计）
- 记录详情页（对话回顾 + 评分详情 + 教师复核）

**缺口:**
- 仪表盘数据较简单（无学习建议/推荐）
- 无通知中心（作业截止、评分完成等）
- 无消息/站内信

### 9️⃣ UI/UX (75% 🟡)

**已实现:**
- 29 个通用 UI 组件（Button/Modal/Table/Form/Dialog/Pagination/Tabs 等）
- shadcn/ui 风格，Tailwind CSS v4
- 暗色模式切换
- LoadingSkeleton / LoadingState
- ErrorBoundary（组件级别）
- EmptyState 空状态组件
- 移动端响应式布局（左侧导航 hamburger）
- 网络状态提示条（NetworkBanner）
- 用户反馈弹窗（FeedbackModal / Toast / sonner）

**缺口:**
- 骨架屏较基础（非逐组件 Skeleton）
- 错误提示文案偏技术，面向用户的友好度不够
- 缺少交互动画/过渡（如页面切换、面板展开收起）
- 部分长列表缺少虚拟滚动
- 无障碍（aria）关注不足

### 🔟 微信小程序 (70% 🟡)

**已实现:**
- 完整小程序骨架（TypeScript 配置、app.json/app.ts/app.wxss）
- API 层（`miniprogram/api/` 含 9 个模块 + `types.gen.ts`）
- 微信 OAuth 登录流
- 病例浏览页 (pages/cases/)
- 训练页 (pages/training/)，含基本聊天交互
- QA 页 (pages/qa/)
- 历史记录页 (pages/history/)
- 个人页面 (pages/profile/)
- 反馈提交页 (pages/feedback/)
- 问卷填写页 (pages/questionnaire/)

**缺口:**
- 训练页功能简化（无情绪面板、查体面板、护理记录等）
- 无训练计时器显示
- 无评分结果详情展示
- 无推送通知订阅
- 页面数较少（共 11 个页面，Web 端功能约 40% 未覆盖）

### 1️⃣1️⃣ 基础设施 (85% 🟢)

**已实现:**
- Docker Compose (staging + prod 双配置，端口隔离)
- PostgreSQL 15 + 健康检查
- Alembic 迁移（22 个 DDL + 3 个 data migration，自动生成 + 人工数据分离）
- CI：GitHub Actions 5 个工作流（staging/cd/maintenance/rollback/auto-tag）
- CD：tag 推送 → 自动构建 → 部署 staging（`test.205716.xyz`）
- 监控端点（`/api/metrics`：请求延时/LLM 调用量/DB 连接池/内存/队列）
- LLM 调用日志 + 审计操作日志
- 备份脚本（`deploy/db-backup.sh` + `db-restore.sh`，自动清理 30 天前）
- 监控脚本（`deploy/monitor/`：每日/每周报告）
- Pre-push + Pre-commit 钩子（lint + typecheck + 迁移 roundtrip）
- Nginx 反代配置

**缺口:**
- 无 Sentry / OpenTelemetry / APM 集成（诊断远程问题困难）
- 无 Grafana + Prometheus（只有原始 metrics 端点）
- 无 WebSocket 健康检查（SSE 端点正常 = 基本正常）
- 备份验证未自动化

### 1️⃣2️⃣ 测试 (55% 🔴)

**测试分布:**

| 目录 | 文件数 | 覆盖内容 |
|------|--------|----------|
| `tests/training/` | 8 | 情绪/主动性/防护/来源/流水线/阶段/训练/提示词 |
| `tests/core/` | 11 | 核心逻辑 |
| `tests/admin/` | 6 | 管理 API |
| `tests/scoring/` | 3 | 评分 |
| `tests/auth/` | 2 | 认证 |
| `tests/cases/` | 2 | 病例 |
| `tests/qa/` | 1 | 问答 |
| `frontend/__tests__/` | 8 | 前端组件 |
| `miniprogram/__tests__/` | 2 | 小程序 |


**缺口:**
- 总测试文件太少（33 后端 + 8 前端 + 2 小程序）
- 无 LLM 集成测试（所有测试 mock LLM 调用）
- 无 E2E 测试
- 前端测试仅覆盖基础组件
- CI 中无测试门禁（`-x -q` 但有 mock，不跑 pg 集成测试）
- 无性能/负载测试

### 1️⃣3️⃣ 技术债务 (60% 🟡)

**已改进:**
- 训练引擎重构为 Pipeline 架构（middleware 模式替代旧 plugin 系统）
- Schema 按领域拆分（19 个 schema 文件）
- Repository 模式已引入（`base.py` + `rubric.py` + `training.py` 等）
- 异常层次完善（`AuthError/ConflictError/NotFoundError/LLMParseError/NoProviderAvailable/LLMRateLimited`）
- Feature flags 系统化（不再是散落 if-else）
- 前端 API 路径类型安全（`ApiPath` satisfies 编译期校验）
- 日志结构化（`extra` 参数统一携带 user_id/role/action）
- 统一响应信封（`{"code": 0, "data": ..., "message": "success"}`）

**遗留问题:**
- Repository 模式仅部分采用——多数路由仍直写 SQLAlchemy query
- 同步异步混合（FastAPI async 路由中调用 sync session query）
- `models.py` 单文件 638 行（应拆分）
- 导出模块查询逻辑重复（`export.py` 多端点各自构造 query）
- 部分提示词模板仍为 Python 硬编码（`prompts/*.py`），DB 版已有但未全面迁移
- `EnvelopeResponse` 在部分端点未统一（部分返回直接 list）
- 前端 `stores/` 仅 2 个 store（缺乏全局状态管理策略）
- PluginRegistry 和 TrainingEngine 的耦合未完全解耦

---

## 短板优先级排序

### P0 — 必须修复（影响商业可用性）

| 短板 | 模块 | 影响 | 建议 |
|------|------|------|------|
| 测试覆盖率不足 | 测试 | 严重 | 新增集成测试覆盖关键路径（评分、情绪、对话）；建立 E2E 测试；CI 中加入测试门禁 |
| 无 APM/Sentry | 基础设施 | 高 | 集成 Sentry for Python + 前端；远程排障能力为 0 |
| QA 无 RAG 能力 | 问答系统 | 中 | 增加文档引用能力作为竞品差异点 |

### P1 — 推荐修复（提升体验和可靠性）

| 短板 | 模块 | 影响 | 建议 |
|------|------|------|------|
| 忘记密码流程 | 认证 | 中 | 邮箱/短信验证码重置密码 |
| 评分进度内存态 | 评分 | 中 | 改为 DB 持久化或 Redis |
| 训练无断点续训 | 训练引擎 | 中 | 保存状态快照，支持恢复 |
| 病例无版本管理 | 病例管理 | 中 | 借鉴 prompt 模板的版本化方案 |
| 小程序训练功能过简 | 小程序 | 中 | 补齐情绪/查体/护理记录面板 |
| 无通知中心 | 学生端 | 中 | 评分完成、作业截止等推送 |
| 批量评分 | 评分系统 | 低-中 | 教师一键为全班批量评分 |
| Repository 模式未全面铺开 | 架构 | 中 | 逐步迁移路由到 Repository |

### P2 — 锦上添花（差异化优势）

| 短板 | 模块 | 影响 | 建议 |
|------|------|------|------|
| 训练回放功能 | 训练引擎 | 低 | 教学示范场景 |
| 跨 Provider 健康检查 | LLM 集成 | 低 | 自动切换 = 更高可用性 |
| 训练结束后自动通知 | 评分 | 低 | 微信推送/站内通知 |
| 病例批量导入/导出 | 病例管理 | 低 | 便于内容迁移 |
| 无障碍规范 | UI/UX | 低 | 政府/医疗行业合规 |
| Excel/PDF 导出 | 管理后台 | 低 | 替代纯 CSV |
| 缓存层改用 Redis | 基础设施 | 低 | 内存态限流 + 情绪缓存 = 多进程不共享 |

---

## 建议下一步方向

### 短期（1-2 周，P0 + 部分 P1）

1. **集成 Sentry** — 优先级最高，当前远程故障诊断盲区
2. **补测试** — 为评分引擎、情绪系统、SSE 对话添加集成测试；CI 中加入 `-m "not pg"` 测试门禁
3. **评分进度持久化** — `ScoringProgressTracker` 改为 DB 或 Redis 存储
4. **忘记密码流程** — 最基本的邮箱验证码重置

### 中期（1-2 个月，剩余 P1）

5. **QA 增强** — 实现文档引用 RAG 能力（结合病例数据 + 护理学参考书）
6. **小程序补齐** — 训练页增加情绪/查体/护理记录面板
7. **通知中心** — 微信模板消息推送 + 站内通知表
8. **Repositories 迁移** — 将业务路由中的裸 SQLAlchemy 调用逐步迁移到 Repository
9. **训练断点续训** — 保存 interim 状态到 `runtime_state` JSONB

### 长期（3-6 个月，P2）

10. **训练回放** — 用于课堂演示和教学评估
11. **Redis 迁移** — 限流/缓存/情绪状态的跨进程一致性
12. **无障碍合规** — aria 标注、键盘导航
13. **性能测试** — 并发 50+ 训练场景的压测
