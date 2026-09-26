# 功能优化与重构方案设计（2026-09-26）

> **输入**：① 维护者本轮交办的全部工作与约束（查询实现统一、筛选控件范式、表单/表格对齐、训练首页、数据真相类 bug）；
> ② 审计调查子代理的只读分析 [`audit-log-and-rbac-analysis-2026-09-26.md`](audit-log-and-rbac-analysis-2026-09-26.md)（审计日志 + RBAC 现状，531 行，含 `path:line` 证据与 A1–A6 切片草案）；
> ③ 本仓库既有的 UI 审计与计划 [`ui-audit-2026-09-26.md`](ui-audit-2026-09-26.md)、[`ui-improvement-plan-2026-09-26.md`](ui-improvement-plan-2026-09-26.md)。
> **本文的职责**：把上面三份东西**排成一条可执行的路线**——定顺序、定依赖、定验收判据、定需要维护者拍板的点；**不重复**分析文档里的证据与字段设计（引用其小节号即可）。
> **状态口径**：`已完成 / 待发版（代码已在本地 master 分支之上） / 待开工 / 待决策`。
> **成本口径**：**S** ≤半天 · **M** 1–3 天 · **L** >3 天（沿用分析文档）。

---

## 0. 结论先行

1. **最紧急的不是审计功能本身，而是一条 P0 自毁路径**：`user_manage`（当前 = `admin`）可以停用/删除 `super_admin`，且全仓没有"最后一个超级管理员"守卫，`seed.py` 在 `roles` 非空时不再补种 → 一旦管理员用户全没了，**只能直连数据库救**（分析文档 RB-1）。这与审计系统的关系是致命的：能看审计的角色可以被合法消灭。**建议立即发版**（改动量：两个分支各一行 + 一个守卫 + 复用现有权限测试夹具）。
2. **审计日志目前是"零"**，不是"少"：没有表、没有端点、没有页面；现有 `logging` 链路里 53 处 `extra={...}` 因为 formatter 没有 `%(user_id)s` 之类的占位符而**一个字段都不输出**（分析文档 §1.2）。所以第一步不是建大表，而是**先让已有结构化字段可见**（半天级收益），再建底座。
3. 本轮已经建立的**查询与界面约定**（§6.4 筛选 DTO + `useListFilters`、§6.4.1 别名陷阱、表头/弹窗档次）应当被后续所有新页面（尤其审计页）**继承而不是另起一套**——分析文档 §3.5 已经按这个前提设计，本文把它固化为准入条件。
4. 已在本轮修掉的两条**数据真相类**问题（训练记录按评分排序 500、训练首页"我的统计"取到榜首同学的数据）说明：这类 bug 的共同成因是「表达式解析/取值口径与真实数据源脱节」，因此本方案把**"按真实装配编译查询的免库回归"**与**"取值必须按身份匹配"**写进验收判据（§2 通用判据）。
5. **待维护者拍板的 4 件事**（不定就不动工）：审计保留期与归档形态、是否新增 `feedbacks.replied_by` 列、审计表是否独占分区、以及**发版闸门**（本轮工作已按要求只做本地提交，未推送/未打标签）。

### 0.1 切片总表（按执行顺序）

| 顺序 | ID | 目标 | 成本 | 依赖 | 需决策 |
|---|---|---|---|---|---|
| 1 | **RB-1** | 权限面自毁路径封堵：停用/删除同样走 `_assert_role_within_scope` + "最后一个 super_admin" 守卫 | S | 无 | — · **已完成（本地，待发版）** |
| 2 | **OBS-1** | 让已有 `extra={...}` 真正可见（logging formatter 带字段 + diagnose 采集），半天级可观测收益 | S | 无 | — |
| 3 | **A1** | 审计底座：`audit_logs` 表 + `core/audit.py`（同事务/独立 session 两种写入口）+ `request_id` 中间件 | M | OBS-1 | — · **已完成（本地，待发版）** |
| 4 | **A2** | 高风险面接入：角色/权限 CRUD、用户角色变更/停用/启用/删除/密码重置/批量导入分班、密钥 CRUD | S | A1 | — · **已完成（本地）：角色/权限、用户（改角色/启停/删/改密/批量）、注册、密钥** |
| 5 | **A3** | 可见性：`audit_view`/`audit_export` 权限键 + 列表/导出端点（**严格沿用 §6.4 约定**）+ 前端审计页 | M | A1、A2 | — · **已完成（本地，待发版）** |
| 6 | **A4** | 导出与越权留痕：10 个导出端点 + `require_permission` 的 403 记 `access.denied` | S | A1 | — |
| 7 | **A5** | 业务动作接入：病例发布/归档、评分复核/重算、反馈回复、问卷模板、班级成员、系统通知 | M | A1 | — · **反馈回复 + 病例生命周期已完成（本地）；评分复核/问卷/班级待接** |
| 8 | **RB-3/4** | RBAC 一致性：权限缓存跨 worker 陈旧（60s→2s）、前端权限陈旧（/auth/me 带 permissions）、`/api/metrics`（裁定不改）、权限粒度（audit_*） | M | A3 | — · **已完成（发版 v2026.09.26-9 已含）** |
| 9 | **A6** | 保留与合规：分区/归档、DB 级 append-only、登录失败与账号锁定、备份包含审计表 | L | A1–A5 | 保留期已定 | **DB 级 append-only + 登录留痕 + 归档规程已完成（本地）；账号级锁定与备份清单待做** |
| 10 | **U1** | UI/查询一致性收尾：剩余页面迁移到 `useListFilters` + `FilterToolbar` | M | 无 | **my-feedback 已完成；versions 等页面待做** |
| 11 | **U2** | 表单与表格规范固化：弹窗四档宽度（已做）、表头主题化（已做）、字段标签/动作行离群点待逐页确认 | S | 无 | — |

顺序理由：**1→2 可立刻发**（都是半天级且无依赖）；3 是 4–9 的前置；5 在 4 之后（没有事件可查的页面没意义）；10/11 与主链无冲突，可穿插。

---

## 1. 与既有约定、在途改动的关系

1. **查询与筛选**（本仓库 baseline，见 `ui-improvement-plan-2026-09-26.md` §6.4）：
   - 后端：一个域一个 `@dataclass XFilters`（`Depends()` 注入），列表与导出共用同一服务入口，谓词只写一次；导出取数一律 `MAX_EXPORT_ROWS + 1`，由 `infra/exporter.py` 统一 400；
   - 前端：一个页面一个 `useListFilters`（`params`/`exportParams` 同源），参数类型从 `api/query-params.ts`（OpenAPI 生成物）派生；
   - **准入**：本方案新增的任何列表页（审计页是第一个）必须照此写，评审时以"筛选键是否只存在于 DTO"为检查点。
2. **查询别名陷阱**（§6.4.1）：排序/过滤若要引用被 `joinedload` 预取的实体，必须显式 join 或用**相关子查询**；新增列表排序时按此写，并补一条"按真实装配编译 PG SQL"的免库回归。
3. **界面一致性**：
   - 表头灰底/大写/12px 已收口到 `theme.Table.styles.th`（唯一来源，页面不得自写 thead 背景）；
   - 列表筛选区统一 `FilterToolbar`（含一键复位与 `hasActiveFilters`，其判定由钩子统一给出，默认值不算活跃）；
   - 弹窗宽度四档：**420（确认/短提示）· 560（单列表单）· 680（多列/长表单）· 800（内容/预览/批量）**；Mantine 预设 `sm`/`md` 仅用于既有历史写法，新代码用四档数值。
4. **回归纪律**（本轮实践，建议固化为评审要求）：
   - 修 bug 必须留下**修前失败、修后通过**的判据；数据库相关测试已从仓库移除，因此判据优先选择**免库可判**的形式（编译 SQL 断言形状、纯函数输入输出）；
   - 不留"看起来有守卫但抓不到真实形状"的假守卫（本轮 AST 守卫试做后删除，理由已记录在 §6.4.1）。
5. **发布闸门**：维护者已明确本轮**只做本地提交、不推送不打标签**。因此下方"待发版"的代码**不会自动生效**；RB-1 这类线上风险要生效必须显式获得一次发版许可。

---

## 2. 切片详情与验收判据

### 2.1 RB-1 — 权限面自毁路径封堵（P0，S，建议首个发版）

- **改动面**：`backend/modules/admin/users.py` 的停用分支（`~:219-222`）与删除分支（`~:261-274`）补 `_assert_role_within_scope`；新增"不能停用/删除**最后一个** `super_admin`"守卫（同一处或 `core/roles.py` 提供公共判定）。
- **验收（可观测）**：复用 `backend/tests/admin/test_user_privilege_guard.py` 夹具，新增四例——`admin` 停用 `super_admin` → 403；`admin` 删除 `super_admin` → 403；停用/删除**最后一个** `super_admin`（操作者是 `super_admin`）→ 400/403；`super_admin` 之间的合法操作仍成功。
- **风险**：守卫若写在路由器层会绕过批量/脚本路径 → 写在 service 层（与 RB-1 分析结论一致）。
- **不做**：不改角色模型、不引入审批流。
- **落地（2026-09-26，本地提交）**：`UserService.update` 的 `is_active` 分支与 `delete` 都补了
  ① 反越权 `_assert_role_within_scope`（与"授予角色/重置密码"同口径）、② `_assert_not_last_active_super_admin`
  兜底；`delete(user_id, current_user)` 签名改为收 `current_user`（调用点仅路由一处）。
- **验收证据**：`tests/admin/test_user_privilege_guard.py` 新增 `TestHighPrivilegeAccountLifecycle` 5 例
  （admin 停用/删除超管 → 403；权限等同超管的第三方角色停用/删除**最后一个**启用超管 → 400；两超管并存时停用
  其一 → 成功）。**修前失败已验证**：撤掉守卫后停用两例报 `DID NOT RAISE`（即漏洞真实存在）。
- **守卫层次须说清**（避免误以为只有一层）：`admin → super_admin` 这条现实路径实际由**反越权**拦下（403）——
  因为 `admin` 缺少 `role_manage`/`api_manage`；`_assert_not_last_active_super_admin` 是**兜底**，只在
  "操作者通过其它角色持有等价权限"时才会成为唯一拦截层（测试用 `platform_admin` 角色构造）。

### 2.2 OBS-1 — 让已有结构化字段可见（S）

- **改动面**：`backend/logging_setup.py` formatter 增加 `user_id/user_role/request_id` 等占位符（缺省 `-`）；`core/diagnostics`（`diagnose.py`）采集 `extra` 而不是只留 message；`request_id` 由中间件生成并回写日志。
- **验收**：一次真实请求的 ERROR 日志里能看到 `user_id`/`request_id`；`/api/diagnose` 的 error group 里保留这两个字段；同一 `request_id` 能在 access 日志与业务日志间串起来。
- **为什么先做**：它是 A1 的公共件（审计行也要 `request_id`），且**独立可发**。

### 2.3 A1 — 审计底座（M）

- **设计**：见分析文档 §3.1（表与索引）、§3.2（写入路径：同事务 vs 独立 session）、§3.0（设计原则）。
- **验收判据**：迁移往返干净且 `ddl/` 内无 `op.execute()`；`record()` 在业务事务内提交则落行、回滚则**不落行**；`record_detached()` 在业务回滚后仍落行；`request_id` 贯通；`audit_logs` 写入**不阻塞**业务（同步写但只插一行，不加锁竞争）。
- **与既有约定**：审计列表将来必然是一个列表页 → 现在就按 §6.4 的 DTO 形态设计 action/target/outcome 等筛选键，避免二次改造。

### 2.3.1 测试基础设施：**面向 PG**（2026-09-26 定）

维护者明确：**本项目始终面向 PostgreSQL，不做跨库降级**。据此本轮做了三件事：

1. `tests/conftest.py` 新增 `pg_session` 夹具：真库连接 + **savepoint 隔离**
   （`Session(bind=conn, join_transaction_mode="create_savepoint")`，外层事务 teardown 回滚）
   → 用例内部 `commit()` 只释放 savepoint，对库零残留，因此既不需要 SQLite 替身，也不需要手写清理。
2. 本轮的 DB 判据全部改跑真库：`tests/core/test_audit_writer.py`（7 条：JSONB 列、DESC 表达式索引、
   CHECK、`FK ON DELETE SET NULL`、同事务提交/回滚、独立 session 留痕）、
   `tests/admin/test_user_privilege_guard.py`（17 条反越权，含 RB-1 政策）。
   夹具在 savepoint 内把系统角色权限**对齐**到 `core.roles.SYSTEM_PERMISSIONS`
   （真库里既有角色权限集可能与代码不一致），回滚即还原。
3. `models/audit.py` 用 PG 原生类型（`BigInteger` / `JSONB` / `TIMESTAMPTZ`），
   并为"拒绝/失败面板"加**部分索引**（`postgresql_where=outcome <> 'success'`）。

**进度**：`test_class_memberships.py` 已随 A2 迁移（它走成员替换 → 会写审计，SQLite 夹具下报 no such table）。
**待办（U3）**：仓库仍有 **12 个测试文件**用 `sqlite://` 夹具（`tests/admin/test_class_memberships.py`、
`tests/cases/*`、`tests/scoring/*` 等）。它们能跑但不符合"面向 PG"的口径（也是 `JSONB` 列
在 SQLite 上必须打补丁的根源）。建议逐个迁到 `pg_session` + 真库建表，作为独立清理切片推进。

### 2.4 A2 — 高风险面接入（S）

- **接入清单**（分析文档 §3.3 的第 1–10 条）：`roles.py` create/update/delete、`users.py` 角色变更/停用/启用/删除/密码重置/批量导入/批量分班、`secrets.py` CRUD。
- **验收**：每条变更恰好 1 行审计，且 `before/after` 与**数据库实际结果**一致（断言 DB 行内容，不是断言"函数被调用"）；角色/权限变更行必须含"变更前后权限集合"。
- **风险**：批量操作（导入/分班）要**一行汇总 + 明细可选**，避免 N 倍写入；密码类字段绝不可进 `payload`。

### 2.5 A3 — 可见性（审计页，M）

- **后端**：`audit_view`/`audit_export` 权限键（`core/roles.py` 给 super_admin 追加）；`admin/audit_logs.py` 列表 + 导出，**沿用 §6.4**：`@dataclass AuditLogFilters`（时间范围/操作者/action/target_type/outcome/keyword）+ `Depends()`；导出 `MAX_EXPORT_ROWS + 1`。
- **前端**：`AuditLogsPage`（`FilterToolbar` + 一键复位 + 分页 + 导出按钮 `params={exportParams}`）、`navigation.tsx` 挂到"系统"组、`query-params.ts` 增加 `AuditLogParams`、`permissions.gen.ts` 重生成。
- **验收**：`audit_view` 缺失时接口 403 且前端被 `RequirePermission` 拦；"筛 N 条 → 导出同集"；导出超限 400；**导出行为本身也落一行审计**（避免"看审计的动作不可审"）。

### 2.5.1 A3 落地与顺带修的两处导航问题（2026-09-26）

- 权限键：`audit_view`（审计日志查看）/`audit_export`（审计日志导出），按决策只授 `super_admin`；
  存量库由 `data/f1b2c3d4e5a6_grant_audit_permissions.py` 只补这两项（幂等，不做全量 resync）。
- 后端：`modules/admin/audit_logs.py` —— `AuditLogFilters`（操作者/动作/目标类型/结果/时间范围/关键字）
  + `_filtered_query` + `list_filtered`；`GET /api/admin/audit-logs` 与
  `POST /api/admin/audit-logs/export` 共用同一 DTO 与入口（导出仍是 `MAX_EXPORT_ROWS + 1` 交统一判定）。
- 前端：`AuditLogsPage`（`useListFilters<AuditLogParams>` + `FilterToolbar` + 主题表头 + 导出按钮 `params={exportParams}`）；
  动作/对象/结果都有中文标签；详情列用等宽码 + tooltip 展示 payload。
- 判据（真库）：筛选各维度、时间范围与关键字、分页与 total、**列表与导出同集**（导出不得出现未命中的行）、
  非法日期报 400。
- **顺带修（导航口径）**：
  1. 教学看板（`/admin`）导航门禁 `score_review` → `stats_view`：页面数据来自 `/api/admin/stats`（要求 `stats_view`），
     否则"只有 score_review"的角色能进页面但统计区 403（RB-5 第 1 条）。
  2. 侧边栏归组（两轮，以后者为准）：
     - 一轮把 `用户反馈` 从"系统"移到"教学"；**维护者随即指出反馈处理属运维** → 已回退到运维组（本文档保留此往返记录，避免后人再改回去）。
     - 同时"教学"分组过大（8 项）→ 按"日常 vs 配置"拆出 **教学资源**；最终五分组为：
       `我的训练`（仅教师端的学生向条目）· `教学`（看板/作业/成绩/训练记录）· `教学资源`（病例库/问卷/评分标准）·
       `人员`（班级/用户/角色）· `运维`（版本归因/成本管理/运维仪表盘/系统通知/系统反馈/审计日志）。
       （另：入口与页面标题统一改名为 **"系统反馈"**，副标题写明"用户对系统本身的问题与建议"，
       消除"是否指教学反馈"的歧义 —— 维护者明确这类反馈针对系统本身。）
- **教师端侧边栏新增"我的训练"分组**：`SidebarNav` 增加 `groupUserLinks`，Layout 按 `isAdminPermissions` 传入 →
  教师/管理端把学生向条目（训练/记录/问答/我的）收进独立分组；**学生端渲染不变**（平铺）。判据：
  `__tests__/core/SidebarNav.test.tsx`（学生端无分组标题 / 教师端有"我的训练"且与管理分组不串味）。

### 2.6 A4 — 导出与越权留痕（S，覆盖面最广）

- 10 个导出端点统一记 `export.downloaded`（含 `rows`/`filters`/`format`）；`require_permission` 的 403 记 `access.denied`（含 `required_permission` + actor + ip）。
- **验收**：真实下载用户列表 → 1 行；用低权限账号访问需 `api_manage` 的端点 → 1 行 denied；100 次导出 → 恰 100 行、无重复。

### 2.7 A5 — 业务动作接入（M）

- 病例发布/归档/删除/`set_open`、评分复核与 force 重算（保留"旧分与旧复核将被删除"的 `before` 快照）、反馈回复（**是否新增 `feedbacks.replied_by` 待决策**）、问卷模板 CRUD 与病例绑定、班级与成员、系统通知。
- **验收**：每域一条端到端 smoke：执行动作 → 查 `audit_logs` 得到预期 action 与关键字段。

#### 2.7.1 裁定：`/api/metrics` 不加应用层鉴权（与 RB-8 建议冲突，按既有决策）

审计研究 §RB-8 建议给 `/api/metrics` 加 token/RBAC 守卫。核对后**不改**：仓库 2026-07-10 已有显式决策
（`docs/superpowers/specs/2026-07-10-tier1-bugfix-design.md:104`："Prometheus scrape 无认证是业界惯例，应用层不应对网络层安全做过度防御"），
并有网络层落地（`deploy/nginx/snippets/block-scanners.conf:12` 单独给该 location 规则），运维手册
（`docs/ops/single-instance-migration.md:47`）也依赖它可直接读取。**结论：保留现状**，把"不修"的理由写进代码注释与本文档，避免后续反复。

### 2.7.2 A5 已完成部分（2026-09-26）

- **反馈回复**：新增 `feedbacks.replied_by`（迁移 `ddl/f2c3d4e5f6a7`，FK ON DELETE SET NULL；历史行保持 NULL
  不猜测）+ 回复写入回复人 + 一行 `feedback.replied` 审计；**回复正文不入审计**（只记长度，PII 最小化）；
  模型侧 `Feedback.user` 关系补 `foreign_keys=[user_id]`（新增 FK 会让关系二义）。判据：
  `tests/admin/test_feedback_reply_audit.py`（首次回复/覆盖两条，断言业务列 + 审计行 + 正文不入库）。
- **病例生命周期**：`publish`（含 `case.publish_rejected` 走独立 session —— 门禁拒绝也是事件）、
  `archive`、`delete`、`set_open` 各一行审计并带 before/after；拒绝路径（未发布不能开放）**不留痕**。
  判据：`tests/admin/test_case_lifecycle_audit.py` 4 条。
- 备注：产品侧新增审计写入会让"仍用 SQLite 夹具"的测试报 `no such table: audit_logs` —— 这正是 U3 要清掉的债，
  迁移完成后即消失（见 §2.3.1）。

### 2.8 RB-3/4 — RBAC 一致性与粒度（M）

- 权限缓存跨 worker 最长 60s 陈旧（`--workers 2`）、前端权限最长 24h 陈旧（`/auth/me` 不返回 permissions）、前后端门禁错配 3 处、系统角色上仍渲染"编辑权限"按钮、`/api/metrics` 无鉴权。
- **验收**：改权限后在另一 worker 上的判定**立即**生效（或给出可观测的失效时延上限并写入文档）；前端权限变更后刷新即生效；`/api/metrics` 未鉴权 → 401/403。

### 2.9 A6 — 保留与合规（L，需决策）

- 分区或归档任务、DB 级 append-only（触发器/受限角色）、登录失败带 IP + 账号级锁定、备份**包含**审计表（注意现有 `db-backup.sh` 排除 `llm_call_logs` 的先例）。
- **验收**：`UPDATE/DELETE audit_logs` 被 DB 拒绝；归档任务 dry-run 输出"将归档 N 行/释放 X"，且**只 detach 不 drop 未导出分区**；连续 5 次密码错误可观测到锁定；恢复演练后审计历史非空。

### 2.10 U1/U2 — 界面与查询一致性收尾（M + S）

- **U1**：`/admin/versions`（仍是手写筛选行、无复位）、`/my-feedback`（手写 params）迁移到 `useListFilters` + `FilterToolbar`；records/assignments/classes/notifications 等域若后续要导出，顺手补筛选 DTO（当前导出端点的筛选已对齐 4 个域）。
- **U2**：把本轮定的"弹窗四档宽度、字段标签用 `label` 属性、动作行右对齐、表头唯一来源"写进文档（本节 §1.3）并在后续新页面评审时按此检查；清理剩余离群点（各页 3–10 处手写小字标签，需逐页确认是**说明文字**还是**字段标签**后再改，勿机械替换——本轮已因此回退过一次误判）。

---

### 2.11 本轮收尾状态（2026-09-26）

> **发版**：第一批（RB-1/RB-3/4/RB-6/RB-9/OBS-1/F2/F3/查询范式/表头与弹窗规范）已随
> `v2026.09.26-9` 上线；审计主体（A1–A6 本批已完成部分 + U3 全量 PG 化 + U1 my-feedback）
> 随 **`v2026.09.26-10`** 发布。


| 切片 | 状态 |
|---|---|
| RB-1 / RB-3 / RB-4 / RB-6 / RB-9 / OBS-1 | **已发版**（v2026.09.26-9） |
| F2 / F3（问卷筛选、导出跟随筛选）、查询范式 §6.4、别名陷阱 §6.4.1、表头/弹窗规范 | **已发版** |
| A1 审计底座（表/迁移/写入器/request_id/actor choke point） | 已完成（本地） |
| A2 高风险面（角色权限、用户、注册、密钥） | 已完成（本地） |
| A3 可见性（audit_view/audit_export、列表/导出端点、审计页、侧边栏分组） | 已完成（本地） |
| A4 导出与越权留痕（10 个导出端点 + access.denied） | 已完成（本地） |
| A5 反馈回复（含 `replied_by`）、病例生命周期 | 已完成（本地）；评分复核/问卷/班级待接 |
| A6 DB 级 append-only、登录失败/成功留痕、12 个月归档规程 | 已完成（本地）；账号级锁定、备份清单待做 |
| U3 其余 12 个 SQLite 测试夹具迁 PG | **已完成（本地，151 条用例；全量 1532 通过、0 个 sqlite 夹具残留）**；并挖出一条产品缺陷 → 见 §2.12 |
| U1 my-feedback 迁 `useListFilters` | 已完成（本地）；versions 等页面待做 |

### 2.12 U3 迁移挖出的**产品缺陷**（SQLite 夹具长期掩盖，待发版后优先处理）

把最后 12 个测试文件迁到 PG 后，暴露出一个**真实的数据口径 bug**（不是测试问题）：

- **现象**：`feedbacks.created_at` 的列类型是 `timestamp without time zone`（naïve），而本机与
  `docker-compose*.yml` 的 PG 会话时区是 `Asia/Shanghai`。服务层写的是 aware-UTC
  （`datetime.now(UTC)`），PG 会按会话时区折算成 **+08 墙钟**存下；读回后 `ensure_utc()` 又按 UTC 解释
  → 偏移 8 小时。
- **影响**：`/admin/ops` 反馈面板与后台反馈列表里的"最老一条 / 未回复天数"在生产上**偏 8 小时**
  （实测：写入 now-3d 得到 `2.7 天`、`oldest_created_at` 差 8 小时）。同类 naïve 列还有
  `llm_call_logs` / `qa_records` / `scores.created_at`，需一并核对。
- **为什么一直没发现**：SQLite 夹具会把 aware 值直接存成 UTC 墙钟，正好"看起来正确"——这正是
  "全项目面向 PG"要清掉的盲区。
- **建议修法**（属产品/迁移改动，本轮未动）：
  1. 首选：这些列迁到 `timestamptz`（`ALTER TABLE … TYPE timestamptz USING created_at AT TIME ZONE 'UTC'`
     需先确认既有行的真实语义 —— 生产库里存的是 +08 墙钟，转换时要按 `AT TIME ZONE 'Asia/Shanghai'` 折算，
     **不要盲目套 UTC**）；
  2. 或写路径统一写 naïve-UTC（`datetime.now(UTC).replace(tzinfo=None)`）并补判据；
  3. 两种都要补一条"读回不偏移"的判据（真库 + 非 UTC 会话时区）。

## 3. 验证与发布

| 场景 | 手段 |
|---|---|
| 后端逻辑 | `cd backend && uv run python -m pytest tests -q`（当前 1488 通过）+ `ruff` / `ty` 干净 |
| 查询形状类 bug | **免库编译判据**（例：`tests/training/test_record_sorting.py` 编译成 PG SQL 断言相关子查询；退回旧写法必须失败） |
| 前端逻辑 | `pnpm test`（当前 502 通过）+ `npx tsc --noEmit` + `pnpm lint` |
| 界面行为 | 本地桩后端（单进程托管 `frontend/dist` + 最小 API/权限键）+ 真实浏览器断言（请求参数、DOM 计算样式、下拉过滤）；不依赖线上凭据 |
| 线上健康 | `/api/diagnose`（token 鉴权）看版本/告警/错误分组；本轮即用它定位了排序 500 |
| 发版 | `pnpm run tag`（构建 + 推 master + tag → `deploy.yml`）；**本轮已冻结，等维护者许可** |

---

## 4. 决策记录（2026-09-26 已拍板）

| # | 议题 | 决策 | 影响 |
|---|---|---|---|
| 1 | 发版窗口 | **暂不发版，继续攒**（本地提交即可；发版需显式许可） | 线上仍是 `2026.09.26-7`；排序 500 的修复与后续切片一起等一个发版窗口 |
| 2 | 审计保留期与形态 | **保留 12 个月 + 按月归档**（整月分区 detach 后导出归档；只 detach 不 drop 未导出分区） | A1 建表即按月分区；A6 归档任务按此实现 |
| 3 | 审计可见性 | **仅 super_admin**：新增 `audit_view` / `audit_export` 两个权限键 | A3 的键位与前端门禁确定；不引入审计员角色 |
| 4 | 反馈回复人 | **新增 `feedbacks.replied_by` 列**（迁移 + 历史回填 NULL） | A5 增加一笔列迁移；审计行作为第二证据 |
| 5 | 权限粒度范围 | **一并纳入本轮**：`audit_view`/`audit_export` + 提示词/版本管理写权限 + `/api/metrics` 鉴权 | RB-7 与 A3 同批，权限词表一次性改到位 |

> 未决的次要项（可后补、不阻塞）：审计表是否独占分区/表空间；归档目标是本地磁盘还是对象存储；权限缓存失效走 DB 版本号还是引入轻量通知。

---

## 5. 明确不做（防止方案膨胀）

- 不引入外部审计/SIEM 服务，不引入消息队列做审计异步化（当前规模下同步单行插入足够）。
- 不为审计单独做一套列表/筛选/导出范式（一律沿用 §6.4）。
- 不做"事后补历史审计"：审计从接入点开始生效，历史不可重建（诚实记录起点）。
- 不在本轮改动 `deploy/` 流水线结构，只按既有 tag→deploy 路径发版。
