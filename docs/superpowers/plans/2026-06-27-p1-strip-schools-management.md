# Plan 1 (P1)：移除学校管理特性 + 清理 school 响应/前端类型 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除「学校管理」整套特性（`/admin/schools` 后端 CRUD + 前端页面）并从认证响应与前端类型中移除 `school_id/school_name`，作为多租户剥离的第一阶段（纯删除，不引入新基类）。

**Architecture:** 自顶向下纯删除：后端先删 schools 路由与 School schemas、去掉 `TokenResponse/WechatLoginResponse` 的 school 字段（**保留 JWT payload 的 school_id claim，留待 P2**），再删前端页面/API/类型/路由/侧边栏与 authStore 残留，最后 `pnpm run api:update:all` 重生类型并全量 check。`School` ORM 模型、`school_id` 列、`tenant_scope`、`school_manage` 权限**本阶段不动**（属 P2-P4）。

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic（backend, `uv run`）；React 19 + TS + Vite + Zustand（frontend）；openapi-typescript 生成类型。

**关联**: 设计 `docs/superpowers/specs/2026-06-27-multi-tenant-removal-and-layered-refactor-design.md` §5 P1。分支：`refactor/strip-multi-tenancy`（**当前分支直接开干，不用 worktree**）。

> 注意：Windows PowerShell，串行用 `;`；后端命令一律 `cd backend; uv run ...`。

---

### Task 1: 删除后端 schools 路由并注销注册

**Files:**
- Delete: `backend/routers/admin/schools.py`
- Modify: `backend/routers/__init__.py`（移除 `admin.schools` 的 import 与 `include_router`）

- [ ] **Step 1: 删除路由文件**

删除整个 `backend/routers/admin/schools.py`。

- [ ] **Step 2: 注销注册**

在 `backend/routers/__init__.py` 中：删除导入 `admin.schools` 的那一行，以及对应的 `app.include_router(...)`（schools 路由）那一行。先读取该文件确认确切行，再精确删除，勿误删其他 admin 路由的注册。

- [ ] **Step 3: 确认无其他引用**

搜索 `from routers.admin.schools`、`admin.schools`、`admin/schools`（后端）确认无残留引用。

Run: `cd backend; uv run python -c "import routers; from main import app; print('import ok')"`
Expected: 打印 `import ok`，无 ImportError。

- [ ] **Step 4: 提交**

```bash
git add backend/routers/admin/schools.py backend/routers/__init__.py
git commit -m "🔥 remove: 删除后端学校管理路由及注册"
```

---

### Task 2: 删除 School schemas 与认证响应中的 school 字段

**Files:**
- Modify: `backend/schemas/admin.py`（删除 `SchoolCreate`、`SchoolResponse`，约 147-161 行）
- Modify: `backend/schemas/auth.py`（`TokenResponse` 删 `school_id/school_name`，约 30-31 行；`WechatLoginResponse` 同，约 66-67 行）
- Modify: `backend/routers/auth.py`（`_build_token_response()` 及微信登录/refresh 构造处删除 `school_id=`、`school_name=` 赋值，约 44-66 行；**保留 JWT `to_encode` 里的 `school_id` claim**）

- [ ] **Step 1: 删除 School schemas**

读取 `backend/schemas/admin.py`，删除 `SchoolCreate` 与 `SchoolResponse` 两个类定义。若文件含 `__all__` 显式导出，亦移除这两项。

- [ ] **Step 2: 删除认证响应 school 字段**

读取 `backend/schemas/auth.py`，从 `TokenResponse` 删除 `school_id` 与 `school_name` 字段；从 `WechatLoginResponse` 删除同名字段。

- [ ] **Step 3: 删除响应构造处的赋值**

读取 `backend/routers/auth.py`，在 `_build_token_response()`（及微信登录、refresh 的响应构造）中删除 `school_id=...`、`school_name=...` 两处实参。**务必保留 JWT 编码 payload（`to_encode`/`create_access_token`）中的 `school_id` —— 它属于 P2**。

- [ ] **Step 4: 校验后端**

Run: `cd backend; uv run ruff check; uv run ty check`
Expected: 无错误（若 `ty` 报某处仍引用已删字段，按提示修正同文件引用）。

- [ ] **Step 5: 提交**

```bash
git add backend/schemas/admin.py backend/schemas/auth.py backend/routers/auth.py
git commit -m "🔥 remove: 移除 School schemas 及认证响应中的 school_id/school_name"
```

---

### Task 3: 修正后端测试

**Files:**
- Modify: `backend/tests/admin/test_admin.py`（删除针对 `/admin/schools` 的测试）
- Modify: `backend/tests/auth/test_auth.py`（删除对 token 响应 `school_id/school_name` 的断言）
- Modify (如有): 其他引用 `SchoolCreate/SchoolResponse` 或 `/admin/schools` 的测试

- [ ] **Step 1: 定位受影响测试**

搜索 `tests/` 下 `admin/schools`、`/api/admin/schools`、`SchoolCreate`、`SchoolResponse`、token 响应里的 `school_id`/`school_name` 断言。

- [ ] **Step 2: 删除/修正**

删除针对学校管理端点的测试用例；删除 token 响应中对 `school_id/school_name` 的断言（保留其余断言）。**不要**删除创建 school 行的 fixture（`conftest.py` 的 `school_id=1` 仍被其他表依赖，属 P3-P4）。

- [ ] **Step 3: 跑受影响域测试**

Run: `cd backend; uv run python -m pytest tests/admin/test_admin.py tests/auth/test_auth.py -x -q`
Expected: PASS（无 collection error、无残留引用 NameError）。

- [ ] **Step 4: 提交**

```bash
git add backend/tests/
git commit -m "✅ test: 移除学校管理端点与 token school 字段相关测试"
```

---

### Task 4: 删除前端学校管理页面/API/路由/侧边栏

**Files:**
- Delete: `frontend/src/pages/admin/SchoolsPage.tsx`
- Delete: `frontend/src/api/admin/schools.ts`
- Delete: `frontend/src/schemas/school.ts`
- Modify: `frontend/src/api/query-keys.ts`（删除 `admin.schools` 查询键，约 54-57 行）
- Modify: `frontend/src/App.tsx`（删除 `SchoolsPage` 懒加载 import 与 `/admin/schools` 路由，约 150-154 行）
- Modify: `frontend/src/components/Layout.tsx`（删除「学校管理」导航项，约 72-77 行；若 `Building2` 图标不再被使用，删除其 import）

- [ ] **Step 1: 删除三个文件**

删除 `SchoolsPage.tsx`、`api/admin/schools.ts`、`schemas/school.ts`。

- [ ] **Step 2: 删引用**

- `query-keys.ts`：删除 `schools` 查询键条目。
- `App.tsx`：删除 `const SchoolsPage = lazy(...)`（或等价 import）与 `<Route path="/admin/schools" ... />`。
- `Layout.tsx`：删除 `{ to: "/admin/schools", icon: Building2, label: "学校管理", permission: "school_manage" }` 导航项；随后检查 `Building2` 是否还被引用，未引用则从 `lucide-react` import 中删除。

- [ ] **Step 3: 确认无残留**

搜索 `frontend/src` 中 `SchoolsPage`、`api/admin/schools`、`schemas/school`、`/admin/schools`，确认无残留 import/引用。

- [ ] **Step 4: 校验（局部）**

Run: `cd frontend; npx tsc --noEmit`
Expected: 无与 schools 相关的报错（若报 `User.school_id` 等类型错误，留待 Task 5 一并解决，可在 Task 5 后再统一跑）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/admin/SchoolsPage.tsx frontend/src/api/admin/schools.ts frontend/src/schemas/school.ts frontend/src/api/query-keys.ts frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "🔥 remove: 删除前端学校管理页面/API/路由/侧边栏入口"
```

---

### Task 5: 删除前端 store 中的 school 类型与 authStore 残留

**Files:**
- Modify: `frontend/src/types/store.ts`（删除 `School` 接口，约 16-22 行；删除 `User.school_id`、`User.school_name`，约 12-13 行；删除 `RoleItem.school_id`，约 29 行）
- Modify: `frontend/src/stores/authStore.ts`（登录时删除 `school_id`/`school_name` 写入，约 61-62 行；`refreshUser` 中删除保留这两字段的两行，约 115-116 行）
- Modify (如有): `frontend/src/components/admin/questionnaires/types.ts`（若 `TemplateListItem.school_id?` 在前端被读取则保留至 P 后续；本阶段只删 store 层；此处**先不动**，留待类型重生后由 Task 6 验证）

- [ ] **Step 1: 删类型**

`types/store.ts`：删除整个 `School` 接口、`User` 的 `school_id?`/`school_name?` 字段、`RoleItem` 的 `school_id` 字段。

- [ ] **Step 2: 删 authStore 残留**

`stores/authStore.ts`：在 `login()` 构造 user 处删除 `school_id: data.school_id ?? undefined` 与 `school_name: ...` 两行；在 `refreshUser()` 中删除 `school_id: current?.school_id` 与 `school_name: current?.school_name` 两行。

- [ ] **Step 3: 确认无 `user.school_id` 读取点**

搜索 `frontend/src` 中 `\.school_id`、`\.school_name`、`School\b`（排除自动生成 `.gen.ts`）。若仍有读取点（预期无，审计确认仅存储不使用），就地删除。

- [ ] **Step 4: 校验**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/types/store.ts src/stores/authStore.ts`
Expected: tsc 无 school 相关报错；biome 通过。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/types/store.ts frontend/src/stores/authStore.ts
git commit -m "🔥 remove: 移除前端 store/authStore 中的 school 类型与残留字段"
```

---

### Task 6: 重新生成 API 类型并全量校验

**Files:**
- Regenerate: `openapi.json`, `frontend/src/api/api-types.gen.ts`, `miniprogram/api/types.gen.ts`（**禁止手改**）

- [ ] **Step 1: 重生类型**

Run: `pnpm run api:update:all`
Expected: 打印 `spec written` 等，生成文件更新（`TokenResponse`/`WechatLoginResponse`/`SchoolResponse` 相关 school 字段消失）。

- [ ] **Step 2: 校验类型同步**

Run: `pnpm run check:api`
Expected: `git diff --exit-code` 通过（重生后无未提交差异 = 已是最新）。若有差异说明上一步生成已写入，纳入提交即可。

- [ ] **Step 3: 全量 check**

Run: `cd backend; uv run ruff check; uv run ruff format --check .; uv run ty check`
Then: `cd frontend; npx tsc --noEmit; npx biome check`
Expected: 全绿。若 `api-types.gen.ts` 移除 school_id 后某前端文件仍引用（预期无），就地修正。

- [ ] **Step 4: 跑关键后端测试**

Run: `cd backend; uv run python -m pytest tests/auth/ tests/admin/ -x -q`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add openapi.json frontend/src/api/api-types.gen.ts miniprogram/api/types.gen.ts
git commit -m "🔧 chore: 重新生成 API 类型（移除 school 字段）"
```

---

### Task 7: P1 收尾验证（tag 待用户确认）

- [ ] **Step 1: 端到端确认删除完整**

搜索全仓 `school_manage` 以外的 P1 目标残留：`/admin/schools`、`SchoolsPage`、`SchoolCreate`、`SchoolResponse`、前端 `\.school_id`（排除 `.gen.ts` 与后端 `school_id` 列/`tenant_scope`，那些属 P2-P3）。确认 P1 范围内已清。

- [ ] **Step 2: 完整推送前检查**

Run: `cd backend; uv run python -m compileall -q .; uv run python -m pytest -x -q; uv run ruff check; uv run ruff format; uv run ty check`
Then: `cd frontend; npx tsc --noEmit; npx biome check`
Expected: 全绿。

- [ ] **Step 3: tag 推送（需用户明确指示）**

P1 代码完成后**暂停**，向用户汇报并征得同意后再执行 `pnpm run tag`（触发 staging 部署）。`🔥 remove`/`🔧 chore` 非 feat/fix，pre-push 不要求测试核对单。

---

## Self-Review 注记

- **Spec 覆盖**：覆盖设计 §5 P1 全部条目（schools 全栈删除、auth 响应 school 字段、前端类型/store、类型重生）；JWT claim 与 `school_manage` 权限按设计**显式推迟**到 P2/P4。
- **顺序安全**：后端 schema 改动（Task 2）先行 → 前端清理（Task 4-5）→ 类型重生（Task 6），避免 `.gen.ts` 先删 school_id 导致 tsc 断裂。
- **非目标**：不动 `School` 模型、`school_id` 列、`tenant_scope`、`school_manage` 权限、角色定义。
