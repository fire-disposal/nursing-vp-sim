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

## 写端点的三条硬规

1. 取目标行用 `visible_class(db, scope, class_id)` / 显式 `require_school(...)`，不要自己 `db.get`。
2. 新行的院校归属用 `writable_school_id(scope, requested)`：院校管理员强制本校，
   平台角色必须显式给出。**不要**允许把 `users.school_id` 改成 NULL（那是平台角色专属）。
3. 单校不变量：一个用户的班级成员必须全在其院校。跨校加入 → `ValidationError`（本仓映射 400）。

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
