# Frontend TypeScript Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 63 frontend source files from JavaScript to TypeScript with `strict: true`, add path aliases (`@/`), remove ESLint in favor of Biome, and delete the `Layout.jsx` re-export.

**Architecture:** Leaf-to-root migration — define types first, then convert files with no internal dependencies (api, utils), then stores, then hooks, then UI components, then business components, then pages, then entry files. Each conversion: rename, add types, fix imports in consumers.

**Tech Stack:** React 19, Vite 8, TypeScript 5.8, Biome 2.4, Zustand 5, Vitest 4

---

### Task 1: Create type definition files

**Files:**
- Create: `frontend/src/types/models.ts`
- Create: `frontend/src/types/api.ts`
- Create: `frontend/src/types/store.ts`
- Create: `frontend/src/types/globals.d.ts`
- Create: `frontend/src/types/index.ts`

- [ ] **Step 1: Create `frontend/src/types/models.ts`**

```typescript
export interface User {
  user_id: number;
  username: string;
  role: "student" | "teacher";
  display_name: string;
  avatar?: string;
  grade?: string;
  className?: string;
}

export interface PatientCase {
  id: number;
  title: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  category?: string;
  tags?: string[];
  age?: number;
  gender?: string;
  background?: string;
  symptoms?: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string;
}

export interface TrainingRecord {
  id: number;
  user_id: number;
  case_id: number;
  case_title?: string;
  patient_name?: string;
  score?: number;
  status: "active" | "completed" | "abandoned";
  created_at: string;
  updated_at: string;
  messages?: Message[];
}

export interface RecordDetail extends TrainingRecord {
  rubric_scores?: ScoreResult[];
  total_score?: number;
  feedback?: string;
  patient_info?: PatientInfo;
}

export interface PatientInfo {
  name: string;
  age: number;
  gender: string;
  chief_complaint?: string;
  avatar_key?: string;
}

export interface RubricItem {
  id: number;
  name: string;
  weight: number;
  criteria: string;
}

export interface ScoreResult {
  item_id: number;
  item_name: string;
  score: number;
  max_score: number;
  feedback: string;
}

export interface Grade {
  id: number;
  name: string;
}

export interface ClassItem {
  id: number;
  name: string;
  grade_id: number;
  grade_name?: string;
}

export interface QASession {
  id: number;
  question: string;
  created_at: string;
  message_count?: number;
}

export interface QAMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}

export interface LLMLog {
  id: number;
  user_id?: number;
  username?: string;
  model: string;
  purpose: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  duration_ms?: number;
  success: boolean;
  error?: string;
  created_at: string;
}

export interface FeedbackItem {
  id: number;
  user_id?: number;
  username?: string;
  type: string;
  content: string;
  rating?: number;
  created_at: string;
}

export interface DurationStat {
  period: string;
  average_minutes: number;
  total_sessions: number;
}

export interface TrendItem {
  date: string;
  count: number;
}

export interface TeacherSummary {
  total_students: number;
  total_sessions: number;
  total_cases: number;
  average_score?: number;
}

export interface StudentRanking {
  user_id: number;
  display_name: string;
  grade?: string;
  class?: string;
  session_count: number;
  average_score?: number;
}

export type Role = "student" | "teacher";
export type Difficulty = "easy" | "medium" | "hard";
export type RecordStatus = "active" | "completed" | "abandoned";
export type ToastType = "success" | "error" | "warning" | "info";
```

- [ ] **Step 2: Create `frontend/src/types/api.ts`**

```typescript
import type { AxiosResponse } from "axios";
import type { PaginatedResponse, TrainingRecord, QASession, QAMessage, LLMLog, FeedbackItem, Grade, ClassItem } from "./models";

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  role: "student" | "teacher";
  display_name: string;
  user_id: number;
}

export interface RegisterRequest {
  username: string;
  password: string;
  display_name: string;
  role?: "student" | "teacher";
}

export interface StartTrainingResponse {
  record_id: number;
}

export interface ChatMessageResponse {
  id: number;
  content: string;
  role: "assistant";
}

export interface StreamChunk {
  content?: string;
  done?: boolean;
  id?: number;
  error?: string;
}

export interface EndTrainingResponse {
  score?: number;
  status: "completed";
}

export interface RecordsResponse extends PaginatedResponse<TrainingRecord> {}

export interface QASessionsResponse {
  sessions: QASession[];
}

export interface QACreateResponse {
  session_id: number;
  answer?: string;
}

export interface QAAskResponse {
  answer?: string;
  id?: number;
}

export interface QAMessagesResponse {
  messages: QAMessage[];
}

export interface ClassSummaryItem {
  grade_id: number;
  grade_name: string;
  class_id: number;
  class_name: string;
  student_count: number;
  session_count: number;
  average_score?: number;
}

export interface RubricData {
  id: number;
  name: string;
  is_active: boolean;
  items?: Array<{
    id: number;
    name: string;
    weight: number;
    criteria: string;
  }>;
  created_at?: string;
}

export interface ApiSecret {
  id: number;
  name: string;
  provider?: string;
  is_active?: boolean;
}

export interface ApiConfig {
  id: number;
  purpose: string;
  provider?: string;
  model?: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
}

export interface PromptData {
  id: number;
  purpose: string;
  name: string;
  is_active?: boolean;
  content?: string;
}

export interface ScoreReviewData {
  id?: number;
  record_id: number;
  rubric_scores: Array<{
    item_id: number;
    score: number;
    feedback: string;
  }>;
  total_score: number;
  feedback: string;
}

export type ApiResponse<T> = AxiosResponse<T>;
```

- [ ] **Step 3: Create `frontend/src/types/store.ts`**

```typescript
import type { User, Grade, ClassItem } from "./models";

export interface AuthState {
  user: User | null;
  token: string | null;
  login: (username: string, password: string) => Promise<User>;
  refreshUser: () => Promise<void>;
  logout: () => void;
}

export interface GradesClassesState {
  grades: Grade[];
  classes: ClassItem[];
  loading: boolean;
  fetchGrades: () => Promise<void>;
  createGrade: (name: string) => Promise<Grade>;
  updateGrade: (id: number, name: string) => Promise<Grade>;
  deleteGrade: (id: number) => Promise<void>;
  fetchClasses: (gradeId?: number) => Promise<ClassItem[]>;
  createClass: (gradeId: number, name: string) => Promise<ClassItem>;
  updateClass: (id: number, body: Partial<ClassItem>) => Promise<ClassItem>;
  deleteClass: (id: number) => Promise<void>;
}

export interface LLMState {
  tab: string;
  setTab: (tab: string) => void;
}
```

- [ ] **Step 4: Create `frontend/src/types/globals.d.ts`**

```typescript
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  readonly isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare var SpeechRecognition: {
  new (): SpeechRecognition;
  prototype: SpeechRecognition;
};

interface Window {
  SpeechRecognition?: typeof SpeechRecognition;
  webkitSpeechRecognition?: typeof SpeechRecognition;
}

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.png" {
  const value: string;
  export default value;
}
```

- [ ] **Step 5: Create `frontend/src/types/index.ts`**

```typescript
export type * from "./models";
export type * from "./api";
export type * from "./store";
```

- [ ] **Step 6: Verify types compile**

```powershell
npx tsc --noEmit --strict --target ES2022 --module ESNext --moduleResolution bundler --jsx react-jsx --allowImportingTsExtensions --isolatedModules --skipLibCheck "frontend/src/types/models.ts" "frontend/src/types/api.ts" "frontend/src/types/store.ts" "frontend/src/types/globals.d.ts"
```

Expected: No errors.

- [ ] **Step 7: Commit**

```powershell
git add frontend/src/types/; if ($?) { git commit -m "✨ feat: add TypeScript type definitions" }
```

---

### Task 2: Configure TypeScript toolchain

**Files:**
- Create: `frontend/tsconfig.json`
- Create: `frontend/src/vite-env.d.ts`
- Modify: `frontend/vite.config.js` → `frontend/vite.config.ts`
- Modify: `frontend/biome.json`
- Modify: `frontend/package.json` (scripts, dependencies)
- Delete: `frontend/eslint.config.js`
- Modify: `frontend/index.html`

- [ ] **Step 1: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": "./src",
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 2: Create `frontend/src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />
```

- [ ] **Step 3: Rename and update `vite.config.js` → `vite.config.ts`**

```powershell
git mv frontend/vite.config.js frontend/vite.config.ts
```

Then edit `frontend/vite.config.ts`:

```typescript
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        timeout: 120000,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "vendor";
          if (id.includes("node_modules/react-router")) return "vendor";
          if (id.includes("node_modules/lucide-react")) return "icons";
        },
      },
    },
  },
});
```

- [ ] **Step 4: Update `frontend/biome.json` — extend include to TS files**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.16/schema.json",
  "files": {
    "include": ["src/**/*.{js,jsx,ts,tsx}", "*.{js,ts}"],
    "ignoreUnknown": true
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedImports": "warn",
        "noUnusedVariables": "warn",
        "useExhaustiveDependencies": "warn"
      },
      "suspicious": {
        "noExplicitAny": "off",
        "noArrayIndexKey": "off"
      },
      "style": {
        "noNonNullAssertion": "off",
        "useTemplate": "off"
      },
      "a11y": {
        "useButtonType": "off",
        "useKeyWithClickEvents": "off",
        "noStaticElementInteractions": "off",
        "useValidAriaRole": "off",
        "noLabelWithoutControl": "off",
        "noAutofocus": "off"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 160
  }
}
```

Changes from original: added `"include": ["src/**/*.{js,jsx,ts,tsx}", "*.{js,ts}"]`, changed `useExhaustiveDependencies` from `"off"` to `"warn"`.

- [ ] **Step 5: Remove ESLint and install TypeScript**

Delete `frontend/eslint.config.js`:

```powershell
Remove-Item -LiteralPath "frontend\eslint.config.js"
```

Update `frontend/package.json` — remove ESLint deps, add TypeScript, update scripts:

```json
{
  "name": "frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "lint": "biome check src/",
    "lint:fix": "biome check --fix src/",
    "format": "biome format --write src/",
    "test": "vitest run",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "axios": "^1.16.1",
    "lucide-react": "^1.16.0",
    "react": "^19.2.6",
    "react-dom": "^19.2.6",
    "react-markdown": "^10.1.0",
    "react-router-dom": "^7.15.1",
    "recharts": "^3.8.1",
    "remark-gfm": "^4.0.1",
    "zustand": "^5.0.14"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.16",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "jsdom": "^29.1.1",
    "typescript": "^5.8.0",
    "vite": "^8.0.12",
    "vitest": "^4.1.7"
  }
}
```

Removed: `@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `globals`.

- [ ] **Step 6: Update `frontend/index.html` — point to main.tsx**

Change line 11 from:
```html
    <script type="module" src="/src/main.jsx"></script>
```
to:
```html
    <script type="module" src="/src/main.tsx"></script>
```

- [ ] **Step 7: Install dependencies**

```powershell
npm install
```

Expected: installs `typescript`, removes old ESLint packages.

- [ ] **Step 8: Verify config compiles**

```powershell
npx tsc --noEmit
```

Expected: may report errors on unconverted JS files (expected at this stage — only .ts files checked).

- [ ] **Step 9: Commit**

```powershell
git add frontend/tsconfig.json frontend/src/vite-env.d.ts frontend/vite.config.ts frontend/biome.json frontend/package.json frontend/index.html; git rm frontend/vite.config.js frontend/eslint.config.js; if ($?) { git commit -m "🔧 chore: configure TypeScript toolchain, remove ESLint" }
```

---

### Task 3: Migrate leaf data files (version, avatar, api)

**Files:**
- Rename: `frontend/src/version.js` → `frontend/src/version.ts`
- Rename: `frontend/src/utils/avatar.js` → `frontend/src/utils/avatar.ts`
- Rename: `frontend/src/api.js` → `frontend/src/api.ts`
- Rename: `frontend/src/api/apiManagement.js` → `frontend/src/api/apiManagement.ts`

- [ ] **Step 1: Migrate `version.js` → `version.ts`**

```powershell
git mv frontend/src/version.js frontend/src/version.ts
```

Content stays the same — `import.meta.env` is typed by `vite-env.d.ts`.

- [ ] **Step 2: Migrate `utils/avatar.js` → `utils/avatar.ts`**

```powershell
git mv frontend/src/utils/avatar.js frontend/src/utils/avatar.ts
```

Edit: add type annotations:

```typescript
import nurseFemale from "../assets/avatars/nurse_female.png";
import nurseMale from "../assets/avatars/nurse_male.png";
import childFemale from "../assets/avatars/patient_child_female.png";
import childMale from "../assets/avatars/patient_child_male.png";
import elderFemale from "../assets/avatars/patient_elder_female.png";
import elderMale from "../assets/avatars/patient_elder_male.png";
import middleFemale from "../assets/avatars/patient_middle_female.png";
import middleMale from "../assets/avatars/patient_middle_male.png";
import youthFemale from "../assets/avatars/patient_youth_female.png";
import youthMale from "../assets/avatars/patient_youth_male.png";

const avatars: Record<string, string> = {
  patient_child_male: childMale,
  patient_child_female: childFemale,
  patient_youth_male: youthMale,
  patient_youth_female: youthFemale,
  patient_middle_male: middleMale,
  patient_middle_female: middleFemale,
  patient_elder_male: elderMale,
  patient_elder_female: elderFemale,
  nurse_male: nurseMale,
  nurse_female: nurseFemale,
};

export function getAgeGroup(age: number | null | undefined): string {
  if (age == null) return "youth";
  if (age < 15) return "child";
  if (age < 36) return "youth";
  if (age < 60) return "middle";
  return "elder";
}

interface PatientAvatarInfo {
  age?: number | null;
  gender?: string;
}

export function getPatientAvatar(patientInfo?: PatientAvatarInfo | null): string {
  if (!patientInfo) return avatars.patient_youth_male;

  const group = getAgeGroup(patientInfo.age);
  const sex = patientInfo.gender === "女" ? "female" : "male";
  const key = `patient_${group}_${sex}`;
  return avatars[key] || avatars.patient_youth_male;
}

export function getNurseAvatar(gender?: string): string {
  const sex = gender === "男" ? "male" : "female";
  return avatars[`nurse_${sex}`];
}
```

- [ ] **Step 3: Migrate `api.js` → `api.ts`**

```powershell
git mv frontend/src/api.js frontend/src/api.ts
```

Edit `frontend/src/api.ts` — add type annotations on the ~60 API functions:

```typescript
import axios, { type AxiosResponse } from "axios";
import type { LoginResponse, ApiSecret, ApiConfig, PromptData, RubricData, ScoreReviewData, StreamChunk } from "./types/api";
import type { TrainingRecord, LLMLog, FeedbackItem, DurationStat, TrendItem, TeacherSummary, StudentRanking, ClassSummaryItem, Grade, ClassItem, QASession, QAMessage } from "./types/models";
import type { PaginatedResponse } from "./types/models";

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

    const shouldRetry = !err.response || err.response.status >= 500 || err.code === "ECONNABORTED" || err.code === "ERR_NETWORK";

    if (!shouldRetry) {
      return Promise.reject(err);
    }

    config._retryCount = (config._retryCount || 0) + 1;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return api(config);
  },
);

// ── Auth ──
export function login(username: string, password: string): Promise<AxiosResponse<LoginResponse>> {
  return api.post("/auth/login", { username, password });
}

export function register(data: { username: string; password: string; display_name: string; role?: string }): Promise<AxiosResponse<unknown>> {
  return api.post("/auth/register", data);
}

export function getMe(): Promise<AxiosResponse<{ id: number; role: string; display_name: string; username: string }>> {
  return api.get("/auth/me");
}

// ── Cases ──
export function getCases(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<TrainingRecord>>> {
  return api.get("/cases", { params });
}

export function getCaseDetail(id: number): Promise<AxiosResponse<Record<string, unknown>>> {
  return api.get(`/cases/${id}`);
}

// ── Training ──
export function startTraining(caseId: number): Promise<AxiosResponse<{ record_id: number }>> {
  return api.post("/training/start", { case_id: caseId });
}

export function sendMessage(recordId: number, content: string, signal?: AbortSignal): Promise<AxiosResponse<{ id: number; content: string; role: string }>> {
  return api.post(`/chat/${recordId}/message`, { content }, { signal });
}

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

  const reader = resp.body!.getReader();
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
        const data: StreamChunk = JSON.parse(line.slice(6));
        if (data.error) {
          onError(data.error);
          return;
        }
        if (data.done && data.id != null) {
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

export function endTraining(recordId: number, signal?: AbortSignal): Promise<AxiosResponse<{ score?: number; status: string }>> {
  return api.post(`/training/${recordId}/end`, null, { signal });
}

export function retryScoring(recordId: number): Promise<AxiosResponse<unknown>> {
  return api.post(`/training/${recordId}/retry-scoring`);
}

// ── Records ──
export function getRecords(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<TrainingRecord>>> {
  return api.get("/training/records", { params });
}

export function deleteRecord(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/training/records/${id}`);
}

export function getRecordDetail(id: number): Promise<AxiosResponse<TrainingRecord>> {
  return api.get(`/training/records/${id}`);
}

export function exportRecords(): Promise<AxiosResponse<Blob>> {
  return api.get("/export/records", { responseType: "blob" });
}

export function exportRecordDetail(id: number): Promise<AxiosResponse<Blob>> {
  return api.get(`/export/record/${id}`, { responseType: "blob" });
}

// ── Admin Users ──
export function getUsers(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<Record<string, unknown>>>> {
  return api.get("/admin/users", { params });
}

export function getStats(): Promise<AxiosResponse<Record<string, unknown>>> {
  return api.get("/admin/stats");
}

// ── Q&A ──
export function createQASession(question: string): Promise<AxiosResponse<{ session_id: number; answer?: string }>> {
  return api.post("/qa/sessions", { question });
}

export function getQASessions(): Promise<AxiosResponse<QASession[]>> {
  return api.get("/qa/sessions");
}

export function deleteQASession(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/qa/sessions/${id}`);
}

export function getQASessionMessages(sessionId: number): Promise<AxiosResponse<QAMessage[]>> {
  return api.get(`/qa/sessions/${sessionId}/messages`);
}

export function askInQASession(sessionId: number, question: string): Promise<AxiosResponse<{ answer?: string; id?: number }>> {
  return api.post(`/qa/sessions/${sessionId}/ask`, { question });
}

export function getQAHistoryAll(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<QASession>>> {
  return api.get("/qa/history/all", { params });
}

export function getQASessionMessagesAdmin(sessionId: number): Promise<AxiosResponse<QAMessage[]>> {
  return api.get(`/qa/history/all/${sessionId}/messages`);
}

// ── Stats ──
export function getDurationStats(period?: string): Promise<AxiosResponse<DurationStat[]>> {
  return api.get(`/stats/duration?period=${period}`);
}

export function getTrends(period?: string): Promise<AxiosResponse<TrendItem[]>> {
  return api.get(`/stats/trends?period=${period}`);
}

export function getTeacherSummary(params?: Record<string, unknown>): Promise<AxiosResponse<TeacherSummary>> {
  return api.get("/stats/teacher-summary", { params });
}

export function getStudentRanking(params?: Record<string, unknown>): Promise<AxiosResponse<StudentRanking[]>> {
  return api.get("/stats/ranking", { params });
}

// ── User Management ──
export function updateUser(id: number, data: Record<string, unknown>): Promise<AxiosResponse<unknown>> {
  return api.put(`/admin/users/${id}`, data);
}

export function batchCreateUsers(users: Array<Record<string, unknown>>): Promise<AxiosResponse<unknown>> {
  return api.post("/admin/users/batch", users);
}

export function deleteUser(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/admin/users/${id}`);
}

export function getStudentDetail(userId: number): Promise<AxiosResponse<Record<string, unknown>>> {
  return api.get(`/admin/users/${userId}/detail`);
}

// ── Case Management ──
export function getManageCases(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<Record<string, unknown>>>> {
  return api.get("/cases/manage/list", { params });
}

export function createCase(caseData: Record<string, unknown>): Promise<AxiosResponse<unknown>> {
  return api.post("/cases", { case_data: caseData });
}

export function updateCase(id: number, caseData: Record<string, unknown>): Promise<AxiosResponse<unknown>> {
  return api.put(`/cases/${id}`, { case_data: caseData });
}

export function deleteCase(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/cases/${id}`);
}

// ── LLM Monitoring ──
export function getLLMStats(): Promise<AxiosResponse<Record<string, unknown>>> {
  return api.get("/admin/llm-stats");
}

export function getLLMLogs(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<LLMLog>>> {
  return api.get("/admin/llm-logs", { params: { aggregate_patient_chat: true, ...params } });
}

export function exportLLMLogs(dateFrom?: string, dateTo?: string): Promise<AxiosResponse<Blob>> {
  const params: Record<string, string> = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return api.get("/admin/llm-logs/export", { params, responseType: "blob" });
}

// ── Score Review ──
export function getScoreReview(recordId: number): Promise<AxiosResponse<ScoreReviewData>> {
  return api.get(`/training/records/${recordId}/review`);
}

export function submitScoreReview(recordId: number, data: ScoreReviewData): Promise<AxiosResponse<unknown>> {
  return api.post(`/training/records/${recordId}/review`, data);
}

export function submitFeedback(data: { type: string; content: string; rating?: number }): Promise<AxiosResponse<unknown>> {
  return api.post("/feedback", data);
}

export function getFeedbacks(params?: Record<string, unknown>): Promise<AxiosResponse<PaginatedResponse<FeedbackItem>>> {
  return api.get("/admin/feedback", { params });
}

export function getFeedbackStats(params?: Record<string, unknown>): Promise<AxiosResponse<Record<string, unknown>>> {
  return api.get("/admin/feedback/stats", { params });
}

export function generateCase(data: Record<string, unknown>): Promise<AxiosResponse<unknown>> {
  return api.post("/cases/generate", data);
}

// ── Grades ──
export async function getGrades(): Promise<Grade[]> {
  const res = await api.get<Grade[]>("/admin/grades");
  return res.data;
}

export async function createGrade(data: { name: string }): Promise<Grade> {
  const res = await api.post<Grade>("/admin/grades", data);
  return res.data;
}

export async function updateGrade(id: number, data: { name: string }): Promise<Grade> {
  const res = await api.put<Grade>(`/admin/grades/${id}`, data);
  return res.data;
}

export async function deleteGrade(id: number): Promise<unknown> {
  const res = await api.delete(`/admin/grades/${id}`);
  return res.data;
}

// ── Classes ──
export async function getClasses(params?: Record<string, unknown>): Promise<ClassItem[]> {
  const res = await api.get<ClassItem[]>("/admin/classes", { params });
  return res.data;
}

export async function createClass(data: { grade_id: number; name: string }): Promise<ClassItem> {
  const res = await api.post<ClassItem>("/admin/classes", data);
  return res.data;
}

export async function updateClass(id: number, data: Record<string, unknown>): Promise<ClassItem> {
  const res = await api.put<ClassItem>(`/admin/classes/${id}`, data);
  return res.data;
}

export async function deleteClass(id: number): Promise<unknown> {
  const res = await api.delete(`/admin/classes/${id}`);
  return res.data;
}

// ── Class Stats ──
export async function getClassSummary(params?: Record<string, unknown>): Promise<ClassSummaryItem[]> {
  const res = await api.get<ClassSummaryItem[]>("/stats/class-summary", { params });
  return res.data;
}

// ── Backup ──
export function downloadBackup(): Promise<AxiosResponse<Blob>> {
  return api.post("/admin/backup", null, { responseType: "blob" });
}

// ── Rubrics ──
export function fetchRubrics(): Promise<RubricData[]> {
  return api.get<RubricData[]>("/admin/api/rubrics").then((res) => res.data);
}

export function getActiveRubric(): Promise<RubricData> {
  return api.get<RubricData>("/admin/api/rubrics/active").then((res) => res.data);
}

export function createRubric(data: Record<string, unknown>): Promise<RubricData> {
  return api.post<RubricData>("/admin/api/rubrics", data).then((res) => res.data);
}

export function updateRubric(id: number, data: Record<string, unknown>): Promise<RubricData> {
  return api.put<RubricData>(`/admin/api/rubrics/${id}`, data).then((res) => res.data);
}

export function deleteRubric(id: number): Promise<unknown> {
  return api.delete(`/admin/api/rubrics/${id}`).then((res) => res.data);
}

export function activateRubric(id: number): Promise<unknown> {
  return api.post(`/admin/api/rubrics/${id}/activate`).then((res) => res.data);
}
```

- [ ] **Step 4: Migrate `api/apiManagement.js` → `api/apiManagement.ts`**

```powershell
git mv frontend/src/api/apiManagement.js frontend/src/api/apiManagement.ts
```

Edit `frontend/src/api/apiManagement.ts` — remove `.js` from import, add minimal types:

```typescript
import { api } from "../api";
import type { AxiosResponse } from "axios";
import type { ApiSecret, ApiConfig, PromptData } from "../types/api";

export function fetchSecrets(): Promise<AxiosResponse<ApiSecret[]>> {
  return api.get("/admin/api/secrets");
}
export function createSecret(data: Record<string, unknown>): Promise<AxiosResponse<ApiSecret>> {
  return api.post("/admin/api/secrets", data);
}
export function updateSecret(id: number, data: Record<string, unknown>): Promise<AxiosResponse<ApiSecret>> {
  return api.put(`/admin/api/secrets/${id}`, data);
}
export function deleteSecret(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/admin/api/secrets/${id}`);
}

export function fetchConfigs(purpose?: string): Promise<AxiosResponse<ApiConfig[]>> {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/api/configs", { params });
}
export function createConfig(data: Record<string, unknown>): Promise<AxiosResponse<ApiConfig>> {
  return api.post("/admin/api/configs", data);
}
export function updateConfig(id: number, data: Record<string, unknown>): Promise<AxiosResponse<ApiConfig>> {
  return api.put(`/admin/api/configs/${id}`, data);
}
export function deleteConfig(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/admin/api/configs/${id}`);
}
export function toggleConfig(id: number): Promise<AxiosResponse<unknown>> {
  return api.post(`/admin/api/configs/${id}/toggle`);
}
export function resetConfig(id: number): Promise<AxiosResponse<unknown>> {
  return api.post(`/admin/api/configs/${id}/reset`);
}
export function testConfig(id: number): Promise<AxiosResponse<unknown>> {
  return api.post(`/admin/api/configs/${id}/test`);
}

export function testAllConfigs(): Promise<AxiosResponse<unknown>> {
  return api.post("/admin/api/configs/test-all");
}

export function reloadRouter(): Promise<AxiosResponse<unknown>> {
  return api.post("/admin/api/reload");
}
export function checkHealth(): Promise<AxiosResponse<unknown>> {
  return api.get("/admin/api/health");
}

export function fetchEnvFallback(): Promise<AxiosResponse<unknown>> {
  return api.get("/admin/api/fallback");
}
export function testEnvFallback(): Promise<AxiosResponse<unknown>> {
  return api.post("/admin/api/fallback/test");
}

export function fetchPrompts(purpose?: string): Promise<AxiosResponse<PromptData[]>> {
  const params: Record<string, string> = {};
  if (purpose) params.purpose = purpose;
  return api.get("/admin/prompts", { params });
}
export function createPrompt(data: Record<string, unknown>): Promise<AxiosResponse<PromptData>> {
  return api.post("/admin/prompts", data);
}
export function updatePrompt(id: number, data: Record<string, unknown>): Promise<AxiosResponse<PromptData>> {
  return api.put(`/admin/prompts/${id}`, data);
}
export function deletePrompt(id: number): Promise<AxiosResponse<unknown>> {
  return api.delete(`/admin/prompts/${id}`);
}
export function activatePrompt(id: number): Promise<AxiosResponse<unknown>> {
  return api.post(`/admin/prompts/${id}/activate`);
}
export function validatePrompt(data: Record<string, unknown>): Promise<AxiosResponse<unknown>> {
  return api.post("/admin/prompts/validate", data);
}
export function reloadPrompts(): Promise<AxiosResponse<unknown>> {
  return api.post("/admin/prompts/reload");
}
export function previewActivePrompt(purpose: string): Promise<AxiosResponse<unknown>> {
  return api.get("/admin/prompts/active/preview", { params: { purpose } });
}
export function fetchSampleVars(purpose: string): Promise<AxiosResponse<unknown>> {
  return api.get("/admin/prompts/sample-vars", { params: { purpose } });
}
```

- [ ] **Step 5: Update imports in all files referencing these renamed modules**

Since we renamed `.js` to `.ts` (or dropped the extension entirely), find and fix imports in consuming files:

```powershell
# Find all imports of api.js (with .js extension in import path — should just be apiManagement.js)
rg --no-filename "from.*\.js" frontend/src/ | Select-String -Pattern '\.js'
```

Search and fix manually across the codebase — any import ending in `.js` or `.jsx` extension must have the extension removed (TS/ESM resolves without extension or with auto-resolution):

Files to check and fix imports:
- `api/apiManagement.ts` line 1: `from "../api"` (already fixed in step 4)
- All `.jsx` files importing from `../api` — these already don't use extensions, so no change needed
- Any file importing these modules — grep for `from.*avatar` to verify

Run:

```powershell
rg "from.*['\"].*avatar" frontend/src/ --include="*.{jsx,ts,tsx}"
rg "from.*['\"].*version" frontend/src/ --include="*.{jsx,ts,tsx}"
rg "from.*['\"].*api["']" frontend/src/ --include="*.{jsx,ts,tsx}"
```

No imports use `.js`/`.jsx` extensions in this codebase (verified). The autocompletion by Vite handles `.ts`/`.tsx` resolution without explicit extensions.

- [ ] **Step 6: Commit**

```powershell
git add frontend/src/version.ts frontend/src/utils/avatar.ts frontend/src/api.ts frontend/src/api/apiManagement.ts; git rm frontend/src/version.js frontend/src/utils/avatar.js frontend/src/api.js frontend/src/api/apiManagement.js; if ($?) { git commit -m "✨ feat: migrate data layer to TypeScript" }
```

---

### Task 4: Migrate Zustand stores

**Files:**
- Rename: `frontend/src/stores/authStore.js` → `frontend/src/stores/authStore.ts`
- Rename: `frontend/src/stores/gradesClassesStore.js` → `frontend/src/stores/gradesClassesStore.ts`
- Rename: `frontend/src/stores/llmStore.js` → `frontend/src/stores/llmStore.ts`

- [ ] **Step 1: Migrate `stores/authStore.js` → `stores/authStore.ts`**

```powershell
git mv frontend/src/stores/authStore.js frontend/src/stores/authStore.ts
```

Edit `frontend/src/stores/authStore.ts`:

```typescript
import { create } from "zustand";
import { login as apiLogin, getMe } from "../api";
import type { AuthState } from "../types/store";
import type { User } from "../types/models";

const useAuthStore = create<AuthState>((set, get) => ({
  user: ((): User | null => {
    const userStr = localStorage.getItem("user");
    if (userStr) {
      try {
        return JSON.parse(userStr) as User;
      } catch {
        return null;
      }
    }
    return null;
  })(),
  token: ((): string | null => {
    return localStorage.getItem("token") || null;
  })(),

  login: async (username: string, password: string): Promise<User> => {
    const { data } = await apiLogin(username, password);
    localStorage.setItem("token", data.access_token);
    const user: User = { user_id: data.user_id, role: data.role, display_name: data.display_name };
    localStorage.setItem("user", JSON.stringify(user));
    set({ user, token: data.access_token });
    return user;
  },

  refreshUser: async (): Promise<void> => {
    try {
      const { data } = await getMe();
      const user: User = { user_id: data.id, role: data.role, display_name: data.display_name };
      localStorage.setItem("user", JSON.stringify(user));
      set({ user });
    } catch {
      get().logout();
    }
  },

  logout: (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    set({ user: null, token: null });
  },
}));

export default useAuthStore;
```

- [ ] **Step 2: Migrate `stores/gradesClassesStore.js` → `stores/gradesClassesStore.ts`**

```powershell
git mv frontend/src/stores/gradesClassesStore.js frontend/src/stores/gradesClassesStore.ts
```

Edit `frontend/src/stores/gradesClassesStore.ts`:

```typescript
import { create } from "zustand";
import { getGrades, createGrade, updateGrade, deleteGrade, getClasses, createClass, updateClass, deleteClass } from "../api";
import type { GradesClassesState } from "../types/store";
import type { Grade, ClassItem } from "../types/models";

const useGradesClassesStore = create<GradesClassesState>((set, get) => ({
  grades: [] as Grade[],
  classes: [] as ClassItem[],
  loading: false,

  fetchGrades: async (): Promise<void> => {
    const { grades, loading } = get();
    if (loading) return;
    set({ loading: true });
    try {
      const data = await getGrades();
      set({ grades: data, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  createGrade: async (name: string): Promise<Grade> => {
    const data = await createGrade({ name });
    set((s) => ({ grades: [...s.grades, data] }));
    return data;
  },

  updateGrade: async (id: number, name: string): Promise<Grade> => {
    const data = await updateGrade(id, { name });
    set((s) => ({ grades: s.grades.map((g) => (g.id === id ? data : g)) }));
    return data;
  },

  deleteGrade: async (id: number): Promise<void> => {
    await deleteGrade(id);
    set((s) => ({ grades: s.grades.filter((g) => g.id !== id), classes: [] }));
  },

  fetchClasses: async (gradeId?: number): Promise<ClassItem[]> => {
    try {
      const params = gradeId ? { grade_id: gradeId } : {};
      const data = await getClasses(params);
      set({ classes: data });
      return data;
    } catch {
      return [];
    }
  },

  createClass: async (gradeId: number, name: string): Promise<ClassItem> => {
    const data = await createClass({ grade_id: gradeId, name });
    set((s) => ({ classes: [...s.classes, data] }));
    return data;
  },

  updateClass: async (id: number, body: Partial<ClassItem>): Promise<ClassItem> => {
    const data = await updateClass(id, body);
    set((s) => ({ classes: s.classes.map((c) => (c.id === id ? data : c)) }));
    return data;
  },

  deleteClass: async (id: number): Promise<void> => {
    await deleteClass(id);
    set((s) => ({ classes: s.classes.filter((c) => c.id !== id) }));
  },
}));

export default useGradesClassesStore;
```

- [ ] **Step 3: Migrate `stores/llmStore.js` → `stores/llmStore.ts`**

```powershell
git mv frontend/src/stores/llmStore.js frontend/src/stores/llmStore.ts
```

Edit `frontend/src/stores/llmStore.ts`:

```typescript
import { create } from "zustand";
import type { LLMState } from "../types/store";

const useLLMStore = create<LLMState>((set) => ({
  tab: "monitor",
  setTab: (tab: string): void => set({ tab }),
}));

export default useLLMStore;
```

- [ ] **Step 4: Update imports in consumer files**

```powershell
# Check all files that import from stores
rg "from.*['\"].*stores/" frontend/src/ --include="*.{jsx,ts,tsx}"
```

No extension changes needed — existing import paths resolve to `.ts` automatically via Vite.

- [ ] **Step 5: Commit**

```powershell
git add frontend/src/stores/; git rm frontend/src/stores/*.js; if ($?) { git commit -m "✨ feat: migrate Zustand stores to TypeScript" }
```

---

### Task 5: Migrate useVoice hook

**Files:**
- Rename: `frontend/src/hooks/useVoice.js` → `frontend/src/hooks/useVoice.ts`

- [ ] **Step 1: Migrate `hooks/useVoice.js` → `hooks/useVoice.ts`**

```powershell
git mv frontend/src/hooks/useVoice.js frontend/src/hooks/useVoice.ts
```

Edit `frontend/src/hooks/useVoice.ts` — add type annotations, reference global declarations from `globals.d.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from "react";

const SENTENCE_RE = /[^。！？；\n]*[。！？；\n]/g;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  const zhCN = voices.filter((v) => v.lang.startsWith("zh-CN"));
  const female = zhCN.find((v) => v.name.includes("Female") || v.name.includes("女") || v.name.includes("Tingting") || v.name.includes("Xiaoxiao"));
  if (female) return female;
  if (zhCN.length > 0) return zhCN[0];
  const zh = voices.find((v) => v.lang.startsWith("zh"));
  if (zh) return zh;
  return voices[0];
}

interface SpeechSupport {
  recognition: boolean;
  synthesis: boolean;
}

export interface UseVoiceReturn {
  speechSupported: SpeechSupport;
  isSpeaking: boolean;
  isListening: boolean;
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;
  speak: (text: string) => void;
  speakRaw: (text: string) => Promise<void>;
  speakStreamChunk: (chunk: string) => void;
  flushStreamSpeak: () => void;
  stopSpeak: () => void;
  resetSpeakState: () => void;
  startListening: () => Promise<string>;
  stopListening: () => void;
}

export default function useVoice(): UseVoiceReturn {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [autoPlay, setAutoPlay] = useState<boolean>(() => localStorage.getItem("voiceAutoPlay") === "true");

  useEffect(() => {
    localStorage.setItem("voiceAutoPlay", autoPlay ? "true" : "false");
  }, [autoPlay]);
  const [speechSupported, setSpeechSupported] = useState<SpeechSupport>({ recognition: false, synthesis: false });

  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const bufferRef = useRef("");
  const spokenLenRef = useRef(0);
  const speakPromRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const rec = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const syn = !!window.speechSynthesis;
    setSpeechSupported({ recognition: rec, synthesis: syn });
    if (syn) {
      voiceRef.current = pickVoice();
      const onVoicesChanged = () => {
        voiceRef.current = pickVoice();
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
      return () => {
        window.speechSynthesis.onvoiceschanged = null;
      };
    }
  }, []);

  const stopSpeak = useCallback(() => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    bufferRef.current = "";
  }, []);

  const speakRaw = useCallback((text: string): Promise<void> => {
    if (!window.speechSynthesis || !text.trim()) return Promise.resolve();
    window.speechSynthesis.cancel();
    return new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 0.9;
      if (voiceRef.current) u.voice = voiceRef.current;
      u.onend = () => {
        setIsSpeaking(false);
        resolve();
      };
      u.onerror = () => {
        setIsSpeaking(false);
        resolve();
      };
      setIsSpeaking(true);
      window.speechSynthesis.speak(u);
    });
  }, []);

  const speak = useCallback(
    (text: string): void => {
      if (!autoPlay) return;
      const portion = text.slice(spokenLenRef.current);
      if (!portion.trim()) return;
      spokenLenRef.current = text.length;
      speakPromRef.current = speakPromRef.current.then(() => speakRaw(portion));
    },
    [autoPlay, speakRaw],
  );

  const speakStreamChunk = useCallback(
    (chunk: string): void => {
      if (!autoPlay) return;
      bufferRef.current += chunk;
      const buf = bufferRef.current;
      const matches = buf.match(SENTENCE_RE);
      if (!matches || matches.length === 0) return;
      let consumed = 0;
      for (const m of matches) {
        speakPromRef.current = speakPromRef.current.then(() => speakRaw(m));
        consumed += m.length;
      }
      bufferRef.current = buf.slice(consumed);
    },
    [autoPlay, speakRaw],
  );

  const flushStreamSpeak = useCallback(() => {
    const remaining = bufferRef.current.trim();
    bufferRef.current = "";
    if (!remaining || !autoPlay) return;
    speakPromRef.current = speakPromRef.current.then(() => speakRaw(remaining));
  }, [autoPlay, speakRaw]);

  const resetSpeakState = useCallback(() => {
    spokenLenRef.current = 0;
    bufferRef.current = "";
  }, []);

  const startListening = useCallback((): Promise<string> => {
    return new Promise<string>((resolve, reject) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        reject(new Error("浏览器不支持语音输入"));
        return;
      }
      const recognition = new SR();
      recognition.lang = "zh-CN";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.onresult = (e) => {
        setIsListening(false);
        resolve(e.results[0]![0]!.transcript);
      };
      recognition.onerror = (e) => {
        setIsListening(false);
        reject(e);
      };
      recognition.onend = () => setIsListening(false);
      recognition.start();
      setIsListening(true);
    });
  }, []);

  const stopListening = useCallback(() => {
    setIsListening(false);
  }, []);

  return {
    speechSupported,
    isSpeaking,
    isListening,
    autoPlay,
    setAutoPlay,
    speak,
    speakRaw,
    speakStreamChunk,
    flushStreamSpeak,
    stopSpeak,
    resetSpeakState,
    startListening,
    stopListening,
  };
}
```

- [ ] **Step 2: Verify no consumer imports need updating**

```powershell
rg "from.*['\"].*useVoice" frontend/src/ --include="*.{jsx,ts,tsx}"
```

Expected: imports don't use extensions, auto-resolved.

- [ ] **Step 3: Commit**

```powershell
git add frontend/src/hooks/useVoice.ts; git rm frontend/src/hooks/useVoice.js; if ($?) { git commit -m "✨ feat: migrate useVoice hook to TypeScript" }
```

---

### Task 6: Migrate UI primitive components

**Files (9 files):**
- `frontend/src/components/ui/Badge.jsx` → `.tsx`
- `frontend/src/components/ui/Button.jsx` → `.tsx`
- `frontend/src/components/ui/ConfirmDialog.jsx` → `.tsx`
- `frontend/src/components/ui/FormField.jsx` → `.tsx`
- `frontend/src/components/ui/LoadingState.jsx` → `.tsx`
- `frontend/src/components/ui/Modal.jsx` → `.tsx`
- `frontend/src/components/ui/PageHeader.jsx` → `.tsx`
- `frontend/src/components/ui/StatCard.jsx` → `.tsx`
- `frontend/src/components/ui/Tabs.jsx` → `.tsx`

- [ ] **Step 1: Rename all 9 files**

```powershell
Get-ChildItem -LiteralPath "frontend\src\components\ui" -Filter "*.jsx" | ForEach-Object { git mv $_.FullName ($_.FullName -replace '\.jsx$', '.tsx') }
```

- [ ] **Step 2: Add type annotations to each file**

For each file, the pattern is: define props interface, annotate function component, fix any JS patterns that TS flags.

**`components/ui/Badge.tsx`:**

```typescript
import type { ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "success" | "warning" | "danger";
  style?: React.CSSProperties;
}

export default function Badge({ children, variant = "default", style }: BadgeProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/Button.tsx`:**

```typescript
import type { ReactNode, ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
  icon?: ReactNode;
}

export default function Button({ children, variant = "primary", loading, icon, style, ...rest }: ButtonProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/ConfirmDialog.tsx`:**

```typescript
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  // ... existing implementation unchanged, add types to state:
  const [dialog, setDialog] = useState<(ConfirmOptions & { open: boolean }) | null>(null);
  // ...
}

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be inside ConfirmProvider");
  return ctx;
}
```

**`components/ui/FormField.tsx`:**

```typescript
import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

interface FormFieldProps {
  label: string;
  name: string;
  type?: string;
  value?: string | number;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  error?: string;
  helperText?: string;
  children?: ReactNode;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
  rows?: number;
  options?: Array<{ value: string | number; label: string }>;
}

export default function FormField({ label, ...rest }: FormFieldProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/LoadingState.tsx`:**

```typescript
interface LoadingStateProps {
  text?: string;
  style?: React.CSSProperties;
}

export default function LoadingState({ text = "加载中...", style }: LoadingStateProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/Modal.tsx`:**

```typescript
import { useEffect, type ReactNode } from "react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  style?: React.CSSProperties;
}

export default function Modal({ open, onClose, title, children, footer, width, style }: ModalProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/PageHeader.tsx`:**

```typescript
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  style?: React.CSSProperties;
}

export default function PageHeader({ title, subtitle, actions, style }: PageHeaderProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/StatCard.tsx`:**

```typescript
import type { ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon?: ReactNode;
  trend?: string;
  trendUp?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export default function StatCard({ title, value, icon, trend, trendUp, style, onClick }: StatCardProps) {
  // ... existing implementation unchanged
}
```

**`components/ui/Tabs.tsx`:**

```typescript
import type { ReactNode } from "react";

interface Tab {
  key: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  tabs: Tab[];
  activeKey?: string;
  onChange?: (key: string) => void;
  style?: React.CSSProperties;
}

export default function Tabs({ tabs, activeKey, onChange, style }: TabsProps) {
  // ... existing implementation unchanged
}
```

**IMPORTANT:** Read each file before editing. The interfaces above are templates — verify they match the actual component's prop usage and adjust. If a component's props are different, read the file and derive the correct interface.

- [ ] **Step 3: Run type check**

```powershell
npx tsc --noEmit 2>&1 | Select-Object -First 50
```

Expected: errors should only come from unconverted `.jsx` files (pages, other components). Fix any errors from the ui components.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/components/ui/; if ($?) { git commit -m "✨ feat: migrate UI primitive components to TypeScript" }
```

---

### Task 7: Migrate hook-level and standalone components

**Files (9 files):**
- `frontend/src/components/ErrorBoundary.jsx` → `.tsx`
- `frontend/src/components/FeedbackModal.jsx` → `.tsx`
- `frontend/src/components/FeedbackProvider.jsx` → `.tsx`
- `frontend/src/components/Toast.jsx` → `.tsx`
- `frontend/src/components/Pagination.jsx` → `.tsx`
- `frontend/src/components/PatientPortrait.jsx` → `.tsx`
- `frontend/src/components/ScoreCard.jsx` → `.tsx`
- `frontend/src/components/TrainingDurationChart.jsx` → `.tsx`
- `frontend/src/components/AppShell.jsx` → `.tsx`

- [ ] **Step 1: Rename all 9 files**

```powershell
Get-ChildItem -LiteralPath "frontend\src\components" -Filter "*.jsx" -File | ForEach-Object { git mv $_.FullName ($_.FullName -replace '\.jsx$', '.tsx') }
```

- [ ] **Step 2: Add type annotations**

**`components/ErrorBoundary.tsx`** (class component — needs explicit children typing):

```typescript
import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("React Error Boundary caught:", error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        // ... existing JSX unchanged
      );
    }
    return this.props.children;
  }
}
```

**`components/FeedbackModal.tsx`:**

```typescript
interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  // ... existing implementation, add types to local state:
  const [type, setType] = useState<string>("bug");
  const [content, setContent] = useState<string>("");
  // ...
}
```

**`components/FeedbackProvider.tsx`:**

```typescript
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface FeedbackContextValue {
  openFeedback: () => void;
}

const FeedbackContext = createContext<FeedbackContextValue | null>(null);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [show, setShow] = useState(false);
  const [promptContent, setPromptContent] = useState("");

  const openFeedback = useCallback((prompt?: string) => {
    setPromptContent(prompt || "");
    setShow(true);
  }, []);

  return (
    <FeedbackContext.Provider value={{ openFeedback }}>
      {children}
      {show && <FeedbackModal open={show} onClose={() => setShow(false)} />}
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): FeedbackContextValue {
  const ctx = useContext(FeedbackContext);
  if (!ctx) throw new Error("useFeedback must be inside FeedbackProvider");
  return ctx;
}
```

**`components/Toast.tsx`:**

```typescript
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastItem {
  id: number;
  message: string;
  type: "success" | "error" | "warning" | "info";
  duration: number;
  entering: boolean;
}

interface ToastContextValue {
  toast: (message: string, type?: "success" | "error" | "warning" | "info", duration?: number) => number;
  success: (msg: string) => number;
  error: (msg: string) => number;
  warning: (msg: string) => number;
  info: (msg: string) => number;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let _nextId = 0;

const icons: Record<string, ReactNode> = {
  success: <CheckCircle size={18} />,
  error: <XCircle size={18} />,
  warning: <AlertTriangle size={18} />,
  info: <Info size={18} />,
};

const colors: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  success: { bg: "#f0fdf4", border: "#86efac", text: "#166534", icon: "#16a34a" },
  error: { bg: "#fef2f2", border: "#fca5a5", text: "#991b1b", icon: "#dc2626" },
  warning: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", icon: "#d97706" },
  info: { bg: "#eff6ff", border: "#93c5fd", text: "#1e40af", icon: "#2563eb" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  // ... rest of implementation unchanged, add types to callbacks
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be inside ToastProvider");
  return ctx;
}
```

**`components/Pagination.tsx`:**

```typescript
import styles from "./Pagination.module.css";

interface PaginationProps {
  total: number;
  offset: number;
  limit: number;
  onChange: (offset: number) => void;
}

export default function Pagination({ total, offset, limit, onChange }: PaginationProps) {
  // ... existing implementation unchanged
}
```

**`components/PatientPortrait.tsx`:**

```typescript
import type { PatientInfo } from "../types/models";

interface PatientPortraitProps {
  patient: PatientInfo;
  style?: React.CSSProperties;
}

export default function PatientPortrait({ patient, style }: PatientPortraitProps) {
  // ... existing implementation unchanged
}
```

**`components/ScoreCard.tsx`:**

```typescript
import type { ScoreResult } from "../types/models";
import type { ReactNode } from "react";

interface ScoreCardProps {
  scores: ScoreResult[];
  totalScore: number;
  feedback?: string;
  loading?: boolean;
  title?: string;
  actions?: ReactNode;
}

export default function ScoreCard({ scores, totalScore, feedback, loading, title, actions }: ScoreCardProps) {
  // ... existing implementation unchanged
}
```

**`components/TrainingDurationChart.tsx`:**

```typescript
import type { DurationStat } from "../types/models";

interface TrainingDurationChartProps {
  data: DurationStat[];
  style?: React.CSSProperties;
}

export default function TrainingDurationChart({ data, style }: TrainingDurationChartProps) {
  // ... existing implementation unchanged
}
```

**`components/AppShell.tsx`:**

```typescript
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import useAuthStore from "../stores/authStore";
// ... (add type for nav items if not already implicitly typed)
```

- [ ] **Step 3: Run type check**

```powershell
npx tsc --noEmit 2>&1 | Select-Object -First 80
```

Fix any errors in the migrated components.

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/components/; if ($?) { git commit -m "✨ feat: migrate main components to TypeScript" }
```

---

### Task 8: Migrate teacher sub-components

**Files (10 files):**
- `frontend/src/components/teacher/ApiManagementTab.jsx` → `.tsx`
- `frontend/src/components/teacher/BackupTab.jsx` → `.tsx`
- `frontend/src/components/teacher/CasesTab.jsx` → `.tsx`
- `frontend/src/components/teacher/ClassFilter.jsx` → `.tsx`
- `frontend/src/components/teacher/ConfigModal.jsx` → `.tsx`
- `frontend/src/components/teacher/FeedbackTab.jsx` → `.tsx`
- `frontend/src/components/teacher/MonitorTab.jsx` → `.tsx`
- `frontend/src/components/teacher/PromptManagementTab.jsx` → `.tsx`
- `frontend/src/components/teacher/QARecordsTab.jsx` → `.tsx`
- `frontend/src/components/teacher/RecordsTab.jsx` → `.tsx`
- `frontend/src/components/teacher/RubricTab.jsx` → `.tsx`
- `frontend/src/components/teacher/SecretModal.jsx` → `.tsx`
- `frontend/src/components/teacher/UsersTab.jsx` → `.tsx`

- [ ] **Step 1: Rename all 13 teacher files**

```powershell
Get-ChildItem -LiteralPath "frontend\src\components\teacher" -Filter "*.jsx" | ForEach-Object { git mv $_.FullName ($_.FullName -replace '\.jsx$', '.tsx') }
```

- [ ] **Step 2: Add type annotations**

Read each file and add props interfaces. These are page-section components typically passed as `children` or used via tabs. Common patterns:

```typescript
// Typical teacher tab pattern:
interface SomeTabProps {
  // Props passed from parent page
  onAction?: () => void;
  // If component imports from store/api, those get typed through imports
}

export default function SomeTab({}: SomeTabProps) {
  // ... existing implementation
}
```

**Key focus:** read each file, add proper TS types to:
- Component props
- Local state (`useState<T>(initial)`)
- API call responses
- Event handlers

- [ ] **Step 3: Run type check**

```powershell
npx tsc --noEmit 2>&1 | Select-Object -First 80
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/components/teacher/; if ($?) { git commit -m "✨ feat: migrate teacher components to TypeScript" }
```

---

### Task 9: Migrate pages

**Files (10 files):**
- `frontend/src/pages/Login.jsx` → `.tsx`
- `frontend/src/pages/DashboardHome.jsx` → `.tsx`
- `frontend/src/pages/CaseSelect.jsx` → `.tsx`
- `frontend/src/pages/ChatTraining.jsx` → `.tsx`
- `frontend/src/pages/History.jsx` → `.tsx`
- `frontend/src/pages/RecordDetail.jsx` → `.tsx`
- `frontend/src/pages/QA.jsx` → `.tsx`
- `frontend/src/pages/Stats.jsx` → `.tsx`
- `frontend/src/pages/Admin.jsx` → `.tsx`

- [ ] **Step 1: Rename all page files**

```powershell
Get-ChildItem -LiteralPath "frontend\src\pages" -Filter "*.jsx" -File | ForEach-Object { git mv $_.FullName ($_.FullName -replace '\.jsx$', '.tsx') }
```

- [ ] **Step 2: Add type annotations**

Read each page file and add TS types. Common patterns:

```typescript
// Form state:
const [username, setUsername] = useState<string>("");
const [password, setPassword] = useState<string>("");
const [error, setError] = useState<string>("");
const [loading, setLoading] = useState<boolean>(false);

// API response data:
const [records, setRecords] = useState<TrainingRecord[]>([]);
const [total, setTotal] = useState<number>(0);

// Event handlers:
const handleSubmit = async (e: React.FormEvent): Promise<void> => { ... };
const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => { ... };
```

**`pages/Login.tsx`** — key types to add:
```typescript
import { useState, type FormEvent } from "react";
// ...
const [username, setUsername] = useState<string>("");
const [password, setPassword] = useState<string>("");
const [error, setError] = useState<string>("");
const [loading, setLoading] = useState<boolean>(false);

const handleSubmit = async (e: FormEvent): Promise<void> => { ... };
```

**`pages/ChatTraining.tsx`** — complex page, key types:
```typescript
import type { Message, ScoreResult } from "../types/models";
// ...
const [messages, setMessages] = useState<Message[]>([]);
const [input, setInput] = useState<string>("");
const [scores, setScores] = useState<ScoreResult[]>([]);
const [streaming, setStreaming] = useState<boolean>(false);
```

- [ ] **Step 3: Run type check**

```powershell
npx tsc --noEmit 2>&1 | Select-Object -First 80
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/pages/; if ($?) { git commit -m "✨ feat: migrate pages to TypeScript" }
```

---

### Task 10: Migrate admin sub-pages

**Files (7 files):**
- `frontend/src/pages/admin/UsersPage.jsx` → `.tsx`
- `frontend/src/pages/admin/UserDetailPage.jsx` → `.tsx`
- `frontend/src/pages/admin/CasesPage.jsx` → `.tsx`
- `frontend/src/pages/admin/LLMManagementPage.jsx` → `.tsx`
- `frontend/src/pages/admin/FeedbackPage.jsx` → `.tsx`
- `frontend/src/pages/admin/GradesClassesPage.jsx` → `.tsx`
- `frontend/src/pages/admin/BackupPage.jsx` → `.tsx`

- [ ] **Step 1: Rename all admin page files**

```powershell
Get-ChildItem -LiteralPath "frontend\src\pages\admin" -Filter "*.jsx" | ForEach-Object { git mv $_.FullName ($_.FullName -replace '\.jsx$', '.tsx') }
```

- [ ] **Step 2: Add type annotations**

Same pattern as Task 9. Read each file, add types to props, state, API responses, handlers.

- [ ] **Step 3: Run type check**

```powershell
npx tsc --noEmit 2>&1 | Select-Object -First 80
```

- [ ] **Step 4: Commit**

```powershell
git add frontend/src/pages/admin/; if ($?) { git commit -m "✨ feat: migrate admin pages to TypeScript" }
```

---

### Task 11: Migrate App.jsx, main.jsx, and test files

**Files:**
- Rename: `frontend/src/App.jsx` → `App.tsx`
- Rename: `frontend/src/main.jsx` → `main.tsx`
- Rename: `frontend/src/__tests__/Layout.test.jsx` → `Layout.test.tsx`
- Rename: `frontend/src/__tests__/FeedbackModal.test.jsx` → `FeedbackModal.test.tsx`
- Rename: `frontend/src/__tests__/Toast.test.jsx` → `Toast.test.tsx`
- Rename: `frontend/src/__tests__/api.test.js` → `api.test.ts`
- Rename: `frontend/src/__tests__/setup.js` → `setup.ts`
- Modify: `frontend/vitest.config.ts`

- [ ] **Step 1: Rename entry and test files**

```powershell
git mv frontend/src/App.jsx frontend/src/App.tsx
git mv frontend/src/main.jsx frontend/src/main.tsx
git mv frontend/src/__tests__/Layout.test.jsx frontend/src/__tests__/Layout.test.tsx
git mv frontend/src/__tests__/FeedbackModal.test.jsx frontend/src/__tests__/FeedbackModal.test.tsx
git mv frontend/src/__tests__/Toast.test.jsx frontend/src/__tests__/Toast.test.tsx
git mv frontend/src/__tests__/api.test.js frontend/src/__tests__/api.test.ts
git mv frontend/src/__tests__/setup.js frontend/src/__tests__/setup.ts
```

- [ ] **Step 2: Add types to `App.tsx`**

```typescript
import { lazy, Suspense, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { FeedbackProvider } from "./components/FeedbackProvider";
import { ToastProvider } from "./components/Toast";
import { ConfirmProvider } from "./components/ui/ConfirmDialog";
import useAuthStore from "./stores/authStore";
import Login from "./pages/Login";

// ... lazy imports unchanged

function PageLoader() {
  return (
    <div className="page-loader">
      <div className="spinner" />
      <p>加载中...</p>
    </div>
  );
}

interface ProtectedRouteProps {
  children: ReactNode;
  role?: "student" | "teacher";
}

function ProtectedRoute({ children, role }: ProtectedRouteProps) {
  const user = useAuthStore((s) => s.user);
  const token = useAuthStore((s) => s.token);

  if (!token || !user) return <Navigate to="/login" replace />;
  if (role && user.role !== role) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

export default function App() {
  // ... unchanged JSX
}
```

- [ ] **Step 3: Update `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    globals: true,
  },
});
```

- [ ] **Step 4: Update `__tests__/Layout.test.tsx` imports**

Change line 5:
```typescript
import Layout from "../components/Layout";
```
to:
```typescript
import AppShell from "../components/AppShell";
```
And update all usages of `<Layout>` to `<AppShell>` in the test file.

- [ ] **Step 5: Update `__tests__/setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
```

No type changes needed — content stays the same.

- [ ] **Step 6: Run full type check**

```powershell
npx tsc --noEmit
```

Expected: 0 errors (or only minor ones to fix).

- [ ] **Step 7: Run tests**

```powershell
npm test
```

Expected: all 4 test suites pass.

- [ ] **Step 8: Commit**

```powershell
git add frontend/src/App.tsx frontend/src/main.tsx frontend/src/__tests__/ frontend/vitest.config.ts; git rm frontend/src/App.jsx frontend/src/main.jsx frontend/src/__tests__/*.js frontend/src/__tests__/*.jsx; if ($?) { git commit -m "✨ feat: migrate entry files and tests to TypeScript" }
```

---

### Task 12: Remove Layout.jsx and apply path aliases

**Files:**
- Delete: `frontend/src/components/Layout.jsx`
- Modify: all files with `../../` relative imports → `@/`

- [ ] **Step 1: Delete Layout.jsx and fix its remaining consumer**

```powershell
git rm frontend/src/components/Layout.jsx
```

Find all imports of Layout:

```powershell
rg "from ['\"].*Layout" frontend/src/ --include="*.{tsx,ts}" 
```

Update any remaining references to import `AppShell` directly. (The test file was already fixed in Task 11.)

- [ ] **Step 2: Replace deep relative imports with `@/` aliases**

Find all `../../` and `../` imports in pages (deepest nesting):

```powershell
rg "from ['\"](\.\./)+" frontend/src/ --include="*.{tsx,ts}" --no-filename
```

For each match, replace with `@/` equivalent. Key conversions:

| From (in `pages/` or `pages/admin/`) | To |
|---|---|
| `"../../components/X"` | `"@/components/X"` |
| `"../components/X"` | `"@/components/X"` |
| `"../../stores/X"` | `"@/stores/X"` |
| `"../../api"` | `"@/api"` |
| `"../../../api"` (from admin) | `"@/api"` |
| `"../../hooks/X"` | `"@/hooks/X"` |
| `"../../../hooks/X"` (from admin) | `"@/hooks/X"` |
| `"../../utils/X"` | `"@/utils/X"` |
| `"../../types/X"` | `"@/types/X"` |
| `"../../../types/X"` (from admin) | `"@/types/X"` |

Components importing from sibling components (`"../ui/X"`, `"../teacher/X"`, `"../X"`) should also be converted:

| From | To |
|---|---|
| `"../ui/X"` | `"@/components/ui/X"` |
| `"../teacher/X"` | `"@/components/teacher/X"` |
| `"../X"` (same dir) | `"@/components/X"` |

- [ ] **Step 3: Run type check + tests**

```powershell
npx tsc --noEmit
npm test
```

- [ ] **Step 4: Run Biome format + lint**

```powershell
npx biome check --fix src/
npx biome format --write src/
```

- [ ] **Step 5: Commit**

```powershell
git add -A; if ($?) { git commit -m "♻️ refactor: remove Layout.jsx, apply @/ path aliases" }
```

---

### Task 13: Final verification

- [ ] **Step 1: Clean type check — zero errors**

```powershell
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 2: All tests pass**

```powershell
npm test
```

Expected: All tests pass.

- [ ] **Step 3: Build succeeds**

```powershell
npm run build
```

Expected: Build completes without errors, outputs to `dist/`.

- [ ] **Step 4: Biome lint clean**

```powershell
npm run lint
```

Expected: No new warnings introduced (may have pre-existing warnings from before migration).

- [ ] **Step 5: Manual spot check**

```powershell
npm run dev
```

Open browser, verify: login flow, dashboard, case selection, chat training, history, admin pages all render without runtime errors.

- [ ] **Step 6: Commit**

```powershell
if ($?) { git commit -m "✅ test: final verification — typecheck, tests, build pass" }
```

---

## Verification Checklist

After all tasks complete:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npm test` — all tests pass
- [ ] `npm run build` — produces valid bundle
- [ ] `npm run lint` — no new errors
- [ ] All `.js`/`.jsx` files removed from `src/`
- [ ] `eslint.config.js` deleted
- [ ] `Layout.jsx` deleted; all imports use `AppShell` directly
- [ ] Path aliases (`@/`) used consistently
- [ ] `index.html` references `main.tsx`
- [ ] `tsconfig.json` has `strict: true`
- [ ] `globals.d.ts` covers Web Speech API and CSS modules
- [ ] Manual smoke test passes (login, chat, admin)
