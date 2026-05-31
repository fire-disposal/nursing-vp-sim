# 08 — 交接记录

> 适用版本: v2026.05.31 | 最后更新: 2026-05-31

本文档用于记录当前版本状态，作为下次继续开发时的快速上下文。

---

## 当前版本概要

**v2026.05.31** — 多 API 管理 + Prompt 模板 + 数据库从 SQLite 迁移到 PostgreSQL + Docker 部署 完成。

**最新改动 (2026-05-28 ~ 2026-05-31):**
- 数据库 SQLite → PostgreSQL 15 + Alembic 迁移
- 多 LLM Provider/Key 管理（优先级加权路由 + 熔断 + 健康检查 + 加密存储）
- Prompt 模板 DB 管理（版本化 + 变量渲染 + 热激活）
- 问答历史（学生端 + 教师端管理）
- 患者画像卡片、分页标准化、跳过评分按钮
- Docker Compose 部署（PostgreSQL + backend + frontend + nginx）
- CI/CD 完善（GitHub Actions → GHCR → VPS，Biome 替代 ESLint）
- 多项 Bug 修复（prompt injection、latency、migration idempotency 等）

**上一版本** (2026-05-27):
- 商业级布局优化完成。14个UI组件，DashboardHome 角色分流，Admin 拆分 4 Tab。
- 详情见下方对应日期记录。

---

## v2026.05.28-31 新增 — 架构升级 + 多 API 管理 + Prompt DB + 问答历史

### 数据库升级 (v2026.05.28)
- SQLite → PostgreSQL 15
- Alembic 管理 schema 迁移
- Docker Compose 一键部署

### 多 API 管理 (v2026.05.29)
- `backend/models.py`: ApiProvider (api_providers), ApiKey (api_keys)
- `backend/services/llm_router.py`: 优先级加权路由 + 熔断 + 健康检查
- `backend/services/crypto_utils.py`: Fernet 加密 API Key
- `backend/routers/admin_api.py`: Provider/Key CRUD + 连通性测试
- 前端 ApiManagementTab: Provider 列表 + Key 管理 + DeepSeek 一键添加

### Prompt DB 管理 (v2026.05.29)
- `backend/models.py`: PromptTemplate (prompt_templates) 版本化
- `backend/services/prompt_manager.py`: 加载/渲染/缓存
- `backend/routers/admin_prompts.py`: 模板 CRUD + 版本激活
- 前端 PromptManagementTab: 模板编辑 + 变量预览 + 热激活

### 问答历史 (v2026.05.30)
- `backend/models.py`: QARecord (qa_records)
- `backend/routers/qa.py`: 问答自动保存 + 历史查询 + 删除
- 前端 QAHistory 页面 + QARecordsTab
- 患者画像 PatientPortrait + 分页标准化 Pagination + 跳过评分按钮

### Bug 修复 (v2026.05.31)
- Prompt format injection 防护
- latency_ms UnboundLocalError
- per-key stats 持久化
- migration idempotency
- CI: ESLint → Biome, commitlint 类型扩展

## 2026-05-27 — v1.16 商业级布局优化

### Phase 0: CSS 修复
1. **main.jsx 添加 CSS 导入**: `import "./styles/index.css"` — 此前所有页面显示浏览器默认样式，根因是 Vite 入口缺少样式导入

### Phase 2: 8 个新 UI 组件
2. **Tabs**: Tab 导航（icon + label + count badge），支持 activeTab/onChange
3. **Table**: 配置化表格（columns数组 + rowKey + empty插槽 + hover + onRowClick）
4. **PageHeader**: 统一页面标题（title + subtitle + icon + actions + back导航），所有7个页面已使用
5. **StatCard**: 统计卡片（icon 44×44 + value + label + 5色主题 + trend指示器），教师仪表盘使用5个
6. **Modal**: 模态框（overlay关闭 + ESC关闭 + body lock + title/footer），3个Tab组件使用
7. **FormField**: 表单字段封装（Input + Select + Textarea + focus/blur）
8. **Toolbar**: 工具栏布局（ToolbarLeft + ToolbarRight）
9. **Drawer**: 侧滑抽屉（left/right + 滑入动画 + overlay）

### Phase 3: DashboardHome 角色分流重构
10. **StudentDashboard**: PageHeader + 状态栏 + 2列65/35（训练Hero + 推荐病例 + 最近记录）+ 侧面板（最新反馈 + 快速提问 + 周统计）
11. **TeacherDashboard**: PageHeader + 5 StatCard + 训练趋势图 + 2列（最近动态 + 快捷操作/数据概览）

### Phase 4: Admin 拆分 + 教师端 Tab 组件
12. **Admin.jsx**: 从 ~1150 行精简为 ~40 行 Tabs 容器
13. **RecordsTab.jsx**: 多维过滤 + 得分颜色编码(85+/70+/60+) + CSV导出 + ConfirmDialog删除
14. **UsersTab.jsx**: 注册表单 + Modal编辑 + Modal批量导入(CSV预览+密码脱敏+模板下载)
15. **CasesTab.jsx**: Modal编辑器(4 fieldset) + JSON导入 + 删除保护
16. **MonitorTab.jsx**: StatCard统计 + 趋势图 + 用途分布 + 日志表格(分页+过滤)

---

## 2026-05-27 — 评分容错 + 百分制

1. **评分容错** (`services/scoring.py`): `_validate_scoring_result()` 对 LLM 遗漏的 strengths/weaknesses/missed_content/suggestions 填入默认值（[]/""），不拒绝评分
2. **57→100分制**: rubric JSON 新增 `raw_max:57`/`raw_scale:3`，LLM 按原始分制打分，`_convert_to_100_scale()` 入库前换算
3. **前端修复**: RecordDetail.jsx legacy 记录 scoreMax=100，ScoreCard.jsx 旧版不显示误导性类别条

---

## 2026-05-26 — 评分体系升级 + 界面商业级重构

### 评分体系升级
1. **评分标准版本化** (`rubrics/nursing_history_v1.json`): 19项条目含锚点描述，动态生成 Prompt，版本追踪（rubric_version）
2. **证据化评分**: 每项含 evidence（对话证据）+ reason（评分理由），ScoreCard 可展开查看
3. **教师复核**: ReviewEditor 模态框，review_status/review_detail_scores/review_comment
4. **scoring_status 追踪**: training_records 表新增 scoring_status(pending/processing/completed/failed) + scoring_error，前端轮询检测

### 前端设计系统
5. **tokens.css**: 完整 CSS 变量体系（色板/间距/字体/圆角/阴影/z-index）
6. **6 个 UI 组件**: Button(5 variant/3 size/icon/loading)、Card、Badge(5 variant)、ConfirmDialog(Context 驱动)、EmptyState、LoadingState
7. **AppShell 统一布局**: 替代两套布局系统，删除 Header.jsx，清理 103 行孤儿 CSS
8. **采集进度侧栏**: ChatTraining.jsx 中文 bigram 关键词匹配 required_inquiries
9. **动画**: ScoreCard 展开/折叠过渡、得分条填充、模态框滑入

### 关键 Bug 修复
10. **评分失败**: `get_record_detail` 未返回 scoring_status/scoring_error → 前端轮询永远检测不到评分完成
11. **Login 按钮不可见**: Button 组件 icon prop 类型不匹配 → 回退为原生 HTML
12. **ConfirmDialog 渲染异常**: CSS 变量在 Vite 中不可靠 → 硬编码样式值

---

## 2026-05-26 — 第三梯队：运维与可观测性

1. **`/api/health` 健康检查** — `backend/main.py`，验证 DB 连接 + 返回版本，DB 失败返回 503
2. **数据库备份** — `POST /api/admin/backup`（教师），`backups/` 目录保留最近 10 个
3. **批量导入密码脱敏** — Admin.jsx 预览表格密码列 `"*".repeat()` 脱敏
4. **分页元数据** — `GET /records` 响应头 `X-Total-Count` + `X-Has-More`
5. **CSV 流式导出** — export.py generator + `yield_per(100)`，避免全量加载内存

---

## 2026-05-25 — 第二梯队：可靠性与韧性 + 流式响应

### SSE 流式对话

- `backend/services/llm_service.py` — 新增 `call_llm_stream()` 异步生成器，`client.stream()` + `aiter_lines()` 解析 SSE
- `backend/routers/chat.py` — 新增 `POST /{record_id}/message/stream`，`StreamingResponse(text/event-stream)`，流式完成后原子保存消息
- `frontend/src/api.js` — 新增 `sendMessageStream()`，`fetch` + `ReadableStream` + `TextDecoder` 消费 SSE
- `frontend/src/pages/ChatTraining.jsx` — 逐字显示 + 闪烁光标动画 + 输入恢复
- 系统提示词从 ~2200 字符精简到 ~1000 字符

### 第二梯队：全部 5 项完成

1. **15 处静默吞错** — 全部替换为 `toast.error()` 用户可见提示
2. **LLM 失败恢复输入** — 错误路径自动恢复用户文本
3. **beforeunload 离开守卫** — 训练中关闭浏览器弹出确认
4. **定时器防绕过** — 基于服务端 `start_time` 计算剩余时间，刷新不重置
5. **Error Boundary** — 全局异常边界包裹应用根，渲染异常不再白屏

### 关键 Bug 修复

- **自动评分误触发**: 新增 `UtcDateTime` TypeDecorator（`backend/models.py`），SQLite 读写透明保留 UTC 时区 → 前端正确计算剩余时间
- **统计页"加载失败"**: `stats.py` + `training.py` 统一使用 `datetime.now(timezone.utc)` + 时区感知日期比较
- **LLM RemoteProtocolError**: 共享客户端 `keepalive_expiry=30` + 自动 `_reset_client()` 重建连接池

### 速率限制 — `backend/rate_limiter.py`（新建）

- **内存滑动窗口限流器**，线程安全，无需 Redis
- 登录：同一 IP 5 分钟内最多 10 次失败，登录成功后自动重置计数
- 注册：同一 IP 每分钟最多 5 次
- 聊天：同一用户每分钟最多 6 条消息
- 问答：同一用户每分钟最多 5 次
- 支持 `X-Forwarded-For` / `X-Real-IP` 反向代理头
- 后台每 10 分钟自动清理过期 key（在 lifespan 中调度）
- 应用端点：`auth.py`（login + register 作为 Depends） / `chat.py` / `qa.py`（作为函数调用）

### 密码强度统一

- `RegisterRequest.password` 和 `BatchUserItem.password` 添加 `Field(min_length=6)`
- 后端 admin.py：用户更新密码检查 `len(password) < 6`（原为 4）
- 批量导入密码检查：`len(password) < 6`（原为 4）
- 前端 Admin.jsx：注册表单 `minLength="6"` + placeholder "至少6位"，编辑用户密码 placeholder "至少6位"
- 全链路前后端双重校验，绕过前端直接调 API 也会被 Pydantic 拦截

### API Key 安全

- `.gitignore` 已含 `.env`，确认不会被 git 提交
- 需用户手动去 DeepSeek 平台轮换 `.env` 中已暴露的 Key

### 审计日志系统 — `backend/logger.py`（新建）

- **结构化 JSON 格式**，同时输出到控制台（stdout）和 `logs/audit.log` 文件
- `X-Request-ID` 中间件：每个请求分配唯一 ID，响应头返回
- **请求摘要日志**：method + path + 状态码 + 耗时(ms) + request_id + client_ip + user_id/user_role（认证接口）
- **敏感操作日志**：
  - 用户删除：`target_id + target_name + 操作者`
  - 用户更新：`target_id + target_name + 操作者`
  - 批量导入：`created + skipped + 操作者`
  - 病例创建/编辑/删除：`case_id + case_name + 操作者`
  - 训练记录删除：`record_id + case_id + owner_id + 操作者`
  - LLM 调用失败：完整错误信息（在 `call_llm()` 中统一记录）
- 中间件自动从 JWT 解析 user_id/role，无需端点传递

---

## 之前版本概要

## 2026-05-24 — 仪表盘中枢化 + 统计图表关联化

学生仪表盘中枢化（4张点击式功能卡片）+ 统计关联图表（ComposedChart 双Y轴）+ `/api/stats/trends` 接口 + 病例难度分级（1-3星，全端覆盖）+ 5个病例（初级1/中级2/高级2，覆盖呼吸/内分泌/消化/风湿免疫/心血管5个学科方向）。

## 2026-05-23 — 功能缺口补齐 + 测试套件

搜索/过滤 + 用户管理（编辑/删除）+ Toast 通知系统 + 学生成绩排名 + 训练记录删除 + 统一仪表盘（角色分流）+ 测试套件（57条）。

## 2026-05-23 — 训练计时 + 教师病例管理

训练倒计时（归零自动结束）+ 教师病例管理（在线 CRUD + JSON 导入）。

## 2026-05-22 — Bug 修复 + 性能优化

聊天当前消息遗漏修复 + 回答正确性 Prompt 优化 + LLM 响应速度优化（聊天 5-30s → 1-2s）。

## 2026-05-21 — 40人并发优化 + 商业化打磨

40人并发优化（7个 Phase：WAL + 连接池 + LLM 加固 + 事务修复 + N+1 修复 + 前端韧性 + 配置管理）+ 商业化打磨第一轮。

---

## 压缩上下文摘要

虚拟患者训练系统。FastAPI + PostgreSQL 15 + React 19 + Vite 8。多 LLM Provider 路由 + Docker Compose 部署。当前 **v2026.05.31**。

**2026-05-31 新增**: 多 API 管理（Provider/Key 优先级加权路由 + 熔断 + 加密）+ Prompt DB 管理（版本化 + 变量渲染 + 热激活）+ 统一 LLM 配置 + Bug 修复（prompt injection/latency/migration idempotency）+ CI 完善（Biome 替代 ESLint）。

**2026-05-30 新增**: 问答历史（QAHistory + QARecordsTab）+ 患者画像 PatientPortrait + 分页标准化 Pagination + 跳过评分按钮 + 版本注入。

**2026-05-28 新增**: 后端整体翻新 — SQLite → PostgreSQL 15 + Alembic 迁移 + Docker Compose 部署 + uv 包管理。

**2026-05-27 新增**: 商业级布局优化 — 14个UI组件 + DashboardHome 角色分流(StudentDashboard/TeacherDashboard) + Admin 拆分4Tab(RecordsTab/UsersTab/CasesTab/MonitorTab) + PageHeader 统一 + 评分容错 + 57→100分制。

**2026-05-26 新增**: 评分体系升级 — 评分标准版本化(rubrics JSON) + 证据化评分(evidence+reason) + 教师复核(ReviewEditor) + 设计系统(tokens.css + 6 UI组件) + AppShell + 采集进度侧栏 + /health + 数据库备份 + CSV流式导出。

**2026-05-25 新增**: SSE 流式对话 + 第二梯队可靠性与韧性(15处吞错修复/输入恢复/beforeunload/定时器防绕过/Error Boundary) + UtcDateTime 时区保护 + 第三梯队(速率限制/密码强度/审计日志)。

**2026-05-24 及之前**: 学生仪表盘中枢化 + 统计图表关联化(ComposedChart双Y轴) + 病例难度分级 + 5个病例 + 训练倒计时 + 教师病例管理 + 多维过滤 + 用户管理 + Toast + 排行榜 + 记录删除 + 测试套件(57条)。

**评分体系**: LLM 按 57 分制打分(19项×1-3分) → _validate_scoring_result(容错+默认值) → _convert_to_100_scale → Score入库(100分制) → ScoreCard展示(evidence展开+教师复核)。

**LLM 服务**: 多 Provider 优先级加权路由(熔断+健康检查) + 流式 SSE(首字<1s) + 评分~13s + api_keys 加密存储(Fernet) + per-key 统计持久化 + LLM 调用审计日志。

**基础设施**: PostgreSQL 15 + SQLAlchemy 2.0 + Alembic 迁移 + Docker Compose(DB+Backend+Frontend+Nginx) + CI/CD(GitHub Actions→GHCR→VPS) + 速率限制(4端点) + 审计日志 + /health。

**前端**: 14 UI 组件 + Pagination + PatientPortrait + SSE 流式对话 + Error Boundary + beforeunload + 采集进度 + ConfirmDialog + Toast + ScoreCard + ReviewEditor + API 管理面板(ApiManagementTab/KeyModal/ProviderModal) + Prompt 管理面板(PromptManagementTab) + 问答历史(QAHistory/QARecordsTab)。

**关键文件**: 后端 `main.py` → `routers/`(11模块) → `services/`(llm_router/llm_service/scoring/prompt_manager/crypto_utils) → `rubrics/` → `migrations/`。前端 `ChatTraining.jsx` → `DashboardHome.jsx` → `Admin.jsx`(6Tab) → `RecordDetail.jsx` → `components/teacher/`(9个) → `ui/`(14个)。启动看 `07-startup-guide.md`。

---

## 剩余待完善问题（按优先级排列）

### 第二梯队：可靠性与韧性 ✅ 已完成

| # | 问题 | 状态 |
|---|------|------|
| 1 | 前端 15 处 `.catch(() => {})` 静默吞错 | ✅ 全部替换为 toast.error |
| 2 | LLM 失败丢失用户输入 | ✅ 错误路径自动恢复输入 |
| 3 | 训练页无 `beforeunload` 离开守卫 | ✅ 训练中关闭弹确认 |
| 4 | 定时器刷新重置 | ✅ 基于服务端 start_time 计算 |
| 5 | 无全局 Error Boundary | ✅ 全局异常边界包裹应用根 |

### 第三梯队：运维与可观测性 ✅ 已完成

| # | 问题 | 状态 |
|---|------|------|
| 7 | 无健康检查端点 `/health` | ✅ `GET /api/health` + 503 on DB fail |
| 8 | 无数据库备份机制 | ✅ `POST /api/admin/backup`，保留最近 10 个 |
| 9 | 批量导入密码明文展示 | ✅ `"*".repeat()` 脱敏 |
| 10 | 训练记录列表无分页元数据 | ✅ `X-Total-Count` + `X-Has-More` 响应头 |
| 11 | CSV 导出全量加载内存 | ✅ generator + `yield_per(100)` 流式输出 |

### Phase 5: 响应式优化

| # | 问题 | 影响 |
|---|------|------|
| 12 | 平板端（768-1024px）布局未适配 | 侧边栏+内容区在小屏幕上可能挤压 |
| 13 | 手机端（<768px）布局未适配 | 当前仅隐藏侧边栏，页面内容未做移动端优化 |
| 14 | 表格横向滚动 | 小屏幕表格可能溢出，需要横向滚动或卡片化 |

### 第四梯队：用户体验打磨

| # | 问题 | 影响 |
|---|------|------|
| 15 | 无断网检测 | 网络断开无提示，用户不知道问题在自己端 |
| 16 | 消息发送失败后无"重试"按钮 | 需手动重新发送，不够直观 |
| 17 | 病例名超 100 字符触发 500 | 前端无限制 + 后端无校验 |
| 18 | 无 Token 刷新机制 | 登录 8 小时后强制踢出，可能打断训练 |

### 第五梯队：测试覆盖缺口

| 模块 | 当前测试数 | 缺口 |
|------|-----------|------|
| 导出 (export.py) | **0** | 完全未测试 |
| 笔记 (notes.py) | **0** | 完全未测试 |
| 统计 (stats.py) | **0** | 完全未测试 |
| 问答 (qa.py) | **0** | 完全未测试 |
| 批量导入 (admin.py batch) | **0** | 新增功能未测试 |
| LLM 失败路径 | **0** | 评分/聊天失败分支未覆盖 |

---

## 下一步建议

1. **Phase 5 响应式优化**：平板/手机端适配，预计 2-3 小时
2. **第四梯队打磨**：4 项（断网检测 + 消息重试 + 病例长度校验 + Token 刷新），预计 1-2 小时
3. **第五梯队补测**：6 个模块 ~30 条测试，预计 2-3 小时
4. **云部署**: 需用户提供服务器 IP + DeepSeek API Key + SECRET_KEY
5. **Docker 容器化**: `docker compose up -d` 一键部署
