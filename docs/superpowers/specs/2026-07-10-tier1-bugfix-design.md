# Tier 1 BUG 修复 — 设计规格 (Spec)

**日期**: 2026-07-10
**状态**: 待用户复核
**类型**: 缺陷修复（经复核过滤后）
**前置**: Tier 0 已完成（`fix/tier0-critical-bugfix` 分支）

---

## 1. 复核结论

原始 Tier 1 的 9 项经逐条读源码复核：

- **真实** (4 项 Medium)：T1-1 (事务 TOCTOU)、T1-3 (export 无分页)、T1-6 (监听器泄漏)、T1-8 (网络误登出)
- **降级** (3 项 Low)：T1-2 (鉴权暴露)、T1-4 (越权角色)、T1-7 (ErrorBoundary 粒度)
- **移除** (2 项)：T1-5 (评分吞异常 —— Tier 0 已化解)、T1-9 (WS 竞态 —— 不存在)

---

## 2. Tier 1a — Medium（4 项）

### T1-1 事务 TOCTOU：create 路径绕过 unit_of_work

**位置**:
- `backend/services/auth.py:82-113` — `register()`: check-then-commit 绕过 UOW
- `backend/services/auth.py:167-185` — `wechat_bind()`: openid 检查后直接 `db.commit()`
- `backend/services/auth.py:189-222` — `wechat_register()`: 同上
- `backend/services/user.py:99-133` — `batch_create()`: 每行 username check 后 `db.commit()` 分批/最终

**根因**: `unit_of_work` 提供 IntegrityError→ConflictError(409) 映射，但这些方法用原始 `db.commit()`。并发注册/绑定微信时，两条请求同时过 SELECT 检查，第二条 INSERT 触发 DB unique 约束 → 原始 IntegrityError → 500 ISE 而非 409 ConflictError。

**修复**: 将 `register()`、`wechat_bind()`、`wechat_register()`、`batch_create()` 的 commit 块包裹在 `unit_of_work(self.db, conflict_detail="...")` 内。`register()` 的 username check 可移入 UOW 块（让 DB unique 约束兜底）。`batch_create` 的 db.commit() 改为一次 UOW（不再分批 commit 50 条一次——UOW 块结束时统一提交）。

**验收**: `backend/tests/auth/test_auth.py`（或新建测试）验证 concurrent register → 409 的响应状态码。对 `wechat_bind` 新增测试：两个请求绑同一 openid → 409。

**风险**: 低。改动均为包裹现有的 db.commit() 调用。

---

### T1-3 export 端点无行数限制

**位置**: 所有调用 `.all()` 的 export 端点。经复核，高风险仅 2 处：
- `backend/routers/feedback.py:74` — `.all()` 全量反馈导出（教师权限，可达千级）
- `backend/routers/admin/users.py:103` — `.all()` 全量用户导出（admin 权限，可达万级）

其他端点（cases 几十条；roles <10 条；notes 自限；assignments 单 assignment 范围）自然受限，**不修**。

**根因**: 无最大导出行数限制，人员+权限扩散后大表可压垮导出任务。

**修复方向**: 在 `backend/infrastructure/exporter.py` 的 `export_response()` 函数开头加 `if len(items) > MAX_EXPORT_ROWS: raise HTTPException(400)`。在 `backend/core/config.py` 定义 `MAX_EXPORT_ROWS = 20000`。对 feedback 和 users 两个端点已使用 `.all()` → 加上 `[:MAX_EXPORT_ROWS]` 切片后传入 export_response。

**验收**: 手动测试 / 或 mock 大列表 → 确认超限返回 400。

**风险**: 极低。正常使用量距 20000 很远（学校场景），确保前端导出按钮不受影响（t0 不修前端）。

---

### T1-6 监听器/定时器卸载泄漏

**位置**:
- `frontend/src/components/training/InitiativeBar.tsx:49` — `setInterval` (tickRef) 只在 `bus.on("training:ended")` 清理，组件卸载不清理
- `frontend/src/components/training/SceneRenderer.tsx:62-63` — drag 的 `document.addEventListener("mousemove"/"mouseup")` 仅 `onUp` 清理，面板关闭 mid-drag 泄漏

EmotionIndicator 的 setTimeout (one-shot, React 18+ 静默忽略 unmounted setState) 不修。

**根因**: 组件 unmount 路径未注册 cleanup，interval 持续运行 / 全局监听器残留。

**修复**:
- InitiativeBar: 在最顶层 `useEffect` 返回 `stopTicker`（组件挂载后 ~line 125 无 cleanup 的 effect 可独立加一个 `useEffect(() => () => stopTicker(), [])`）
- SceneRenderer: 加 ref 追踪活跃 drag 监听器，在 `activeCard` 变化或 unmount 时统一清除

**验收**: 浏览器 DevTools → 训练页进入后立即离开（不触发 training:ended）→ 确认 no lingering intervals (Performance monitor 或 console.count 验证)。

**风险**: 低。纯清理逻辑，不改变功能行为。

---

### T1-8 authStore 网络错误误登出

**位置**: `frontend/src/stores/authStore.ts:86-96`

**根因**: `refreshAuth()` catch 块对所有错误（包括网络断连、5xx、超时）都执行 `set({ user: null, token: null, permissions: [] })`。关键触发路径：
1. `onRehydrateStorage` (line 150-151): 页面加载 zustand 恢复 session 后立即调 refreshAuth——**此时断网会立即清空有效 session**（最高风险）
2. `startRefreshTimer` (line 26-32): 24 小时定时刷新——训练中瞬断可被登出（风险较低但存在）

**修复方向**（最小改动）:
- `refreshAuth` catch 块内判断 `axios.isAxiosError(err) && err.response` —— 只有服务端返回 401 时才清 session。网络错误 / 5xx / 超时只 `console.warn` 并返回 false，**不清 session**。
- `onRehydrateStorage` 不再无条件调 `refreshAuth()`。改为：仅在 `getMe()` 返回 401 时通过 interceptor 触发 logout（interceptor 已正确实现此逻辑）。即删除 line 150-152 内的 `refreshAuth` 调用，依赖正常 API 调用的 401 → interceptor → logout 链。`startRefreshTimer` 照旧但有了 catch 守卫。

**验收**: 手动测试：开页面时断网 → session 保留，网络恢复后 API 正常调用；正常 401 → session 清除。

**风险**: 低。仅改变错误处理分支，不影响正常登录/刷新路径。

---

## 3. Tier 1b — Low（3 项）

### T1-2 鉴权暴露

**位置**: `backend/routers/profiles.py:18`（无鉴权）、`backend/routers/health.py:54`（`/api/metrics` 无鉴权）

**根因**: `/api/profiles` 暴露训练类型名+聚合count，无 PII；`/api/metrics` 曝 Prometheus 运维指标。

**修复方向**: 给 `/api/profiles` 加 `CurrentUser` 依赖（一行业务）。`/api/metrics` 不修——Prometheus scrape 无认证是业界惯例，应用层不应对网络层安全做过度防御。

### T1-4 越权角色赋权

**位置**: `backend/services/user.py:244-248`（`user.update()` 角色赋值）+ `backend/routers/admin/users.py:113`

**根因**: 持有 `user_manage` 者可赋任意角色（包括 admin），无角色层级守卫。当前默认配置中 `school_admin` 已有全部权限使提权无实际影响，但自定义角色可构成风险。

**修复方向**: `user.update()` 申请赋角色的那行加守卫 `if current_user.id == user_id: raise ValidationError("不能修改自己的角色")` 防自提权。对他人则维持现状（user_manage 本应受信任）。

### T1-7 场景卡 ErrorBoundary 粒度过粗

**位置**: `frontend/src/components/training/SceneRenderer.tsx:117-122`

**根因**: `ErrorBoundary` 在 App 层，单卡崩溃整页白屏（显示"页面出错了"+重试）。

**修复方向**: 在 `<activeCard.component .../>` 外包 `<ErrorBoundary fallback={<div>卡片加载失败</div>}>`，使崩溃局限在卡片区域。

---

## 4. 非目标（YAGNI）

- `/api/metrics` 鉴权（Prometheus 惯例，网络层负责）
- T1-3 中自然受限的端点（cases/roles/notes/assignments export）
- EmotionIndicator setTimeout cleanup（React 18+ 已静默忽略，实际影响为零）
- `update_me` / `change_password` / `logout` 的 `unit_of_work` 包裹（不存在并发冲突场景）
- 删除端点响应格式统一化（非 BUG，属风格差异，归入未来 refactor）

---

## 5. 执行顺序

**Tier 1a**（4 项，有实际用户影响或安全意义）:
1. T1-1 事务 TOCTOU（后端，有测试覆盖）
2. T1-3 export 行数限制（后端，单文件）
3. T1-6 监听器泄漏（前端，两个组件）
4. T1-8 网络误登出（前端，单文件）

**Tier 1b**（3 项，低影响快速修）:
5. T1-2 profiles 加鉴权
6. T1-4 禁止自提权
7. T1-7 SceneRenderer 局部 ErrorBoundary

每项独立可测，无顺序依赖。
