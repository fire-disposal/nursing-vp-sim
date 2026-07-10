# Tier 1a Medium BUG 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Tier 1a 四项 Medium 缺陷——事务 TOCTOU、export 无行数限制、前端监听器泄漏、authStore 网络误登出。

**Architecture:** 四个独立改动域。后端两项（auth service unit_of_work 包裹 + exporter 行数门禁）互无依赖。前端两项（InitiativeBar/SceneRenderer cleanup + authStore catch 守卫）互无依赖。每项 TDD 或验证性测试。

**Tech Stack:** 后端 FastAPI + SQLAlchemy + pytest（`uv run` from `backend/`）；前端 React 19 + TypeScript + Vitest + Testing Library（`npx` from `frontend/`）。

**关联 spec:** `docs/superpowers/specs/2026-07-10-tier1-bugfix-design.md`

---

## Task 1: T1-1 auth/user 创建包裹 unit_of_work（TDD）

### Task 1a: `AuthService.register()` 包裹 UOW

**Files:** Modify `backend/services/auth.py:82-132`, Test `backend/tests/auth/test_auth.py`

- [ ] **Step 1: 写失败测试**

在 `backend/tests/auth/test_auth.py` 末尾追加（若文件不存在或 fixture 不同，参照 `tests/scoring/` 的 db_session 模式）：

```python
def test_register_duplicate_username_returns_409(db_session, admin_user):
    """并发注册同一用户名→409 ConflictError，非 500."""
    from schemas import RegisterRequest
    from services.auth import AuthService
    svc = AuthService(db_session)
    req = RegisterRequest(username="dup_test_user", password="pass1234", role="student",
                          display_name="Dup", gender=None)
    svc.register(req, admin_user)  # first succeeds

    from core.exceptions import ConflictError
    with pytest.raises(ConflictError):
        svc.register(req, admin_user)  # second → 409
```

IMPORTANT: Confirm `admin_user` fixture exists in auth tests (likely via conftest or a `_seed_admin`). If not, create a minimal User with admin role in the test. Adapt RegisterRequest field names to match the actual schema.

- [ ] **Step 2: Run test to confirm 500 (fail)**

Run: `cd backend; uv run python -m pytest tests/auth/test_auth.py::test_register_duplicate_username_returns_409 -x -q`
Expected: FAIL — raw IntegrityError (500) or internal server error, NOT ConflictError 409.

- [ ] **Step 3: Wrap register() commit in unit_of_work**

In `backend/services/auth.py` `register()`, replace lines 107-113:
```python
        self.db.add(user)
        self.db.flush()
        ...
        self.db.commit()
```
with:
```python
        self.db.add(user)
        self.db.flush()

        if req.class_id is not None:
            self.db.add(UserClass(user_id=user.id, class_id=req.class_id))

        with unit_of_work(self.db, conflict_detail="用户名已存在"):
            pass  # flush + add already done; UOW wraps the commit
```
Actually: the existing code does `self.db.add(user); self.db.flush(); ...; self.db.add(UserClass(...)); self.db.commit()`. The simplest fix: replace `self.db.commit()` with `with unit_of_work(self.db, conflict_detail="用户名已存在"): pass` (the `with` block triggers commit on exit). The existing `self.db.add()` / `self.db.flush()` stay. Ensure `unit_of_work` is already imported (check the file's imports — it may already be imported; if not add `from core.unit_of_work import unit_of_work`). Also raise ConflictError("用户名已存在") before UOW is fine to keep — unique constraint is the backstop for the race window.

- [ ] **Step 4: Run test to confirm 409**

Run: `cd backend; uv run python -m pytest tests/auth/test_auth.py::test_register_duplicate_username_returns_409 -x -q`
Expected: PASS

- [ ] **Step 5: Ruff + Commit**

```bash
cd backend; uv run ruff check services/auth.py tests/auth/
git add backend/services/auth.py backend/tests/auth/test_auth.py
git commit -m "🐛 fix: register() 包裹 unit_of_work 避免并发注册返回 500"
```

### Task 1b: `wechat_bind()` 包裹 UOW

**Files:** Modify `backend/services/auth.py:167-185`

- [ ] **Step 1: 包裹 commit**

Replace line 185 `self.db.commit()` with:
```python
        current_user.wechat_openid = openid
        with unit_of_work(self.db, conflict_detail="此微信已被绑定"):
            pass
```
The openid check at line 180 remains but is now backed by DB unique constraint via UOW.

- [ ] **Step 2: Commit**

```bash
git add backend/services/auth.py
git commit -m "🐛 fix: wechat_bind() 包裹 unit_of_work 防并发绑定"
```

### Task 1c: `wechat_register()` 包裹 UOW

**Files:** Modify `backend/services/auth.py:189-226`

- [ ] **Step 1: 包裹 commit**

Replace line 222 `self.db.commit()` with:
```python
        self.db.add(user)
        with unit_of_work(self.db, conflict_detail="此微信已注册"):
            pass
```
Openid check at line 199 remains. Username uniqueness is handled by the while-loop (which generates a unique name pre-commit) — but the UOW backs it.

- [ ] **Step 2: Commit**

```bash
git add backend/services/auth.py
git commit -m "🐛 fix: wechat_register() 包裹 unit_of_work 防并发注册"
```

### Task 1d: `batch_create()` 统一 UOW

**Files:** Modify `backend/services/user.py:99-133`

- [ ] **Step 1: 移除分批 commit，改用一次 UOW**

Replace the `for` loop body that has `if created % 50 == 0: self.db.commit()` (line 131-132) and the final `self.db.commit()` (line 133) by wrapping the entire batch create in a single UOW block. The per-row username check (line 99) stays to skip duplicates early (avoids IntegrityError during the loop), but the final `with unit_of_work(self.db, conflict_detail="批量建用户冲突"):` replaces the commit pattern. Specifically: remove lines 131-132 and change line 133:
```python
        # remove: if created % 50 == 0: self.db.commit()
        with unit_of_work(self.db, conflict_detail="批量建用户冲突"):
            pass  # all db.add() already done; commit on exit
```
Don't put the whole for-loop inside unit_of_work (it would hold the transaction open too long) — just the final commit. But note: `self.db.flush()` inside the loop (line 127) already pushes to DB; the commit makes it durable. The existing per-row username check already guards against same-batch duplicates. The UOW only protects against concurrent batch imports.

- [ ] **Step 2: 验证 ruff + 既有 tests**

Run: `cd backend; uv run ruff check services/user.py; uv run python -m pytest tests/ -x -q -k "test_batch" 2>&1 | Select -Last 3`
Expected: ruff clean. If no existing batch test, that's fine.

- [ ] **Step 3: Commit**

```bash
git add backend/services/user.py
git commit -m "🐛 fix: batch_create() 包裹 unit_of_work 防并发批量创建冲突"
```

---

## Task 2: T1-3 export 行数限制

**Files:** Modify `backend/core/config.py`, `backend/infrastructure/exporter.py`, `backend/routers/feedback.py`, `backend/routers/admin/users.py`

- [ ] **Step 1: 定义 MAX_EXPORT_ROWS**

In `backend/core/config.py`, add after the existing scoring config block (~line 115):
```python
MAX_EXPORT_ROWS = int(os.getenv("MAX_EXPORT_ROWS", "20000"))
```

- [ ] **Step 2: export_response 加行数门禁**

In `backend/infrastructure/exporter.py`, add at the top of `export_response()`:
```python
from core.config import MAX_EXPORT_ROWS
from fastapi import HTTPException

def export_response(...):
    if len(items) > MAX_EXPORT_ROWS:
        raise HTTPException(status_code=400, detail=f"单次导出最多 {MAX_EXPORT_ROWS} 行")
    ...  # existing body
```
Check existing imports — add `from fastapi import HTTPException` if not already imported.

- [ ] **Step 3: feedback export 加切片**

`backend/routers/feedback.py` line 74:
```python
    fb = db.query(Feedback).order_by(Feedback.created_at.desc()).all()
```
Change to:
```python
    from core.config import MAX_EXPORT_ROWS
    fb = db.query(Feedback).order_by(Feedback.created_at.desc()).limit(MAX_EXPORT_ROWS + 1).all()
```
The `+1` triggers the 400 if at boundary, so the caller gets a clear error instead of silent truncation.

- [ ] **Step 4: users export 加切片**

`backend/routers/admin/users.py` line 103 (the `.all()` call). Read to confirm exact line. Change to:
```python
    from core.config import MAX_EXPORT_ROWS
    users = db.query(User).order_by(...).limit(MAX_EXPORT_ROWS + 1).all()
```

- [ ] **Step 5: Ruff + related tests**

Run: `cd backend; uv run ruff check infrastructure/exporter.py routers/feedback.py routers/admin/users.py core/config.py; uv run python -m pytest tests/ -x -q -k "export" 2>&1 | Select -Last 3`
Expected: clean

- [ ] **Step 6: Commit**

```bash
git add backend/core/config.py backend/infrastructure/exporter.py backend/routers/feedback.py backend/routers/admin/users.py
git commit -m "🐛 fix: export 端点加 MAX_EXPORT_ROWS 行数限制防 DoS"
```

---

## Task 3: T1-6 前端监听器卸载泄漏

### Task 3a: InitiativeBar interval cleanup

**Files:** Modify `frontend/src/components/training/InitiativeBar.tsx`

- [ ] **Step 1: 加 unmount cleanup**

The current component has no cleanup on unmount. `stopTicker` already exists (around line 24). Add a `useEffect` at the top of the component (after all hooks but before any logic effects) that runs stopTicker on unmount:
```typescript
	useEffect(() => {
		return () => stopTicker();
	}, [stopTicker]);
```
(`stopTicker` has stable deps `[]` so it's safe in the dep array.)

- [ ] **Step 2: tsc + biome**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/training/InitiativeBar.tsx`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/training/InitiativeBar.tsx
git commit -m "🐛 fix: InitiativeBar unmount 时清理 setInterval"
```

### Task 3b: SceneRenderer drag listener cleanup

**Files:** Modify `frontend/src/components/training/SceneRenderer.tsx`

- [ ] **Step 1: 读当前 drag 逻辑**

Read `SceneRenderer.tsx` lines 50-70 to confirm the `onMove`/`onUp` listener registration pattern.

The fix: add a `useRef<() => void>()` that stores a cleanup function, called in a `useEffect` return on unmount. In `onMouseDown` (where listeners are added), update the ref. In `onUp` (where they are removed), null the ref. In `useEffect(() => () => cleanupRef.current?.(), [])`, run the cleanup on unmount or activeCard change.

Precise implementation (adapt to actual variable names):
```tsx
const dragCleanupRef = useRef<(() => void) | null>(null);

useEffect(() => {
  return () => dragCleanupRef.current?.();
}, []);

// Inside onMouseDown, after adding listeners:
dragCleanupRef.current = () => {
  document.removeEventListener("mousemove", onMove);
  document.removeEventListener("mouseup", onUp);
};

// Inside onUp, after removing listeners:
dragCleanupRef.current = null;
```

- [ ] **Step 2: tsc + biome**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/components/training/SceneRenderer.tsx`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/training/SceneRenderer.tsx
git commit -m "🐛 fix: SceneRenderer drag 监听器 unmount 时清理"
```

---

## Task 4: T1-8 authStore 网络误登出

**Files:** Modify `frontend/src/stores/authStore.ts` (lines 86-96, 146-154)

- [ ] **Step 1: 读 authStore 检查现有代码与导入**

Read the file to confirm current state. Check if `axios` (or `isAxiosError`) is already imported. It should be since the file imports from `@/api`.

- [ ] **Step 2: 修改 refreshAuth catch 守卫**

Replace lines 91-95 (the catch block):
```typescript
			} catch {
				console.warn("[authStore] refreshAuth 失败 — 另一标签页可能已刷新令牌");
				stopRefreshTimer();
				set({ user: null, token: null, permissions: [] });
				return false;
			}
```
with:
```typescript
			} catch (err: unknown) {
				const is401 = (err && typeof err === "object" && "response" in err &&
					(err as { response?: { status?: number } }).response?.status === 401);
				if (is401) {
					console.warn("[authStore] refreshAuth 401 — 清除会话");
					stopRefreshTimer();
					set({ user: null, token: null, permissions: [] });
				} else {
					console.warn("[authStore] refreshAuth 网络/服务端错误 — 保持现有会话", err);
				}
				return false;
			}
```

- [ ] **Step 3: 移除 onRehydrateStorage 的强制 refreshAuth**

In `onRehydrateStorage` (lines 146-154), the current code:
```typescript
			onRehydrateStorage: () => {
				return (state) => {
					if (!state?.token) return;
					startRefreshTimer();
					if (state.user) {
						useAuthStore.getState().refreshAuth().catch(() => {});
					}
				};
			},
```
Remove the `if (state.user) { ... }` block (lines 150-152). The `startRefreshTimer()` call stays for periodic refresh. The first API call will trigger 401 interceptor if needed.
```typescript
			onRehydrateStorage: () => {
				return (state) => {
					if (!state?.token) return;
					startRefreshTimer();
				};
			},
```

- [ ] **Step 4: tsc + biome + 既有测试**

Run: `cd frontend; npx tsc --noEmit; npx biome check src/stores/authStore.ts; npx vitest run src/__tests__/authStore.test.ts`
Expected: tsc clean, biome clean, authStore tests pass

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/authStore.ts
git commit -m "🐛 fix: refreshAuth 仅 401 清会话，onRehydrateStorage 不强制刷新"
```

---

## 阶段收尾 Checkpoint

- [ ] **后端**: `cd backend; uv run ruff check; uv run ty check; uv run python -m pytest -x -q`
- [ ] **前端**: `cd frontend; npx tsc --noEmit; npx biome check; npx vitest run src/__tests__/`
- [ ] 全绿后汇报 Tier 1a 完成，继续 Tier 1b

---

## Self-Review

- Spec 覆盖：T1-1→Task 1a-1d；T1-3→Task 2；T1-6→Task 3a-3b；T1-8→Task 4。
- 无占位符/TODO。每个步骤含完整代码。
- 签名一致：unit_of_work 从现有文件导入；MAX_EXPORT_ROWS 从 config 导入；前端变量名需读文件确认后微调（已标注"adapt to actual"）。
- 后续 Tier 1b 任务简单（3 项一行改动），可合并入 checkpoint 直接修或另立 mini-plan。
