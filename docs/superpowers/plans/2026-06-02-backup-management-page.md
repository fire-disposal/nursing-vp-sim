# Backup Management Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backup management page (`/admin/backup`) to the teacher admin panel with a manual database backup download button.

**Architecture:** Frontend-only addition. Reuses existing `POST /api/admin/backup` endpoint. Follows the established admin page pattern: route → page → tab component, with sidebar nav link.

**Tech Stack:** React 19, React Router 7, Axios, Lucide React icons

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `frontend/src/api.js` | Modify | Add `downloadBackup()` function |
| `frontend/src/components/teacher/BackupTab.jsx` | Create | Download button with loading/error states |
| `frontend/src/pages/admin/BackupPage.jsx` | Create | Page wrapper: Layout + PageHeader + BackupTab |
| `frontend/src/App.jsx` | Modify | Add lazy route for `/admin/backup` |
| `frontend/src/components/AppShell.jsx` | Modify | Add sidebar nav link "备份管理" |

---

### Task 1: Add `downloadBackup` API function

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add `downloadBackup` to api.js**

Add the following function at the end of `frontend/src/api.js`, before the final blank line:

```js
// ── 备份管理 ──

export function downloadBackup() {
  return api.post("/admin/backup", null, { responseType: "blob" });
}
```

The function sends `null` as the request body (backend expects an empty POST) and sets `responseType: "blob"` to receive the zip file as binary data — the same pattern used by `exportRecords()` and `exportLLMLogs()`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "✨ feat: add downloadBackup API function"
```

---

### Task 2: Create `BackupTab` component

**Files:**
- Create: `frontend/src/components/teacher/BackupTab.jsx`

- [ ] **Step 1: Create BackupTab.jsx**

Create `frontend/src/components/teacher/BackupTab.jsx`:

```jsx
import { Database, DownloadCloud } from "lucide-react";
import { useState } from "react";
import { downloadBackup } from "../../api";
import { useToast } from "../Toast";

export default function BackupTab() {
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const response = await downloadBackup();

      const contentDisposition = response.headers["content-disposition"];
      let filename = "backup.zip";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (match) filename = match[1];
      }

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      toast.success("备份下载成功");
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "未知错误";
      toast.error(`备份下载失败: ${msg}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="card">
      <div className="empty-state" style={{ padding: "var(--space-12) 0" }}>
        <div className="icon">
          <Database size={48} />
        </div>
        <div style={{ fontSize: "var(--font-size-base)", fontWeight: "var(--font-weight-semibold)", marginTop: "var(--space-3)" }}>
          下载数据库备份
        </div>
        <div style={{ fontSize: "var(--font-size-sm)", color: "var(--text-secondary)", marginTop: "var(--space-1)", maxWidth: 380, lineHeight: 1.5 }}>
          使用 pg_dump 导出完整数据库，生成 .zip 压缩包下载到本地。可用于数据安全备份或迁移。
        </div>
        <button
          className="btn btn-primary"
          onClick={handleDownload}
          disabled={downloading}
          style={{ marginTop: "var(--space-4)", display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}
        >
          {downloading ? (
            <>
              <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
              正在导出备份...
            </>
          ) : (
            <>
              <DownloadCloud size={16} />
              下载数据库备份
            </>
          )}
        </button>
      </div>
    </div>
  );
}
```

Design rationale:
- Uses `empty-state` styling for centered, minimal layout (matching existing empty state patterns)
- Extracts filename from `Content-Disposition` header so the downloaded file matches the server-generated name (`nursing_backup_{timestamp}.zip`)
- Shows a spinner inline on the button during download (matching the `LoadingState` spinner class)
- Uses `useToast` for success/error feedback (same as FeedbackTab and other components)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/teacher/BackupTab.jsx
git commit -m "✨ feat: add BackupTab component"
```

---

### Task 3: Create `BackupPage` page

**Files:**
- Create: `frontend/src/pages/admin/BackupPage.jsx`

- [ ] **Step 1: Create BackupPage.jsx**

Create `frontend/src/pages/admin/BackupPage.jsx`:

```jsx
import { Database } from "lucide-react";
import Layout from "../../components/Layout";
import BackupTab from "../../components/teacher/BackupTab";
import PageHeader from "../../components/ui/PageHeader";

export default function BackupPage({ user, onLogout }) {
  return (
    <Layout user={user} onLogout={onLogout}>
      <PageHeader
        title="备份管理"
        subtitle="下载数据库备份文件，用于数据安全与迁移"
        icon={Database}
      />
      <BackupTab />
    </Layout>
  );
}
```

This follows the exact pattern of `FeedbackPage.jsx`: `Layout` → `PageHeader` with icon/title/subtitle → tab component.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/admin/BackupPage.jsx
git commit -m "✨ feat: add BackupPage route page"
```

---

### Task 4: Add route and sidebar link

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/AppShell.jsx`

- [ ] **Step 1: Add lazy import in App.jsx**

In `frontend/src/App.jsx`, after line 22 (`const GradesClassesPage = ...`), add:

```jsx
const BackupPage = lazy(() => import("./pages/admin/BackupPage"));
```

- [ ] **Step 2: Add route in App.jsx**

In `frontend/src/App.jsx`, after the `/admin/feedback` route block (lines 203-210), add:

```jsx
                  <Route
                    path="/admin/backup"
                    element={
                      <ProtectedRoute role="teacher">
                        <BackupPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />
```

The complete insertion point looks like:

```jsx
                  <Route
                    path="/admin/feedback"
                    element={
                      <ProtectedRoute role="teacher">
                        <FeedbackPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route
                    path="/admin/backup"
                    element={
                      <ProtectedRoute role="teacher">
                        <BackupPage user={user} onLogout={handleLogout} />
                      </ProtectedRoute>
                    }
                  />

                  <Route path="*" element={<Navigate to="/login" replace />} />
```

- [ ] **Step 3: Add sidebar link in AppShell.jsx**

In `frontend/src/components/AppShell.jsx`, first add `HardDrive` to the lucide-react imports on line 3. Change:

```jsx
import {
  BarChart3,
  ClipboardList,
  GraduationCap,
  HelpCircle,
  Home,
  Info,
  Menu,
  MessageSquare,
  Server,
  Settings,
  Stethoscope,
  UserSearch,
  Users,
  X,
} from "lucide-react";
```

to:

```jsx
import {
  BarChart3,
  ClipboardList,
  GraduationCap,
  HardDrive,
  HelpCircle,
  Home,
  Info,
  Menu,
  MessageSquare,
  Server,
  Settings,
  Stethoscope,
  UserSearch,
  Users,
  X,
} from "lucide-react";
```

Then, in the `teacherLinks` array (after line 41), add:

```jsx
  { to: "/admin/backup", icon: HardDrive, label: "备份管理" },
```

The complete `teacherLinks` array should become:

```jsx
const teacherLinks = [
  { to: "/home", icon: Home, label: "首页" },
  { to: "/history", icon: ClipboardList, label: "训练记录" },
  { to: "/qa", icon: HelpCircle, label: "护理问答" },
  { to: "/stats", icon: BarChart3, label: "训练统计" },
  { to: "/admin", icon: Settings, label: "训练管理" },
  { to: "/admin/users", icon: Users, label: "用户管理" },
  { to: "/admin/grades-classes", icon: GraduationCap, label: "班级管理" },
  { to: "/admin/cases", icon: UserSearch, label: "病例管理" },
  { to: "/admin/llm", icon: Server, label: "LLM 管理" },
  { to: "/admin/feedback", icon: MessageSquare, label: "用户反馈" },
  { to: "/admin/backup", icon: HardDrive, label: "备份管理" },
];
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/AppShell.jsx
git commit -m "✨ feat: add backup page route and sidebar link"
```

---

### Task 5: Verify

**Files:** None (verification only)

- [ ] **Step 1: Run lint check**

```bash
npx biome check frontend/src/ --max-diagnostics none
```

Expected: No errors or warnings in the modified/new files.

- [ ] **Step 2: Start dev server and verify navigation**

```bash
# Start backend (if not running)
# Start frontend: npm run dev
# Navigate to http://localhost:5173/admin/backup
# Verify:
#   - Sidebar shows "备份管理" link with HardDrive icon
#   - Page renders with "备份管理" title and download button
#   - Clicking download triggers file download
#   - Toast shows success/error message
```
