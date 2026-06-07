# 前端代码结构长期优化 实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 系统性地重构前端代码结构，消除巨型组件、拆分单体 API 文件、迁移到 react-router v7 Layout Routes、建立 Query Key Factory、统一状态管理分层，最大化长期可维护性。

**Architecture:** 五阶段渐进式重构。先建立基础设施（路由 + API 层 + cache 管理层），再分解巨型组件，然后 feature-first 目录重组，最后类型系统、a11y、测试加固。每阶段独立可测、可合。

**Tech Stack:** React 19, TypeScript 5.8 strict, Vite 8, react-router-dom v7.15, TanStack React Query 5.100, Zustand 5, shadcn/ui base-nova, Biome 2.4, Vitest 4.1

---

## Phase 1: 基础设施层

### Task 1.1: 创建 Query Key Factory

**Files:**
- Create: `frontend/src/api/query-keys.ts`

- [ ] **Step 1: 创建 Query Key Factory 文件**

写入 `frontend/src/api/query-keys.ts`:

```ts
export const queryKeys = {
  auth: {
    me: ["auth", "me"] as const,
  },
  cases: {
    all: ["cases"] as const,
    lists: () => [...queryKeys.cases.all, "list"] as const,
    list: (params: Record<string, unknown>) => [...queryKeys.cases.lists(), params] as const,
    details: () => [...queryKeys.cases.all, "detail"] as const,
    detail: (id: number | string) => [...queryKeys.cases.details(), id] as const,
    managed: {
      all: ["cases", "manage"] as const,
      list: (params: Record<string, unknown>) => [...queryKeys.cases.managed.all, params] as const,
    },
  },
  training: {
    all: ["training"] as const,
    records: (params: Record<string, unknown>) => ["records", params] as const,
    recent: () => ["records", "recent"] as const,
    detail: (id: number | string) => ["record", id] as const,
    review: (id: number | string) => ["scoreReview", id] as const,
    state: (recordId: number) => ["trainingState", recordId] as const,
  },
  qa: {
    all: ["qa"] as const,
    sessions: () => [...queryKeys.qa.all, "sessions"] as const,
    history: (params: Record<string, unknown>) => [...queryKeys.qa.all, "history", params] as const,
    messages: (sessionId: number | string) => [...queryKeys.qa.all, "messages", sessionId] as const,
  },
  stats: {
    all: ["stats"] as const,
    duration: (period: string) => [...queryKeys.stats.all, "duration", period] as const,
    trends: (period: string) => [...queryKeys.stats.all, "trends", period] as const,
    teacherSummary: (params: Record<string, unknown>) => [...queryKeys.stats.all, "teacherSummary", params] as const,
    ranking: (params: Record<string, unknown>) => [...queryKeys.stats.all, "ranking", params] as const,
    classSummary: (params: Record<string, unknown>) => [...queryKeys.stats.all, "classSummary", params] as const,
    admin: () => [...queryKeys.stats.all, "admin"] as const,
  },
  admin: {
    users: {
      all: ["admin", "users"] as const,
      list: (params: Record<string, unknown>) => [...queryKeys.admin.users.all, params] as const,
      detail: (userId: number | string) => [...queryKeys.admin.users.all, "detail", userId] as const,
    },
    roles: ["admin", "roles"] as const,
    feedback: {
      all: ["admin", "feedback"] as const,
      list: (params: Record<string, unknown>) => [...queryKeys.admin.feedback.all, params] as const,
      stats: (params: Record<string, unknown>) => [...queryKeys.admin.feedback.all, "stats", params] as const,
    },
    llm: {
      stats: ["admin", "llm", "stats"] as const,
      logs: (params: Record<string, unknown>) => ["admin", "llm", "logs", params] as const,
    },
  },
  grades: {
    all: ["grades"] as const,
    classes: (gradeId?: number) => ["classes", gradeId] as const,
  },
  rubric: {
    all: ["rubrics"] as const,
    active: () => [...queryKeys.rubric.all, "active"] as const,
  },
  apiManagement: {
    secrets: ["admin", "api", "secrets"] as const,
    configs: (purpose?: string) => ["admin", "api", "configs", purpose] as const,
    modelPresets: ["admin", "api", "modelPresets"] as const,
    health: ["admin", "api", "health"] as const,
    fallback: ["admin", "api", "fallback"] as const,
  },
  prompts: {
    all: (purpose?: string) => ["prompts", purpose] as const,
    activePreview: (purpose: string) => ["prompts", "active", "preview", purpose] as const,
    sampleVars: (purpose: string) => ["prompts", "sampleVars", purpose] as const,
  },
  questionnaires: {
    all: ["questionnaires"] as const,
    templates: (offset: number, typeFilter?: string) => ["questionnaireTemplates", offset, typeFilter] as const,
    detail: (id: number | null) => ["questionnaireTemplateDetail", id] as const,
    stats: (templateId: number | null) => ["questionnaireStats", templateId] as const,
    responses: (templateId: number, params?: Record<string, unknown>) => ["questionnaireResponses", templateId, params] as const,
    check: (params: { case_id?: number; record_id?: number; trigger?: string }) => ["questionnaireCheck", params] as const,
  },
  sessionConfigs: ["sessionConfigs"] as const,
  nursingRecord: (recordId: number) => ["nursingRecord", recordId] as const,
} as const;
```

- [ ] **Step 2: 验证文件无 TypeScript 编译错误**

```powershell
npx tsc --noEmit
```

Expected: No errors related to query-keys.ts

- [ ] **Step 3: 提交**

```powershell
git add frontend/src/api/query-keys.ts
git commit -m "feat: add Query Key Factory for type-safe cache management"
```

---

### Task 1.2: 提取共享 ScoreData 类型

**Files:**
- Create: `frontend/src/types/score.ts`
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/components/ScoreCard.tsx:5-27`
- Modify: `frontend/src/pages/ChatTraining.tsx:24-32`

- [ ] **Step 1: 创建 `frontend/src/types/score.ts`**

```ts
export interface ScoreItemData {
  id?: number;
  name: string;
  score: number;
  evidence?: string;
  reason?: string;
}

export interface DetailScoreCategory {
  score: number;
  max: number;
  items?: ScoreItemData[];
}

export interface ScoreData {
  total_score: number;
  detail_scores?: Record<string, DetailScoreCategory>;
  strengths?: string[];
  weaknesses?: string[];
  missed_content?: string[];
  suggestions?: string;
  rubric_version?: string;
}
```

- [ ] **Step 2: 在 `frontend/src/types/index.ts` 添加 re-export**

当前内容:
```ts
export type * from "./store";
```

替换为:
```ts
export type * from "./store";
export type * from "./score";
```

- [ ] **Step 3: 更新 `ScoreCard.tsx` — 删除本地类型定义，改用导入**

删除第 5-27 行的 `ScoreItemData`、`DetailScoreCategory`、`ScoreData` 接口定义，在文件顶部添加导入:

```ts
import type { ScoreData, ScoreItemData, DetailScoreCategory } from "@/types/score";
```

- [ ] **Step 4: 更新 `ChatTraining.tsx` — 删除本地 ScoreData 定义**

删除第 24-32 行的 `ScoreData` 接口:
```ts
interface ScoreData {
  total_score: number;
  detail_scores?: Record<string, { score: number; max: number; items?: { id: number; name: string; score: number }[] }>;
  strengths?: string[];
  weaknesses?: string[];
  missed_content?: string[];
  suggestions?: string;
  rubric_version?: string;
}
```

添加导入:
```ts
import type { ScoreData } from "@/types/score";
```

- [ ] **Step 5: 更新 `RecordDetail.tsx` 中的 ScoreData 引用**

查找并替换 RecordDetail.tsx 中的本地 `ScoreData` 接口，改为从 `@/types/score` 导入。

- [ ] **Step 6: 更新 `DashboardHome.tsx` 中的 ScoreData 引用**

查找并替换 DashboardHome.tsx 中的本地 `ScoreData`/变体定义，改为从 `@/types/score` 导入。

- [ ] **Step 7: 验证编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 8: 提交**

```powershell
git add frontend/src/types/score.ts frontend/src/types/index.ts frontend/src/components/ScoreCard.tsx frontend/src/pages/ChatTraining.tsx frontend/src/pages/RecordDetail.tsx frontend/src/pages/DashboardHome.tsx
git commit -m "refactor: extract shared ScoreData types to types/score.ts"
```

---

### Task 1.3: 迁移到 react-router v7 Layout Routes

**Files:**
- Create: `frontend/src/components/ProtectedRoute.tsx`
- Modify: `frontend/src/App.tsx` (major rewrite)
- Modify: `frontend/src/pages/DashboardHome.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/CaseSelect.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/History.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/RecordDetail.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/QA.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/Stats.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/Admin.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/AdminQuestionnaires.tsx` (remove `<Layout>` wrapper)
- Modify: `frontend/src/pages/AdminDebugPage.tsx` (remove `<Layout>` wrapper)
- Modify: all `frontend/src/pages/admin/*.tsx` (remove `<Layout>` wrapper)

- [ ] **Step 1: 创建 `frontend/src/components/ProtectedRoute.tsx`**

```tsx
import { Navigate, Outlet } from "react-router-dom";
import useAuthStore from "@/stores/authStore";

interface ProtectedRouteProps {
  role?: string;
  permission?: string;
}

export default function ProtectedRoute({ role, permission }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);
  const permissions = useAuthStore((s) => s.permissions);

  if (!token || !user) return <Navigate to="/login" replace />;
  if (permission && !permissions.includes(permission)) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/login" replace />;

  return <Outlet />;
}
```

- [ ] **Step 2: 重写 `App.tsx` 使用 Layout Routes**

完整替换 `App.tsx` 内容为:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FeedbackProvider } from "@/components/FeedbackProvider";
import Layout from "@/components/Layout";
import ProtectedRoute from "@/components/ProtectedRoute";
import { ConfirmProvider } from "@/components/ui/ConfirmDialog";
import { Toaster } from "@/components/ui/sonner";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

const Login = lazy(() => import("@/pages/Login"));
const DashboardHome = lazy(() => import("@/pages/DashboardHome"));
const CaseSelect = lazy(() => import("@/pages/CaseSelect"));
const ChatTraining = lazy(() => import("@/pages/ChatTraining"));
const History = lazy(() => import("@/pages/History"));
const RecordDetail = lazy(() => import("@/pages/RecordDetail"));
const QA = lazy(() => import("@/pages/QA"));
const StatsPage = lazy(() => import("@/pages/Stats").then((m) => ({ default: m.StatsPage })));
const Admin = lazy(() => import("@/pages/Admin"));
const AdminUsers = lazy(() => import("@/pages/admin/UsersPage"));
const AdminUserDetail = lazy(() => import("@/pages/admin/UserDetailPage"));
const AdminCases = lazy(() => import("@/pages/admin/CasesPage"));
const AdminLLM = lazy(() => import("@/pages/admin/LLMManagementPage"));
const AdminFeedback = lazy(() => import("@/pages/admin/FeedbackPage"));
const AdminGradesClasses = lazy(() => import("@/pages/admin/GradesClassesPage"));
const AdminSchools = lazy(() => import("@/pages/admin/SchoolsPage"));
const AdminRoles = lazy(() => import("@/pages/admin/RolesPage"));
const AdminQuestionnaires = lazy(() => import("@/pages/AdminQuestionnaires"));
const AdminDebug = lazy(() => import("@/pages/AdminDebugPage"));

function PageLoader() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3">
      <div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      <p className="text-sm text-muted-foreground">加载中...</p>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <Toaster />
        <ConfirmProvider>
          <FeedbackProvider>
            <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route element={<ProtectedRoute />}>
                    <Route element={<Layout />}>
                      <Route index element={<Navigate to="/home" replace />} />
                      <Route path="/home" element={<DashboardHome />} />
                      <Route path="/cases" element={<ProtectedRoute permission="training_access"><CaseSelect /></ProtectedRoute>} />
                      <Route path="/training/:recordId" element={<ProtectedRoute permission="training_access"><ChatTraining /></ProtectedRoute>} />
                      <Route path="/history" element={<History />} />
                      <Route path="/record/:id" element={<RecordDetail />} />
                      <Route path="/qa" element={<QA />} />
                      <Route path="/stats" element={<StatsPage />} />
                      <Route path="/admin" element={<ProtectedRoute permission="score_review"><Admin /></ProtectedRoute>} />
                      <Route path="/admin/llm" element={<ProtectedRoute permission="llm_monitor"><AdminLLM /></ProtectedRoute>} />
                      <Route path="/admin/cases" element={<ProtectedRoute permission="case_manage"><AdminCases /></ProtectedRoute>} />
                      <Route path="/admin/users/:userId" element={<ProtectedRoute permission="user_manage"><AdminUserDetail /></ProtectedRoute>} />
                      <Route path="/admin/users" element={<ProtectedRoute permission="user_manage"><AdminUsers /></ProtectedRoute>} />
                      <Route path="/admin/grades-classes" element={<ProtectedRoute permission="grade_class_manage"><AdminGradesClasses /></ProtectedRoute>} />
                      <Route path="/admin/feedback" element={<ProtectedRoute permission="feedback_review"><AdminFeedback /></ProtectedRoute>} />
                      <Route path="/admin/schools" element={<ProtectedRoute permission="school_manage"><AdminSchools /></ProtectedRoute>} />
                      <Route path="/admin/roles" element={<ProtectedRoute permission="role_manage"><AdminRoles /></ProtectedRoute>} />
                      <Route path="/admin/questionnaires" element={<ProtectedRoute permission="questionnaire_manage"><AdminQuestionnaires /></ProtectedRoute>} />
                      <Route path="/admin/debug" element={<ProtectedRoute permission="score_review"><AdminDebug /></ProtectedRoute>} />
                    </Route>
                  </Route>
                  <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </FeedbackProvider>
        </ConfirmProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
```

**注意**: v7 尚未正式支持 `<ProtectedRoute>` 嵌套 `<Route>` 再嵌套 `<Layout>` 作为 layout routes 的写法（即 `<Route>` 嵌套 `<Route>` 当他们是元素组件时不会起效）。因此上述方案正确使用了 `<Route element={...}>` 嵌套模式——`<ProtectedRoute>` 和 `<Layout>` 都使用 `<Outlet />`，这才是 v7 的 layout routes 正确姿势。上述写法完全兼容 react-router-dom v7.15。

- [ ] **Step 3: 从所有页面文件中移除 `<Layout>` 包装**

对于以下每个文件，移除 `<Layout>` 导入和 JSX 包装，将 `<Layout>...</Layout>` 替换为 `<>...</>` 或直接返回内容:

需要修改的文件列表:
- `frontend/src/pages/DashboardHome.tsx` — 移除 `import Layout from "@/components/Layout"` 和 `<Layout>` 包装
- `frontend/src/pages/CaseSelect.tsx` — 同上
- `frontend/src/pages/History.tsx` — 同上
- `frontend/src/pages/RecordDetail.tsx` — 同上
- `frontend/src/pages/QA.tsx` — 同上
- `frontend/src/pages/Stats.tsx` — 同上
- `frontend/src/pages/Admin.tsx` — 同上
- `frontend/src/pages/AdminQuestionnaires.tsx` — 同上
- `frontend/src/pages/AdminDebugPage.tsx` — 同上
- `frontend/src/pages/admin/UsersPage.tsx` — 同上
- `frontend/src/pages/admin/UserDetailPage.tsx` — 同上
- `frontend/src/pages/admin/CasesPage.tsx` — 同上
- `frontend/src/pages/admin/LLMManagementPage.tsx` — 同上
- `frontend/src/pages/admin/FeedbackPage.tsx` — 同上
- `frontend/src/pages/admin/GradesClassesPage.tsx` — 同上
- `frontend/src/pages/admin/SchoolsPage.tsx` — 同上
- `frontend/src/pages/admin/RolesPage.tsx` — 同上

以 `DashboardHome.tsx` 为例，典型的修改模式:

Before:
```tsx
import Layout from "@/components/Layout";
// ...
export default function DashboardHome() {
  // ...
  return <Layout>...</Layout>;
}
```

After:
```tsx
// 删除 import Layout from "@/components/Layout";
// ...
export default function DashboardHome() {
  // ...
  return <>...</>;
}
```

对每个页面文件执行同样的操作。

- [ ] **Step 4: 验证 TypeScript 编译**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 5: 提交**

```powershell
git add frontend/src/components/ProtectedRoute.tsx frontend/src/App.tsx frontend/src/pages/
git commit -m "refactor: migrate to react-router v7 Layout Routes with ProtectedRoute"
```

---

### Task 1.4: 拆分 `api-client.ts` 为领域模块

**Files:**
- Create: `frontend/src/api/auth.ts`
- Create: `frontend/src/api/cases.ts`
- Create: `frontend/src/api/chat.ts`
- Create: `frontend/src/api/training.ts`
- Create: `frontend/src/api/export.ts`
- Create: `frontend/src/api/admin/users.ts`
- Create: `frontend/src/api/admin/roles.ts`
- Create: `frontend/src/api/admin/feedback.ts`
- Create: `frontend/src/api/admin/llm.ts`
- Create: `frontend/src/api/admin/api-management.ts`
- Create: `frontend/src/api/admin/index.ts`
- Create: `frontend/src/api/qa.ts`
- Create: `frontend/src/api/stats.ts`
- Create: `frontend/src/api/grades-classes.ts`
- Create: `frontend/src/api/rubric.ts`
- Create: `frontend/src/api/prompts.ts`
- Create: `frontend/src/api/questionnaires.ts`
- Create: `frontend/src/api/nursing-records.ts`
- Create: `frontend/src/api/training-state.ts`
- Modify: `frontend/src/api/api-client.ts` (改为 barrel re-export)

- [ ] **Step 1: 创建 `frontend/src/api/auth.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const login = (username: string, password: string) => api.post<Schemas["TokenResponse"]>("/auth/login", { username, password });

export const register = (data: Schemas["RegisterRequest"]) => api.post<Schemas["TokenResponse"]>("/auth/register", data);

export const getMe = () => api.get<Schemas["UserBrief"]>("/auth/me");

export const refreshToken = () => api.post<Schemas["TokenResponse"]>("/auth/refresh");

export const changePassword = (oldPassword: string, newPassword: string) =>
  api.put<Schemas["OkResponse"]>("/auth/change-password", { old_password: oldPassword, new_password: newPassword });
```

- [ ] **Step 2: 创建 `frontend/src/api/cases.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getCases = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_CaseBrief_"]>("/cases", { params });

export const getCaseDetail = (id: number | string) => api.get<Schemas["CaseDetail"]>(`/cases/${id}`);

export const startTraining = (caseId: number | string, configId?: string) =>
  api.post<Schemas["TrainingStartResponse"]>("/training/start", { case_id: caseId, config_id: configId });

export const getManageCases = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_CaseManageItem_"]>("/cases/manage/list", { params });

export const createCase = (data: Schemas["CaseCreateRequest"]) => api.post<Schemas["CaseManageItem"]>("/cases", data);

export const updateCase = (id: number | string, data: Schemas["CaseUpdateRequest"]) => api.put<Schemas["CaseManageItem"]>(`/cases/${id}`, data);

export const deleteCase = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/cases/${id}`);

export const generateCase = (data: Schemas["CaseGenerateRequest"]) => api.post<Schemas["CaseGenerateResponse"]>("/cases/generate", data);
```

- [ ] **Step 3: 创建 `frontend/src/api/chat.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const sendMessage = (recordId: number | string, content: string, signal?: AbortSignal) =>
  api.post<Schemas["ChatMessageResponse"]>(`/chat/${recordId}/message`, { content }, { signal });

export async function sendMessageStream(
  recordId: number | string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (id?: number) => void,
  onError: (msg: string) => void,
  onSanitized?: (reply: string) => void,
  onSystem?: (text: string) => void,
  signal?: AbortSignal,
) {
  const token = localStorage.getItem("token");
  const resp = await fetch(`/api/chat/${recordId}/message/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content }),
    signal,
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: "请求失败" }));
    onError(err.detail || "请求失败");
    return;
  }

  if (!resp.body) {
    onError("响应体为空");
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.error) {
          onError(data.error);
          return;
        }
        if (data.sanitized) {
          onSanitized?.(data.reply);
          continue;
        }
        if (data.system) {
          onSystem?.(data.system);
          continue;
        }
        if (data.done) {
          onDone(data.id);
          return;
        }
        if (data.content) {
          onChunk(data.content);
        }
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
}
```

- [ ] **Step 4: 创建 `frontend/src/api/training.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const endTraining = (recordId: number | string, signal?: AbortSignal) =>
  api.post<Schemas["ScoringTriggerResponse"]>(`/training/${recordId}/end`, null, { signal });

export const retryScoring = (recordId: number | string) => api.post<Schemas["ScoringTriggerResponse"]>(`/training/${recordId}/retry-scoring`);

export const getRecords = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_TrainingRecordBrief_"]>("/training/records", { params });

export const deleteRecord = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/training/records/${id}`);

export const getRecordDetail = (id: number | string) => api.get<Schemas["TrainingRecordDetail"]>(`/training/records/${id}`);

export const getScoreReview = (recordId: number | string) => api.get<Schemas["ScoreReviewResponse"]>(`/training/records/${recordId}/review`);

export const submitScoreReview = (recordId: number | string, data: Schemas["ScoreReviewRequest"]) =>
  api.post<Schemas["ScoreReviewResponse"]>(`/training/records/${recordId}/review`, data);

export const getSessionConfigs = () => api.get<Record<string, unknown>[]>("/training/configs");
```

- [ ] **Step 5: 创建 `frontend/src/api/export.ts`**

```ts
import { api } from "./axios-instance";

export const exportRecords = () => api.get<Blob>("/export/records", { responseType: "blob" });

export const exportRecordDetail = (id: number | string) => api.get<Blob>(`/export/record/${id}`, { responseType: "blob" });
```

- [ ] **Step 6: 创建 `frontend/src/api/admin/users.ts`**

```ts
import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const getUsers = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_UserBrief_"]>("/admin/users", { params });

export const getStats = () => api.get<Schemas["AdminStats"]>("/admin/stats");

export const updateUser = (id: number | string, data: Schemas["UserUpdateRequest"]) => api.put<Schemas["UserBrief"]>(`/admin/users/${id}`, data);

export const batchCreateUsers = (users: Schemas["BatchUserItem"][]) => api.post<Schemas["BatchCreateResult"]>("/admin/users/batch", users);

export const deleteUser = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/admin/users/${id}`);

export const getStudentDetail = (userId: number | string) => api.get<Schemas["StudentDetail"]>(`/admin/users/${userId}/detail`);
```

- [ ] **Step 7: 创建 `frontend/src/api/admin/roles.ts`**

```ts
import { api } from "../axios-instance";

export const getRoles = () =>
  api.get<{ id: number; name: string; display_name: string; is_system: boolean; permissions: string[]; user_count: number }[]>("/admin/roles");
```

- [ ] **Step 8: 创建 `frontend/src/api/admin/feedback.ts`**

```ts
import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const submitFeedback = (data: Schemas["FeedbackSubmit"]) => api.post<Schemas["FeedbackSubmitResponse"]>("/feedback", data);

export const getFeedbacks = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_FeedbackItem_"]>("/admin/feedback", { params });

export const getFeedbackStats = (params: Record<string, unknown> = {}) => api.get<Schemas["FeedbackDailyItem"][]>("/admin/feedback/stats", { params });
```

- [ ] **Step 9: 创建 `frontend/src/api/admin/llm.ts`**

```ts
import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const getLLMStats = () => api.get<Schemas["LLMStatsResponse"]>("/admin/llm-stats");

export const getLLMLogs = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_LLMCallLogItem_"]>("/admin/llm-logs", {
    params: { aggregate_patient_chat: true, ...params },
  });

export const exportLLMLogs = (dateFrom?: string, dateTo?: string) => {
  const params: Record<string, string> = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return api.get<Blob>("/admin/llm-logs/export", { params, responseType: "blob" });
};
```

- [ ] **Step 10: 创建 `frontend/src/api/admin/api-management.ts`**

```ts
import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const fetchSecrets = () => api.get<Schemas["ApiSecretResponse"][]>("/admin/api/secrets");

export const createSecret = (data: Schemas["ApiSecretCreate"]) => api.post<Schemas["SecretCreateResponse"]>("/admin/api/secrets", data);

export const updateSecret = (id: number | string, data: Schemas["ApiSecretUpdate"]) => api.put<Schemas["ApiSecretResponse"]>(`/admin/api/secrets/${id}`, data);

export const deleteSecret = (id: number | string) => api.delete<Schemas["OkResponse"]>(`/admin/api/secrets/${id}`);

export const fetchConfigs = (purpose?: string) => {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get<Schemas["LLMConfigResponse"][]>("/admin/api/configs", { params });
};

export const createConfig = (data: Schemas["LLMConfigCreate"]) => api.post<Schemas["ConfigCreateResponse"]>("/admin/api/configs", data);

export const updateConfig = (id: number | string, data: Schemas["LLMConfigUpdate"]) => api.put<Schemas["LLMConfigResponse"]>(`/admin/api/configs/${id}`, data);

export const deleteConfig = (id: number | string) => api.delete<Schemas["OkResponse"]>(`/admin/api/configs/${id}`);

export const toggleConfig = (id: number | string) => api.post<Schemas["ToggleStatusResponse"]>(`/admin/api/configs/${id}/toggle`);

export const resetConfig = (id: number | string) => api.post<Schemas["OkResponse"]>(`/admin/api/configs/${id}/reset`);

export const testConfig = (id: number | string) => api.post<Schemas["TestResultItem"]>(`/admin/api/configs/${id}/test`);

export const testAllConfigs = () => api.post<Schemas["TestAllResultsResponse"]>("/admin/api/configs/test-all");

export const reloadRouter = () => api.post<Schemas["OkResponse"]>("/admin/api/reload");

export const checkHealth = () => api.get<Schemas["HealthCheckItem"][]>("/admin/api/health");

export const fetchEnvFallback = () => api.get("/admin/api/fallback");

export const testEnvFallback = () => api.post<Schemas["TestResultItem"]>("/admin/api/fallback/test");

export interface ModelPresetItem {
  name: string;
  price_input: number;
  price_output: number;
}

export interface ProviderPreset {
  provider: string;
  display_name: string;
  base_url: string;
  models: ModelPresetItem[];
}

export const fetchModelPresets = () => api.get<{ providers: ProviderPreset[] }>("/admin/api/model-presets");
```

- [ ] **Step 11: 创建 `frontend/src/api/admin/index.ts`**

```ts
export * from "./users";
export * from "./roles";
export * from "./feedback";
export * from "./llm";
export * from "./api-management";
```

- [ ] **Step 12: 创建 `frontend/src/api/qa.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const createQASession = (question: string) => api.post<Schemas["QAAskResponse"]>("/qa/sessions", { question });

export const getQASessions = () => api.get<Schemas["QASessionItem"][]>("/qa/sessions");

export const deleteQASession = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/qa/sessions/${id}`);

export const getQASessionMessages = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/sessions/${sessionId}/messages`);

export const askInQASession = (sessionId: number | string, question: string) =>
  api.post<Schemas["QAAskResponse"]>(`/qa/sessions/${sessionId}/ask`, { question });

export const getQAHistoryAll = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_QASessionAdminItem_"]>("/qa/history/all", { params });

export const getQASessionMessagesAdmin = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/history/all/${sessionId}/messages`);
```

- [ ] **Step 13: 创建 `frontend/src/api/stats.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getDurationStats = (period = "month") => api.get<Schemas["DurationStats"]>(`/stats/duration?period=${period}`);

export const getTrends = (period = "month") => api.get<Schemas["TrendStats"]>(`/stats/trends?period=${period}`);

export const getTeacherSummary = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_TeacherSummaryItem_"]>("/stats/teacher-summary", { params });

export const getStudentRanking = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_RankingItem_"]>("/stats/ranking", { params });
```

- [ ] **Step 14: 创建 `frontend/src/api/grades-classes.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getGrades = () => api.get<Schemas["GradeResponse"][]>("/admin/grades");

export const createGrade = (data: Schemas["GradeCreate"]) => api.post<Schemas["GradeResponse"]>("/admin/grades", data);

export const updateGrade = (id: number | string, data: Schemas["GradeUpdate"]) => api.put<Schemas["GradeResponse"]>(`/admin/grades/${id}`, data);

export const deleteGrade = (id: number | string) => api.delete(`/admin/grades/${id}`);

export const getClasses = (params: Record<string, unknown> = {}) => api.get<Schemas["ClassResponse"][]>("/admin/classes", { params });

export const createClass = (data: Schemas["ClassCreate"]) => api.post<Schemas["ClassResponse"]>("/admin/classes", data);

export const updateClass = (id: number | string, data: Schemas["ClassUpdate"]) => api.put<Schemas["ClassResponse"]>(`/admin/classes/${id}`, data);

export const deleteClass = (id: number | string) => api.delete(`/admin/classes/${id}`);

export const getClassSummary = (params: Record<string, unknown> = {}) => api.get<Schemas["ClassSummaryItemSchema"][]>("/stats/class-summary", { params });
```

- [ ] **Step 15: 创建 `frontend/src/api/rubric.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const fetchRubrics = () => api.get<Schemas["RubricResponse"][]>("/admin/api/rubrics");

export const getActiveRubric = () => api.get<Schemas["RubricResponse"]>("/admin/api/rubrics/active");

export const createRubric = (data: Record<string, unknown>) => api.post<Schemas["RubricResponse"]>("/admin/api/rubrics", data);

export const updateRubric = (id: number | string, data: Record<string, unknown>) => api.put<Schemas["RubricResponse"]>(`/admin/api/rubrics/${id}`, data);

export const deleteRubric = (id: number | string) => api.delete(`/admin/api/rubrics/${id}`);

export const activateRubric = (id: number | string) => api.post(`/admin/api/rubrics/${id}/activate`);
```

- [ ] **Step 16: 创建 `frontend/src/api/prompts.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const fetchPrompts = (purpose?: string) => {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get<Schemas["PromptTemplateResponse"][]>("/admin/prompts", { params });
};

export const createPrompt = (data: Schemas["PromptTemplateCreate"]) => api.post<Schemas["PromptTemplateResponse"]>("/admin/prompts", data);

export const updatePrompt = (id: number | string, data: Schemas["PromptTemplateUpdate"]) =>
  api.put<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}`, data);

export const deletePrompt = (id: number | string) => api.delete<Schemas["OkResponse"]>(`/admin/prompts/${id}`);

export const activatePrompt = (id: number | string, purpose?: string) =>
  api.post<Schemas["PromptTemplateResponse"]>(`/admin/prompts/${id}/activate${purpose ? `?purpose=${encodeURIComponent(purpose)}` : ""}`);

export const validatePrompt = (data: Schemas["PromptValidateRequest"]) => api.post<Schemas["PromptValidateResponse"]>("/admin/prompts/validate", data);

export const reloadPrompts = () => api.post<Schemas["OkResponse"]>("/admin/prompts/reload");

export const previewActivePrompt = (purpose: string) => api.get<Schemas["PromptPreviewResponse"]>("/admin/prompts/active/preview", { params: { purpose } });

export const fetchSampleVars = (purpose: string) => api.get<Schemas["SampleVarsResponse"]>("/admin/prompts/sample-vars", { params: { purpose } });
```

- [ ] **Step 17: 创建 `frontend/src/api/questionnaires.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getQuestionnairesTemplates = (params?: Record<string, unknown>) =>
  api.get<Schemas["PaginatedResponse_QuestionnaireTemplateResponse_"]>("/questionnaires/templates", { params });

export const createQuestionnaireTemplate = (data: Schemas["QuestionnaireTemplateCreate"]) =>
  api.post<Schemas["QuestionnaireTemplateDetailResponse"]>("/questionnaires/templates", data);

export const getQuestionnaireTemplate = (id: number) => api.get<Schemas["QuestionnaireTemplateDetailResponse"]>(`/questionnaires/templates/${id}`);

export const updateQuestionnaireTemplate = (id: number, data: Schemas["QuestionnaireTemplateUpdate"]) =>
  api.put<Schemas["QuestionnaireTemplateDetailResponse"]>(`/questionnaires/templates/${id}`, data);

export const deleteQuestionnaireTemplate = (id: number) => api.delete<Schemas["OkResponse"]>(`/questionnaires/templates/${id}`);

export const checkQuestionnaire = (params: { case_id?: number; record_id?: number; trigger?: string }) =>
  api.get<Schemas["QuestionnaireCheckResponse"]>("/questionnaires/check", { params });

export const submitQuestionnaire = (data: Schemas["QuestionnaireSubmitRequest"]) =>
  api.post<Schemas["QuestionnaireResponseItem"]>("/questionnaires/responses", data);

export const getQuestionnaireResponses = (templateId: number, params?: Record<string, unknown>) =>
  api.get<Schemas["PaginatedResponse_QuestionnaireResponseItem_"]>(`/questionnaires/responses/${templateId}`, { params });

export const getQuestionnaireStats = (templateId: number) => api.get<Schemas["QuestionnaireStatsResponse"]>(`/questionnaires/responses/${templateId}/stats`);

export const exportQuestionnaireCSV = (templateId: number) => api.get(`/questionnaires/responses/${templateId}/export`, { responseType: "blob" });
```

- [ ] **Step 18: 创建 `frontend/src/api/nursing-records.ts`**

```ts
import { api } from "./axios-instance";

export const getNursingRecord = (recordId: number) => api.get<Record<string, unknown>>(`/nursing-records/${recordId}`);

export const saveNursingRecord = (recordId: number, data: Record<string, unknown>) => api.post<Record<string, unknown>>(`/nursing-records/${recordId}`, data);
```

- [ ] **Step 19: 创建 `frontend/src/api/training-state.ts`**

```ts
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getTrainingState = (recordId: number) => api.get<Schemas["TrainingStateResponse"]>(`/training/${recordId}/state`);

export const triggerInitiative = (recordId: number) => api.post<Schemas["InitiativeTriggerResponse"]>(`/training/${recordId}/initiative/trigger`);

export const updateTrainingFeatures = (recordId: number, features: Record<string, boolean>) =>
  api.put<{ ok: boolean; features: Record<string, boolean> }>(`/training/${recordId}/config/features`, features);
```

- [ ] **Step 20: 重写 `api-client.ts` 为 barrel re-export（保持向后兼容）**

```ts
export * from "./auth";
export * from "./cases";
export * from "./chat";
export * from "./training";
export * from "./export";
export * from "./admin";
export * from "./qa";
export * from "./stats";
export * from "./grades-classes";
export * from "./rubric";
export * from "./prompts";
export * from "./questionnaires";
export * from "./nursing-records";
export * from "./training-state";
```

- [ ] **Step 21: 验证 TypeScript 编译**

```powershell
npx tsc --noEmit
```

Expected: No errors — barrel re-export 应保持所有现有导入不变

- [ ] **Step 22: 提交**

```powershell
git add frontend/src/api/
git commit -m "refactor: split api-client.ts into domain modules with barrel re-export"
```

---

## Phase 2: 巨型组件分解

### Task 2.1: 拆分 ChatTraining.tsx — 提取 hooks

**Files:**
- Create: `frontend/src/hooks/useTrainingTimer.ts`
- Create: `frontend/src/hooks/useRecordLoader.ts`
- Create: `frontend/src/hooks/useScorePolling.ts`
- Create: `frontend/src/hooks/useScoreProgress.ts`
- Create: `frontend/src/hooks/useNetworkStatus.ts`
- Modify: `frontend/src/pages/ChatTraining.tsx`

- [ ] **Step 1: 创建 `frontend/src/hooks/useTrainingTimer.ts`**

从 ChatTraining.tsx 中提取所有计时器逻辑:

```ts
import { useCallback, useEffect, useRef } from "react";
import { useToast } from "@/components/Toast";

interface UseTrainingTimerOptions {
  initialRemaining: number | null;
  onAutoEnd: () => void;
}

export function useTrainingTimer({ initialRemaining, onAutoEnd }: UseTrainingTimerOptions) {
  const [remaining, setRemaining] = useState<number | null>(initialRemaining);
  const [timerActive, setTimerActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const warned5Ref = useRef(false);
  const warned2Ref = useRef(false);
  const autoEndRef = useRef(false);
  const toast = useToast();

  useEffect(() => {
    setRemaining(initialRemaining);
    if (initialRemaining != null && initialRemaining > 0) {
      setTimerActive(true);
    }
  }, [initialRemaining]);

  useEffect(() => {
    if (!timerActive) return;
    timerRef.current = setInterval(() => {
      setRemaining((s) => {
        if (s == null) return s;
        if (s <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerActive]);

  useEffect(() => {
    if (remaining == null || !timerActive) return;
    if (remaining <= 300 && remaining > 299 && !warned5Ref.current) {
      warned5Ref.current = true;
      toast.warning("训练时间剩余 5 分钟");
    }
    if (remaining <= 120 && remaining > 119 && !warned2Ref.current) {
      warned2Ref.current = true;
      toast.warning("训练时间剩余 2 分钟，即将自动结束");
    }
  }, [remaining, timerActive, toast.warning, toast.info]);

  useEffect(() => {
    if (remaining === 0 && timerActive && !autoEndRef.current) {
      autoEndRef.current = true;
      onAutoEnd();
    }
  }, [remaining, timerActive, onAutoEnd]);

  const stopTimer = useCallback(() => {
    setTimerActive(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resetTimer = useCallback(() => {
    warned5Ref.current = false;
    warned2Ref.current = false;
    autoEndRef.current = false;
    stopTimer();
  }, [stopTimer]);

  const formatTime = useCallback((sec: number | null): string => {
    if (sec == null) return "--:--";
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }, []);

  return { remaining, timerActive, stopTimer, resetTimer, formatTime, setRemaining, setTimerActive };
}

import { useState } from "react";
```

注意: 上述代码中 `import { useState }` 必须在文件顶部，重新调整为:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/components/Toast";

// ... 其余代码
```

- [ ] **Step 2: 创建 `frontend/src/hooks/useRecordLoader.ts`**

```ts
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getRecordDetail } from "@/api/training";
import { useToast } from "@/components/Toast";
import type { ScoreData } from "@/types/score";

export function useRecordLoader(
  recordId: string | undefined,
  opts: {
    setMessages: (msgs: unknown[]) => void;
    setCaseTitle: (t: string) => void;
    setRequiredInquiries: (inquiries: string[]) => void;
    setPatientInfo: (info: unknown) => void;
    setCaseId: (id: number) => void;
    setFeatures: (features: Record<string, boolean>) => void;
    setRecordStatus: (status: string | null) => void;
    setScore: (score: ScoreData | null) => void;
    setShowScore: (show: boolean) => void;
    onTimerReady: (remaining: number | null) => void;
    onPreTestCheck: () => Promise<{ has_pending?: boolean } | undefined>;
  },
) {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    if (!recordId) return;

    getRecordDetail(Number(recordId))
      .then(({ data }) => {
        if (cancelled) return;
        const detail = data as Record<string, unknown> & {
          messages?: unknown[];
          case_name?: string;
          required_inquiries?: string[];
          patient_info?: unknown;
          case_id?: number;
          features?: Record<string, boolean>;
          status?: string;
          score?: ScoreData;
          remaining_seconds?: number;
          time_limit?: number;
          start_time?: string;
        };

        opts.setMessages(
          ((detail.messages || []) as Array<{ streaming?: boolean }>).map((m) => ({
            ...m,
            streaming: false,
          })),
        );
        if (detail.case_name) opts.setCaseTitle(detail.case_name);
        if (detail.required_inquiries) opts.setRequiredInquiries(detail.required_inquiries as string[]);
        if (detail.patient_info) opts.setPatientInfo(detail.patient_info);
        if (detail.case_id) opts.setCaseId(detail.case_id);
        if (detail.features) opts.setFeatures(detail.features);
        opts.setRecordStatus(detail.status || null);

        if (detail.status === "completed") {
          opts.onTimerReady(null);
          if (detail.score) {
            opts.setScore(detail.score);
            opts.setShowScore(true);
          }
          return;
        }

        const r =
          detail.remaining_seconds != null
            ? detail.remaining_seconds
            : detail.time_limit && detail.start_time
              ? Math.max(0, (detail.time_limit || 20) * 60 - Math.floor((Date.now() - new Date(detail.start_time).getTime()) / 1000))
              : null;
        opts.onTimerReady(r);

        opts.onPreTestCheck().then((result) => {
          if (result?.has_pending) {
            // handled externally via showPreQuestionnaire
          }
        });
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("加载训练记录失败");
          navigate("/cases");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [recordId]);
}
```

- [ ] **Step 3: 创建 `frontend/src/hooks/useScorePolling.ts`**

```ts
import { useCallback, useRef } from "react";
import { endTraining, getRecordDetail } from "@/api/training";
import { useToast } from "@/components/Toast";
import type { ScoreData } from "@/types/score";

interface UseScorePollingOptions {
  recordId: number | null;
  onScoreReady: (score: ScoreData) => void;
  onPostTestCheck: () => Promise<{ has_pending?: boolean } | undefined>;
}

export function useScorePolling({ recordId, onScoreReady, onPostTestCheck }: UseScorePollingOptions) {
  const toast = useToast();
  const scoreCancelRef = useRef(false);

  const executeEnd = useCallback(
    async (isAuto = false) => {
      if (!recordId) return;
      scoreCancelRef.current = false;

      try {
        await endTraining(recordId);
        for (let i = 0; i < 40; i++) {
          if (scoreCancelRef.current) break;
          await new Promise<void>((r) => setTimeout(r, 3000));
          const detail = await getRecordDetail(recordId);
          const data = detail.data as Record<string, unknown>;
          if (data.scoring_status === "completed" && data.score) {
            onScoreReady(data.score as ScoreData);
            onPostTestCheck().then((result) => {
              if (result?.has_pending) {
                // handled externally
              }
            });
            return;
          }
          if (data.scoring_status === "failed") {
            toast.error(`自动评分失败：${data.scoring_error || "未知错误，可在训练记录中手动重试"}`);
            return;
          }
        }
      } catch (err: unknown) {
        const axiosErr = err as { name?: string; code?: string; response?: { data?: { detail?: string } } };
        if (axiosErr.name !== "CanceledError" && axiosErr.code !== "ERR_CANCELED") {
          if (!isAuto) toast.error(axiosErr.response?.data?.detail || "结束训练失败，请重试");
        }
      }
    },
    [recordId, onScoreReady, onPostTestCheck, toast],
  );

  return { executeEnd, scoreCancelRef };
}
```

- [ ] **Step 4: 创建 `frontend/src/hooks/useScoreProgress.ts`**

```ts
import { useEffect, useRef, useState } from "react";

export function useScoreProgress(isActive: boolean) {
  const [progress, setProgress] = useState(0);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef(0);

  useEffect(() => {
    if (!isActive) return;
    setProgress(0);
    speedRef.current = 100 / (15 * 20);

    progressIntervalRef.current = setInterval(() => {
      setProgress((prev) => {
        const next = prev + speedRef.current;
        return Math.min(next, 100);
      });
    }, 50);

    return () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    };
  }, [isActive]);

  const fastForward = () => {
    speedRef.current = 8;
  };

  return { progress, fastForward };
}
```

- [ ] **Step 5: 创建 `frontend/src/hooks/useNetworkStatus.ts`**

```ts
import { useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const toast = useToast();

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => {
      setIsOnline(false);
      toast.warning("网络已断开");
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [toast.warning]);

  return isOnline;
}
```

- [ ] **Step 6: 验证 TypeScript 编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors in new hook files

- [ ] **Step 7: 提交**

```powershell
git add frontend/src/hooks/useTrainingTimer.ts frontend/src/hooks/useRecordLoader.ts frontend/src/hooks/useScorePolling.ts frontend/src/hooks/useScoreProgress.ts frontend/src/hooks/useNetworkStatus.ts
git commit -m "refactor: extract ChatTraining hooks (timer, record loader, score polling, network)"
```

---

### Task 2.2: 拆分 ChatTraining.tsx — 提取子组件和使用新 hooks

**Files:**
- Create: `frontend/src/components/training/InquirySidebar.tsx`
- Create: `frontend/src/components/training/ScoringOverlay.tsx`
- Create: `frontend/src/components/training/TrainingHeader.tsx`
- Create: `frontend/src/components/training/ChatInput.tsx`
- Modify: `frontend/src/pages/ChatTraining.tsx` (major rewrite to use new hooks + sub-components)

- [ ] **Step 1: 创建 `frontend/src/components/training/InquirySidebar.tsx`**

从 ChatTraining.tsx 第 34-150 行提取:

```tsx
import { CheckCircle2, Circle, ListChecks, X } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

function extractKeywords(inquiry: string): string[] {
  const cleaned = inquiry.replace(/[（）()]/g, " ");
  const tokens: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.push(cleaned.slice(i, i + 2));
  }
  return [...new Set(tokens.filter((t) => t.trim().length === 2))];
}

function getInquiryLabel(inquiry: string): string {
  return inquiry
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .slice(0, 18);
}

interface InquirySidebarProps {
  inquiries: string[];
  studentMessages: ChatMessage[];
}

export default function InquirySidebar({ inquiries, studentMessages }: InquirySidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const addressed = useMemo(() => {
    if (!inquiries || inquiries.length === 0) return new Set<number>();
    const allText = studentMessages.map((m) => m.content).join("");
    const result = new Set<number>();
    inquiries.forEach((inquiry, idx) => {
      const keywords = extractKeywords(inquiry);
      const matched = keywords.some((kw) => allText.includes(kw));
      if (matched) result.add(idx);
    });
    return result;
  }, [inquiries, studentMessages]);

  const covered = addressed.size;
  const total = inquiries.length;
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0;

  if (inquiries.length === 0) return null;

  return (
    <>
      <button
        className="relative flex items-center gap-1 px-2 h-8 rounded-md border border-border bg-card text-xs sm:text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-primary/50 shrink-0"
        onClick={() => setIsOpen((v) => !v)}
        title="采集进度"
        aria-label="采集进度"
      >
        <ListChecks size={13} className="sm:size-[16px]" />
        <span>
          {covered}/{total}
        </span>
        {pct < 100 && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />}
      </button>

      <div
        className={cn(
          "fixed top-0 right-0 bottom-0 w-[320px] max-w-[85vw] bg-background z-[1000] flex flex-col transition-transform duration-300 ease-out border-l border-border",
          isOpen ? "translate-x-0 shadow-[-8px_0_30px_rgba(0,0,0,0.08)]" : "translate-x-full",
        )}
      >
        <div className="flex justify-between items-center px-5 py-4 border-b border-border">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <ListChecks size={18} /> 采集进度
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            className="w-8 h-8 rounded-lg border border-border bg-card flex items-center justify-center hover:bg-muted transition-colors"
            aria-label="关闭进度面板"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 border-b border-border">
          <div className="flex justify-between mb-2">
            <span className="text-xs text-muted-foreground">关键问诊内容覆盖</span>
            <span className={cn("text-sm font-bold", pct >= 80 ? "text-green-600" : pct >= 40 ? "text-amber-600" : "text-red-600")}>
              {covered}/{total}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-[width] duration-500", pct >= 80 ? "bg-green-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500")}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-auto py-2">
          {inquiries.map((inquiry, idx) => {
            const done = addressed.has(idx);
            return (
              <div
                key={idx}
                className={cn("flex items-start gap-2.5 px-5 py-2.5 text-sm transition-colors", done ? "text-foreground" : "text-muted-foreground/60")}
              >
                {done ? (
                  <CheckCircle2 size={16} className="text-green-500 shrink-0 mt-0.5" />
                ) : (
                  <Circle size={16} className="text-muted-foreground/30 shrink-0 mt-0.5" />
                )}
                <span className="leading-relaxed">{getInquiryLabel(inquiry)}</span>
              </div>
            );
          })}
        </div>

        <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground leading-relaxed">
          提示：系统根据对话关键词自动匹配，仅供参考。建议按护理评估框架全面采集病史。
        </div>
      </div>

      {isOpen && <div onClick={() => setIsOpen(false)} className="fixed inset-0 bg-black/30 z-[999]" role="presentation" />}
    </>
  );
}
```

- [ ] **Step 2: 创建 `frontend/src/components/training/ScoringOverlay.tsx`**

从 ChatTraining.tsx 第 771-796 行提取评分等待覆盖层:

```tsx
import { cn } from "@/lib/utils";

interface ScoringOverlayProps {
  progress: number;
  onCancel: () => void;
  onGoHome: () => void;
}

export default function ScoringOverlay({ progress, onCancel, onGoHome }: ScoringOverlayProps) {
  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[200]">
      <div className="bg-card rounded-2xl text-center px-6 sm:px-10 py-8 sm:py-10 max-w-[420px] w-[92vw] shadow-xl border border-border">
        <div className="w-12 h-12 mx-auto mb-5 border-4 border-muted border-t-primary rounded-full animate-spin" />
        <h3 className="text-lg font-semibold mb-2">{progress >= 100 ? "评分完成，即将展示报告" : "AI 正在评分"}</h3>
        <p className="text-muted-foreground text-sm leading-relaxed mb-6">正在分析你的训练表现，根据问诊完整性、沟通技巧等维度进行评分，请耐心等待...</p>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-6">
          <div
            className={cn("h-full rounded-full transition-colors", progress >= 100 ? "bg-green-500" : "bg-primary")}
            style={{ width: `${progress}%`, transition: progress >= 100 ? "none" : "width 0.05s linear" }}
          />
        </div>
        <button
          onClick={onCancel}
          className="px-5 py-2 rounded-lg border border-border bg-card text-muted-foreground text-sm hover:bg-muted transition-colors"
        >
          稍后在记录中查看，先回首页
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 `frontend/src/components/training/TrainingHeader.tsx`**

从 ChatTraining.tsx 第 521-612 行提取页头:

```tsx
import { ArrowLeft, Clock, Ear, EarOff, ListChecks, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPatientAvatar, type PatientInfo } from "@/utils/avatar";
import InquirySidebar from "./InquirySidebar";
import NursingRecordPanel from "@/components/nursing-record/NursingRecordPanel";
import type { ChatMessage } from "@/types/chat";

interface TrainingHeaderProps {
  patientName: string;
  caseTitle: string;
  patientInfo: PatientInfo | null;
  remaining: number | null;
  formatTime: (sec: number | null) => string;
  ending: boolean;
  messagesLength: number;
  inquiries: string[];
  studentMessages: ChatMessage[];
  showNursingRecord: boolean;
  onToggleNursingRecord: () => void;
  showPortrait: boolean;
  onTogglePortrait: () => void;
  voiceAutoPlay: boolean;
  voiceSpeechSupported: boolean;
  onToggleAutoPlay: () => void;
  recordId: string;
  onBack: () => void;
  onEnd: () => void;
}

export default function TrainingHeader({
  patientName,
  caseTitle,
  patientInfo,
  remaining,
  formatTime,
  ending,
  messagesLength,
  inquiries,
  studentMessages,
  showNursingRecord,
  onToggleNursingRecord,
  voiceAutoPlay,
  voiceSpeechSupported,
  onToggleAutoPlay,
  recordId,
  onBack,
  onEnd,
}: TrainingHeaderProps) {
  return (
    <header
      className="shrink-0 border-b border-border bg-card px-4 pb-3 sm:px-4 sm:py-0 sm:h-14"
      style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
    >
      <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
        <button
          className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors"
          onClick={onBack}
          title="返回首页"
          aria-label="返回首页"
        >
          <ArrowLeft size={16} className="sm:size-[18px]" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img
            className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
            src={getPatientAvatar(patientInfo)}
            alt={patientName || "虚拟患者"}
          />
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-semibold text-foreground truncate">{patientName || "虚拟患者"}</div>
            <div className="text-[0.65rem] sm:text-xs text-muted-foreground truncate">{caseTitle}</div>
          </div>
        </div>

        <div
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border bg-card shrink-0",
            remaining !== null && remaining <= 120 && "border-red-200 bg-red-50 text-red-600",
            remaining !== null && remaining > 120 && remaining <= 300 && "border-amber-200 bg-amber-50 text-amber-600",
            remaining === null || remaining > 300 ? "border-border text-muted-foreground" : "",
          )}
        >
          <Clock size={12} className="sm:size-[14px] shrink-0" />
          <span>{formatTime(remaining)}</span>
        </div>

        <div className="flex items-center gap-1 sm:gap-1.5">
          <InquirySidebar inquiries={inquiries} studentMessages={studentMessages} />

          <NursingRecordPanel isOpen={showNursingRecord} onToggle={onToggleNursingRecord} recordId={recordId} />

          {voiceSpeechSupported && (
            <button
              className={cn(
                "w-8 h-8 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
                voiceAutoPlay && "border-primary bg-primary/10 text-primary hover:bg-primary/20",
              )}
              onClick={onToggleAutoPlay}
              title={voiceAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
              aria-label={voiceAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
            >
              {voiceAutoPlay ? <Ear size={14} className="sm:size-[16px]" /> : <EarOff size={14} className="sm:size-[16px]" />}
            </button>
          )}

          <button
            className="flex items-center gap-1 px-2.5 h-8 rounded-md border border-destructive/30 bg-card text-destructive text-xs sm:text-sm font-medium shrink-0 hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={onEnd}
            disabled={ending || messagesLength <= 1}
            aria-label="结束训练"
          >
            <Phone size={13} className="sm:size-[15px] sm:block hidden" />
            <span className="sm:hidden">结束</span>
            <span className="hidden sm:inline">{ending ? "评分中..." : "结束训练"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: 创建 `frontend/src/components/training/ChatInput.tsx`**

从 ChatTraining.tsx 第 698-769 行提取输入区域:

```tsx
import { type KeyboardEvent } from "react";
import { Mic, MicOff, RefreshCw, Send, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  input: string;
  onInputChange: (value: string) => void;
  onSend: (retryContent?: string) => void;
  onVoiceInput: () => void;
  loading: boolean;
  ending: boolean;
  remaining: number | null;
  isOnline: boolean;
  isListening: boolean;
  voiceSupported: boolean;
  failedMessage: string | null;
  maxLength?: number;
}

export default function ChatInput({
  input,
  onInputChange,
  onSend,
  onVoiceInput,
  loading,
  ending,
  remaining,
  isOnline,
  isListening,
  voiceSupported,
  failedMessage,
  maxLength = 2000,
}: ChatInputProps) {
  const isDisabled = loading || ending || remaining === 0 || !isOnline;

  return (
    <div className="flex items-center gap-2 px-3 sm:px-6 py-3 bg-card border-t border-border shrink-0">
      {voiceSupported && (
        <button
          className={cn(
            "w-10 h-10 rounded-full border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
            isListening && "border-destructive bg-destructive/10 text-destructive",
          )}
          onClick={onVoiceInput}
          disabled={isDisabled}
          title={isListening ? "停止录音" : "语音输入"}
          aria-label={isListening ? "停止录音" : "语音输入"}
        >
          {isListening ? <MicOff size={18} /> : <Mic size={18} />}
        </button>
      )}

      {!isOnline && (
        <div className="flex items-center gap-1.5 text-xs text-amber-600 shrink-0">
          <WifiOff size={14} />
          <span className="hidden sm:inline">网络已断开</span>
        </div>
      )}

      {failedMessage && !loading ? (
        <button
          className="flex items-center gap-1.5 px-3 h-10 rounded-full border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium shrink-0 hover:bg-amber-100 transition-colors"
          onClick={() => onSend(failedMessage)}
        >
          <RefreshCw size={14} />
          <span>重新发送</span>
        </button>
      ) : null}

      <div className="flex items-center gap-2 flex-1 relative">
        <input
          type="text"
          value={input}
          maxLength={maxLength}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && !e.shiftKey && onSend()}
          placeholder={!isOnline ? "网络已断开" : remaining === 0 ? "训练时间已结束" : "输入你的问题，按 Enter 发送..."}
          disabled={isDisabled}
          className="flex-1 h-10 px-4 rounded-full border border-border bg-muted text-sm placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 focus:bg-background transition-all disabled:opacity-50"
        />
        {input.length > 0 && (
          <span
            className={cn(
              "absolute right-3 top-1/2 -translate-y-1/2 text-xs pointer-events-none",
              input.length >= maxLength
                ? "text-destructive font-medium"
                : input.length >= maxLength * 0.85
                  ? "text-amber-600"
                  : "text-muted-foreground/60",
            )}
          >
            {input.length}/{maxLength}
          </span>
        )}
      </div>

      <button
        className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        onClick={() => onSend()}
        disabled={!input.trim() || isDisabled}
        aria-label="发送消息"
      >
        <Send size={17} />
      </button>
    </div>
  );
}
```

- [ ] **Step 5: 验证 TypeScript 编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors in new training component files

- [ ] **Step 6: 提交**

```powershell
git add frontend/src/components/training/
git commit -m "refactor: extract ChatTraining sub-components (InquirySidebar, ScoringOverlay, TrainingHeader, ChatInput)"
```

---

### Task 2.3: 拆分 ChatTraining.tsx — 重构主组件

**Files:**
- Modify: `frontend/src/pages/ChatTraining.tsx` (rewrite to ~180 lines using new hooks + sub-components)

- [ ] **Step 1: 重写 ChatTraining.tsx 使用所有新 hooks 和子组件**

完全替换 `frontend/src/pages/ChatTraining.tsx` 内容。此文件应精简为协调器（orchestrator），将内联组件替换为导入。

注意：需要将所有 `from "@/api/api-client"` 的导入更新为对应的新模块路径。`endTraining` → `@/api/training`，`getRecordDetail` → `@/api/training`。

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStream } from "@/hooks/useChatStream";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useQuestionnaire } from "@/hooks/useQuestionnaire";
import { useRecordLoader } from "@/hooks/useRecordLoader";
import { useScorePolling } from "@/hooks/useScorePolling";
import { useScoreProgress } from "@/hooks/useScoreProgress";
import { useTrainingTimer } from "@/hooks/useTrainingTimer";
import { useTypingFreeze } from "@/hooks/useTypingFreeze";
import useVoice from "@/hooks/useVoice";
import { cn } from "@/lib/utils";
import ChatBubble from "@/components/ChatBubble";
import ChatInput from "@/components/training/ChatInput";
import ScoringOverlay from "@/components/training/ScoringOverlay";
import TrainingHeader from "@/components/training/TrainingHeader";
import OperationPanel from "@/components/OperationPanel";
import PatientPortrait from "@/components/PatientPortrait";
import ScoreCard from "@/components/ScoreCard";
import { QuestionnaireModal } from "@/components/QuestionnaireModal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import type { ChatMessage } from "@/types/chat";
import type { ScoreData } from "@/types/score";
import { getNurseAvatar, getPatientAvatar, type PatientInfo } from "@/utils/avatar";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();
  const [input, setInput] = useState("");
  const [ending, setEnding] = useState(false);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [showScore, setShowScore] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [patientName, setPatientName] = useState("");
  const [caseTitle, setCaseTitle] = useState("");
  const [requiredInquiries, setRequiredInquiries] = useState<string[]>([]);
  const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
  const [showPortrait, setShowPortrait] = useState(true);
  const [showNursingRecord, setShowNursingRecord] = useState(false);
  const [recordStatus, setRecordStatus] = useState<string | null>(null);
  const [caseId, setCaseId] = useState<number | null>(null);
  const [showPreQuestionnaire, setShowPreQuestionnaire] = useState(false);
  const [showPostQuestionnaire, setShowPostQuestionnaire] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const failedMessageRef = useRef<string | null>(null);
  const prevShowScoreRef = useRef(false);

  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const isOnline = useNetworkStatus();
  const voice = useVoice({ patientGender: patientInfo?.gender, patientAge: patientInfo?.age });

  const pendingContentRef = useRef("");
  const { messages, setMessages, send, loading, abortRef } = useChatStream(recordId ? Number(recordId) : null, {
    onPatientChunk: (chunk: string) => voice.speakStreamChunk(chunk),
    onPatientDone: () => voice.flushStreamSpeak(),
    onError: (err: string) => {
      toast.error(err);
      failedMessageRef.current = pendingContentRef.current;
    },
  });

  const { markTyping } = useTypingFreeze();

  const handleScoreReady = (data: ScoreData) => {
    setScore(data);
    setShowScore(true);
    fastForward();
  };

  const { executeEnd, scoreCancelRef } = useScorePolling({
    recordId: recordId ? Number(recordId) : null,
    onScoreReady: handleScoreReady,
    onPostTestCheck: () => postTest.check(),
  });

  const { remaining, formatTime, resetTimer, setRemaining, setTimerActive } = useTrainingTimer({
    initialRemaining: null,
    onAutoEnd: () => executeEnd(true),
  });

  useRecordLoader(recordId, {
    setMessages: (msgs) =>
      setMessages(
        (msgs as ChatMessage[]).map((m) => ({ ...m, streaming: false })),
      ),
    setCaseTitle,
    setRequiredInquiries,
    setPatientInfo: (info) => setPatientInfo(info as PatientInfo),
    setCaseId,
    setFeatures,
    setRecordStatus,
    setScore,
    setShowScore,
    onTimerReady: (r) => {
      resetTimer();
      if (r != null && r > 0) {
        setRemaining(r);
        setTimerActive(true);
      }
      if (r === null || r === 0) {
        setRemaining(null);
        setTimerActive(false);
      }
    },
    onPreTestCheck: () => preTest.check().then((result) => result ? { has_pending: result.has_pending } : undefined),
  });

  const { progress: scoreProgress, fastForward } = useScoreProgress(ending);

  useEffect(() => {
    if (!showScore) return;
    fastForward();
  }, [showScore, fastForward]);

  useEffect(() => {
    if (!scoreProgress && !showScore) return;
    if (prevShowScoreRef.current && !showScore && showOverlay) {
      setShowOverlay(false);
    }
    prevShowScoreRef.current = showScore;
  }, [showScore, showOverlay, scoreProgress]);

  useEffect(() => {
    if (scoreProgress >= 100 && showScore) {
      const timer = setTimeout(() => setShowOverlay(false), 300);
      return () => clearTimeout(timer);
    }
  }, [scoreProgress, showScore]);

  const preTest = useQuestionnaire({
    caseId,
    trigger: "before_training",
    onComplete: () => setShowPreQuestionnaire(false),
  });

  const postTest = useQuestionnaire({
    caseId,
    recordId: recordId ? Number(recordId) : null,
    trigger: "after_scoring",
    onComplete: () => setShowPostQuestionnaire(false),
  });

  const studentMessages = useMemo(() => messages.filter((m) => m.role === "student"), [messages]);

  const handleSend = async (retryContent?: string) => {
    const content = retryContent || input.trim();
    if (!content || loading) return;
    if (content.length > 2000) return;
    if (retryContent) {
      failedMessageRef.current = null;
    } else {
      setInput("");
    }
    pendingContentRef.current = content;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    voice.resetSpeakState();
    await send(content);
  };

  const handleEnd = async () => {
    const ok = await confirm({
      title: "结束训练",
      message: "确定结束本次训练吗？结束后将自动评分，可能需要等待数十秒。",
      confirmLabel: "确定结束",
      danger: true,
    });
    if (!ok) return;
    setEnding(true);
    setShowOverlay(true);
    executeEnd(false);
  };

  const toggleVoice = () => {
    voice.startListening().then(
      (text) => setInput(text),
      (err) => {
        if (err.error === "not-allowed") toast.warning("麦克风权限被拒绝，请在浏览器设置中允许");
        else if (err.error === "no-speech") toast.info("未检测到语音，请重试");
        else if (err.message) toast.info(err.message);
        else toast.info("语音识别失败，请重试");
      },
    );
  };

  const handleSpeakToggle = (text: string) => {
    if (voice.isSpeaking) {
      voice.stopSpeak();
    } else {
      voice.speakRaw(text);
    }
  };

  return (
    <div className="flex flex-col h-dvh bg-background">
      <TrainingHeader
        patientName={patientName}
        caseTitle={caseTitle}
        patientInfo={patientInfo}
        remaining={remaining}
        formatTime={formatTime}
        ending={ending}
        messagesLength={messages.length}
        inquiries={requiredInquiries}
        studentMessages={studentMessages}
        showNursingRecord={showNursingRecord}
        onToggleNursingRecord={() => setShowNursingRecord((v) => !v)}
        showPortrait={showPortrait}
        onTogglePortrait={() => setShowPortrait((v) => !v)}
        voiceAutoPlay={voice.autoPlay}
        voiceSpeechSupported={voice.speechSupported.synthesis}
        onToggleAutoPlay={() => {
          if (voice.autoPlay) voice.stopSpeak();
          voice.setAutoPlay(!voice.autoPlay);
        }}
        recordId={recordId || "default"}
        onBack={async () => {
          const isActive = remaining != null && remaining > 0 && !score && !ending;
          if (isActive) {
            const ok = await confirm({
              title: "离开训练",
              message: "训练还在进行中，离开将丢失当前进度，确认离开吗？",
              confirmLabel: "确认离开",
              danger: true,
            });
            if (!ok) return;
          }
          navigate("/home");
        }}
        onEnd={handleEnd}
      />

      <div className="flex flex-1 overflow-hidden relative">
        <PatientPortrait patientInfo={patientInfo} collapsed={!showPortrait} onToggle={() => setShowPortrait((v) => !v)} />

        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 flex flex-col gap-3 sm:gap-4 w-full">
          <div className="flex-1" />

          {messages.length <= 1 && (
            <div className="text-center py-12 sm:py-16 text-muted-foreground">
              <div className="flex items-center justify-center mb-4">
                <img className="w-12 h-12 rounded-full object-cover bg-muted ring-2 ring-border" src={getPatientAvatar(patientInfo)} alt="患者" />
              </div>
              <p className="text-sm font-medium text-foreground/70">请按照护理评估流程与患者交流</p>
              <span className="text-xs block mt-1 text-muted-foreground/70">从主诉开始，逐步了解现病史、既往史、用药史等信息</span>
            </div>
          )}

          {remaining == null && recordStatus === "completed" && !score && messages.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-3 mb-3 text-sm text-amber-700 dark:text-amber-400">
              训练已结束，暂无评分。可在记录详情中请求评分。
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatBubble
              key={msg.id ?? i}
              message={msg}
              patientAvatar={getPatientAvatar(patientInfo)}
              nurseAvatar={getNurseAvatar()}
              showSpeakButton={voice.speechSupported.synthesis && !voice.autoPlay}
              isSpeaking={voice.isSpeaking}
              onSpeakToggle={handleSpeakToggle}
            />
          ))}

          {loading && !messages.some((m) => m.streaming) && (
            <>
              <div className="flex items-end gap-2 justify-start">
                <img className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted" src={getPatientAvatar(patientInfo)} alt="患者" />
                <div className="bg-card text-foreground border border-border rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              </div>
              <div className="flex justify-center mt-2">
                <button
                  onClick={() => {
                    scoreCancelRef.current = true;
                    setEnding(false);
                    setShowOverlay(false);
                  }}
                  className="px-4 py-1.5 rounded-lg border border-border bg-card text-muted-foreground text-xs hover:bg-muted transition-colors"
                >
                  跳过等待，稍后在记录中查看
                </button>
              </div>
            </>
          )}

          {remaining === 0 && (
            <div className="text-center mx-2 sm:mx-4 px-4 py-3 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-sm font-semibold">
              训练时间已结束，系统正在自动评分...
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {features.physical_exam && (
        <div className="flex items-center gap-2 px-3 sm:px-6 py-1.5 bg-card border-t border-border shrink-0">
          <OperationPanel
            onOperation={(cmd) => {
              setInput(cmd);
              handleSend(cmd);
            }}
            results={[]}
            disabled={loading || ending || remaining === 0 || !isOnline}
          />
        </div>
      )}

      <ChatInput
        input={input}
        onInputChange={(v) => {
          setInput(v);
          markTyping();
        }}
        onSend={handleSend}
        onVoiceInput={toggleVoice}
        loading={loading}
        ending={ending}
        remaining={remaining}
        isOnline={isOnline}
        isListening={voice.isListening}
        voiceSupported={voice.speechSupported.recognition}
        failedMessage={failedMessageRef.current}
      />

      {showOverlay && (
        <ScoringOverlay
          progress={scoreProgress}
          onCancel={() => {
            scoreCancelRef.current = true;
            setEnding(false);
            setShowOverlay(false);
            navigate("/home");
          }}
          onGoHome={() => navigate("/home")}
        />
      )}

      {showScore && score && (
        <ScoreCard
          score={score}
          onClose={() => setShowScore(false)}
          onRetry={() => navigate("/cases")}
          onGoHome={() =>
            navigate("/home", {
              state: { feedbackPrompt: Date.now() },
            })
          }
        />
      )}

      {showPreQuestionnaire && preTest.checkResponse && (
        <QuestionnaireModal
          open={showPreQuestionnaire}
          onComplete={() => setShowPreQuestionnaire(false)}
          onSkip={() => setShowPreQuestionnaire(false)}
          checkResponse={preTest.checkResponse}
          loading={preTest.isLoading}
          onSubmit={preTest.submit}
        />
      )}

      {showPostQuestionnaire && postTest.checkResponse && (
        <QuestionnaireModal
          open={showPostQuestionnaire}
          onComplete={() => setShowPostQuestionnaire(false)}
          onSkip={() => setShowPostQuestionnaire(false)}
          checkResponse={postTest.checkResponse}
          loading={postTest.isLoading}
          onSubmit={postTest.submit}
        />
      )}

      <style>{`
        .typing-dots {
          display: flex;
          gap: 4px;
          padding: 2px 0;
        }
        .typing-dots span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: hsl(var(--muted-foreground) / 0.4);
          animation: bounce-dot 1.4s infinite ease-in-out;
        }
        .typing-dots span:nth-child(1) { animation-delay: -0.32s; }
        .typing-dots span:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce-dot {
          0%, 80%, 100% { transform: scale(0.3); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 2: 清理未使用的导入**

确保移除以下不再需要的导入（已在 hooks 或子组件中定义）：
- `extractKeywords`, `getInquiryLabel` 函数 — 已移至 InquirySidebar
- `InquirySidebar` 组件 — 已作为独立文件
- `endTraining`, `getRecordDetail` 从 `api-client` 的导入 — 已移至 hooks
- `ArrowLeft`, `CheckCircle2`, `Circle`, `Clock`, `Ear`, `EarOff`, `ListChecks`, `Mic`, `MicOff`, `Phone`, `RefreshCw`, `Send`, `WifiOff`, `X` — 部分已移至子组件

- [ ] **Step 3: 验证 TypeScript 编译通过且无未使用变量**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: 运行 Biome lint**

```powershell
npx biome check --write frontend/src/pages/ChatTraining.tsx frontend/src/components/training/ frontend/src/hooks/
```

Expected: No errors or fixed

- [ ] **Step 5: 提交**

```powershell
git add frontend/src/pages/ChatTraining.tsx
git commit -m "refactor: rewrite ChatTraining as thin orchestrator with extracted hooks and components"
```

---

### Task 2.4: 拆分 QuestionnairesTab.tsx

**Files:**
- Create: `frontend/src/components/teacher/questionnaires/QuestionnaireList.tsx`
- Create: `frontend/src/components/teacher/questionnaires/QuestionnaireEditor.tsx`
- Create: `frontend/src/components/teacher/questionnaires/QuestionnaireStats.tsx`
- Create: `frontend/src/components/teacher/questionnaires/QuestionnaireAssign.tsx`
- Create: `frontend/src/components/teacher/questionnaires/useQuestionnaireMutations.ts`
- Create: `frontend/src/components/teacher/questionnaires/types.ts`
- Modify: `frontend/src/components/teacher/QuestionnairesTab.tsx` (rewrite to thin orchestrator)

- [ ] **Step 1: 创建 `frontend/src/components/teacher/questionnaires/types.ts`**

提取 QuestionnairesTab.tsx 中的所有本地类型:

```ts
export interface TemplateListItem {
  id: number;
  title: string;
  type: string;
  description?: string;
  is_active: boolean;
  question_count: number;
  response_count: number;
  school_id?: number;
  created_at: string;
  updated_at: string;
}

export interface QuestionItem {
  id: number;
  content: string;
  question_type: string;
  required: boolean;
  sort_order: number;
  options?: string[];
}

export interface TemplateDetail extends TemplateListItem {
  questions: QuestionItem[];
  case_ids: number[];
}

export interface QuestionForm {
  id?: number;
  content: string;
  question_type: string;
  required: boolean;
  sort_order: number;
  options: string[];
}

export interface TemplateForm {
  title: string;
  type: string;
  description: string;
  is_active: boolean;
  questions: QuestionForm[];
}

export interface CaseBrief {
  id: number;
  title: string;
  case_type: string;
}

export interface StatsData {
  total_responses: number;
  average_score?: number;
  score_distribution?: Record<string, number>;
  question_stats?: Array<{
    question_id: number;
    content: string;
    question_type: string;
    answers: Record<string, number>;
  }>;
}

export type ViewMode = "list" | "stats" | "editor" | "assign";
```

- [ ] **Step 2: 创建 `frontend/src/components/teacher/questionnaires/useQuestionnaireMutations.ts`**

从 QuestionnairesTab.tsx 提取所有 mutation 逻辑:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createQuestionnaireTemplate,
  deleteQuestionnaireTemplate,
  updateQuestionnaireTemplate,
} from "@/api/questionnaires";
import { queryKeys } from "@/api/query-keys";
import type { TemplateDetail } from "./types";

const TEN_MINUTES = 10 * 60 * 1000;

export function useQuestionnaireMutations() {
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createQuestionnaireTemplate>[0]) => createQuestionnaireTemplate(data),
    onSuccess: (response) => {
      toast.success("问卷创建成功");
      queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all, stale: true });
      return response.data as TemplateDetail;
    },
    onError: () => toast.error("创建失败"),
    gcTime: TEN_MINUTES,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof updateQuestionnaireTemplate>[1] }) =>
      updateQuestionnaireTemplate(id, data),
    onSuccess: () => {
      toast.success("问卷更新成功");
      queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all, stale: true });
    },
    onError: () => toast.error("更新失败"),
    gcTime: TEN_MINUTES,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteQuestionnaireTemplate(id),
    onSuccess: () => {
      toast.success("问卷删除成功");
      queryClient.invalidateQueries({ queryKey: queryKeys.questionnaires.all, stale: true });
    },
    onError: () => toast.error("删除失败"),
    gcTime: TEN_MINUTES,
  });

  return { createMutation, updateMutation, deleteMutation };
}
```

- [ ] **Step 3: 创建 `frontend/src/components/teacher/questionnaires/QuestionnaireList.tsx`**

从 QuestionnairesTab.tsx 提取列表视图（包含表格、分页、搜索、操作按钮）。

需要包含:
- 模板列表表格（第 558-661 行附近的 JSX）
- 分页控件
- 类型过滤下拉框
- 创建/编辑/删除/查看统计/下发问卷的操作按钮
- `useQuery` 获取 `questionnaireTemplates` 和 `cases`

具体代码过长在此省略，但须包含完整的表格渲染逻辑。文件预计约 200 行。

- [ ] **Step 4: 创建 `frontend/src/components/teacher/questionnaires/QuestionnaireEditor.tsx`**

从 QuestionnairesTab.tsx 提取编辑/新建弹窗（第 663-857 行附近的 JSX），包含题目管理 UI（添加/删除/排序/类型切换）。

文件预计约 250 行。

- [ ] **Step 5: 创建 `frontend/src/components/teacher/questionnaires/QuestionnaireStats.tsx`**

从 QuestionnairesTab.tsx 提取统计视图（第 441-553 行附近的 JSX）。

文件预计约 150 行。

- [ ] **Step 6: 创建 `frontend/src/components/teacher/questionnaires/QuestionnaireAssign.tsx`**

从 QuestionnairesTab.tsx 提取下发弹窗（第 859-952 行附近的 JSX）。

文件预计约 130 行。

- [ ] **Step 7: 重写 `QuestionnairesTab.tsx` 为 thin orchestrator**

重写后的文件约为 80-120 行，仅作为状态协调器（view mode 切换、selected template 状态、modal 开关），渲染对应的子组件。

- [ ] **Step 8: 验证 TypeScript 编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 9: 提交**

```powershell
git add frontend/src/components/teacher/questionnaires/ frontend/src/components/teacher/QuestionnairesTab.tsx
git commit -m "refactor: decompose QuestionnairesTab into sub-components (list, editor, stats, assign)"
```

---

### Task 2.5: 拆分 CasesTab.tsx

**Files:**
- Create: `frontend/src/components/teacher/cases/CaseList.tsx`
- Create: `frontend/src/components/teacher/cases/CaseForm.tsx`
- Create: `frontend/src/components/teacher/cases/useCaseMutations.ts`
- Create: `frontend/src/components/teacher/cases/types.ts`
- Modify: `frontend/src/components/teacher/CasesTab.tsx` (rewrite to thin orchestrator)

- [ ] **Step 1: 创建 `frontend/src/components/teacher/cases/types.ts`**

从 CasesTab.tsx 提取所有本地类型。

- [ ] **Step 2: 创建 `frontend/src/components/teacher/cases/useCaseMutations.ts`**

提取 create/update/delete + AI generation 的 useMutation 调用。

- [ ] **Step 3: 创建 `frontend/src/components/teacher/cases/CaseList.tsx`**

提取病例列表 tableView（表格、搜索、过滤、分页），包含 AI 生成面板。

- [ ] **Step 4: 创建 `frontend/src/components/teacher/cases/CaseForm.tsx`**

提取病例编辑/新建表单弹窗（包含 4+ fieldset 和 JSON 导入）。

- [ ] **Step 5: 重写 `CasesTab.tsx` 为 thin orchestrator**

重写后约为 100 行。

- [ ] **Step 6: 验证 TypeScript 编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 7: 提交**

```powershell
git add frontend/src/components/teacher/cases/ frontend/src/components/teacher/CasesTab.tsx
git commit -m "refactor: decompose CasesTab into sub-components (list, form)"
```

---

### Task 2.6: 拆分 UsersTab.tsx + 迁移到 React Query

**Files:**
- Create: `frontend/src/components/teacher/users/UserList.tsx`
- Create: `frontend/src/components/teacher/users/UserForm.tsx`
- Create: `frontend/src/components/teacher/users/BatchImport.tsx`
- Create: `frontend/src/components/teacher/users/useUserMutations.ts`
- Create: `frontend/src/components/teacher/users/types.ts`
- Modify: `frontend/src/components/teacher/UsersTab.tsx` (rewrite using React Query)

- [ ] **Step 1: 创建 `frontend/src/components/teacher/users/types.ts`**

从 UsersTab.tsx 提取所有本地类型。

- [ ] **Step 2: 创建 `frontend/src/components/teacher/users/useUserMutations.ts`**

将当前 UsersTab 中的手动 useState + useEffect + API 调用迁移到 React Query `useQuery` + `useMutation` 模式，使用 `queryKeys.admin.users.*`。

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { batchCreateUsers, deleteUser, getUsers, updateUser } from "@/api/admin/users";
import { queryKeys } from "@/api/query-keys";

export function useUserList(offset: number, filters: Record<string, unknown>) {
  return useQuery({
    queryKey: queryKeys.admin.users.list({ offset, filters }),
    queryFn: () => getUsers({ offset, ...filters }).then((r) => r.data),
    placeholderData: (prev) => prev,
  });
}

export function useUserMutations() {
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number | string; data: Parameters<typeof updateUser>[1] }) =>
      updateUser(id, data),
    onSuccess: () => {
      toast.success("用户更新成功");
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all, stale: true });
    },
    onError: () => toast.error("更新失败"),
  });

  const batchCreateMutation = useMutation({
    mutationFn: (users: Parameters<typeof batchCreateUsers>[0]) => batchCreateUsers(users),
    onSuccess: (response) => {
      toast.success(`成功创建 ${response.data.created || 0} 个用户`);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all, stale: true });
    },
    onError: () => toast.error("批量创建失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number | string) => deleteUser(id),
    onSuccess: () => {
      toast.success("用户删除成功");
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.users.all, stale: true });
    },
    onError: () => toast.error("删除失败"),
  });

  return { updateMutation, batchCreateMutation, deleteMutation };
}
```

- [ ] **Step 3: 创建 `frontend/src/components/teacher/users/UserList.tsx`**

提取用户列表表格视图。

- [ ] **Step 4: 创建 `frontend/src/components/teacher/users/UserForm.tsx`**

提取用户编辑/新建弹窗。

- [ ] **Step 5: 创建 `frontend/src/components/teacher/users/BatchImport.tsx`**

提取批量导入弹窗。

- [ ] **Step 6: 重写 `UsersTab.tsx` 为 thin orchestrator + React Query**

重写后约为 100 行，使用 `useUserList` 和 `useUserMutations`。

- [ ] **Step 7: 验证 TypeScript 编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 8: 提交**

```powershell
git add frontend/src/components/teacher/users/ frontend/src/components/teacher/UsersTab.tsx
git commit -m "refactor: decompose UsersTab + migrate to React Query"
```

---

### Task 2.7: 拆分 PromptManagementTab.tsx

**Files:**
- Create: `frontend/src/components/teacher/prompts/PromptList.tsx`
- Create: `frontend/src/components/teacher/prompts/PromptForm.tsx`
- Create: `frontend/src/components/teacher/prompts/usePromptMutations.ts`
- Create: `frontend/src/components/teacher/prompts/types.ts`
- Modify: `frontend/src/components/teacher/PromptManagementTab.tsx` (rewrite to thin orchestrator)

- [ ] **Step 1: 按照 QuestionnairesTab 和 CasesTab 相同的分解模式**

创建 types.ts、usePromptMutations.ts、PromptList.tsx、PromptForm.tsx，然后重写 PromptManagementTab.tsx。

- [ ] **Step 2: 验证 TypeScript 编译通过**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: 提交**

```powershell
git add frontend/src/components/teacher/prompts/ frontend/src/components/teacher/PromptManagementTab.tsx
git commit -m "refactor: decompose PromptManagementTab into sub-components"
```

---

## Phase 3: Feature-First 目录重组

### Task 3.1: 创建 training feature 目录并移动相关组件

**Files:**
- Move: `frontend/src/components/ScoreCard.tsx` → `frontend/src/components/training/ScoreCard.tsx`
- Move: `frontend/src/components/OperationPanel.tsx` → `frontend/src/components/training/OperationPanel.tsx`
- Move: `frontend/src/components/PatientPortrait.tsx` → `frontend/src/components/training/PatientPortrait.tsx`
- Modify: all files importing from the old paths

- [ ] **Step 1: 使用 `git mv` 移动文件**

```powershell
git mv frontend/src/components/ScoreCard.tsx frontend/src/components/training/ScoreCard.tsx
git mv frontend/src/components/OperationPanel.tsx frontend/src/components/training/OperationPanel.tsx
git mv frontend/src/components/PatientPortrait.tsx frontend/src/components/training/PatientPortrait.tsx
```

- [ ] **Step 2: 更新所有导入路径**

查找并更新所有引用旧路径的文件:

- ChatTraining.tsx 中的 `@/components/ScoreCard` → `@/components/training/ScoreCard`
- ChatTraining.tsx 中的 `@/components/OperationPanel` → `@/components/training/OperationPanel`
- ChatTraining.tsx 中的 `@/components/PatientPortrait` → `@/components/training/PatientPortrait`
- RecordDetail.tsx 中的 `@/components/ScoreCard` → `@/components/training/ScoreCard`

- [ ] **Step 3: 验证 TypeScript 编译**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: 提交**

```powershell
git add -A
git commit -m "refactor: move training-specific components to components/training/"
```

---

### Task 3.2: 移动 dashboard-only 和 login-only 组件

**Files:**
- Move: `frontend/src/components/TrainingDurationChart.tsx` → `frontend/src/components/dashboard/TrainingDurationChart.tsx`
- Move: `frontend/src/components/LoginIllustration.tsx` → `frontend/src/components/login/LoginIllustration.tsx`

- [ ] **Step 1: 使用 `git mv` 移动文件**

```powershell
git mv frontend/src/components/TrainingDurationChart.tsx frontend/src/components/dashboard/TrainingDurationChart.tsx
git mv frontend/src/components/LoginIllustration.tsx frontend/src/components/login/LoginIllustration.tsx
```

- [ ] **Step 2: 更新 DashboardHome.tsx 和 Login.tsx 中的导入路径**

```powershell
# 在 DashboardHome.tsx 中
# @/components/TrainingDurationChart → @/components/dashboard/TrainingDurationChart

# 在 Login.tsx 中
# @/components/LoginIllustration → @/components/login/LoginIllustration
```

- [ ] **Step 3: 验证 TypeScript 编译**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: 提交**

```powershell
git add -A
git commit -m "refactor: move dashboard and login components to feature directories"
```

---

## Phase 4: 质量加固

### Task 4.1: 导入路径统一（`@/` alias）

**Files:**
- Modify: `frontend/src/components/Layout.tsx` (lines 34-36)
- Modify: `frontend/src/components/FeedbackModal.tsx` (lines 5-6)

- [ ] **Step 1: 修复 Layout.tsx 中的相对导入**

将:
```ts
import useAuthStore from "../stores/authStore";
import useSchoolStore from "../stores/schoolStore";
import { APP_VERSION } from "../version";
```

改为:
```ts
import useAuthStore from "@/stores/authStore";
import useSchoolStore from "@/stores/schoolStore";
import { APP_VERSION } from "@/version";
```

同时更新 `import { useFeedback } from "./FeedbackProvider";` → `import { useFeedback } from "@/components/FeedbackProvider";`
和 `import Modal from "./ui/Modal";` → `import Modal from "@/components/ui/Modal";`

- [ ] **Step 2: 修复 FeedbackModal.tsx 中的相对导入**

将:
```ts
import { useToast } from "./Toast";
import Modal from "./ui/Modal";
```

改为:
```ts
import { useToast } from "@/components/Toast";
import Modal from "@/components/ui/Modal";
```

- [ ] **Step 3: 验证 TypeScript 编译**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 4: 提交**

```powershell
git add frontend/src/components/Layout.tsx frontend/src/components/FeedbackModal.tsx
git commit -m "style: normalize imports to use @/ alias consistently"
```

---

### Task 4.2: 状态管理清理

**Files:**
- Delete: `frontend/src/stores/llmStore.ts`
- Modify: `frontend/src/stores/gradesClassesStore.ts` (移除 server state，保留纯 UI state)
- Modify: `frontend/src/types/store.ts` (移除 LLMState)
- Modify: `frontend/src/types/index.ts` (同步更新)
- Modify: all files importing from llmStore

- [ ] **Step 1: 查找所有 llmStore 的导入**

```powershell
rg "llmStore" frontend/src --files-with-matches
```

Expected: 可能需要更新的文件有 `LLMManagementPage.tsx` 和其他使用 llmStore 的组件。

- [ ] **Step 2: 将所有 llmStore 使用替换为 URL search params 或 local useState**

在 LLMManagementPage.tsx 及其他使用 llmStore 的文件中，将 `useLLMStore(s => s.tab)` / `useLLMStore(s => s.setTab)` 替换为:

```tsx
import { useSearchParams } from "react-router-dom";

// 替换 store
const [searchParams, setSearchParams] = useSearchParams();
const tab = searchParams.get("tab") || "monitor";
const setTab = (t: string) => setSearchParams({ tab: t });
```

- [ ] **Step 3: 删除 llmStore.ts 文件并更新 types**

```powershell
git rm frontend/src/stores/llmStore.ts
```

更新 `types/store.ts`，移除 `LLMState` 接口和相关的 `LLMState` 导出。

更新 `types/index.ts`，移除 `export type * from "./store";` 中已不存在的 LLMState（实际上 store.ts 中不再导出即可）。

- [ ] **Step 4: 更新 gradesClassesStore 仅保留 UI 状态**

将 `gradesClassesStore.ts` 中的数据获取和 API 调用逻辑移除，仅保留 UI 状态（如选中的 gradeId、展开/折叠状态）。数据获取迁移到对应的 React Query hooks 中。

实际上，由于 gradesClassesStore 被 GradesClassesPage 使用，且 API 调用在 store 中已有完整实现，当前阶段的最小化改造是:

```ts
// 不在 Phase 4 中强制拆分 gradesClassesStore
// 仅移除 LLMState 和 llmStore
```

保持 gradesClassesStore 不变，仅删除 llmStore。

- [ ] **Step 5: 验证 TypeScript 编译**

```powershell
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 6: 提交**

```powershell
git add -A
git commit -m "refactor: remove llmStore, migrate tab state to URL search params"
```

---

### Task 4.3: 死代码清理

**Files:**
- Delete: `frontend/src/components/Button.tsx` (空文件)
- Delete: `frontend/src/components/form.tsx` (空文件)
- Delete: `frontend/src/components/teacher/RecordsTab.tsx` (217 行，未使用)

- [ ] **Step 1: 删除死代码文件**

```powershell
git rm frontend/src/components/Button.tsx
git rm frontend/src/components/form.tsx
git rm frontend/src/components/teacher/RecordsTab.tsx
```

- [ ] **Step 2: 验证无引用报错**

```powershell
npx tsc --noEmit
```

Expected: No errors (确认无代码引用这些文件)

- [ ] **Step 3: 提交**

```powershell
git add -A
git commit -m "chore: remove dead code (empty files + unused RecordsTab)"
```

---

### Task 4.4: 启用 Biome a11y 规则

**Files:**
- Modify: `frontend/biome.json`

- [ ] **Step 1: 启用基础 a11y 规则**

在 `biome.json` 的 `linter.rules` 部分，将以下规则从 `"off"` 改为 `"warn"`:

```json
{
  "linter": {
    "rules": {
      "a11y": {
        "useButtonType": "warn",
        "noStaticElementInteractions": "warn"
      }
    }
  }
}
```

- [ ] **Step 2: 运行 Biome check，查看警告数量**

```powershell
npx biome check frontend/src/
```

Expected: 出现 a11y 警告（预估 20-50 条），记录数量作为基线。

- [ ] **Step 3: 修复 a11y 警告**

对于每一条 a11y 警告:
- `useButtonType`: 给 `<button>` 添加 `type="button"` 属性
- `noStaticElementInteractions`: 为有 onClick 的非交互元素添加 `role` 和 `onKeyDown`

- [ ] **Step 4: 验证修复后无警告**

```powershell
npx biome check frontend/src/
```

Expected: No a11y warnings (或警告数显著减少)

- [ ] **Step 5: 提交**

```powershell
git add frontend/biome.json
git add -A  # 修复的组件文件
git commit -m "chore: enable a11y rules (useButtonType, noStaticElementInteractions) and fix violations"
```

---

## Phase 5: 收尾

### Task 5.1: 全局 TypeScript 编译 + Biome 最终检查

- [ ] **Step 1: 运行完整 TypeScript 检查**

```powershell
npx tsc --noEmit
```

Expected: Zero errors

- [ ] **Step 2: 运行 Biome 格式化 + lint**

```powershell
npx biome check --write frontend/src/
```

Expected: No errors, all files formatted

- [ ] **Step 3: 如果剩余 a11y 规则想启用，重复 Phase 4.4 模式**

```json
// biome.json 中逐步启用:
"useKeyWithClickEvents": "warn",
"useValidAriaRole": "warn",
"noLabelWithoutControl": "warn",
"noAutofocus": "warn"
```

- [ ] **Step 4: 提交**

```powershell
git add -A
git commit -m "chore: final TypeScript + Biome lint pass"
```

---

### Task 5.2: 运行测试验证

- [ ] **Step 1: 运行现有测试**

```powershell
npx vitest run
```

Expected: All existing tests pass (test imports may need updating for moved files)

- [ ] **Step 2: 如果测试失败，修复导入路径**

检查测试文件中的导入路径是否因文件移动而失效:
- `__tests__/authStore.test.ts` 中的 `@/api/api-client` 导入应仍有效（barrel re-export）
- `__tests__/stores.test.ts` 中的 `@/stores/llmStore` 导入需要移除或更新

- [ ] **Step 3: 再次运行测试确认通过**

```powershell
npx vitest run
```

Expected: All tests pass

- [ ] **Step 4: 提交**

```powershell
git add -A
git commit -m "test: fix test imports after restructuring"
```

---

### Task 5.3: Vite 构建验证

- [ ] **Step 1: 执行生产构建**

```powershell
npm run build
```

Expected: 构建成功，无错误。输出在 `frontend/dist/`。

- [ ] **Step 2: 检查构建输出大小**

```powershell
Get-ChildItem -Recurse dist -File | Measure-Object -Property Length -Sum
```

记录构建产物总大小作为基线对比。

- [ ] **Step 3: 验证 chunk 分割正确**

检查是否仍然生成了 `vendor.js`, `icons.js`, `charts.js`, `markdown.js` 以及各 lazy 页面的 chunk。

---

## 执行顺序摘要

```
Phase 1: 基础设施（Week 1-2）
  Task 1.1 → Query Key Factory
  Task 1.2 → 提取共享 ScoreData 类型
  Task 1.3 → v7 Layout Routes 迁移
  Task 1.4 → api-client.ts 拆分

Phase 2: 巨型组件分解（Week 3-5）
  Task 2.1 → 提取 ChatTraining hooks
  Task 2.2 → 提取 ChatTraining 子组件
  Task 2.3 → 重构 ChatTraining 主组件
  Task 2.4 → 拆分 QuestionnairesTab
  Task 2.5 → 拆分 CasesTab
  Task 2.6 → 拆分 UsersTab + React Query 迁移
  Task 2.7 → 拆分 PromptManagementTab

Phase 3: 目录重组（Week 6-7）
  Task 3.1 → training feature 目录
  Task 3.2 → dashboard/login feature 目录

Phase 4: 质量加固（Week 8-9）
  Task 4.1 → 导入路径统一
  Task 4.2 → 状态管理清理
  Task 4.3 → 死代码清理
  Task 4.4 → a11y 规则启用

Phase 5: 收尾（Week 10）
  Task 5.1 → 全局 TS + Biome 检查
  Task 5.2 → 测试验证
  Task 5.3 → 构建验证
```

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| v7 Layout Routes 路由行为不一致 | Task 1.3 完成后对每个路由做手工冒烟测试 |
| api-client 拆分导致导入失效 | barrel re-export 保证 100% 向后兼容；全部 import 维持 `@/api/api-client` |
| ChatTraining 重构引入回归 | 拆分前 ChatTraining 已是 835 行无测试的组件；拆分后至少 hooks 可独立测试 |
| 文件移动导致 Git 历史丢失 | 使用 `git mv` 保留文件历史 |
| Teacher Tab 拆分遗漏功能 | 每个拆分保持原文件作为 thin orchestrator，子组件仅在 orchestrator 中引用 |
