# Admin UX Polish — Design Spec

Date: 2026-06-05

## Scope

Unify interaction patterns across all admin management pages: delete confirmation, empty states, search/filter, sidebar, loading states, and form behavior.

## 1. Delete Confirmation Unification

Replace all `window.confirm()` calls with `useConfirm()` hook to match UsersTab/History pattern.

**Files:**
- `frontend/src/pages/admin/SchoolsPage.tsx` — `window.confirm()` → `useConfirm()`
- `frontend/src/pages/admin/RolesPage.tsx` — `window.confirm()` → `useConfirm()`
- `frontend/src/pages/admin/GradesClassesPage.tsx` — prop-based `ConfirmDialog` → `useConfirm()` hook

**Pattern:**
```tsx
const { confirm } = useConfirm();
const ok = await confirm({
  title: "删除学校",
  message: `确定要删除学校「${schoolName}」？此操作不可恢复。`,
});
if (!ok) return;
```

## 2. Empty States

Add `EmptyState` component (already exists in project) to pages that render empty `<tbody>` with no feedback.

| Page | Icon | Title | Description |
|------|------|-------|-------------|
| `UsersTab` | `Users` | 暂无用户 | 注册第一个用户后这里会显示 |
| `SchoolsPage` | `Building2` | 暂无学校 | 创建第一个学校后这里会显示 |
| `RolesPage` | `Shield` | 暂无角色 | 创建第一个角色后这里会显示 |
| `GradesClassesPage` | `GraduationCap` | 暂无年级/班级 | 创建第一个年级后这里会显示 |

Condition: shown when `items.length === 0` and not loading.

## 3. Search / Filter

Add name search + pagination to pages missing it.

| Page | Search | Pagination | Backend support |
|------|--------|------------|-----------------|
| `SchoolsPage` | school name (debounced 200ms) | limit 50 offset | API has `search` + pagination params |
| `RolesPage` | role display_name (debounced 200ms) | — roles usually few | Backend roles API needs `search` param added |
| `GradesClassesPage` | grade/class name (debounced 200ms) | — grades/classes usually few | Zustand store handles filtering client-side |
| `QARecordsTab` | student name | — | Backend API may need `search` param |

Implementation: search input in toolbar above table, matching UsersTab pattern.

**Backend change:** `GET /api/admin/roles` add optional `search` query parameter.

## 4. Sidebar Optimization

### 4a. Role display name
Store `role_display_name` in authStore during login (backend `/me` already returns it), display it in sidebar instead of raw `role` string.

```tsx
// Before: {user?.role || "用户"}
// After: {user?.role_display_name || user?.role || "用户"}
```

Files: `frontend/src/stores/authStore.ts` (add field), `frontend/src/components/Layout.tsx` (use it).

### 4b. Icon deduplication
- Schools page icon: `Building2` (was `GraduationCap`)
- Grades/classes icon: `GraduationCap` (unchanged)

Import `Building2` from `lucide-react`.

### 4c. Section separator
Add a thin separator line with "管理" label between user-facing links and admin links:

```
首页
病例训练
训练记录
护理问答
训练统计
—— 管理 ——
用户管理
角色管理
学校管理
班级管理
病例管理
训练管理
LLM 管理
用户反馈
```

Implementation: insert a `Separator` + small muted label between the two link groups in `allLinks`.

## 5. Form Behavior

### 5a. Modal form reset on close
`SchoolsPage`, `RolesPage`, `GradesClassesPage` — clear form state when modal closes.

```tsx
const handleCloseCreate = () => {
  setName(""); setAdminUsername(""); setAdminPassword(""); setAdminDisplayName("");
  setShowCreate(false);
};
```

### 5b. Unsaved edit protection (RolesPage)
When user is editing role A's permissions and clicks "编辑权限" on role B, show confirmation:

```tsx
const startEdit = (role: RoleItem) => {
  if (editId !== null && editId !== role.id) {
    if (!window.confirm("放弃当前编辑的修改？")) return;
  }
  setEditId(role.id);
  setEditPerms([...role.permissions]);
};
```

Note: keep `window.confirm` here as it's a guard, not a delete action. Replace with `useConfirm` later if desired.

### 5c. Loading states for list pages
Add loading indicator during data fetch:

| Page | Method |
|------|--------|
| `UsersTab` | `useState` loading flag + spinner overlay |
| `SchoolsPage` | `useState` loading flag + spinner overlay |
| `RolesPage` | `useState` loading flag + spinner overlay |
| `GradesClassesPage` | Zustand store already has data; add loading state to store |
| `QARecordsTab` | Already has loading state |

A simple centered `<div className="flex justify-center py-12"><Loader2 className="animate-spin" /></div>` in place of the table when `loading && items.length === 0`.

## 6. Side Effect — Backend

`backend/routers/admin_roles.py` `list_roles` endpoint: add `search: str = Query(default="")` parameter, filter by `Role.display_name.ilike(f"%{search}%")`.

## Files Changed

| File | Changes |
|------|---------|
| `frontend/src/pages/admin/SchoolsPage.tsx` | confirm dialog, empty state, search, pagination, form reset |
| `frontend/src/pages/admin/RolesPage.tsx` | confirm dialog, empty state, search, form reset, unsaved guard |
| `frontend/src/pages/admin/GradesClassesPage.tsx` | confirm dialog, empty state, search, form reset |
| `frontend/src/components/teacher/UsersTab.tsx` | empty state, loading state |
| `frontend/src/components/teacher/QARecordsTab.tsx` | search by student name |
| `frontend/src/components/Layout.tsx` | icon swap, section separator, role display |
| `frontend/src/stores/authStore.ts` | add `role_display_name` field |
| `frontend/src/pages/Login.tsx` | persist `role_display_name` on login |
| `backend/routers/admin_roles.py` | add `search` param to list endpoint |

## Out of Scope

- Loading skeletons (complex per-component; simple spinner suffices)
- Bulk operations (separate feature)
- Sortable columns (separate feature)
- Undo/soft-delete (separate feature)
- Mobile-specific responsive improvements
- History/Stats role-based gating (already done in refactor)
