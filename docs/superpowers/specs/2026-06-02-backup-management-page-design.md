# Backup Management Page Design

## Overview

Add a backup management page (`/admin/backup`) to the teacher admin panel, providing manual database backup download via `pg_dump`. Backend API already exists; this is a frontend-only addition.

## Scope

- Manual backup download only (single button)
- No backup history, restore, or scheduling in this iteration

## Backend

No changes required. `POST /api/admin/backup` (`backend/routers/admin.py:297`) is already implemented:
- Runs `pg_dump` against the configured PostgreSQL database
- Zips the `.sql` dump
- Returns `FileResponse` (zip download)
- Cleans up temp files after 5 seconds

## Frontend Design

### Route

```
/admin/backup  →  BackupPage  (ProtectedRoute role="teacher")
```

### Files

| File | Change | Description |
|------|--------|-------------|
| `frontend/src/App.jsx` | Edit | Add lazy route for `/admin/backup` |
| `frontend/src/components/AppShell.jsx` | Edit | Add sidebar nav link "备份管理" |
| `frontend/src/api.js` | Edit | Add `downloadBackup()` API function |
| `frontend/src/pages/admin/BackupPage.jsx` | New | Page wrapper: Layout + PageHeader + BackupTab |
| `frontend/src/components/teacher/BackupTab.jsx` | New | Download button with loading/error states |

### Component Tree

```
BackupPage
  ├── Layout (shared sidebar + logout)
  │     └── AppShell
  ├── PageHeader
  │     ├── icon: Database (lucide-react)
  │     ├── title: "备份管理"
  │     └── subtitle: "下载数据库备份文件，用于数据安全与迁移"
  └── BackupTab
        ├── Info card: explains what backup does
        ├── Download button: "下载数据库备份" with DownloadCloud icon
        ├── Loading spinner during download
        └── Toast notification on success/error
```

### API Function

```js
// api.js
export async function downloadBackup() {
  const response = await api.post('/admin/backup', {}, { responseType: 'blob' })
  const url = window.URL.createObjectURL(new Blob([response.data]))
  const link = document.createElement('a')
  link.href = url
  link.setAttribute('download', `backup-${new Date().toISOString().slice(0,10)}.zip`)
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}
```

### Sidebar Link

Added under existing teacher links, after "用户反馈":
- Icon: `HardDrive` (lucide-react)
- Label: "备份管理"
- Path: `/admin/backup`

### States

| State | UI |
|-------|-----|
| Idle | Button visible, no spinner |
| Loading | Button disabled, spinner shown, "正在导出备份..." |
| Success | Toast: "备份下载成功" |
| Error | Toast: "备份下载失败: {message}" |
