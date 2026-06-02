# OpenAPI-Driven Frontend Rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete backend OpenAPI spec → Auto-generate TypeScript client → Replace hand-written api.js → Full .jsx→.tsx migration → Radix UI component adoption. Backend and frontend run in parallel git worktrees.

**Architecture:** Backend track adds `response_model=` to 32 endpoints (zero logic changes). Frontend track uses `openapi-typescript` to generate types from `/openapi.json`, wraps existing axios interceptors in a typed client, then replaces all manual API imports and migrates remaining .jsx→.tsx with generated DTO types. Radix UI Dialog/AlertDialog/Tabs replace custom Modal/ConfirmDialog/Tabs.

**Tech Stack:** Python/FastAPI/Pydantic (backend), React 19/Vite 8/Zustand 5/openapi-typescript/Radix UI (frontend)

---

## Setup (Controller): Create Parallel Worktrees

- [ ] **Step 1: Create backend worktree**

```powershell
git worktree add ../backend-openapi -b feat/backend-openapi feat/frontend-typescript-migration
Set-Location ../backend-openapi
pip install -r backend/requirements.txt
Set-Location ..
```

- [ ] **Step 2: Create frontend worktree**

```powershell
git worktree add ../frontend-rebuild -b feat/frontend-rebuild feat/frontend-typescript-migration
Set-Location ../frontend-rebuild/frontend
npm install
Set-Location ../..
```

- [ ] **Step 3: Verify both worktrees**

```powershell
git worktree list
```

Expected: 3 entries — main, ../backend-openapi, ../frontend-rebuild

---

## Track A: Backend OpenAPI Completion (Worktree `../backend-openapi`)

### Task A1: Add new Pydantic schemas to schemas.py

**Files:**
- Modify: `backend/schemas.py` (append new models)

- [ ] **Step 1: Append to backend/schemas.py**

Read the end of `backend/schemas.py`, then append:

```python
# ── Generic responses ──
class MessageResponse(BaseModel):
    message: str

class OkResponse(BaseModel):
    ok: bool = True

class ToggleStatusResponse(BaseModel):
    ok: bool = True
    status: str

# ── Create short responses ──
class SecretCreateResponse(BaseModel):
    id: int
    key_suffix: str

class ConfigCreateResponse(BaseModel):
    id: int

class FeedbackSubmitResponse(BaseModel):
    id: int
    created_at: datetime

# ── Training trigger ──
class ScoringTriggerResponse(BaseModel):
    message: str
    record_id: int
    scoring_status: str

# ── Feedback stats ──
class FeedbackDailyItem(BaseModel):
    date: str
    rating_1: int = 0
    rating_2: int = 0
    rating_3: int = 0
    rating_4: int = 0
    rating_5: int = 0

# ── Rubric ──
class RubricDimensionItem(BaseModel):
    name: str = ""
    weight: int = 0
    criteria: str = ""

class RubricResponse(BaseModel):
    id: int
    name: str
    version: str = ""
    description: Optional[str] = None
    total_max: int = 100
    raw_max: int = 57
    raw_scale: int = 3
    dimensions: list = []
    is_active: bool = False
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)

class RubricBrief(BaseModel):
    id: int
    name: str
    is_active: bool = False
    model_config = ConfigDict(from_attributes=True)

# ── Prompt misc ──
class SampleVarsResponse(BaseModel):
    purpose: str
    vars: dict

# ── Health / Test ──
class HealthCheckItem(BaseModel):
    base_url: str
    status: str
    latency_ms: Optional[int] = None
    error: Optional[str] = None

class TestResultItem(BaseModel):
    base_url: str
    ok: bool
    status_code: Optional[int] = None
    latency_ms: Optional[int] = None
    error: Optional[str] = None

class TestAllResultsResponse(BaseModel):
    results: list[TestResultItem]

# ── Stats item schemas (replace PaginatedResponse[dict]) ──
class TeacherSummaryItem(BaseModel):
    user_id: int
    display_name: str
    student_code: Optional[str] = None
    total_sessions: int = 0
    total_minutes: int = 0

class RankingItem(BaseModel):
    user_id: int
    display_name: str
    student_id: Optional[str] = None
    total_sessions: int = 0
    avg_score: Optional[float] = None
    total_score: float = 0
    total_minutes: int = 0
    rank: int = 0

class ClassSummaryItemSchema(BaseModel):
    class_id: int
    class_name: str
    grade_name: str
    student_count: int = 0
    avg_score: Optional[float] = None
    completion_rate: float = 0
    total_sessions: int = 0
    total_minutes: int = 0
```

- [ ] **Step 2: Verify schemas load**

```powershell
python -c "from backend.schemas import MessageResponse, OkResponse, ScoringTriggerResponse, RubricResponse; print('OK')"
```

Expected: `OK`

- [ ] **Step 3: Commit**

```powershell
git add backend/schemas.py; git commit -m "✨ feat: add response schemas for OpenAPI completion"
```

---

### Task A2: Add response_model to auth.py, cases.py, training.py

**Files:**
- Modify: `backend/routers/auth.py`
- Modify: `backend/routers/cases.py`
- Modify: `backend/routers/training.py`

- [ ] **Step 1: Update auth.py — GET /auth/me**

Read `backend/routers/auth.py`. The existing import should already have schemas. Add to `get_me`:

```python
# Add to existing schemas import:
from schemas import LoginRequest, RegisterRequest, TokenResponse

# Before get_me function:
# No exact ResponseSchema exists — use a minimal dict-as-schema approach:
# Since /auth/me returns { id, username, role, display_name, student_id },
# and UserBrief already has these fields (plus extras), use UserBrief
from schemas import UserBrief

@router.get("/me", response_model=UserBrief)
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # ... existing function body unchanged
```

Note: The return dict must match UserBrief fields. If the current return dict has keys that UserBrief doesn't expect, the response_model will filter them. Verify `return {"id": current_user.id, "username": current_user.username, "role": current_user.role, "display_name": current_user.display_name, "student_id": current_user.student_id}` — UserBrief accepts these.

- [ ] **Step 2: Update cases.py — DELETE /{case_id}**

Read `backend/routers/cases.py`. Find `delete_case` function. Add import and response_model:

```python
from schemas import MessageResponse

@router.delete("/{case_id}", response_model=MessageResponse)
def delete_case(case_id: int, ...):
    # ... existing function unchanged
    return {"message": "病例已删除"}
```

- [ ] **Step 3: Update training.py — 3 endpoints**

Read `backend/routers/training.py`. Update imports:

```python
from schemas import (
    TrainingStartRequest, TrainingStartResponse, TrainingRecordBrief,
    TrainingRecordDetail, ScoreReviewRequest, ScoreReviewResponse,
    PaginatedResponse, MessageResponse, ScoringTriggerResponse,
)
```

Add `response_model=` to:
- `end_training`: `@router.post("/{record_id}/end", response_model=ScoringTriggerResponse)`
- `retry_scoring`: `@router.post("/{record_id}/retry-scoring", response_model=ScoringTriggerResponse)`
- `delete_record`: `@router.delete("/records/{record_id}", response_model=MessageResponse)`

- [ ] **Step 4: Verify**

```powershell
python -c "from backend.main import app; print('Router imports OK')"
```

Expected: No import errors.

- [ ] **Step 5: Commit**

```powershell
git add backend/routers/auth.py backend/routers/cases.py backend/routers/training.py
git commit -m "✨ feat: add response_model to auth/cases/training routers"
```

---

### Task A3: Add response_model to admin.py and admin_api.py (CRUD)

**Files:**
- Modify: `backend/routers/admin.py`
- Modify: `backend/routers/admin_api.py`

- [ ] **Step 1: admin.py — DELETE /users + import**

Read `backend/routers/admin.py`. Add `MessageResponse` to schemas import. Add `response_model=MessageResponse` to `delete_user`.

- [ ] **Step 2: admin_api.py — update imports**

Read `backend/routers/admin_api.py`. The current import is:
```python
from schemas import (
    ApiSecretCreate, ApiSecretUpdate, ApiSecretResponse,
    LLMConfigCreate, LLMConfigUpdate, LLMConfigResponse,
)
```

Expand to:
```python
from schemas import (
    ApiSecretCreate, ApiSecretUpdate, ApiSecretResponse,
    LLMConfigCreate, LLMConfigUpdate, LLMConfigResponse,
    OkResponse, ToggleStatusResponse,
    SecretCreateResponse, ConfigCreateResponse,
    TestResultItem, TestAllResultsResponse,
    HealthCheckItem,
)
```

- [ ] **Step 3: admin_api.py — add response_model to each endpoint**

| Endpoint (line) | response_model |
|---|---|
| `create_secret` POST /secrets | `response_model=SecretCreateResponse, status_code=201` |
| `update_secret` PUT /secrets/{id} | `response_model=OkResponse` |
| `delete_secret` DELETE /secrets/{id} | `response_model=OkResponse` |
| `create_config` POST /configs | `response_model=ConfigCreateResponse, status_code=201` |
| `update_config` PUT /configs/{id} | `response_model=OkResponse` |
| `delete_config` DELETE /configs/{id} | `response_model=OkResponse` |
| `toggle_config` POST /configs/{id}/toggle | `response_model=ToggleStatusResponse` |
| `reset_config` POST /configs/{id}/reset | `response_model=OkResponse` |
| `test_config` POST /configs/{id}/test | `response_model=TestResultItem` |
| `test_all_configs` POST /configs/test-all | `response_model=TestAllResultsResponse` |
| `reload_router` POST /reload | `response_model=OkResponse` |
| `get_env_fallback` GET /fallback | skip (dict, unstable shape) |
| `test_env_fallback` POST /fallback/test | `response_model=TestResultItem` |
| `health_check` GET /health | `response_model=list[HealthCheckItem]` |

- [ ] **Step 4: Verify**

```powershell
python -c "from backend.main import app; print('OK')"
```

- [ ] **Step 5: Commit**

```powershell
git add backend/routers/admin.py backend/routers/admin_api.py
git commit -m "✨ feat: add response_model to admin + admin_api CRUD endpoints"
```

---

### Task A4: Add response_model to admin_api.py (Rubric endpoints)

**Files:**
- Modify: `backend/routers/admin_api.py`

- [ ] **Step 1: Read the rubric endpoint section**

Find functions starting from `list_rubrics` to `activate_rubric` in `backend/routers/admin_api.py`. These currently return raw SQLAlchemy Rubric ORM objects.

- [ ] **Step 2: Add imports**

```python
from schemas import RubricResponse, RubricBrief
# and import Rubric model if not already imported:
from models import Rubric
```

- [ ] **Step 3: Add response_model**

| Endpoint | response_model | Notes |
|---|---|---|
| `list_rubrics` GET /rubrics | `response_model=list[RubricBrief]` | Brief list, omit dimensions |
| `get_active_rubric` GET /rubrics/active | `response_model=RubricResponse` | Full detail |
| `create_rubric` POST /rubrics | `response_model=RubricResponse, status_code=201` | Return created |
| `update_rubric` PUT /rubrics/{id} | `response_model=RubricResponse` | Return updated |
| `delete_rubric` DELETE /rubrics/{id} | `response_model=OkResponse` | |
| `activate_rubric` POST /rubrics/{id}/activate | `response_model=OkResponse` | |

- [ ] **Step 4: Verify**

```powershell
python -c "from backend.main import app; print('OK')"
```

- [ ] **Step 5: Commit**

```powershell
git add backend/routers/admin_api.py
git commit -m "✨ feat: add RubricResponse schemas + response_model to rubric endpoints"
```

---

### Task A5: Add response_model to remaining routers

**Files:**
- Modify: `backend/routers/admin_prompts.py`
- Modify: `backend/routers/admin_grades.py`
- Modify: `backend/routers/admin_classes.py`
- Modify: `backend/routers/qa.py`
- Modify: `backend/routers/feedback.py`
- Modify: `backend/routers/notes.py`
- Modify: `backend/routers/stats.py`

- [ ] **Step 1: admin_prompts.py**

Read the file. Add schemas: `MessageResponse` → `delete_prompt` (returns `{"ok": True}`, use MessageResponse after adjusting return to `{"message": "已删除"}` format, or add `OkResponse`). Use `OkResponse` to keep existing return shape.

- `delete_prompt` → `response_model=OkResponse`
- `activate_prompt` → `response_model=OkResponse`
- `get_sample_vars` → `response_model=SampleVarsResponse`

- [ ] **Step 2: admin_grades.py**

- `delete_grade` → `response_model=MessageResponse` (returns `{"message": "..."}`)

- [ ] **Step 3: admin_classes.py**

- `delete_class` → `response_model=MessageResponse`

- [ ] **Step 4: qa.py**

- `delete_session` → check return format. If it returns `{"detail": "删除成功"}`, either change to `{"message": "删除成功"}` to use `MessageResponse`, or add a response schema. **Simplest: change the return dict key from "detail" to "message"** and use `response_model=MessageResponse`.

- [ ] **Step 5: feedback.py**

- `submit_feedback` → `response_model=FeedbackSubmitResponse`
- `feedback_stats` → `response_model=list[FeedbackDailyItem]`

- [ ] **Step 6: notes.py**

- `delete_note` → `response_model=MessageResponse`

- [ ] **Step 7: stats.py — replace PaginatedResponse[dict] with typed schemas**

Read `backend/routers/stats.py`. Update imports to include `TeacherSummaryItem`, `RankingItem`, `ClassSummaryItemSchema`.

Change 3 endpoints:
- `teacher_summary`: `PaginatedResponse[dict]` → `PaginatedResponse[TeacherSummaryItem]`
- `student_ranking`: `PaginatedResponse[dict]` → `PaginatedResponse[RankingItem]`
- `class_summary`: `list[dict]` → `list[ClassSummaryItemSchema]`

**IMPORTANT:** The dict keys in the list comprehensions must match the Pydantic field names. Verify each comprehension matches its schema.

- [ ] **Step 8: Verify all routers**

```powershell
python -c "from backend.main import app; print('All routers loaded OK')"
```

- [ ] **Step 9: Commit**

```powershell
git add backend/routers/
git commit -m "✨ feat: add response_model to remaining routers + typed stats schemas"
```

---

### Task A6: Final verification — /openapi.json

**Files:**
- None (verification only)

- [ ] **Step 1: Start backend**

```powershell
cd backend; python -m uvicorn main:app --port 8000 &
```

- [ ] **Step 2: Fetch OpenAPI spec**

```powershell
Invoke-WebRequest -Uri http://localhost:8000/openapi.json -OutFile openapi.json
```

- [ ] **Step 3: Quick sanity check**

```powershell
python -c "import json; spec = json.load(open('openapi.json')); paths = spec['paths']; print(f'Endpoints: {sum(len(v) for v in paths.values())}'); schemas = spec['components']['schemas']; print(f'Schemas: {len(schemas)}')"
```

Expected: 70+ endpoints, 60+ schemas.

- [ ] **Step 4: Check for remaining 'dict' or 'object' in response types**

```powershell
python -c "
import json
spec = json.load(open('openapi.json'))
for path, methods in spec['paths'].items():
    for method, op in methods.items():
        if 'responses' in op:
            for code, resp in op['responses'].items():
                if resp and 'content' in resp:
                    for ct, media in resp['content'].items():
                        schema = media.get('schema', {})
                        ref = schema.get('$ref', '')
                        if not ref and schema != {}:
                            print(f'{method.upper()} {path} ({code}): inline schema - {schema.get(\"type\",\"?\")}')
"
```

Expected: Only streaming/binary endpoints should show inline types.

- [ ] **Step 5: Stop backend, commit if any fixes**

```powershell
git add openapi.json  # if saved to repo
git commit -m "✅ test: verify OpenAPI spec completeness"
```

---

## Track B: Frontend Rebuild (Worktree `../frontend-rebuild`)

### Task B1: Install openapi-typescript, add npm scripts

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json` (auto)

- [ ] **Step 1: Install openapi-typescript**

```powershell
npm install --save-dev openapi-typescript
```

Work from `frontend/` directory.

- [ ] **Step 2: Add generate:api script to package.json**

```json
"generate:api": "npx openapi-typescript http://localhost:8000/openapi.json -o src/api/api-types.gen.ts"
```

- [ ] **Step 3: Create output directory**

```powershell
New-Item -ItemType Directory -Path "src/api" -Force
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/package.json frontend/package-lock.json frontend/src/api/
git commit -m "🔧 chore: install openapi-typescript, add generate:api script"
```

---

### Task B2: Extract axios-instance.ts from api.js

**Files:**
- Create: `frontend/src/api/axios-instance.ts`
- Read: `frontend/src/api.js` (reference)

- [ ] **Step 1: Read api.js interceptor logic**

Read `frontend/src/api.js`. The interceptors handle: auth token injection, 401 redirect, auto-retry.

- [ ] **Step 2: Create axios-instance.ts**

```typescript
import axios from "axios";

export const api = axios.create({
  baseURL: "/api",
  timeout: 120000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      return Promise.reject(err);
    }

    const config = err.config;
    if (!config || config._retryCount >= 1) {
      return Promise.reject(err);
    }

    const shouldRetry =
      !err.response ||
      err.response.status >= 500 ||
      err.code === "ECONNABORTED" ||
      err.code === "ERR_NETWORK";

    if (!shouldRetry) {
      return Promise.reject(err);
    }

    config._retryCount = (config._retryCount || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return api(config);
  },
);
```

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/api/axios-instance.ts
git commit -m "✨ feat: extract axios-instance with auth/retry interceptors"
```

---

### Task B3: Generate api-types.gen.ts and create api-client.ts

> **DEPENDENCY:** Requires Track A Phase 1 complete and backend running on port 8000.

- [ ] **Step 1: Start backend (if not running)**

```powershell
cd ../../backend-openapi/backend; python -m uvicorn main:app --port 8000 &
cd ../../frontend-rebuild/frontend
```

- [ ] **Step 2: Generate types**

```powershell
npm run generate:api
```

- [ ] **Step 3: Verify generation**

```powershell
Get-Item src/api/api-types.gen.ts | Select-Object Length
```

Expected: File exists, >10KB.

- [ ] **Step 4: Create api-client.ts**

```typescript
import { api } from "./axios-instance";
import type { paths, components } from "./api-types.gen";

type Schemas = components["schemas"];

// ── Auth ──
export const login = (username: string, password: string) =>
  api.post<Schemas["TokenResponse"]>("/api/auth/login", { username, password });

export const register = (data: { username: string; password: string; display_name: string; role?: string }) =>
  api.post("/api/auth/register", data);

export const getMe = () =>
  api.get<Schemas["UserBrief"]>("/api/auth/me");

// ── Cases ──
export const getCases = (params: Record<string, unknown>) =>
  api.get("/api/cases", { params });

export const getCaseDetail = (id: number) =>
  api.get(`/api/cases/${id}`);

// ── Training ──
export const startTraining = (caseId: number) =>
  api.post<Schemas["TrainingStartResponse"]>("/api/training/start", { case_id: caseId });

export const sendMessage = (recordId: number, content: string, signal?: AbortSignal) =>
  api.post(`/api/chat/${recordId}/message`, { content }, { signal });

export const endTraining = (recordId: number, signal?: AbortSignal) =>
  api.post<Schemas["ScoringTriggerResponse"]>(`/api/training/${recordId}/end`, null, { signal });

export const retryScoring = (recordId: number) =>
  api.post<Schemas["ScoringTriggerResponse"]>(`/api/training/${recordId}/retry-scoring`);

export const getRecords = (params: Record<string, unknown>) =>
  api.get("/api/training/records", { params });

export const deleteRecord = (id: number) =>
  api.delete<Schemas["MessageResponse"]>(`/api/training/records/${id}`);

export const getRecordDetail = (id: number) =>
  api.get<Schemas["TrainingRecordDetail"]>(`/api/training/records/${id}`);

export const exportRecords = () =>
  api.get("/api/export/records", { responseType: "blob" });

export const exportRecordDetail = (id: number) =>
  api.get(`/api/export/record/${id}`, { responseType: "blob" });

// ── Admin Users ──
export const getUsers = (params: Record<string, unknown>) =>
  api.get("/api/admin/users", { params });

export const getStats = () =>
  api.get<Schemas["AdminStats"]>("/api/admin/stats");

export const updateUser = (id: number, data: Record<string, unknown>) =>
  api.put(`/api/admin/users/${id}`, data);

export const batchCreateUsers = (users: Record<string, unknown>[]) =>
  api.post<Schemas["BatchCreateResult"]>("/api/admin/users/batch", users);

export const deleteUser = (id: number) =>
  api.delete<Schemas["MessageResponse"]>(`/api/admin/users/${id}`);

export const getStudentDetail = (userId: number) =>
  api.get<Schemas["StudentDetail"]>(`/api/admin/users/${userId}/detail`);

// ── Q&A ──
export const createQASession = (question: string) =>
  api.post<Schemas["QAAskResponse"]>("/api/qa/sessions", { question });

export const getQASessions = () =>
  api.get("/api/qa/sessions");

export const deleteQASession = (id: number) =>
  api.delete<Schemas["MessageResponse"]>(`/api/qa/sessions/${id}`);

export const getQASessionMessages = (sessionId: number) =>
  api.get(`/api/qa/sessions/${sessionId}/messages`);

export const askInQASession = (sessionId: number, question: string) =>
  api.post<Schemas["QAAskResponse"]>(`/api/qa/sessions/${sessionId}/ask`, { question });

export const getQAHistoryAll = (params: Record<string, unknown>) =>
  api.get("/api/qa/history/all", { params });

export const getQASessionMessagesAdmin = (sessionId: number) =>
  api.get(`/api/qa/history/all/${sessionId}/messages`);

// ── Stats ──
export const getDurationStats = (period = "month") =>
  api.get<Schemas["DurationStats"]>(`/api/stats/duration?period=${period}`);

export const getTrends = (period = "month") =>
  api.get<Schemas["TrendStats"]>(`/api/stats/trends?period=${period}`);

export const getTeacherSummary = (params: Record<string, unknown>) =>
  api.get("/api/stats/teacher-summary", { params });

export const getStudentRanking = (params: Record<string, unknown>) =>
  api.get("/api/stats/ranking", { params });

// ── Case Management ──
export const getManageCases = (params: Record<string, unknown>) =>
  api.get("/api/cases/manage/list", { params });

export const createCase = (caseData: Record<string, unknown>) =>
  api.post("/api/cases", { case_data: caseData });

export const updateCase = (id: number, caseData: Record<string, unknown>) =>
  api.put(`/api/cases/${id}`, { case_data: caseData });

export const deleteCase = (id: number) =>
  api.delete<Schemas["MessageResponse"]>(`/api/cases/${id}`);

export const generateCase = (data: Record<string, unknown>) =>
  api.post<Schemas["CaseGenerateResponse"]>("/api/cases/generate", data);

// ── LLM Monitoring ──
export const getLLMStats = () =>
  api.get<Schemas["LLMStatsResponse"]>("/api/admin/llm-stats");

export const getLLMLogs = (params: Record<string, unknown>) =>
  api.get("/api/admin/llm-logs", { params: { aggregate_patient_chat: true, ...params } });

export const exportLLMLogs = (dateFrom?: string, dateTo?: string) => {
  const params: Record<string, string> = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return api.get("/api/admin/llm-logs/export", { params, responseType: "blob" });
};

// ── Score Review ──
export const getScoreReview = (recordId: number) =>
  api.get<Schemas["ScoreReviewResponse"]>(`/api/training/records/${recordId}/review`);

export const submitScoreReview = (recordId: number, data: Schemas["ScoreReviewRequest"]) =>
  api.post<Schemas["ScoreReviewResponse"]>(`/api/training/records/${recordId}/review`, data);

export const submitFeedback = (data: { tag: string; content: string; rating?: number }) =>
  api.post<Schemas["FeedbackSubmitResponse"]>("/api/feedback", data);

export const getFeedbacks = (params: Record<string, unknown>) =>
  api.get<Schemas["FeedbackListResponse"]>("/api/admin/feedback", { params });

export const getFeedbackStats = (params: Record<string, unknown>) =>
  api.get("/api/admin/feedback/stats", { params });

// ── Grades ──
export const getGrades = () =>
  api.get("/api/admin/grades").then((res) => res.data);

export const createGrade = (data: { name: string }) =>
  api.post("/api/admin/grades", data).then((res) => res.data);

export const updateGrade = (id: number, data: { name: string }) =>
  api.put(`/api/admin/grades/${id}`, data).then((res) => res.data);

export const deleteGrade = (id: number) =>
  api.delete<Schemas["MessageResponse"]>(`/api/admin/grades/${id}`).then((res) => res.data);

// ── Classes ──
export const getClasses = (params?: Record<string, unknown>) =>
  api.get("/api/admin/classes", { params }).then((res) => res.data);

export const createClass = (data: { grade_id: number; name: string }) =>
  api.post("/api/admin/classes", data).then((res) => res.data);

export const updateClass = (id: number, data: Record<string, unknown>) =>
  api.put(`/api/admin/classes/${id}`, data).then((res) => res.data);

export const deleteClass = (id: number) =>
  api.delete<Schemas["MessageResponse"]>(`/api/admin/classes/${id}`).then((res) => res.data);

// ── Class Stats ──
export const getClassSummary = (params?: Record<string, unknown>) =>
  api.get("/api/stats/class-summary", { params }).then((res) => res.data);

// ── Backup ──
export const downloadBackup = () =>
  api.post("/api/admin/backup", null, { responseType: "blob" });

// ── Rubrics ──
export const fetchRubrics = () =>
  api.get("/api/admin/api/rubrics").then((res) => res.data);

export const getActiveRubric = () =>
  api.get("/api/admin/api/rubrics/active").then((res) => res.data);

export const createRubric = (data: Record<string, unknown>) =>
  api.post("/api/admin/api/rubrics", data).then((res) => res.data);

export const updateRubric = (id: number, data: Record<string, unknown>) =>
  api.put(`/api/admin/api/rubrics/${id}`, data).then((res) => res.data);

export const deleteRubric = (id: number) =>
  api.delete(`/api/admin/api/rubrics/${id}`).then((res) => res.data);

export const activateRubric = (id: number) =>
  api.post(`/api/admin/api/rubrics/${id}/activate`).then((res) => res.data);
```

- [ ] **Step 5: Also export sendMessageStream (SSE)**

```typescript
export async function sendMessageStream(
  recordId: number,
  content: string,
  onChunk: (content: string) => void,
  onDone: (id: number) => void,
  onError: (error: string) => void,
  signal?: AbortSignal,
): Promise<void> {
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

  if (!resp.body) { onError("响应体为空"); return; }
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
        if (data.error) { onError(data.error); return; }
        if (data.done && data.id != null) { onDone(data.id); return; }
        if (data.content) { onChunk(data.content); }
      } catch { /* ignore */ }
    }
  }
}
```

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/api/
git commit -m "✨ feat: generate api-types from OpenAPI + create typed api-client"
```

---

### Task B4-B7: Replace api.js imports throughout the codebase

These tasks are **mechanical find-and-replace** across ~30 files. The pattern:

**Find:** `from "../../api"` or `from "../api"` or `from "../../api/apiManagement"`  
**Replace:** `from "@/api/api-client"`

Additionally, remove the `.js` extension from the import in `apiManagement.js` (if it still references `"../api.js"`).

> **Note:** Since `api-client.ts` exports the same function names as `api.js` (e.g., `getUsers`, `login`, etc.), the import path is the only change needed. Function signatures remain compatible at the JS call sites — stricter type checking comes when each file is converted to .tsx.

**Files to process (Batch by directory):**

- [ ] **Task B4 Step 1: Stores + Hooks** — `authStore.ts`, `gradesClassesStore.ts`, `useVoice.ts` (only stores import from api)

```powershell
# Update imports in store files
# Already in: frontend/src/stores/authStore.ts: import { login as apiLogin, getMe } from "../api";
# Change to: import { login as apiLogin, getMe } from "@/api/api-client";
```

- [ ] **Task B5: Components (non-teacher)** — `AppShell.jsx`, `FeedbackModal.jsx`, `ScoreCard.jsx`, etc.

```powershell
# Find files importing from ../../api or ../api
rg "from ['\"]\.\./.*api" frontend/src/components/ --include="*.jsx" -l
# Replace each with from "@/api/api-client"
```

- [ ] **Task B6: Teacher components** — All files in `frontend/src/components/teacher/`

```powershell
rg "from ['\"]\.\./.*api" frontend/src/components/teacher/ --include="*.jsx" -l
# Replace each with from "@/api/api-client"
```

- [ ] **Task B7: Pages** — All files in `frontend/src/pages/` and `frontend/src/pages/admin/`

```powershell
rg "from ['\"]\.\./.*api" frontend/src/pages/ --include="*.jsx" -l
# Replace each with from "@/api/api-client"
```

**Each batch commit:**

```powershell
git add <directory>; git commit -m "♻️ refactor: replace api.js imports with @/api/api-client in <directory>"
```

---

### Task B8: Full .jsx → .tsx migration

**Files:** All remaining .jsx files (~50 files across components/, pages/)

- [ ] **Step 1: Rename all .jsx to .tsx**

```powershell
Get-ChildItem -Path "frontend/src" -Recurse -Filter "*.jsx" | ForEach-Object {
    $new = $_.FullName -replace '\.jsx$', '.tsx'
    git mv $_.FullName $new
}
```

This covers: components/, components/ui/, components/teacher/, pages/, pages/admin/, App.jsx, main.jsx.

- [ ] **Step 2: Update index.html**

Change `main.jsx` → `main.tsx` in `frontend/index.html` line 11.

- [ ] **Step 3: Type each file — priority order**

| Priority | Pattern | Type additions |
|----------|---------|---------------|
| 1 | Component props | Add `interface XxxProps { ... }` |
| 2 | useState | Add generic: `useState<Type>(init)` |
| 3 | Event handlers | `(e: React.FormEvent)`, `(e: React.ChangeEvent<HTMLInputElement>)` |
| 4 | API data | Use Schemas from `@/api/api-types.gen` |
| 5 | catch blocks | `(err: unknown)` with narrowing |

**Proceed file by file.** After each file: `npx tsc --noEmit` to check. Fix errors before moving to next file.

- [ ] **Step 4: Run full type check**

```powershell
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 5: Run build**

```powershell
npm run build
```

Expected: Build succeeds.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/ frontend/index.html
git commit -m "✨ feat: full .jsx→.tsx migration with generated API types"
```

---

### Task B9: Path aliases + Layout.jsx cleanup

- [ ] **Step 1: Delete Layout.jsx**

```powershell
git rm frontend/src/components/Layout.jsx
```

Then find all imports of `Layout` and replace with `AppShell`:
```powershell
rg "import.*Layout" frontend/src/ --include="*.tsx" -l
```

Update each. In `App.tsx`, `Layout` was likely not used directly (it's a re-export of AppShell). In tests, replace `import Layout` with `import AppShell`.

- [ ] **Step 2: Replace `../../` with `@/`**

```powershell
# Find remaining relative imports deeper than one level
rg "from ['\"]\.\./(\.\./)+" frontend/src/ --include="*.tsx" -n
```

Replace each with `@/` equivalent. Example:
- `from "../../components/Toast"` → `from "@/components/Toast"`
- `from "../../../api"` → `from "@/api/api-client"`

- [ ] **Step 3: Verify**

```powershell
npx tsc --noEmit && npm run build
```

- [ ] **Step 4: Commit**

```powershell
git add -A; git commit -m "♻️ refactor: apply @/ path aliases, remove Layout.jsx"
```

---

### Task B10: Install Radix UI, replace Modal with Dialog

**Files:**
- Create: `frontend/src/components/ui/Dialog.tsx`
- Modify: All files importing Modal

- [ ] **Step 1: Install**

```powershell
npm install @radix-ui/react-dialog
```

- [ ] **Step 2: Create Dialog.tsx**

```typescript
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number | string;
}

export default function Dialog({ open, onClose, title, children, footer, maxWidth = 560 }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
            zIndex: 1000,
          }}
        />
        <DialogPrimitive.Content
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: typeof maxWidth === "number" ? `${maxWidth}px` : maxWidth,
            maxWidth: "90vw",
            maxHeight: "85vh",
            overflow: "auto",
            background: "#fff",
            borderRadius: "var(--radius-lg, 12px)",
            boxShadow: "var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.15))",
            zIndex: 1001,
            padding: 0,
          }}
        >
          {title && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "20px 24px 0",
              }}
            >
              <DialogPrimitive.Title style={{ fontSize: "1.1rem", fontWeight: 600, margin: 0 }}>
                {title}
              </DialogPrimitive.Title>
              <DialogPrimitive.Close
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--gray-400)",
                  padding: 4,
                }}
              >
                <X size={20} />
              </DialogPrimitive.Close>
            </div>
          )}
          <div style={{ padding: "12px 24px" }}>{children}</div>
          {footer && (
            <div
              style={{
                padding: "0 24px 20px",
                display: "flex",
                gap: 12,
                justifyContent: "flex-end",
              }}
            >
              {footer}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

- [ ] **Step 3: Replace Modal imports**

```powershell
# Find all files importing Modal from ../ui/Modal
rg "from ['\"].*ui/Modal" frontend/src/ --include="*.tsx" -l
# Replace with: import Dialog from "@/components/ui/Dialog"
```

Update usage: `<Modal ...>` → `<Dialog ...>`, same props: `open`, `onClose`, `title`, `maxWidth`, `children`, `footer`.

- [ ] **Step 4: Delete old Modal.jsx**

```powershell
git rm frontend/src/components/ui/Modal.jsx  # or .tsx if already renamed
```

- [ ] **Step 5: Verify**

```powershell
npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "♻️ refactor: replace Modal with Radix Dialog"
```

---

### Task B11: Replace ConfirmDialog with Radix AlertDialog

**Files:**
- Create: `frontend/src/components/ui/AlertDialog.tsx`
- Modify: All consumers of useConfirm

- [ ] **Step 1: Install**

```powershell
npm install @radix-ui/react-alert-dialog
```

- [ ] **Step 2: Create AlertDialog.tsx with context provider**

```typescript
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions): Promise<boolean> =>
      new Promise((resolve) => {
        setState({ ...options, resolve });
      }),
    [],
  );

  const handleClose = (confirmed: boolean) => {
    state?.resolve(confirmed);
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <AlertDialogPrimitive.Root open={state !== null} onOpenChange={() => handleClose(false)}>
        <AlertDialogPrimitive.Portal>
          <AlertDialogPrimitive.Overlay
            style={{
              position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
            }}
          />
          <AlertDialogPrimitive.Content
            style={{
              position: "fixed", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              width: 420, maxWidth: "90vw",
              background: "#fff",
              borderRadius: "var(--radius-lg, 12px)",
              boxShadow: "var(--shadow-xl, 0 20px 60px rgba(0,0,0,0.15))",
              zIndex: 1001, padding: 24,
            }}
          >
            <AlertDialogPrimitive.Title style={{ fontSize: "1.05rem", fontWeight: 600, margin: "0 0 8px" }}>
              {state?.title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description style={{ color: "var(--gray-500)", fontSize: "0.9rem", lineHeight: 1.5 }}>
              {state?.message}
            </AlertDialogPrimitive.Description>
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 20 }}>
              <AlertDialogPrimitive.Cancel asChild>
                <button type="button" className="btn" onClick={() => handleClose(false)}>
                  {state?.cancelLabel || "取消"}
                </button>
              </AlertDialogPrimitive.Cancel>
              <AlertDialogPrimitive.Action asChild>
                <button
                  type="button"
                  className={`btn ${state?.danger ? "btn-danger" : "btn-primary"}`}
                  onClick={() => handleClose(true)}
                >
                  {state?.confirmLabel || "确定"}
                </button>
              </AlertDialogPrimitive.Action>
            </div>
          </AlertDialogPrimitive.Content>
        </AlertDialogPrimitive.Portal>
      </AlertDialogPrimitive.Root>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): { confirm: (options: ConfirmOptions) => Promise<boolean> } {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be inside ConfirmProvider");
  return ctx;
}
```

- [ ] **Step 3: Update imports**

```powershell
rg "from ['\"].*ui/ConfirmDialog" frontend/src/ --include="*.tsx" -l
# Replace with: import { ConfirmProvider, useConfirm } from "@/components/ui/AlertDialog"
```

- [ ] **Step 4: Delete old ConfirmDialog**

```powershell
git rm frontend/src/components/ui/ConfirmDialog.jsx
```

- [ ] **Step 5: Verify**

```powershell
npx tsc --noEmit && npm run build
```

- [ ] **Step 6: Commit**

```powershell
git add -A; git commit -m "♻️ refactor: replace ConfirmDialog with Radix AlertDialog"
```

---

### Task B12: Replace Tabs with Radix Tabs

**Files:**
- Create: `frontend/src/components/ui/Tabs.tsx` (overwrite existing)
- Verify: All consumers still work

- [ ] **Step 1: Install**

```powershell
npm install @radix-ui/react-tabs
```

- [ ] **Step 2: Overwrite Tabs.tsx**

```typescript
import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ReactNode } from "react";

interface TabItem {
  key: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: TabItem[];
  activeKey?: string;
  onChange?: (key: string) => void;
  style?: React.CSSProperties;
}

export default function Tabs({ tabs, activeKey, onChange, style }: TabsProps) {
  const current = activeKey || tabs[0]?.key || "";

  return (
    <TabsPrimitive.Root
      value={current}
      onValueChange={(v) => onChange?.(v)}
      style={style}
    >
      <TabsPrimitive.List
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--gray-200)",
          marginBottom: 16,
        }}
      >
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.key}
            value={tab.key}
            disabled={tab.disabled}
            style={{
              padding: "10px 20px",
              border: "none",
              background: "none",
              cursor: tab.disabled ? "not-allowed" : "pointer",
              fontSize: "0.9rem",
              fontWeight: 500,
              color: current === tab.key ? "var(--primary-500)" : "var(--gray-500)",
              borderBottom: current === tab.key ? "2px solid var(--primary-500)" : "2px solid transparent",
              opacity: tab.disabled ? 0.4 : 1,
              fontFamily: "inherit",
            }}
          >
            {tab.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.key} value={tab.key}>
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
```

- [ ] **Step 3: Verify consumers**

No change needed — the Tabs component interface is identical (same props). Existing imports continue to work.

- [ ] **Step 4: Verify build**

```powershell
npx tsc --noEmit && npm run build
```

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/components/ui/Tabs.tsx frontend/package.json
git commit -m "♻️ refactor: replace custom Tabs with Radix Tabs"
```

---

### Task B13: Final verification

- [ ] **Step 1: Clean tsc**

```powershell
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: All tests**

```powershell
npm test
```

Expected: All tests pass (update test imports if needed).

- [ ] **Step 3: Build**

```powershell
npm run build
```

Expected: Successful production build.

- [ ] **Step 4: Dev smoke test**

```powershell
npm run dev
```

Manual check: login, dashboard, case select, chat training, admin pages.

- [ ] **Step 5: Commit**

```powershell
git commit -m "✅ test: final verification — typecheck, tests, build pass"
```

---

## Merge: Integration

- [ ] **Step 1: Merge Backend branch into baseline**

```powershell
cd <main-worktree>
git checkout feat/frontend-typescript-migration
git merge feat/backend-openapi
```

- [ ] **Step 2: Merge Frontend branch**

```powershell
git merge feat/frontend-rebuild
```

Resolve any conflicts.

- [ ] **Step 3: Regenerate API types against merged backend**

```powershell
# Start backend, then:
cd frontend; npm run generate:api
git add src/api/api-types.gen.ts; git commit -m "🔄 chore: regenerate API types from merged OpenAPI spec"
```

- [ ] **Step 4: Final build**

```powershell
cd frontend; npm run build
```

- [ ] **Step 5: Cleanup worktrees**

```powershell
git worktree remove ../backend-openapi
git worktree remove ../frontend-rebuild
```
