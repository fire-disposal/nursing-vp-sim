# 多租户剥离 + 分层范式重构 设计 (Design)

> 日期: 2026-06-27 · 分支: `refactor/strip-multi-tenancy`
> 关联分析: [`2026-06-27-multi-tenant-audit.md`](./2026-06-27-multi-tenant-audit.md)（多租户存在与行为的完整盘点）
> 状态: 设计待评审 → 通过后进入 implementation plan

---

## 1. 目标与决策

1. **全量剥离多租户**：彻底移除多学校（`school_id` / `schools` / `tenant_scope` / `school_admin` 学校作用域）特性。理由：事实单租户（仅 1 校）、前端从不真正使用、2C2G 无法支撑多校并发。
2. **以剥离为载体，增量引入「声明式分层」范式（方案 A）**：每删一处 `tenant_scope`、动到一个域，就顺手把该域改造成 **薄路由 → service → repository + 横切自动化**。**未被剥离触及的域不动。**
3. **首个触及域作为 PoC**，锁定 `Repository[T]` / `make_crud_router` / 事务 UoW / 异常词汇 / DI 别名 的基类设计，再沿用到其余触及域。

非目标（YAGNI 边界）：不把 chat pipeline 套到 CRUD；不做「全后端 repository 迁移」这个独立 epic；不引入元类/自动派生 schema 的「极致声明式框架」。

---

## 2. 现状摘要（详见审计文档）

- 数据访问 = **胖路由 / active-record-ish**：36/36 handler 直接 `db.query()`，~103 处手写 `db.commit()`，无薄路由。
- `repositories/` 层存在但**近乎死代码**（`Case/User/PracticeRepository` 请求路径无人引用）。
- 骨架优良但未用满：`core/exceptions.py`（仅 ~20% 采用）、`PaginatedResponse[T]`（高一致）、`require_permission` 闭包工厂、`paginate()`、`login_strategies/` 的 Strategy+registry、`app.state` 单例、`middleware/dependencies.py`（typed Depends，**从未被 import**）。
- 多租户耦合：6 表带 `school_id` + `schools` 表 + 单点 `tenant_scope()`（~15 文件/25+ 调用点）+ 散落 `is_super_admin` 旁路 + 双层角色（NULL 模板 vs 本校）。

---

## 3. 目标范式 A：约定优于配置的分层 (Convention-over-Configuration Layered)

三根支柱，分别对位「自动化 / 美观 / 高复用」。**全部是激活现有骨架的演进，非重写。**

### 支柱① 通用基类自动化 CRUD（自动化 + 高复用）

- `repositories/base.py`：定义/收敛 `Repository[TModel]`，提供 typed `get / get_or_404 / list(分页) / create / update / delete / exists / filter`。**所有 repository 统一继承它**（修掉 `UserRepository` 未继承 `SyncRepository` 的不一致）。
- `core/crud_router.py`（新，~百行）：`make_crud_router(*, model, schema_brief, schema_detail, schema_create, schema_update, perm_prefix, ...)` 自动挂载 5 个标准端点（list→`PaginatedResponse`、get、create、update、delete→`DeleteResponse`），自动接 `require_permission`。**有特例的域只覆写个别路由**，其余白来。
- `core/service.py`（新，薄）：`CrudService[TModel, TCreate, TUpdate]` = repository 包装 + 领域错误（抛 `NotFoundError` 等），承载跨实体业务规则。

### 支柱② 横切关注点全 DI / 自动（自动化 + 美观）

- **事务自动化**：新增 `transactional` / `get_uow` 依赖 —— 进入产出 session，正常退出自动 `commit`，异常自动 `rollback`。**逐步消灭 ~103 处手写 commit**（触及域内）。
- **错误自动映射**：触及代码内**禁止裸 `HTTPException`**，统一抛 `core/exceptions.py` 类型（必要时补 `ForbiddenError` / `ValidationError`），由 `main.py` 已注册的 handler 自动转响应。
- **DI 统一**：单一风格 `Annotated[...]` 别名 —— `DbSession`、`CurrentUser`、`Perm("xxx")`（复活 `middleware/dependencies.py`，把它从死代码变成标准入口）。

### 支柱③ 薄路由 + 纯领域模块（美观 + 高复用）

- 路由收薄到「声明意图」（~5 行）：解析入参 → 调 service → 返回 schema。
- 富业务逻辑下沉到 service，或 `contexts/patient/` 式**无路由纯领域模块**（已验证的最干净样板）。
- 保留 chat pipeline（领域专用，**不泛化**）。

---

## 4. PoC：首个触及域锁定基类

剥离 P2 第一个改造的域（建议 **grades**：纯 CRUD、无 `is_system` 特判，最适合锁基类；`roles` 因 `is_system`/系统角色特判随后改造）作为 PoC，产出并冻结：
`Repository[TModel]` 接口 + `make_crud_router` 签名 + `transactional` 依赖 + 异常词汇 + DI 别名集。
PoC 通过 `pnpm run check` + 该域单测后，作为模板复制到其余触及域。**基类一旦变动需回溯已改造域**，故先冻结再推广。

---

## 5. 分阶段交付（每阶段 = 1 tag → staging → 验证；2C2G 友好）

| 阶段 | 范围 | 范式动作 | 风险 |
|------|------|----------|------|
| **P1 死契约 + 学校管理全栈删除** | 删 `/admin/schools`（router+schemas+SchoolsPage+`api/admin/schools.ts`+`schemas/school.ts`+`query-keys`+侧边栏+路由）；删前端 `User.school_id/school_name`、`School` 类型、localStorage 残留；`TokenResponse`/`WechatLoginResponse` 去 `school_id/school_name`（JWT payload 的 school_id claim 待 P2 确认后端无消费后再删）；`pnpm run api:update:all` 重生类型 | 暂不引入基类（纯删除） | 低 |
| **P2 collapse `tenant_scope` + PoC + 增量分层** | 逐域移除 school 过滤/查询参数；**首域 PoC 锁基类**，其余触及域改造成 薄路由→service→repository + 事务/异常/DI 横切；删 `tenant_scope`、`admin/api.py` 的 `school_id is None` 守卫（换成 `api_manage` 权限/`is_super_admin`） | 引入并推广 A | 中 |
| **P3 DDL 迁移 + seed 重写** | 一支 autogenerate DDL：drop 6 FK（注意 users=RESTRICT）→ `roles/grades` `UNIQUE(school_id,name)`→`UNIQUE(name)`（先验无同名）→ drop 6 列 → drop `schools` 表；重写 `seed.py`（删模板角色、扁平角色、去 `school_id=` 赋值）；重生类型 | repository 屏蔽列变更影响 | 高 |
| **P4 角色/权限/测试/文档收尾** | 删 NULL 模板角色数据；移除 `school_manage` 权限；测试夹具去 `school_id=1`；更新 `docs/01-architecture.md`、UML | 收口 | 中 |

---

## 6. 开放问题的设计裁决（待你评审确认）

1. **`schools` 表**：**完全删除**，不留兜底单行（贴合「坚决全量剥离」）。
2. **角色**：**最小改动 —— 不合并角色**。保留 `super_admin / school_admin / teacher / student` 四角色，仅：删 NULL 模板角色（ids 1-4，0 用户）、全局移除 `school_manage` 权限。`super_admin` 仍是系统管理员（含 `api_manage/prompt_manage`），`school_admin` 自然降级为「教务管理员」。避免无谓的角色/用户迁移。
3. **NULL 行 backfill**：**无需**。直接 drop 列即可 —— cases/practices/questionnaire_templates 的 `school_id`（值全为 1 或 NULL）失去作用域维度后全部变为全局可见，这正是当前单租户的真实行为，无数据丢失。
4. **`admin/api.py` 的 `school_id is None` 守卫**：审计疑为潜在死逻辑（seed 出的 admin `school_id=1` 会被拒）。P2 改造时先**验证当前是否可用**，再换成 `require_permission("api_manage")`。
5. **节奏**：已定 = 增量、以剥离为载体、首域 PoC（§4-5）。

---

## 7. 风险与验证

- **DDL 迁移（P3，最高风险）**：必须通过 pre-push 的 alembic upgrade→downgrade→upgrade roundtrip；`roles/grades` 唯一约束重塑前查重复名。
- **类型契约**：P1/P3 后 `pnpm run api:update:all` 重生 `api-types.gen.ts` + miniapp，`pnpm run check:api` 须绿。
- **基类回溯成本（P2）**：PoC 先冻结基类再推广，降低返工。
- **每阶段独立 tag → staging 验证**，附测试核对单（feat/fix 触发）；爆炸半径按阶段隔离。
- 全程 `pnpm run check`（ruff + ty + biome + tsc），触及域补/跑单测。

---

## 8. 实施分解

本设计偏大，implementation 将按阶段拆为独立 plan：**Plan 1 = P1**（低风险、纯删除、先验证流程）→ **Plan 2 = P2 + PoC**（范式落地核心）→ **Plan 3 = P3**（DDL）→ **Plan 4 = P4**。每个 plan 走 spec→plan→实施→tag 的闭环。

---

## 9. 结论

全量剥离多租户，并借此把后端从「胖路由 + 休眠骨架」激活为「约定优于配置的分层」范式 —— 通用基类自动化 CRUD、DI 横切自动化、薄路由 + 纯领域模块，恰好对位「自动化 / 美观 / 高复用」。改造严格以剥离触及面为边界、分阶段、首域 PoC 冻结基类，风险可控。
