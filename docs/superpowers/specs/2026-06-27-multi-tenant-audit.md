# 多租户子系统审计 (Multi-Tenant Audit)

> 日期: 2026-06-27 · 分支: `refactor/strip-multi-tenancy`
> 目的: 在考虑「手术剥离多租户耦合」前，完整盘点多租户（多学校 / `school_id`）在系统内的**所有存在及其行为**。
> 方法: 6 个并行子代理按域审计（auth / admin / training / scoring-stats-cases / qa-feedback-catchall / core-data），结果交叉验证。
> 本文件为**只读分析**，不含任何代码改动。

---

## 0. 执行摘要

- **事实上是单租户**: 生产/测试库各仅 1 所学校（`默认学校`, id=1）。所有用户、角色、班级硬绑定到 id=1。
- **前端从不发送 `school_id`**: 后端 10+ 个列表端点暴露 `school_id` 查询参数（标注「super_admin 按学校筛选」），但**没有任何前端代码传递它**。super_admin 跨校筛选是**纯后端死契约**。
- **学校管理 UI 是半成品**: `SchoolsPage` 的「进入管理」按钮只是 `navigate("/home")`，从未实现「切换学校视角」。
- **隔离机制单点**: 几乎全部隔离由 `core/security.py:100` 的 `tenant_scope()` 驱动，约 **15+ 文件 / 25+ 调用点**。
- **结论**: 剥离主要是**后端数据模型 + API schema + seed** 的清理；前端影响仅限「删除学校管理页 + 重新生成类型 + 清理 localStorage 残留字段」。训练/评分/引擎/聊天/护理记录等核心域**完全无耦合**。

---

## 1. 数据层 (Data Layer)

### 1.1 携带 `school_id` 的表（完整清单 — 6 张）

| 表 | 可空 | FK → schools.id | ON DELETE | 约束 / 索引 | 语义 |
|----|------|----------------|-----------|-------------|------|
| `roles` | 是 (NULL=模板角色) | ✔ | CASCADE | `UNIQUE(school_id, name)` | 双层角色 |
| `users` | **否** | ✔ | RESTRICT | `ix_users_school_id` | 用户硬绑校 |
| `grades` | 否 | ✔ | CASCADE | `UNIQUE(school_id, name)` | 年级绑校 |
| `cases` | 是 (NULL=全局) | ✔ | SET NULL | — | 全局/本校病例 |
| `practices` | 是 (NULL=全局) | ✔ | SET NULL | `ix_practices_school_id` | 全局/本校练习 |
| `questionnaire_templates` | 是 (NULL=全局) | ✔ | SET NULL | indexed | 全局/本校问卷 |

来源: `models/auth.py:25,48`、`models/org.py:19,24`、`models/case_practice.py:37,54`、`models/questionnaire.py:31-42`、`models/tenant.py:10`、迁移 `migrations/versions/ddl/0001_initial.py:98-253`。

### 1.2 间接绑校（无 `school_id` 列，靠 JOIN 推导）

- `training_records` / `messages` / `scores` → 通过 `User.school_id` JOIN 过滤（`session.py:391`, `stats.py:52`）。
- `assignments` → 通过 `Class → Grade.school_id` 间接绑校（`assignments.py:37`）。
- `practice_snapshot` (TrainingRecord JSONB) **不含** school_id（`session.py:157-170`）。

### 1.3 `schools` 表

`models/tenant.py:10` — 极简模型 `(id, name UNIQUE, created_at)`，无关系定义（反向关系挂在子模型上）。被 6 张表 FK 引用。

### 1.4 双层角色系统（最复杂的一块）

- **模板角色** `school_id = NULL, is_system=True`（ids 1–4）— 只为「建校时复制权限结构」存在，**无用户引用、无代码消费**（建校走 `core/roles.py` 常量新建，不读模板）。即上次发现的「超管页面重复角色」根因。
- **本校角色** `school_id = N, is_system=True`（ids 5–8）— 用户实际挂载的角色。
- `UNIQUE(school_id, name)`：Postgres 中 NULL 互不相等，故模板角色可与本校角色同名共存。剥离后约束须变为 `UNIQUE(name)`（需先验证无同名冲突）。

### 1.5 迁移现状

所有 `school_id` 列均在**单一压缩初始迁移** `0001_initial.py` 中创建；后续迁移无一触碰 school_id，**无任何 backfill 数据迁移**。剥离需新增一支 DDL 迁移（详见 §6）。

---

## 2. 访问控制层 (Access Control)

### 2.1 `tenant_scope()` — 唯一隔离权威

`core/security.py:100-110`
```
tenant_scope(user, requested_school_id=None) -> int | None
  if user.is_super_admin: return requested_school_id   # None = 看全部
  else:                   return user.school_id          # 锁定本校
```
调用方统一模式：`scope = tenant_scope(...)` → `if scope is not None: query.filter(Model.school_id == scope)`。

**调用面（约 15+ 文件）**: `cases.py`、`stats.py`、`feedback.py`、`export.py`、`admin/users.py`、`admin/roles.py`、`admin/grades.py`、`admin/classes.py`、`admin/practices.py`、`admin/export.py`、`contexts/training/router/session.py`、`contexts/qa/_sessions.py`、`questionnaires/templates.py|questions.py|responses.py|stats.py`、`repositories/case.py|user.py`。

### 2.2 `is_super_admin` 与「`school_id is None` 代理」

- `models/auth.py:74` — `is_super_admin = role.name == "super_admin"`。
- `core/roles.py:1-50` — `super_admin` 独有 `api_manage / prompt_manage / school_manage`；`school_admin` 无此三项（这是两个管理员角色的唯一差异）。
- 散落的 `is_super_admin` 旁路: `admin/users.py:116,302`、`assignments.py:135,251`、`admin/schools.py:36,143`。
- ⚠️ **`admin/api.py:43-47` `_require_system_admin()` 用 `current_user.school_id is not None` 拒绝访问**（把「school_id=NULL」当作超管标志）。但 seed 创建的 admin 用户 `school_id=1`（非 NULL），且 `users.school_id` NOT NULL —— **疑似潜在不一致/死逻辑，剥离前需验证该端点对当前 admin 是否实际可用**。

### 2.3 权限系统与多租户**正交**

`require_permission` / `has_permission` 仅查 `RolePermission`（无 school_id 列），与学校无关。剥离不影响权限机制本身，仅需在 `core/roles.py` 清理 `school_manage`。

---

## 3. 行为清单（按域 · 含 `文件:行号`）

### 3.1 Auth / Token
- `routers/auth.py:49,176,324` — JWT payload 含 `school_id` 声明。
- `routers/auth.py:44-66,316-340` — `TokenResponse` / `WechatLoginResponse` 含 `school_id`、`school_name`；登录/刷新/微信登录返回。
- `routers/auth.py:105,118,252` — 注册时按 `Role.school_id == current_user.school_id` 取角色、新用户绑 `current_user.school_id`；微信注册按名查 `默认学校`。
- `routers/auth.py:271` — `/auth/me`(UserBrief) **不含** school_id（已干净）。
- `core/security.py:44` — `get_current_user` 用 `joinedload(User.school)`（可删）。
- `schemas/auth.py:30-31,66-67` — `school_id/school_name` 字段。

### 3.2 Admin — 学校 / 角色 / 用户 / 年级班级
- `routers/admin/schools.py`（整文件）— 学校 CRUD；`create_school:79-134` 建校时为每个 `SYSTEM_ROLES` 复制 per-school 角色+权限并建 `school_admin` 用户（**最核心多租户逻辑**）；`delete_school` 守卫依赖 FK CASCADE。
- `routers/admin/roles.py:31,78-83,119-127,169-177` — list/create/update/delete 全程 `tenant_scope` + `school_id` 校验（即上次「重复角色」的展示来源）。
- `routers/admin/users.py:41-44,61-63,116-117,123-124,186-191,302,360-370,392-444` — list/detail/update/delete/batch/stats 全部 school 作用域 + 跨校 404 守卫。
- `routers/admin/grades.py` / `classes.py`（各 list/create/update/delete）— `tenant_scope` 过滤 + 跨校守卫（classes 经 JOIN Grade）。
- `schemas/admin.py:147-161,183` — `SchoolCreate/SchoolResponse`、`RoleResponse.school_id`。

### 3.3 Cases / Practices
- `routers/cases.py:83-90,118-126,227-243,266,286-321` — 列表/详情/更新/删除走 `tenant_scope`，过滤 `(school_id==scope) | (school_id IS NULL)`（NULL=全局可见）；`create_case:266` 硬写 `school_id=current_user.school_id`。
- `routers/admin/practices.py:53-55,86,99-113,131,160` — 同上 NULL-全局模式；建练习时校验病例归属（`无权使用该校病例`），硬写 school_id。
- `repositories/case.py` / `repositories/user.py` — `list_by_school/count_by_school` 接受 school_id 过滤。
- **最高数据风险**: cases/practices 的 `NULL=全局` 语义，列删除时需决定现有 NULL 行去向。

### 3.4 Training（耦合极薄，仅 `session.py`）
- `contexts/training/router/session.py:244-247` — `/start` 病例 `tenant_scope` 过滤。
- `:385-391` — `/records` 列表暴露 `school_id` 查询参数 + JOIN User 过滤。
- `:468-469,523-524` — 记录详情/删除的跨校 404 守卫。
- ⚠️ `:283-370` — `/start-from-assignment` **无任何 school 守卫**（设计缺口，多租户从未严格隔离作业）。
- 其余 training 路由（chat/scoring/progress/nursing/score_review/physical_exam）、pipeline、`patient/exam.py`、前端 `engine/**`、`components/training/**`、`api/training.ts`、`api/chat.ts` — **全部零耦合**。

### 3.5 Scoring / Stats
- `score_engine.py` / `infrastructure/scoring_progress.py` / `engine/ScoreManager.ts` / `panels/scoring-display/**` — **零耦合**。
- `routers/stats.py:29-52,68-96,126,171,219-227` — 4 端点 `school_id` 参数 + `tenant_scope`；teacher-summary/ranking 经 `Role.school_id` 隐式绑校。
- `routers/export.py:21-32` — `/export/records` `school_id` 参数 + JOIN 过滤。
- `frontend/src/api/stats.ts` — **从不发送 school_id**（超管跨校统计为死功能）。

### 3.6 QA / Feedback
- `contexts/qa/_sessions.py:112-131,169-173` — QA 历史 `school_id` 参数 + 过滤 + 单条消息跨校守卫；`:169` 传 `None` 的微妙之处（super_admin 实际仍看全部）。
- `routers/feedback.py:50-63,104-110` — 列表/统计 `school_id` 参数 + JOIN 过滤。
- 前端 `QA.tsx` / `api/qa.ts` / `FeedbackPage.tsx` / `api/admin/feedback.ts` — 无 UI 发送 school_id（通用 params 可透传但未使用）。

### 3.7 Questionnaires（隐性深耦合）
- `models/questionnaire.py:31-42` + `schemas/questionnaire.py:76` — 模板 `school_id` 列/字段/关系。
- `routers/questionnaires/templates.py:47,63,89-94,128,156-240,256-269` — 响应回填 school_id；list/get/update/delete + assign_cases 全程 `tenant_scope`；create 硬写 school_id。
- `questions.py:26-111`、`responses.py:234-243`、`stats.py:32-137` — 题目 CRUD / 回答列表 / 统计 / 导出 全部经模板或 User 的 school_id 级联作用域。
- ⚠️ **单一模板创建者的 school_id 决定哪些管理角色可见统计/分配病例** —— 隐性耦合。

### 3.8 Notes / Assignments
- `routers/notes.py:25-28` — 老师查学生笔记的跨校守卫（无 super_admin 旁路）。
- `routers/assignments.py:37,134-138,250-254` — `_check_teacher_school` + 创建/更新引用 `practice.case.school_id` 做病例归属校验。

### 3.9 前端 / 小程序 / 测试 / 文档
- 前端: `stores/authStore.ts:61,115`（存/留 school_id/school_name）、`types/store.ts:12,16-22,29`（User/School/RoleItem 类型）、`schemas/school.ts`（整文件）、`pages/admin/SchoolsPage.tsx`（整页）、`api/admin/schools.ts`（整文件）、`api/query-keys.ts:54-57`、`Layout.tsx:72-76`（侧边栏「学校管理」）、`RolesPage.tsx:50`（school_manage 权限项）、`UserList.tsx:142` / `role-badge.tsx:6-7`（super_admin/school_admin 徽章）。
- 自动生成（只读，需重新生成）: `frontend/src/api/api-types.gen.ts`、`miniprogram/api/types.gen.ts`（多处 `school_id?/school_name?`）。
- 测试: `tests/{auth,admin,training,scoring}/*` 与 `conftest.py` 硬编码 `school_id=1`；`frontend authStore.test.ts`。
- 文档: `docs/01-architecture.md`、`docs/uml/*.puml`、历史 checklist。

---

## 4. 关键发现 / 隐性耦合

1. **死契约**: super_admin 跨校筛选（`school_id` query param）全链路存在于后端+生成类型，但**无任何 UI 触发** → 移除前端零风险。
2. **半成品 UI**: `SchoolsPage` 「进入管理」= `navigate("/home")`，从无真正多校切换。
3. **`admin/api.py` 用 `school_id is None` 作超管代理** — 与 seed 出的 admin（school_id=1）疑似矛盾，须验证。
4. **不一致守卫**: `notes.py`、部分 `practices.py` 用裸 `current_user.school_id` 且**无 super_admin 旁路**，与 tenant_scope 主路径不一致（多租户真启用时即为 bug）。
5. **作业无校隔离**: `/start-from-assignment` 无 school 守卫。
6. **问卷级联**: 模板 school_id 经 tenant_scope 级联到题目/统计/分配病例，是最隐蔽的耦合链。

---

## 5. 剥离影响与风险排序（供后续设计参考，非本次实施）

| 优先 | 工作项 | 风险 | 说明 |
|------|--------|------|------|
| P0 | DB 迁移 | 高 | 先 drop 6 个 FK（注意 users=RESTRICT）→ `roles/grades` 的 `UNIQUE(school_id,name)`→`UNIQUE(name)`（先验证无同名）→ drop 6 列 → drop `schools` 表 |
| P0 | cases/practices/templates 的 NULL 行 | 中 | `SET NULL=全局` 语义消失，列删除前确认无需 backfill |
| P0 | `tenant_scope` 移除 | 高 | ~15 文件 / 25+ 调用点；统一删 `if scope is not None` 过滤与 `school_id` 查询参数 |
| P1 | seed 重写 | 中 | 删模板角色、扁平化角色、去掉所有 `school_id=` 赋值；处理 `if School.count()>0: return` 守卫 |
| P1 | 删 `/admin/schools` 全栈 | 低 | router + schemas + SchoolsPage + api/schemas/query-keys + 侧边栏 + 路由 |
| P1 | 角色合并 | 中 | `school_admin` 是否并入 `super_admin`？`school_manage` 权限作废 |
| P1 | Token/Schema 清理 | 中 | JWT payload、`TokenResponse`、`RoleResponse`、`QuestionnaireTemplateResponse` 去 school_id；`pnpm run api:update:all` 重新生成 |
| P2 | 前端 localStorage 迁移 | 低 | 持久化的 `school_id/school_name` 兼容处理 |
| P2 | 测试夹具 | 低 | 去 `school_id=1` |
| P2 | 文档/UML | 低 | 更新架构图与说明 |

---

## 6. 待决问题（进入 brainstorming 时回答）

1. `schools` 表是**完全删除**，还是保留为单行兜底（降低迁移风险）？
2. `super_admin` 与 `school_admin` 合并为单一 `admin`，还是保留 `super_admin` 作系统管理员？
3. cases/practices/questionnaire_templates 现有 NULL 行：直接丢列（NULL 全局变全可见）即可，还是需显式 backfill？
4. `admin/api.py` 的 `school_id is None` 守卫现状是否为已存在 bug（需先确认当前 admin 能否管理密钥）？
5. 剥离是**一次性大迁移**，还是分阶段（先去前端死契约 → 再去 tenant_scope → 最后 DDL）？

---

## 7. 结论

多租户在数据层（6 表 + schools）、访问控制层（tenant_scope + is_super_admin + school_id 代理）、以及 admin/cases/practices/qa/feedback/questionnaires/notes/assignments 的查询与守卫中均有存在，但**训练核心域、评分、前端引擎/组件完全解耦**，且**前端从不真正使用多租户**。整体属于「可控但跨域」的清理，建议作为独立的 brainstorming → spec → plan → 分阶段实施，DDL 迁移与 tenant_scope 移除为最高风险项。
