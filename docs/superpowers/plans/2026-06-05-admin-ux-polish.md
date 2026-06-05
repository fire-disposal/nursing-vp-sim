# Admin UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify interaction patterns across admin pages — delete confirmations, empty states, search/filter, sidebar, form behavior, and loading states.

**Architecture:** Surface-level UI polish. No new backend routes. One minor backend change (search param on roles endpoint). All changes follow existing patterns already used in UsersTab/History.

**Tech Stack:** React + TypeScript, Zustand, React Query, lucide-react, shadcn/ui components, FastAPI (Python)

---

### Task 1: Delete Confirmation — SchoolsPage

**Files:**
- Modify: `frontend/src/pages/admin/SchoolsPage.tsx`

- [ ] **Step 1: Add `useConfirm` import and replace `window.confirm`**

Replace the `handleDelete` function:

```tsx
// Add to imports:
import { useConfirm } from "@/components/ui/ConfirmDialog";

// In component body, add:
const { confirm } = useConfirm();

// Replace handleDelete:
const handleDelete = async (id: number, schoolName: string) => {
  const ok = await confirm({
    title: "删除学校",
    message: `确定要删除学校「${schoolName}」？此操作不可恢复。`,
  });
  if (!ok) return;
  try {
    await api.delete(`/admin/schools/${id}`);
    toast.success("学校已删除");
    loadSchools();
  } catch (e: any) {
    toast.error(e?.response?.data?.detail || "删除失败");
  }
};
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/SchoolsPage.tsx
git commit -m "♻️ refactor: SchoolsPage delete confirm uses useConfirm hook"
```

---

### Task 2: Delete Confirmation — RolesPage

**Files:**
- Modify: `frontend/src/pages/admin/RolesPage.tsx`

- [ ] **Step 1: Add `useConfirm` and replace `window.confirm`**

```tsx
// Add to imports:
import { useConfirm } from "@/components/ui/ConfirmDialog";

// In component body, add:
const { confirm } = useConfirm();

// Replace handleDelete:
const handleDelete = async (id: number, name: string) => {
  const ok = await confirm({
    title: "删除角色",
    message: `确定要删除角色「${name}」？`,
  });
  if (!ok) return;
  try {
    await api.delete(`/admin/roles/${id}`);
    toast.success("角色已删除");
    loadRoles();
  } catch (e: any) {
    toast.error(e?.response?.data?.detail || "删除失败");
  }
};
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/RolesPage.tsx
git commit -m "♻️ refactor: RolesPage delete confirm uses useConfirm hook"
```

---

### Task 3: Delete Confirmation — GradesClassesPage

**Files:**
- Modify: `frontend/src/pages/admin/GradesClassesPage.tsx`

- [ ] **Step 1: Read file to find `ConfirmDialog` prop-based usage**

Read `frontend/src/pages/admin/GradesClassesPage.tsx` to find the existing `<ConfirmDialog>` component usage and `handleDelete` functions.

- [ ] **Step 2: Replace prop-based ConfirmDialog with useConfirm hook**

Remove the `open`, `onConfirm`, `onCancel` state and children-based `ConfirmDialog`. Replace with:

```tsx
// Add import:
import { useConfirm } from "@/components/ui/ConfirmDialog";

// In component, add:
const { confirm } = useConfirm();

// Replace handleDelete calls:
const handleDeleteGrade = async (id: number, name: string) => {
  const ok = await confirm({
    title: "删除年级",
    message: `确定要删除年级「${name}」？相关班级也会被删除。`,
  });
  if (!ok) return;
  // ... existing delete logic
};

const handleDeleteClass = async (id: number, name: string) => {
  const ok = await confirm({
    title: "删除班级",
    message: `确定要删除班级「${name}」？`,
  });
  if (!ok) return;
  // ... existing delete logic
};
```

- [ ] **Step 3: Remove old ConfirmDialog JSX and state variables**

Remove `<ConfirmDialog>` from JSX and associated `useState` like `confirmOpen`, `confirmTitle`, etc.

- [ ] **Step 4: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/GradesClassesPage.tsx
git commit -m "♻️ refactor: GradesClassesPage delete confirm uses useConfirm hook"
```

---

### Task 4: Empty State — UsersTab

**Files:**
- Modify: `frontend/src/components/teacher/UsersTab.tsx`

- [ ] **Step 1: Add EmptyState import and render condition**

```tsx
// Add import:
import EmptyState from "@/components/ui/EmptyState";

// Before the table, wrap with conditional:
{!loading && users.length === 0 ? (
  <EmptyState icon={Users} title="暂无用户" description="注册第一个用户后这里会显示" />
) : (
  // ... existing table JSX
  <div className="overflow-x-auto">
    <table>...</table>
  </div>
)}
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/UsersTab.tsx
git commit -m "✨ feat: add empty state to UsersTab"
```

---

### Task 5: Empty State — SchoolsPage

**Files:**
- Modify: `frontend/src/pages/admin/SchoolsPage.tsx`

- [ ] **Step 1: Add EmptyState**

```tsx
// Add imports:
import EmptyState from "@/components/ui/EmptyState";
import { Building2 } from "lucide-react";

// Add loading state:
const [loading, setLoading] = useState(true);

// In loadSchools, set loading true at start, false after:
const loadSchools = async () => {
  setLoading(true);
  try {
    const { data } = await api.get("/admin/schools", { params: { limit: 100 } });
    setSchools(data.items || []);
  } catch { /* ignore */ }
  finally { setLoading(false); }
};

// Before table:
{!loading && schools.length === 0 ? (
  <EmptyState icon={Building2} title="暂无学校" description="创建第一个学校后这里会显示" />
) : (
  // ... existing table JSX
)}
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/SchoolsPage.tsx
git commit -m "✨ feat: add empty state and loading to SchoolsPage"
```

---

### Task 6: Empty State — RolesPage

**Files:**
- Modify: `frontend/src/pages/admin/RolesPage.tsx`

- [ ] **Step 1: Add EmptyState**

```tsx
// Add imports:
import EmptyState from "@/components/ui/EmptyState";
import { Shield } from "lucide-react";

// Add loading state:
const [loading, setLoading] = useState(true);

// In loadRoles:
const loadRoles = async () => {
  setLoading(true);
  try {
    const { data } = await api.get("/admin/roles");
    setRoles(data || []);
  } catch { toast.error("加载角色列表失败"); }
  finally { setLoading(false); }
};

// Before role cards:
{!loading && roles.length === 0 ? (
  <EmptyState icon={Shield} title="暂无角色" description="创建第一个角色后这里会显示" />
) : (
  // ... existing cards JSX
)}
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/RolesPage.tsx
git commit -m "✨ feat: add empty state and loading to RolesPage"
```

---

### Task 7: Empty State — GradesClassesPage

**Files:**
- Modify: `frontend/src/pages/admin/GradesClassesPage.tsx`

- [ ] **Step 1: Add EmptyState for grades and classes tables**

```tsx
// Add import:
import EmptyState from "@/components/ui/EmptyState";
import { GraduationCap } from "lucide-react";

// In grades tab:
{!loading && grades.length === 0 ? (
  <EmptyState icon={GraduationCap} title="暂无年级" description="创建第一个年级后这里会显示" />
) : (
  // ... grades table
)}

// In classes tab:
{!loading && classes.length === 0 ? (
  <EmptyState icon={GraduationCap} title="暂无班级" description="创建第一个班级后这里会显示" />
) : (
  // ... classes table
)}
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/GradesClassesPage.tsx
git commit -m "✨ feat: add empty states to GradesClassesPage"
```

---

### Task 8: Search + Pagination — SchoolsPage

**Files:**
- Modify: `frontend/src/pages/admin/SchoolsPage.tsx`

- [ ] **Step 1: Add search state and debounce**

```tsx
// Add imports:
import { Search } from "lucide-react";
import Pagination from "@/components/ui/Pagination";

// Add state:
const [search, setSearch] = useState("");
const [searchInput, setSearchInput] = useState("");
const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);
const [offset, setOffset] = useState(0);
const [total, setTotal] = useState(0);
const LIMIT = 50;

// Debounced search:
const handleSearchChange = (value: string) => {
  setSearchInput(value);
  if (searchTimer.current) clearTimeout(searchTimer.current);
  searchTimer.current = setTimeout(() => {
    setSearch(value);
    setOffset(0);
  }, 200);
};

// Update loadSchools with search + pagination:
const loadSchools = async () => {
  setLoading(true);
  try {
    const { data } = await api.get("/admin/schools", { params: { search: search || undefined, limit: LIMIT, offset } });
    setSchools(data.items || []);
    setTotal(data.total || 0);
  } catch { /* ignore */ }
  finally { setLoading(false); }
};

// Subscribe to search + offset changes:
useEffect(() => { loadSchools(); }, [search, offset]);
```

- [ ] **Step 2: Add search UI and pagination in JSX**

```tsx
// Above the table, add toolbar:
<div className="flex items-center gap-3 mb-4">
  <div className="relative flex-1 max-w-xs">
    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    <input
      type="text"
      placeholder="搜索学校名称..."
      value={searchInput}
      onChange={(e) => handleSearchChange(e.target.value)}
      className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm"
    />
  </div>
  <Button onClick={() => setShowCreate(true)}>
    <Plus size={16} /> 新建学校
  </Button>
</div>

// After table, add pagination:
{total > LIMIT && (
  <div className="mt-4 flex justify-center">
    <Pagination offset={offset} limit={LIMIT} total={total} onPageChange={setOffset} />
  </div>
)}
```

- [ ] **Step 3: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/SchoolsPage.tsx
git commit -m "✨ feat: add search and pagination to SchoolsPage"
```

---

### Task 9: Search — RolesPage (Backend + Frontend)

**Files:**
- Modify: `backend/routers/admin_roles.py`
- Modify: `frontend/src/pages/admin/RolesPage.tsx`

- [ ] **Step 1: Add search param to backend roles endpoint**

Read `backend/routers/admin_roles.py`, find `list_roles` function, add:

```python
from fastapi import Query

@router.get("", response_model=list[RoleResponse])
def list_roles(
    search: Annotated[str, Query(default="")] = "",
    current_user: User = Depends(require_permission("role_manage")),
    db: Session = Depends(get_db),
):
    query = db.query(Role).filter(Role.school_id == current_user.school_id)
    if search:
        query = query.filter(Role.display_name.ilike(f"%{search}%"))
    roles = query.order_by(Role.id).all()
    # ... rest unchanged
```

- [ ] **Step 2: Add search UI to frontend RolesPage**

```tsx
// Add imports:
import { Search } from "lucide-react";

// Add state:
const [search, setSearch] = useState("");
const [searchInput, setSearchInput] = useState("");
const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);

// Debounced search:
const handleSearchChange = (value: string) => {
  setSearchInput(value);
  if (searchTimer.current) clearTimeout(searchTimer.current);
  searchTimer.current = setTimeout(() => setSearch(value), 200);
};

// Update loadRoles:
const loadRoles = async () => {
  setLoading(true);
  try {
    const { data } = await api.get("/admin/roles", { params: { search: search || undefined } });
    setRoles(data || []);
  } catch { toast.error("加载角色列表失败"); }
  finally { setLoading(false); }
};

useEffect(() => { loadRoles(); }, [search]);

// Add search input in JSX, above the title:
<div className="flex items-center justify-between mb-4">
  <div className="relative flex-1 max-w-xs">
    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
    <input
      type="text"
      placeholder="搜索角色..."
      value={searchInput}
      onChange={(e) => handleSearchChange(e.target.value)}
      className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm"
    />
  </div>
  <Button onClick={() => setShowCreate(true)}>
    <Plus size={16} /> 新建角色
  </Button>
</div>
```

- [ ] **Step 3: Verify**

Run: `cd frontend; npx tsc --noEmit` and `cd backend; python -m pytest tests/ -x --timeout=30 -q`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add backend/routers/admin_roles.py frontend/src/pages/admin/RolesPage.tsx
git commit -m "✨ feat: add search to RolesPage with backend support"
```

---

### Task 10: Search — GradesClassesPage

**Files:**
- Modify: `frontend/src/pages/admin/GradesClassesPage.tsx`
- Modify: Zustand store (locate the store file)

- [ ] **Step 1: Read the current GradesClassesPage and its Zustand store**

Read both files to understand the state management pattern and how grades/classes are loaded.

- [ ] **Step 2: Add client-side search filter**

```tsx
// Add imports:
import { Search } from "lucide-react";

// Add search state per tab:
const [gradeSearch, setGradeSearch] = useState("");
const [classSearch, setClassSearch] = useState("");

// Filter grades client-side:
const filteredGrades = grades.filter((g) =>
  !gradeSearch || g.name.toLowerCase().includes(gradeSearch.toLowerCase())
);

// Filter classes client-side:
const filteredClasses = classes.filter((c) =>
  !classSearch || c.name.toLowerCase().includes(classSearch.toLowerCase())
);

// Add search input in each tab's toolbar
```

- [ ] **Step 3: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/admin/GradesClassesPage.tsx
git commit -m "✨ feat: add client-side search to GradesClassesPage"
```

---

### Task 11: Search — QARecordsTab

**Files:**
- Modify: `frontend/src/components/teacher/QARecordsTab.tsx`

- [ ] **Step 1: Read file to find current structure**

Read the file to understand how data is loaded.

- [ ] **Step 2: Add student name search**

```tsx
// Add search state:
const [search, setSearch] = useState("");
const [searchInput, setSearchInput] = useState("");
const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);

// Debounced search:
const handleSearchChange = (value: string) => {
  setSearchInput(value);
  if (searchTimer.current) clearTimeout(searchTimer.current);
  searchTimer.current = setTimeout(() => setSearch(value), 200);
};

// Add search input to toolbar, and pass search to API params:
await api.get("/qa/history/all", { params: { search: search || undefined, ... } });

// Add search UI:
<div className="relative flex-1 max-w-xs">
  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
  <input
    type="text"
    placeholder="搜索学生姓名..."
    value={searchInput}
    onChange={(e) => handleSearchChange(e.target.value)}
    className="w-full pl-9 pr-3 py-2 border border-border rounded-lg text-sm"
  />
</div>
```

- [ ] **Step 3: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/teacher/QARecordsTab.tsx
git commit -m "✨ feat: add student name search to QARecordsTab"
```

---

### Task 12: Sidebar — Role Display Name

**Files:**
- Modify: `frontend/src/stores/authStore.ts`
- Modify: `frontend/src/types/store.ts`
- Modify: `frontend/src/pages/Login.tsx`
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Add role_display_name to authStore and UserStore type**

Read `frontend/src/types/store.ts`, find `UserStore` interface, add:

```ts
export interface UserStore {
  id: number;
  username: string;
  role: string;
  role_display_name: string;
  display_name: string | null;
  student_id: string | null;
  created_at: string;
}
```

Read `frontend/src/stores/authStore.ts`, find `login` function. After successful login, store `role_display_name` from response:

```ts
// In the login function where user is set:
const res = await login(username, password);
const { token, user } = res.data;
set({ user: { ...user, role_display_name: user.role_display_name || "" }, token });
localStorage.setItem("user", JSON.stringify({ ...user, role_display_name: user.role_display_name || "" }));
```

- [ ] **Step 2: Update Layout.tsx role display**

```tsx
// In Layout.tsx, change the role display line:
<div className="text-xs text-muted-foreground">
  {user?.role_display_name || user?.role || "用户"}
</div>
```

- [ ] **Step 3: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/stores/authStore.ts frontend/src/types/store.ts frontend/src/components/Layout.tsx
git commit -m "✨ feat: display role_display_name in sidebar instead of raw role"
```

---

### Task 13: Sidebar — Icons and Section Separator

**Files:**
- Modify: `frontend/src/components/Layout.tsx`

- [ ] **Step 1: Import Building2 and change school icon**

```tsx
// Add to imports:
import { ..., Building2 } from "lucide-react";

// Change schools link:
{ to: "/admin/schools", icon: Building2, label: "学校管理", permission: "school_manage" },
```

- [ ] **Step 2: Add section separator**

Insert between the user-facing links and admin links:

```tsx
// After the last user-facing link (stats), before admin links:
<div className="px-3 pt-2 pb-1">
  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
    管理
  </p>
</div>
```

- [ ] **Step 3: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/Layout.tsx
git commit -m "✨ feat: differentiate school icon, add admin section header in sidebar"
```

---

### Task 14: Form Reset on Modal Close

**Files:**
- Modify: `frontend/src/pages/admin/SchoolsPage.tsx`
- Modify: `frontend/src/pages/admin/RolesPage.tsx`
- Modify: `frontend/src/pages/admin/GradesClassesPage.tsx`

- [ ] **Step 1: SchoolsPage — reset form on close**

```tsx
// Replace the onClose handler of the create modal:
<Modal open={showCreate} onClose={() => {
  setName("");
  setAdminUsername("");
  setAdminPassword("");
  setAdminDisplayName("");
  setShowCreate(false);
}} title="新建学校">
```

- [ ] **Step 2: RolesPage — reset form on close**

```tsx
// Replace the onClose handler of the create modal:
<Modal open={showCreate} onClose={() => {
  setNewName("");
  setNewDisplayName("");
  setShowCreate(false);
}} title="新建角色">
```

- [ ] **Step 3: GradesClassesPage — reset form on close**

Read the current Modal component in the file. Reset edit fields in the onClose handler:

```tsx
<Modal open={modalOpen} onClose={() => {
  setName("");
  setModalOpen(false);
  setEditingId(null);
}} title="...">
```

- [ ] **Step 4: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin/SchoolsPage.tsx frontend/src/pages/admin/RolesPage.tsx frontend/src/pages/admin/GradesClassesPage.tsx
git commit -m "🐛 fix: reset form state on modal close across admin pages"
```

---

### Task 15: Unsaved Edit Guard — RolesPage

**Files:**
- Modify: `frontend/src/pages/admin/RolesPage.tsx`

- [ ] **Step 1: Add confirmation before switching edit target**

```tsx
const startEdit = (role: RoleItem) => {
  if (editId !== null && editId !== role.id) {
    if (!window.confirm("放弃当前编辑的修改？")) return;
  }
  setEditId(role.id);
  setEditPerms([...role.permissions]);
};
```

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/admin/RolesPage.tsx
git commit -m "✨ feat: add unsaved-edit confirmation to RolesPage"
```

---

### Task 16: Loading States

**Files:**
- Modify: `frontend/src/components/teacher/UsersTab.tsx`
- (SchoolsPage, RolesPage already have loading state from Tasks 5/6)

- [ ] **Step 1: Add loading state to UsersTab**

```tsx
// Add state:
const [loading, setLoading] = useState(true);

// In loadUsers, set loading:
const loadUsers = useCallback(async () => {
  setLoading(true);
  try {
    // ... existing fetch logic
  } finally {
    setLoading(false);
  }
}, [dependencies]);

// In JSX, show spinner on first load:
{loading && users.length === 0 ? (
  <div className="flex justify-center py-12">
    <Loader2 size={24} className="animate-spin text-muted-foreground" />
  </div>
) : users.length === 0 ? (
  <EmptyState ... />
) : (
  // ... table
)}
```

Add `Loader2` import from `lucide-react`.

- [ ] **Step 2: Verify**

Run: `cd frontend; npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/teacher/UsersTab.tsx
git commit -m "✨ feat: add loading spinner to UsersTab"
```

---

### Task 17: Final Verification and Deploy

- [ ] **Step 1: Run all tests**

```bash
cd frontend; npx tsc --noEmit
cd ../backend; python -m pytest tests/ -x --timeout=30 -q
```
Expected: All pass.

- [ ] **Step 2: Push and tag**

```bash
git push origin master
git tag v2026.06.05-6
git push origin v2026.06.05-6
```

