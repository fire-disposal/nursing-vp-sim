# 院校隔离（租户）与校级计费

## 边界定义

- `schools` 是租户表；`classes.school_id` 必填；`users.school_id` 可空 —— **NULL = 平台角色**
  （`super_admin`），跨院校可见。其余角色一律非空。
- 判定只有一处：`backend/core/tenant.py` 的 `resolve_scope`
  - `users.school_id IS NULL` → 跨院校（平台视角）
  - 有 `user_manage` → 本校全部
  - 否则 → 只看自己任教的班（`class_ids`）
- 越权访问返回 **404**（不暴露存在性），只有缺权限才是 403。理由：租户隔离是安全属性，
  403 会告诉对方“这个 id 存在，只是不是你的”。

## 权限归属（超管 = 全部）

`core/roles.py` 里 `super_admin` 的权限是**从词表派生**（`list(PERMISSION_KEYS)`），
且 `seed.sync_system_roles()` 在**每次启动**把库里的系统角色权限对齐到代码：
新增权限 key 自动生效，不需要迁移、也不需要手工补库。

这一条是踩坑后补的：此前同步被包在「角色表非空就 return」的早退里，于是 2026-10-27
上线 `school_manage` 时只有空库新装拿到它，**线上所有角色都没有这个 key**，
院校管理页对所有人 403。角色权限由代码拥有（UI 里改权限，下次启动被覆盖）——
这是刻意设计，不是副作用。

## 写端点的三条硬规

1. 取目标行用 `visible_class(db, scope, class_id)` / 显式 `require_school(...)`，不要自己 `db.get`。
2. 新行的院校归属用 `writable_school_id(scope, requested)`：院校管理员强制本校，
   平台角色必须显式给出。**不要**允许把 `users.school_id` 改成 NULL（那是平台角色专属）。
   - 编辑用户（`PUT /admin/users/{id}` 的 `school_id`，唯一写入点是 `UserService._change_school`）
     同一口径：院校管理员只能提交本校（跨校 = 404）；`super_admin` 不能被挂院校（否则静默丢掉
     跨院校作用域）；账号仍在原院校的班级里时拒绝搬迁，先解除那些班级归属。
3. 单校不变量：一个用户的班级成员必须全在其院校。跨校加入 → `ValidationError`（本仓映射 400）。

## 平台角色的「当前院校」（`X-School-Scope`）

平台角色（`school_manage`）可以在壳顶栏把**工作视图**收窄到某一所院校。实现只有一处：
前端 axios 拦截器带 `X-School-Scope: <school_id>`，后端 `core/tenant.py::get_tenant_scope`
经 `apply_school_scope` 收窄 `TenantScope`。

- **只收窄、不放宽**：院校角色的 `scope.school_id` 非空 → 头一律忽略；非法值（非整数/非正）
  视为未指定，退回全部院校。
- 头只影响**读**（所有经 `Scope` 依赖收窄的查询）；写端点仍按各自规则（`writable_school_id` /
  `visible_class`）判定，创建表单的院校默认跟随作用域、并在收窄时锁住选择。
- 前端把作用域快照（名称/主题色/院徽版本）持久化在 `school-scope`（localStorage），
  退出登录即清空 —— 换账号不能带走上一个平台的视图偏好。

## 院校品牌（可选，不影响隔离）

- `schools.theme_color`：主题色调色板键（闭集见 `frontend/src/theme/school-palettes.ts`），
  空 = 平台默认品牌色。**不存任意 hex**：品牌色会当主色用在填充按钮上，任意色无法保证对比度。
- `schools.logo` / `logo_mime` / `logo_updated_at`：院徽字节入库（与场景图片同构，不读文件系统），
  上传入口先归一（剥元数据、长边 512、WebP，原始上传 ≤2MB）。
- 院徽读取是**公开端点** `GET /api/schools/{id}/logo`（`<img>` 带不了 Authorization；
  院徽本身就是对外标识）。URL 带 `?v=<logo_updated_at>` 做缓存版本号。
- 品牌只影响观感：主题色在 `main.tsx` 换 `theme.colors.brand`；隔离仍只由本文件的租户作用域决定。

## 为什么用查询助手而不是 RLS

本仓是单人运维 + 单实例 PG，行级安全策略（RLS）会引入“连接池里谁在查”的隐性状态，
排查成本高于收益。收窄写在查询层，配套契约测试（`tests/tenant/test_isolation_matrix.py`）
覆盖“A 校管理员访问 B 校资源必须 404/空”。新增端点若漏了收窄，靠这条测试兜底。

## 校级计费

成本归因链：`llm_call_logs.user_id → users.school_id`、`voice_call_logs.user_id → users.school_id`。
`user_id` 为空的行归“未归属”桶（不静默丢）。院校级预算目前没有表：
预算仍是平台级（`api_secrets.monthly_cost_limit` 之和、`voice_configs.monthly_budget`），
要不要按院校分预算属于产品决策，未做。

## 存量数据

生产库在迁移 `b7c1d9e4a2f6` 里统一回填为「杭州师范大学」（用户确认：现有班级/届别/用户/管理员
全属该校）。空库不建默认院校：新环境由超管自己建第一所。
