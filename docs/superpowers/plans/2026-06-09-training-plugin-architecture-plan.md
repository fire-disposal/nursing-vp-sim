# 训练页面插件化架构 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将训练页面从单体 ChatTraining.tsx 重构成插件化架构，前 17 个组件（引擎核心 + 8 前端插件 + 3 后端流水线插件 + 3 管理界面 + 3 后端 API）作为第一批迁移。

**Architecture:** 前端：TrainingEngine 编排器 + PluginRegistry + MessageBus + SlotRenderer（响应式 CSS Grid ）+ StreamManager + ScoreManager + PatientProvider。后端：PipelinePlugin 接口 + build_pipeline() 动态组装中间件链。场景配置 JSON 驱动前后端插件组合。

**Tech Stack:** React 19 + TypeScript 5 + Vite 8 + Tailwind CSS v4 + Zustand + React Router v7 + shadcn/ui；后端 Python 3.12 + FastAPI + SQLAlchemy 2.0

---

### 文件结构总览（本次计划涉及的文件）

```
新建: frontend/src/engine/
├── types.ts
├── PluginRegistry.ts
├── MessageBus.ts
├── PatientProvider.tsx
├── StreamManager.ts
├── ScoreManager.ts
├── SlotRenderer.tsx
├── useResponsiveLayout.ts
├── TrainingEngine.tsx
└── index.ts

新建: frontend/src/plugins/
├── timer/index.ts + TimerDisplay.tsx
├── voice/index.ts + VoiceButton.tsx
├── inquiry/index.ts + InquirySidebar.tsx
├── physical-exam/index.ts + ExamPanel.tsx (迁移自 OperationPanel.tsx)
├── nursing-record/index.ts + NursingRecordPanel.tsx (移动现有目录)
├── questionnaire/index.ts + QuestionnaireOverlay.tsx
├── patient-initiative/index.ts (纯逻辑)
├── scoring-display/index.ts + ScoreCard.tsx + ScoringOverlay.tsx
└── dev-tools/index.ts + panels/

新建: frontend/src/pages/admin/PluginDashboard.tsx
新建: frontend/src/pages/admin/ScenarioComposer.tsx
新建: frontend/src/api/scenarios.ts
新建: frontend/src/api/admin/plugins.ts
新建: frontend/src/api/admin/scenarios.ts
新建: frontend/src/hooks/useScenario.ts

改造: frontend/src/pages/ChatTraining.tsx
改造: frontend/src/pages/AdminDebugPage.tsx
改造: frontend/src/App.tsx (添加新路由)

后端新建/改造:
新建: backend/contexts/training/pipeline/plugin.py
改造: backend/contexts/training/pipeline/registry.py
新建: backend/contexts/training/pipeline/middleware/emotion_tracker.py
新建: backend/contexts/training/pipeline/middleware/initiative_timer_reset.py
改造: backend/contexts/training/pipeline/middleware/prompt_builder.py
改造: backend/core/feature_flags.py
新建: backend/routers/admin/scenarios.py
新建: backend/routers/admin/plugins.py
新建: backend/data/scenarios/*.json
```

---

### Task 1: 引擎类型定义

**Files:**
- Create: `frontend/src/engine/types.ts`

- [ ] **Step 1: 写入完整类型定义文件**

```typescript
// frontend/src/engine/types.ts
import type { ReactNode, ComponentType } from "react";

// ── 消息 / 患者 / 评分（复用现有类型） ──
export interface ChatMessage {
  id?: number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
  timestamp?: string;
}

export interface PatientData {
  name: string;
  age: number;
  gender: "male" | "female";
  caseTitle: string;
  chiefComplaint?: string;
  personality?: string;
  requiredInquiries?: string[];
}

export interface ScoreData {
  total_score?: number;
  detail_scores?: Record<string, number>;
  strengths?: string[];
  weaknesses?: string[];
  summary?: string;
}

// ── 槽位名称 ──
export type SlotName =
  | "header"
  | "sidebar"
  | "content"
  | "panel"
  | "overlay"
  | "footer"
  | "input-toolbar"
  | "sidebar-tray";

// ── 槽位渲染定义 ──
export interface SlotDefinition {
  render: "inline" | "drawer" | "sheet" | "modal";
  priority?: number;
}

// ── 布局定义 ──
export interface SlotGrid {
  areas: string[][];
  slots: Record<SlotName, SlotDefinition>;
}

export interface LayoutDef {
  breakpoints: {
    desktop: SlotGrid;
    tablet?: SlotGrid;
    mobile: SlotGrid;
  };
  sidebarBehavior: "fixed" | "collapsible" | "drawer";
  panelBehavior: "inline" | "drawer" | "sheet";
}

// ── 生命周期钩子 ──
export interface LifecycleHooks {
  onInit?: (ctx: PluginContext) => void | (() => void);
  beforeSend?: (message: string) => string;
  afterReceive?: (message: ChatMessage) => void;
  onPhaseChange?: (from: string, to: string) => void;
  onEnd?: (reason: "manual" | "timeout" | "admin") => void;
  onScoreReady?: (score: ScoreData) => void;
  onDestroy?: () => void;
}

// ── 轮询配置 ──
export interface PollConfig {
  endpoint: string;
  interval: number;
}

// ── 插件上下文 ──
export interface PluginContext {
  recordId: string;
  bus: MessageBus;
  patient: PatientData;
  sendMessage: (text: string) => void;
  endTraining: () => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

// ── MessageBus 接口 ──
export interface MessageBus {
  on(event: string, handler: (...args: any[]) => void): () => void;
  emit(event: string, ...args: any[]): void;
  off(event: string, handler: (...args: any[]) => void): void;
  listEvents(): string[];
}

// ── 插件运行时状态 ──
export type PluginStatus = "active" | "inactive" | "error" | "waiting";

export interface PluginRuntime {
  status: PluginStatus;
  activatedAt?: number;
  hookCalls: Record<string, number>;
  lastError?: string;
}

// ── 插件元数据 ──
export interface PluginMeta {
  description: string;
  icon?: string;
  author?: string;
  version?: string;
  tags?: string[];
  source?: string;
}

// ── 插件定义 ──
export interface TrainingPlugin {
  id: string;
  name: string;
  featureFlag?: string;
  requires?: string[];
  slots?: Partial<Record<SlotName, ComponentType<SlotProps>>>;
  hooks?: Partial<LifecycleHooks>;
  pollConfig?: PollConfig;
  meta: PluginMeta;
  runtime?: PluginRuntime;
}

// ── 传给 slot 组件的 props ──
export interface SlotProps {
  ctx: PluginContext;
  features: Record<string, boolean>;
  currentPhase: string;
  phaseCount: number;
  advancePhase: () => void;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/types.ts
git commit -m "feat: add engine type definitions for plugin architecture"
```

---

### Task 2: MessageBus 实现

**Files:**
- Create: `frontend/src/engine/MessageBus.ts`

- [ ] **Step 1: 写入 MessageBus 实现**

```typescript
// frontend/src/engine/MessageBus.ts
import type { MessageBus } from "./types";

export function createMessageBus(): MessageBus {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();

  return {
    on(event: string, handler: (...args: any[]) => void): () => void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
      return () => {
        listeners.get(event)?.delete(handler);
      };
    },

    emit(event: string, ...args: any[]): void {
      const handlers = listeners.get(event);
      if (!handlers) return;
      for (const h of handlers) {
        try {
          h(...args);
        } catch (e) {
          console.error(`[MessageBus] error in handler for "${event}":`, e);
        }
      }
    },

    off(event: string, handler: (...args: any[]) => void): void {
      listeners.get(event)?.delete(handler);
    },

    listEvents(): string[] {
      return Array.from(listeners.keys());
    },
  };
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/MessageBus.ts
git commit -m "feat: add MessageBus for plugin event communication"
```

---

### Task 3: PluginRegistry 实现

**Files:**
- Create: `frontend/src/engine/PluginRegistry.ts`

- [ ] **Step 1: 写入 PluginRegistry 实现**

```typescript
// frontend/src/engine/PluginRegistry.ts
import type { TrainingPlugin, SlotName, PluginRuntime, PluginStatus } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, TrainingPlugin>();
  private featureFlags: Record<string, boolean> = {};

  register(plugin: TrainingPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRegistry] plugin "${plugin.id}" already registered, overwriting.`);
    }
    this.plugins.set(plugin.id, { ...plugin });
  }

  getAll(): TrainingPlugin[] {
    return Array.from(this.plugins.values());
  }

  getActive(featureFlags?: Record<string, boolean>): TrainingPlugin[] {
    const flags = featureFlags ?? this.featureFlags;
    return Array.from(this.plugins.values()).filter((p) => this.isActive(p, flags));
  }

  getSlots(slotName: SlotName, featureFlags?: Record<string, boolean>): TrainingPlugin[] {
    return this.getActive(featureFlags).filter((p) => p.slots?.[slotName]);
  }

  isActive(plugin: TrainingPlugin, featureFlags: Record<string, boolean>): boolean {
    if (plugin.requires?.length) {
      const allDepsMet = plugin.requires.every((depId) => {
        const dep = this.plugins.get(depId);
        return dep && this.isActive(dep, featureFlags);
      });
      if (!allDepsMet) return false;
    }
    if (plugin.featureFlag !== undefined) {
      if (!featureFlags[plugin.featureFlag]) return false;
    }
    return true;
  }

  setFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlags = { ...flags };
  }

  updateRuntime(pluginId: string, update: Partial<PluginRuntime>): void {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;
    plugin.runtime = {
      status: "active" as PluginStatus,
      hookCalls: {},
      ...plugin.runtime,
      ...update,
    };
  }
}

export const pluginRegistry = new PluginRegistry();
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/PluginRegistry.ts
git commit -m "feat: add PluginRegistry for plugin lifecycle management"
```

---

### Task 4: PatientProvider 实现

**Files:**
- Create: `frontend/src/engine/PatientProvider.tsx`

- [ ] **Step 1: 写入 PatientProvider 和 usePatient hook**

```typescript
// frontend/src/engine/PatientProvider.tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/api/axios-instance";
import type { PatientData } from "./types";

interface PatientContextValue {
  patient: PatientData | null;
  loading: boolean;
  error: string | null;
}

const PatientContext = createContext<PatientContextValue>({
  patient: null,
  loading: true,
  error: null,
});

export function PatientProvider({ recordId, children }: { recordId: string; children: ReactNode }) {
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/training/records/${recordId}`)
      .then((res) => {
        if (cancelled) return;
        const d = res.data;
        setPatient({
          name: d.patient_name ?? d.patient?.name ?? "患者",
          age: d.patient_age ?? d.patient?.age ?? 0,
          gender: d.patient_gender ?? d.patient?.gender ?? "male",
          caseTitle: d.case_title ?? d.case?.title ?? "",
          chiefComplaint: d.chief_complaint ?? d.case?.chief_complaint ?? "",
          personality: d.personality ?? d.case?.personality ?? "",
          requiredInquiries: d.required_inquiries ?? [],
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || "加载患者信息失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [recordId]);

  return <PatientContext.Provider value={{ patient, loading, error }}>{children}</PatientContext.Provider>;
}

export function usePatient() {
  return useContext(PatientContext);
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/PatientProvider.tsx
git commit -m "feat: add PatientProvider for patient data context"
```

---

### Task 5: StreamManager 实现

**Files:**
- Create: `frontend/src/engine/StreamManager.ts`

- [ ] **Step 1: 写入 StreamManager（从 useChatStream 抽取核心逻辑）**

```typescript
// frontend/src/engine/StreamManager.ts
import { sendMessageStream } from "@/api/api-client";
import type { ChatMessage } from "./types";

export interface StreamCallbacks {
  onPatientChunk?: (chunk: string) => void;
  onPatientDone?: (replyId?: number) => void;
  onError?: (err: string) => void;
  onSanitized?: (reply: string) => void;
  onSystem?: (text: string) => void;
}

export class StreamManager {
  private recordId: number | null;
  private messages: ChatMessage[] = [];
  private listeners: Array<() => void> = [];
  private abortController: AbortController | null = null;
  private _loading = false;
  private loadingListeners: Array<(l: boolean) => void> = [];

  constructor(recordId: number | null) {
    this.recordId = recordId;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  get loading(): boolean {
    return this._loading;
  }

  setRecordId(id: number | null): void {
    this.recordId = id;
  }

  setMessages(msgs: ChatMessage[]): void {
    this.messages = msgs;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  onLoadingChange(fn: (loading: boolean) => void): () => void {
    this.loadingListeners.push(fn);
    return () => { this.loadingListeners = this.loadingListeners.filter((l) => l !== fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  private setLoading(v: boolean): void {
    this._loading = v;
    for (const fn of this.loadingListeners) fn(v);
  }

  abort(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.setLoading(false);
  }

  private isOperation(content: string): boolean {
    return content.startsWith("/") || content.startsWith("测") || content.startsWith("观察");
  }

  async send(content: string, callbacks: StreamCallbacks = {}): Promise<void> {
    if (!this.recordId || this._loading) return;
    this.setLoading(true);

    const op = this.isOperation(content);
    const addedIds = new Set<number>();

    if (!op) {
      const studentId = Date.now();
      addedIds.add(studentId);
      this.messages = [...this.messages, { id: studentId, role: "student", content }];
      this.notify();
    } else {
      const sysId = Date.now();
      addedIds.add(sysId);
      this.messages = [...this.messages, { id: sysId, role: "system", content: `正在${content}...` }];
      this.notify();
    }

    if (!op) {
      const placeholderId = Date.now() + 1;
      addedIds.add(placeholderId);
      this.messages = [...this.messages, { id: placeholderId, role: "patient", content: "", streaming: true }];
      this.notify();
    }

    const controller = new AbortController();
    this.abortController = controller;

    try {
      await sendMessageStream(
        this.recordId,
        content,
        (chunk) => {
          const msgs = [...this.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i]?.streaming) {
              msgs[i] = { ...msgs[i], content: msgs[i].content + chunk };
              this.messages = msgs;
              this.notify();
              break;
            }
          }
          callbacks.onPatientChunk?.(chunk);
        },
        (doneId) => {
          const msgs = [...this.messages];
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i]?.streaming) {
              msgs[i] = { ...msgs[i], streaming: false, id: doneId || msgs[i].id };
              this.messages = msgs;
              this.notify();
              break;
            }
          }
          callbacks.onPatientDone?.(doneId);
          this.setLoading(false);
          if (this.abortController === controller) this.abortController = null;
        },
        (err) => {
          this.messages = this.messages.filter((m) => !m.streaming && !addedIds.has(m.id ?? 0));
          this.notify();
          this.setLoading(false);
          callbacks.onError?.(err);
          if (this.abortController === controller) this.abortController = null;
        },
        (reply) => callbacks.onSanitized?.(reply),
        (sysMsg) => {
          this.messages = [...this.messages, { id: Date.now(), role: "system", content: sysMsg }];
          this.notify();
        },
        controller.signal,
      );
    } catch {
      this.messages = this.messages.filter((m) => !m.streaming && !addedIds.has(m.id ?? 0));
      this.notify();
      this.setLoading(false);
    } finally {
      if (this.abortController === controller) this.abortController = null;
    }
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/StreamManager.ts
git commit -m "feat: add StreamManager extracted from useChatStream"
```

---

### Task 6: ScoreManager 实现

**Files:**
- Create: `frontend/src/engine/ScoreManager.ts`

- [ ] **Step 1: 写入 ScoreManager**

```typescript
// frontend/src/engine/ScoreManager.ts
import { api } from "@/api/axios-instance";
import type { ScoreData } from "./types";

export class ScoreManager {
  private recordId: number | null;
  private _score: ScoreData | null = null;
  private _progress = 0;
  private _polling = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners: Array<() => void> = [];

  constructor(recordId: number | null) {
    this.recordId = recordId;
  }

  get score(): ScoreData | null { return this._score; }
  get progress(): number { return this._progress; }
  get polling(): boolean { return this._polling; }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  async end(): Promise<void> {
    if (!this.recordId) return;
    this._progress = 10;
    this.notify();
    await api.post(`/training/${this.recordId}/end`);
    this._progress = 30;
    this.notify();
    this.startPolling();
  }

  private startPolling(): void {
    if (this._polling || !this.recordId) return;
    this._polling = true;
    let retries = 0;
    const maxRetries = 40;

    this.pollTimer = setInterval(async () => {
      if (retries >= maxRetries) {
        this.stopPolling();
        return;
      }
      try {
        const res = await api.get(`/training/records/${this.recordId}/review`);
        const data = res.data as ScoreData;
        if (data && (data.total_score !== undefined || data.detail_scores)) {
          this._score = data;
          this._progress = 100;
          this.stopPolling();
          this.notify();
        } else {
          this._progress = Math.min(95, 30 + retries * 2);
          this.notify();
        }
      } catch {
        this._progress = Math.min(95, 30 + retries * 2);
        this.notify();
      }
      retries++;
    }, 3000);
  }

  stopPolling(): void {
    this._polling = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.notify();
  }

  reset(): void {
    this.stopPolling();
    this._score = null;
    this._progress = 0;
    this.notify();
  }

  setRecordId(id: number | null): void {
    this.recordId = id;
    this.reset();
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/ScoreManager.ts
git commit -m "feat: add ScoreManager extracted from useScorePolling + useScoreProgress"
```

---

### Task 7: SlotRenderer 实现

**Files:**
- Create: `frontend/src/engine/SlotRenderer.tsx`

- [ ] **Step 1: 写入 SlotRenderer**

```typescript
// frontend/src/engine/SlotRenderer.tsx
import type { ComponentType } from "react";
import type { SlotName, SlotProps, TrainingPlugin, SlotDefinition } from "./types";

interface SlotRendererProps {
  name: SlotName;
  plugins: TrainingPlugin[];
  definition: SlotDefinition;
  slotProps: SlotProps;
}

export function SlotRenderer({ name, plugins, definition, slotProps }: SlotRendererProps) {
  const candidates = plugins
    .filter((p) => p.slots?.[name])
    .sort((a, b) => (a.slots![name]?.priority ?? 99) - (b.slots![name]?.priority ?? 99));

  if (candidates.length === 0) return null;

  return (
    <div className="slot-container" data-slot={name} data-render={definition.render}>
      {candidates.map((plugin) => {
        const Component = plugin.slots![name] as ComponentType<SlotProps>;
        return <Component key={plugin.id} {...slotProps} />;
      })}
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/SlotRenderer.tsx
git commit -m "feat: add SlotRenderer for dynamic slot composition"
```

---

### Task 8: 响应式布局 hook

**Files:**
- Create: `frontend/src/engine/useResponsiveLayout.ts`

- [ ] **Step 1: 写入 useResponsiveLayout**

```typescript
// frontend/src/engine/useResponsiveLayout.ts
import { useEffect, useState } from "react";
import type { LayoutDef, SlotGrid } from "./types";

type Breakpoint = "desktop" | "tablet" | "mobile";

function getBreakpoint(): Breakpoint {
  const w = window.innerWidth;
  if (w >= 1024) return "desktop";
  if (w >= 768) return "tablet";
  return "mobile";
}

export function useResponsiveLayout(layout: LayoutDef): SlotGrid {
  const [bp, setBp] = useState<Breakpoint>(getBreakpoint);

  useEffect(() => {
    const handler = () => setBp(getBreakpoint());
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  if (bp === "desktop") return layout.breakpoints.desktop;
  if (bp === "tablet") return layout.breakpoints.tablet ?? layout.breakpoints.mobile;
  return layout.breakpoints.mobile;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/useResponsiveLayout.ts
git commit -m "feat: add useResponsiveLayout hook for viewport-aware slot grids"
```

---

### Task 9: TrainingEngine 编排器

**Files:**
- Create: `frontend/src/engine/TrainingEngine.tsx`

- [ ] **Step 1: 写入 TrainingEngine 主组件**

```typescript
// frontend/src/engine/TrainingEngine.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { pluginRegistry } from "./PluginRegistry";
import { createMessageBus } from "./MessageBus";
import { StreamManager } from "./StreamManager";
import { ScoreManager } from "./ScoreManager";
import { PatientProvider, usePatient } from "./PatientProvider";
import { SlotRenderer } from "./SlotRenderer";
import { useResponsiveLayout } from "./useResponsiveLayout";
import type { TrainingPlugin, SlotName, LayoutDef, SlotProps, ChatMessage } from "./types";

// ── 默认布局 ──
const DEFAULT_LAYOUT: LayoutDef = {
  breakpoints: {
    desktop: {
      areas: [
        ["header", "header", "header"],
        ["sidebar", "content", "panel"],
        ["footer", "footer", "panel"],
      ],
      slots: {
        header: { render: "inline" },
        sidebar: { render: "inline", priority: 1 },
        content: { render: "inline" },
        panel: { render: "inline", priority: 2 },
        footer: { render: "inline" },
        overlay: { render: "modal" },
      },
    },
    mobile: {
      areas: [["header"], ["content"], ["footer"]],
      slots: {
        header: { render: "inline" },
        content: { render: "inline" },
        footer: { render: "inline" },
        sidebar: { render: "sheet", priority: 1 },
        panel: { render: "drawer", priority: 2 },
        overlay: { render: "modal" },
      },
    },
  },
  sidebarBehavior: "fixed",
  panelBehavior: "inline",
};

interface TrainingEngineProps {
  recordId: string;
  scenarioConfig?: { features?: Record<string, boolean>; layout?: LayoutDef; plugins?: string[] };
  plugins: TrainingPlugin[];
}

function TrainingEngineInner({ recordId, scenarioConfig, plugins }: TrainingEngineProps) {
  const navigate = useNavigate();
  const { patient, loading } = usePatient();
  const recordNum = Number(recordId);

  // ── 核心管理器（useRef 保持实例稳定） ──
  const busRef = useRef(createMessageBus());
  const streamRef = useRef(new StreamManager(recordNum));
  const scoreRef = useRef(new ScoreManager(recordNum));

  // ── 消息状态（由 StreamManager 驱动） ──
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    streamRef.current.setRecordId(recordNum);
    const unsub = streamRef.current.subscribe(() => setMessages([...streamRef.current.getMessages()]));
    const unsubLoading = streamRef.current.onLoadingChange(setSending);
    return () => { unsub(); unsubLoading(); };
  }, [recordNum]);

  // ── 评分状态 ──
  const [score, setScore] = useState(scoreRef.current.score);
  const [progress, setProgress] = useState(scoreRef.current.progress);

  useEffect(() => {
    scoreRef.current.setRecordId(recordNum);
    const unsub = scoreRef.current.subscribe(() => {
      setScore(scoreRef.current.score);
      setProgress(scoreRef.current.progress);
    });
    return unsub;
  }, [recordNum]);

  // ── 注册插件 ──
  useEffect(() => {
    pluginRegistry.setFeatureFlags(scenarioConfig?.features ?? {});
    for (const p of plugins) pluginRegistry.register(p);
    return () => { /* plugins 注销由各自 hooks 清理 */ };
  }, [plugins, scenarioConfig?.features]);

  const activePlugins = useMemo(
    () => pluginRegistry.getActive(scenarioConfig?.features),
    [plugins, scenarioConfig?.features],
  );

  // ── 布局 ──
  const layout = scenarioConfig?.layout ?? DEFAULT_LAYOUT;
  const grid = useResponsiveLayout(layout);

  // ── 构建 slot props ──
  const sendMessage = useCallback(
    (text: string) => {
      streamRef.current.send(text, {
        onPatientChunk: () => busRef.current.emit("stream:chunk"),
        onPatientDone: () => busRef.current.emit("stream:done"),
        onError: (err) => busRef.current.emit("stream:error", err),
      });
    },
    [],
  );

  const endTraining = useCallback(async () => {
    await scoreRef.current.end();
    busRef.current.emit("training:ended");
  }, []);

  const slotProps: SlotProps = useMemo(
    () => ({
      ctx: {
        recordId,
        bus: busRef.current,
        patient: patient!,
        sendMessage,
        endTraining,
        setMessages: (action) => {
          setMessages((prev) => {
            const next = typeof action === "function" ? action(prev) : action;
            streamRef.current.setMessages(next);
            return next;
          });
        },
      },
      features: scenarioConfig?.features ?? {},
      currentPhase: "history_taking",
      phaseCount: 1,
      advancePhase: () => {},
    }),
    [recordId, patient, sendMessage, endTraining, scenarioConfig?.features],
  );

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="size-8 animate-spin rounded-full border-[3px] border-primary/30 border-t-primary" />
      </div>
    );
  }

  if (!patient) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">患者信息加载失败</div>;
  }

  // ── CSS Grid 模板区域 ──
  const gridTemplateAreas = grid.areas.map((row) => `"${row.join(" ")}"`).join(" ");

  return (
    <div
      className="training-grid h-screen gap-2 p-2"
      style={{ display: "grid", gridTemplateAreas, gridTemplateColumns: "repeat(auto-fit, 1fr)" }}
    >
      {(["header", "sidebar", "content", "panel", "footer", "overlay", "input-toolbar", "sidebar-tray"] as SlotName[]).map(
        (name) => {
          const def = grid.slots[name as SlotName];
          if (!def) return null;
          return (
            <SlotRenderer
              key={name}
              name={name}
              plugins={activePlugins}
              definition={def}
              slotProps={slotProps}
            />
          );
        },
      )}
    </div>
  );
}

export function TrainingEngine(props: TrainingEngineProps) {
  return (
    <PatientProvider recordId={props.recordId}>
      <TrainingEngineInner {...props} />
    </PatientProvider>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/TrainingEngine.tsx
git commit -m "feat: add TrainingEngine orchestrator component"
```

---

### Task 10: 引擎 index 导出

**Files:**
- Create: `frontend/src/engine/index.ts`

- [ ] **Step 1: 写入 barrel export**

```typescript
// frontend/src/engine/index.ts
export { TrainingEngine } from "./TrainingEngine";
export { PluginRegistry, pluginRegistry } from "./PluginRegistry";
export { createMessageBus } from "./MessageBus";
export { StreamManager } from "./StreamManager";
export { ScoreManager } from "./ScoreManager";
export { PatientProvider, usePatient } from "./PatientProvider";
export { SlotRenderer } from "./SlotRenderer";
export { useResponsiveLayout } from "./useResponsiveLayout";
export type * from "./types";
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/engine/index.ts
git commit -m "feat: add engine barrel exports"
```

---

### Task 11: Timer 插件

**Files:**
- Create: `frontend/src/plugins/timer/index.ts`
- Create: `frontend/src/plugins/timer/TimerDisplay.tsx`

- [ ] **Step 1: 写入 TimerDisplay 组件**

```typescript
// frontend/src/plugins/timer/TimerDisplay.tsx
import { useEffect, useState } from "react";
import type { SlotProps } from "@/engine/types";

interface TimerDisplayProps extends SlotProps {
  duration?: number; // 分钟
}

export function TimerDisplay({ ctx, duration = 30 }: TimerDisplayProps) {
  const [remaining, setRemaining] = useState(duration * 60);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    if (remaining <= 0) {
      ctx.bus.emit("timer:timeout");
      ctx.endTraining();
      return;
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, paused, ctx]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <div className="flex items-center gap-1 text-sm font-mono tabular-nums">
      <span className={remaining < 300 ? "text-red-500" : ""}>
        {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
      </span>
      <button onClick={() => setPaused((p) => !p)} className="text-xs text-muted-foreground">
        {paused ? "▶" : "⏸"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 写入 timer 插件定义**

```typescript
// frontend/src/plugins/timer/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { TimerDisplay } from "./TimerDisplay";

export const timerPlugin: TrainingPlugin = {
  id: "timer",
  name: "倒计时",
  meta: {
    description: "训练倒计时，超时自动结束训练",
    icon: "clock",
    tags: ["ui", "header"],
  },
  slots: {
    header: TimerDisplay,
  },
  hooks: {
    onEnd(reason) {
      // timer:timeout 事件已在 TimerDisplay 中 emit
    },
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/plugins/timer/
git commit -m "feat: add timer plugin extracted from useTrainingTimer"
```

---

### Task 12: Voice 插件

**Files:**
- Create: `frontend/src/plugins/voice/index.ts`
- Create: `frontend/src/plugins/voice/VoiceButton.tsx`

- [ ] **Step 1: 写入 VoiceButton**

```typescript
// frontend/src/plugins/voice/VoiceButton.tsx
import { useEffect, useRef, useState } from "react";
import type { SlotProps } from "@/engine/types";

declare global {
  interface Window {
    SpeechSynthesisUtterance: typeof SpeechSynthesisUtterance;
    SpeechRecognition: typeof SpeechRecognition;
    webkitSpeechRecognition: typeof SpeechRecognition;
  }
}

export function VoiceButton({ ctx }: SlotProps) {
  const [autoPlay, setAutoPlay] = useState(() => localStorage.getItem("voice_autoPlay") !== "false");
  const [listening, setListening] = useState(false);
  const recogRef = useRef<any>(null);

  useEffect(() => {
    localStorage.setItem("voice_autoPlay", String(autoPlay));
  }, [autoPlay]);

  // 自动朗读：监听 stream:done
  useEffect(() => {
    if (!autoPlay) return;
    const unsub = ctx.bus.on("stream:done", () => {
      const msgs = document.querySelectorAll("[data-role='patient']");
      const last = msgs[msgs.length - 1];
      if (last) {
        const text = last.textContent ?? "";
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "zh-CN";
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    });
    return unsub;
  }, [autoPlay, ctx.bus]);

  const toggleListen = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    if (listening) {
      recogRef.current?.stop();
      setListening(false);
      return;
    }

    const recog = new SpeechRecognition();
    recog.lang = "zh-CN";
    recog.interimResults = true;
    recogRef.current = recog;

    recog.onresult = (e: any) => {
      let transcript = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      if (e.results[0]?.isFinal) {
        ctx.sendMessage(transcript);
        setListening(false);
      }
    };

    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);

    recog.start();
    setListening(true);
  };

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => setAutoPlay((v) => !v)}
        className={`text-xs px-1 rounded ${autoPlay ? "bg-primary/20 text-primary" : "text-muted-foreground"}`}
        title={autoPlay ? "自动朗读开" : "自动朗读关"}
      >
        🔊
      </button>
      <button
        onClick={toggleListen}
        className={`text-xs px-1 rounded ${listening ? "bg-red-500/20 text-red-500 animate-pulse" : "text-muted-foreground"}`}
        title="语音输入"
      >
        🎤
      </button>
    </div>
  );
}
```

- [ ] **Step 2: 写入 voice 插件定义**

```typescript
// frontend/src/plugins/voice/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { VoiceButton } from "./VoiceButton";

export const voicePlugin: TrainingPlugin = {
  id: "voice",
  name: "语音交互",
  meta: {
    description: "TTS 自动朗读患者回复 + 语音输入",
    icon: "mic",
    tags: ["ui", "input", "tts"],
  },
  slots: {
    "input-toolbar": VoiceButton,
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/plugins/voice/
git commit -m "feat: add voice plugin extracted from useVoice"
```

---

### Task 13: Inquiry 插件

**Files:**
- Create: `frontend/src/plugins/inquiry/index.ts`
- Create: `frontend/src/plugins/inquiry/InquirySidebar.tsx`

- [ ] **Step 1: 写入 InquirySidebar**

```typescript
// frontend/src/plugins/inquiry/InquirySidebar.tsx
import { useEffect, useMemo, useState } from "react";
import type { SlotProps, ChatMessage } from "@/engine/types";

export function InquirySidebar({ ctx }: SlotProps) {
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const inquiries = ctx.patient.requiredInquiries ?? [];

  useEffect(() => {
    const unsub = ctx.bus.on("stream:done", () => {
      const msgs = document.querySelectorAll("[data-role='patient']");
      msgs.forEach((el) => {
        const text = (el.textContent ?? "").toLowerCase();
        for (const q of inquiries) {
          if (text.includes(q.toLowerCase())) {
            setCompleted((prev) => new Set([...prev, q]));
          }
        }
      });
    });
    return unsub;
  }, [inquiries, ctx.bus]);

  if (inquiries.length === 0) return null;

  const done = completed.size;
  const total = inquiries.length;
  const pct = Math.round((done / total) * 100);

  return (
    <div className="text-xs">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">问诊进度</span>
        <div className="h-1.5 flex-1 rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写入 inquiry 插件定义**

```typescript
// frontend/src/plugins/inquiry/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { InquirySidebar } from "./InquirySidebar";

export const inquiryPlugin: TrainingPlugin = {
  id: "inquiry",
  name: "问诊进度",
  meta: {
    description: "显示必问问诊项完成进度",
    icon: "clipboard-list",
    tags: ["ui", "header"],
  },
  slots: {
    header: InquirySidebar,
    "sidebar-tray": InquirySidebar,
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/plugins/inquiry/
git commit -m "feat: add inquiry progress plugin"
```

---

### Task 14: Physical Exam 前端插件

**Files:**
- Create: `frontend/src/plugins/physical-exam/index.ts`
- Create: `frontend/src/plugins/physical-exam/ExamPanel.tsx`

- [ ] **Step 1: 从现有 OperationPanel.tsx 复制并改造为 ExamPanel**

```typescript
// frontend/src/plugins/physical-exam/ExamPanel.tsx
import { useState } from "react";
import type { SlotProps } from "@/engine/types";

const OPERATIONS = [
  { id: "vitals", label: "生命体征", command: "/vitals" },
  { id: "bp", label: "血压", command: "/bp" },
  { id: "temp", label: "体温", command: "/temp" },
  { id: "spo2", label: "血氧", command: "/spo2" },
  { id: "hr", label: "心率", command: "/hr" },
  { id: "rr", label: "呼吸", command: "/rr" },
  { id: "skin", label: "皮肤", command: "/skin" },
  { id: "pain", label: "疼痛评分", command: "/pain" },
];

export function ExamPanel({ ctx, features }: SlotProps) {
  const [expanded, setExpanded] = useState(false);

  if (!features.physical_exam) return null;

  const execute = (cmd: string) => {
    ctx.sendMessage(cmd);
  };

  return (
    <div className="rounded-lg border bg-card p-3">
      <button onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between text-sm font-medium">
        <span>护理查体操作</span>
        <span className="text-muted-foreground">{expanded ? "▲" : "▼"}</span>
      </button>
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-1">
          {OPERATIONS.map((op) => (
            <button
              key={op.id}
              onClick={() => execute(op.command)}
              className="rounded bg-secondary px-2 py-1 text-xs hover:bg-secondary/80"
            >
              {op.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 写入 physical-exam 插件定义**

```typescript
// frontend/src/plugins/physical-exam/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { ExamPanel } from "./ExamPanel";

export const physicalExamPlugin: TrainingPlugin = {
  id: "physical-exam",
  name: "护理查体操作",
  featureFlag: "physical_exam",
  meta: {
    description: "查体操作面板：血压/体温/血氧/心率等",
    icon: "stethoscope",
    tags: ["ui", "panel", "exam"],
  },
  slots: {
    panel: ExamPanel,
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/plugins/physical-exam/
git commit -m "feat: add physical exam frontend plugin from OperationPanel"
```

---

### Task 15: Nursing Record 插件

**Files:**
- Move: `frontend/src/components/nursing-record/` → `frontend/src/plugins/nursing-record/`
- Create: `frontend/src/plugins/nursing-record/index.ts`

- [ ] **Step 1: 移动 nursing-record 目录到 plugins 下**

```bash
New-Item -ItemType Directory -Path "frontend\src\plugins\nursing-record" -Force; if ($?) { Copy-Item -Recurse -LiteralPath "frontend\src\components\nursing-record\*" -Destination "frontend\src\plugins\nursing-record\" }
```

- [ ] **Step 2: 更新 nursing-record 内部 import 路径（从 @/components/nursing-record 改为 @/plugins/nursing-record）**

```bash
# 通过 grep 找出所有引用旧路径的文件并更新
```

需要手动检查 `config.ts`, `index.ts`, `NursingRecordPanel.tsx`, `items/*.tsx` 中的 import 路径，将 `@/components/nursing-record` 替换为 `@/plugins/nursing-record`。

- [ ] **Step 3: 写入 nursing-record 插件定义**

```typescript
// frontend/src/plugins/nursing-record/index.ts (在现有 index.ts 基础上新增 export)
import type { TrainingPlugin } from "@/engine/types";
import { NursingRecordPanel } from "./NursingRecordPanel";

export const nursingRecordPlugin: TrainingPlugin = {
  id: "nursing-record",
  name: "护理记录",
  meta: {
    description: "可配置的护理记录面板，支持 input/textarea/select/radio/checkbox_group/vital_sign 六种字段",
    icon: "clipboard-edit",
    tags: ["ui", "panel", "record"],
  },
  slots: {
    panel: NursingRecordPanel,
  },
};
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/plugins/nursing-record/
git add -u frontend/src/components/nursing-record/
git commit -m "feat: move nursing-record to plugins directory, add plugin definition"
```

---

### Task 16: Questionnaire 插件

**Files:**
- Create: `frontend/src/plugins/questionnaire/index.ts`
- Create: `frontend/src/plugins/questionnaire/QuestionnaireOverlay.tsx`

- [ ] **Step 1: 写入 QuestionnaireOverlay（复用现有 QuestionnaireModal 逻辑）**

```typescript
// frontend/src/plugins/questionnaire/QuestionnaireOverlay.tsx
import { useEffect, useState } from "react";
import type { SlotProps } from "@/engine/types";

interface Questionnaire {
  id: number;
  title: string;
  questions: Array<{ id: number; text: string; type: string; options?: string[] }>;
}

export function QuestionnaireOverlay({ ctx }: SlotProps) {
  const [phase, setPhase] = useState<"pre" | "post" | null>(null);
  const [questionnaire, setQuestionnaire] = useState<Questionnaire | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    const unsubEnd = ctx.bus.on("training:ended", () => setPhase("post"));
    // 初始化时检查前问卷
    checkPreQuestionnaire();
    return unsubEnd;
  }, []);

  async function checkPreQuestionnaire() {
    try {
      const { api } = await import("@/api/axios-instance");
      const res = await api.get(`/questionnaires/training/${ctx.recordId}/pre`);
      if (res.data && (res.data as Questionnaire).questions?.length) {
        setQuestionnaire(res.data as Questionnaire);
        setPhase("pre");
      }
    } catch { /* 无前问卷 */ }
  }

  useEffect(() => {
    if (phase === "post") {
      (async () => {
        try {
          const { api } = await import("@/api/axios-instance");
          const res = await api.get(`/questionnaires/training/${ctx.recordId}/post`);
          if (res.data && (res.data as Questionnaire).questions?.length) {
            setQuestionnaire(res.data as Questionnaire);
            setAnswers({});
          }
        } catch { /* 无后问卷 */ }
      })();
    }
  }, [phase]);

  if (!phase || !questionnaire) return null;

  const submit = async () => {
    try {
      const { api } = await import("@/api/axios-instance");
      await api.post(`/questionnaires/${questionnaire.id}/submit`, {
        record_id: Number(ctx.recordId),
        answers,
      });
      setPhase(null);
      setQuestionnaire(null);
    } catch (e: any) {
      console.error("问卷提交失败", e);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">{questionnaire.title}</h2>
        <div className="max-h-[60vh] space-y-4 overflow-auto">
          {questionnaire.questions.map((q) => (
            <div key={q.id}>
              <label className="mb-1 block text-sm font-medium">{q.text}</label>
              {q.type === "text" ? (
                <input
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="w-full rounded border px-2 py-1 text-sm"
                />
              ) : (
                <select
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="w-full rounded border px-2 py-1 text-sm"
                >
                  <option value="">请选择</option>
                  {q.options?.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          {phase === "pre" && (
            <button onClick={() => setPhase(null)} className="rounded px-3 py-1 text-sm text-muted-foreground">
              跳过
            </button>
          )}
          <button onClick={submit} className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground">
            提交
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写入 questionnaire 插件定义**

```typescript
// frontend/src/plugins/questionnaire/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { QuestionnaireOverlay } from "./QuestionnaireOverlay";

export const questionnairePlugin: TrainingPlugin = {
  id: "questionnaire",
  name: "训练问卷",
  meta: {
    description: "训练前/后问卷调查",
    icon: "clipboard-check",
    tags: ["ui", "overlay", "assessment"],
  },
  slots: {
    overlay: QuestionnaireOverlay,
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/plugins/questionnaire/
git commit -m "feat: add questionnaire plugin"
```

---

### Task 17: Patient Initiative 插件（纯逻辑）

**Files:**
- Create: `frontend/src/plugins/patient-initiative/index.ts`

- [ ] **Step 1: 写入纯逻辑插件**

```typescript
// frontend/src/plugins/patient-initiative/index.ts
import { api } from "@/api/axios-instance";
import type { TrainingPlugin } from "@/engine/types";

export const patientInitiativePlugin: TrainingPlugin = {
  id: "patient-initiative",
  name: "患者主动追问",
  featureFlag: "patient_initiative",
  requires: [],   // 后端 emotion 插件作为依赖在 scenario 配置中保证
  meta: {
    description: "监听患者主动追问状态，触发 initiative 轮询并展示",
    icon: "message-circle",
    tags: ["logic", "patient"],
  },
  pollConfig: {
    endpoint: `/training/{recordId}/state`,
    interval: 5000,
  },
  hooks: {
    onInit(ctx) {
      const recordId = Number(ctx.recordId);
      const timer = setInterval(async () => {
        try {
          const res = await api.get(`/training/${recordId}/state`);
          const data = res.data as any;
          if (data.initiative && data.initiative.should_trigger) {
            await api.post(`/training/${recordId}/initiative/trigger`);
            ctx.bus.emit("initiative:triggered");
          }
          ctx.bus.emit("initiative:state", data.initiative);
        } catch { /* 忽略轮询错误 */ }
      }, 5000);

      return () => clearInterval(timer);
    },
    onDestroy() {
      // cleanup 由 onInit 返回的函数处理
    },
  },
};
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/plugins/patient-initiative/index.ts
git commit -m "feat: add patient initiative polling plugin"
```

---

### Task 18: Scoring Display 插件

**Files:**
- Create: `frontend/src/plugins/scoring-display/index.ts`
- Create: `frontend/src/plugins/scoring-display/ScoringOverlay.tsx`
- Create: `frontend/src/plugins/scoring-display/ScoreCard.tsx`

- [ ] **Step 1: 写入 ScoringOverlay（进度条覆盖层）**

```typescript
// frontend/src/plugins/scoring-display/ScoringOverlay.tsx
import { useEffect, useState } from "react";
import type { SlotProps } from "@/engine/types";

export function ScoringOverlay({ ctx }: SlotProps) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const unsub = ctx.bus.on("training:ended", () => {
      setVisible(true);
      setProgress(10);
    });
    return unsub;
  }, [ctx.bus]);

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => {
      setProgress((p) => {
        if (p >= 95) { clearInterval(id); return 95; }
        return p + 1;
      });
    }, 200);
    return () => clearInterval(id);
  }, [visible]);

  useEffect(() => {
    const unsub = ctx.bus.on("score:ready", () => {
      setProgress(100);
      setTimeout(() => setVisible(false), 500);
    });
    return unsub;
  }, [ctx.bus]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-background/90">
      <p className="mb-4 text-lg font-medium">正在评估训练表现...</p>
      <div className="h-2 w-64 rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all duration-200" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{progress}%</p>
    </div>
  );
}
```

- [ ] **Step 2: 写入 ScoreCard**

```typescript
// frontend/src/plugins/scoring-display/ScoreCard.tsx
import { cn } from "@/lib/utils";
import type { SlotProps } from "@/engine/types";
import type { ScoreData } from "@/engine/types";

interface ScoreCardInnerProps extends SlotProps {
  score: ScoreData;
  onClose: () => void;
}

export function ScoreCardInner({ score, onClose }: ScoreCardInnerProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md max-h-[80vh] overflow-auto rounded-lg bg-background p-6 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">训练评分报告</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {score.total_score !== undefined && (
          <div className="mb-4 text-center">
            <span className="text-4xl font-bold text-primary">{score.total_score}</span>
            <span className="text-muted-foreground"> 分</span>
          </div>
        )}

        {score.detail_scores && (
          <div className="mb-4 space-y-1">
            <h3 className="text-sm font-medium text-muted-foreground">详细评分</h3>
            {Object.entries(score.detail_scores).map(([key, val]) => (
              <div key={key} className="flex justify-between text-sm">
                <span>{key}</span>
                <span className="tabular-nums">{val}</span>
              </div>
            ))}
          </div>
        )}

        {score.strengths?.length ? (
          <div className="mb-3">
            <h3 className="text-sm font-medium text-green-600">优势</h3>
            <ul className="list-inside list-disc text-sm">
              {score.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        ) : null}

        {score.weaknesses?.length ? (
          <div className="mb-3">
            <h3 className="text-sm font-medium text-red-600">改进建议</h3>
            <ul className="list-inside list-disc text-sm">
              {score.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        ) : null}

        {score.summary && (
          <div className="mb-4 rounded bg-muted p-3 text-sm">
            <h3 className="mb-1 font-medium">总结</h3>
            <p>{score.summary}</p>
          </div>
        )}

        <button onClick={onClose} className="w-full rounded bg-primary py-2 text-sm text-primary-foreground">
          返回
        </button>
      </div>
    </div>
  );
}

// Wrapper that listens for score:ready and shows the card
import { useState, useEffect } from "react";

export function ScoreCard({ ctx }: SlotProps) {
  const [score, setScore] = useState<ScoreData | null>(null);

  useEffect(() => {
    const unsub = ctx.bus.on("score:ready", (data: ScoreData) => {
      setScore(data);
    });
    return unsub;
  }, [ctx.bus]);

  if (!score) return null;

  return <ScoreCardInner ctx={ctx} score={score} onClose={() => setScore(null)} />;
}
```

- [ ] **Step 3: 写入 scoring-display 插件定义**

```typescript
// frontend/src/plugins/scoring-display/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { ScoringOverlay } from "./ScoringOverlay";
import { ScoreCard } from "./ScoreCard";

export const scoringDisplayPlugin: TrainingPlugin = {
  id: "scoring-display",
  name: "评分展示",
  meta: {
    description: "训练结束后的进度条覆盖 + 评分报告弹窗",
    icon: "trophy",
    tags: ["ui", "overlay", "scoring"],
  },
  slots: {
    overlay: (props) => (
      <>
        <ScoringOverlay {...props} />
        <ScoreCard {...props} />
      </>
    ),
  },
  hooks: {
    onScoreReady(ctx, score) {
      // ScoreManager 会 emit score:ready，ScoreCard 监听即可
    },
  },
};
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/plugins/scoring-display/
git commit -m "feat: add scoring display plugin"
```

---

### Task 19: DevTools 插件

**Files:**
- Create: `frontend/src/plugins/dev-tools/index.ts`
- Create: `frontend/src/plugins/dev-tools/PluginStatusPanel.tsx`
- Create: `frontend/src/plugins/dev-tools/EventBusMonitor.tsx`
- Create: `frontend/src/plugins/dev-tools/FeatureFlagPanel.tsx`

- [ ] **Step 1: 写入 DevTools 主组件和插件定义**

```typescript
// frontend/src/plugins/dev-tools/index.ts
import type { TrainingPlugin } from "@/engine/types";
import { DevToolsPanel } from "./DevToolsPanel";

export const devToolsPlugin: TrainingPlugin = {
  id: "dev-tools",
  name: "开发者工具",
  meta: {
    description: "实时插件状态监控、事件总线监控、Feature Flag 热切换",
    icon: "wrench",
    tags: ["dev", "debug", "panel"],
  },
  slots: {
    panel: DevToolsPanel,
  },
};
```

```typescript
// frontend/src/plugins/dev-tools/DevToolsPanel.tsx
import { useEffect, useState } from "react";
import type { SlotProps } from "@/engine/types";
import { pluginRegistry } from "@/engine/PluginRegistry";

interface BusLog {
  time: string;
  event: string;
  args: string;
}

export function DevToolsPanel({ ctx, features }: SlotProps) {
  const [activeTab, setActiveTab] = useState<"plugins" | "events" | "flags">("plugins");
  const [busLogs, setBusLogs] = useState<BusLog[]>([]);
  const [refresh, setRefresh] = useState(0);

  // 事件监听
  useEffect(() => {
    const allEvents = ctx.bus.listEvents();
    const unsubs = allEvents.map((evt) =>
      ctx.bus.on(evt, (...args: any[]) => {
        setBusLogs((prev) => {
          const log: BusLog = {
            time: new Date().toLocaleTimeString(),
            event: evt,
            args: JSON.stringify(args).slice(0, 100),
          };
          return [...prev.slice(-99), log];
        });
      })
    );
    return () => unsubs.forEach((fn) => fn());
  }, [ctx.bus]);

  const plugins = pluginRegistry.getAll();

  return (
    <div className="flex h-full flex-col rounded-lg border bg-card text-xs">
      <div className="flex border-b">
        {(["plugins", "events", "flags"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-3 py-1.5 ${activeTab === tab ? "border-b-2 border-primary font-medium" : "text-muted-foreground"}`}
          >
            {tab === "plugins" ? "插件" : tab === "events" ? "事件" : "开关"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-2">
        {activeTab === "plugins" && (
          <div className="space-y-1">
            {plugins.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                <span className="font-medium">{p.name}</span>
                <span className={`size-1.5 rounded-full ${
                  p.featureFlag && !features[p.featureFlag]
                    ? "bg-gray-400"
                    : "bg-green-500"
                }`} />
              </div>
            ))}
          </div>
        )}

        {activeTab === "events" && (
          <div className="space-y-0.5 font-mono">
            {busLogs.map((log, i) => (
              <div key={i} className="flex gap-2 opacity-70">
                <span className="text-muted-foreground">{log.time}</span>
                <span className="text-blue-500">{log.event}</span>
                <span className="truncate text-muted-foreground">{log.args}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === "flags" && (
          <div className="space-y-2">
            {Object.entries(features).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between">
                <span>{key}</span>
                <button
                  onClick={() => {
                    // 热切换 — 重新设置 feature flags
                    const newFlags = { ...features, [key]: !val };
                    pluginRegistry.setFeatureFlags(newFlags);
                    setRefresh((r) => r + 1);
                  }}
                  className={`rounded px-2 py-0.5 ${val ? "bg-green-500/20 text-green-600" : "bg-gray-200 text-gray-500"}`}
                >
                  {val ? "ON" : "OFF"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/plugins/dev-tools/
git commit -m "feat: add DevTools plugin for real-time debug monitoring"
```

---

### Task 20: ChatTraining.tsx 重构

**Files:**
- Modify: `frontend/src/pages/ChatTraining.tsx`

- [ ] **Step 1: 替换 ChatTraining.tsx 为面板组装**

```typescript
// frontend/src/pages/ChatTraining.tsx
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { timerPlugin } from "@/plugins/timer";
import { voicePlugin } from "@/plugins/voice";
import { inquiryPlugin } from "@/plugins/inquiry";
import { physicalExamPlugin } from "@/plugins/physical-exam";
import { nursingRecordPlugin } from "@/plugins/nursing-record";
import { questionnairePlugin } from "@/plugins/questionnaire";
import { patientInitiativePlugin } from "@/plugins/patient-initiative";
import { scoringDisplayPlugin } from "@/plugins/scoring-display";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();

  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;

  return (
    <TrainingEngine
      recordId={recordId}
      scenarioConfig={{
        features: {
          physical_exam: true,
          patient_initiative: true,
          emotion: true,
        },
      }}
      plugins={[
        timerPlugin,
        voicePlugin,
        inquiryPlugin,
        physicalExamPlugin,
        nursingRecordPlugin,
        questionnairePlugin,
        patientInitiativePlugin,
        scoringDisplayPlugin,
      ]}
    />
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/pages/ChatTraining.tsx
git commit -m "refactor: replace monolithic ChatTraining with TrainingEngine assembly"
```

---

### Task 21: AdminDebugPage.tsx 重构

**Files:**
- Modify: `frontend/src/pages/AdminDebugPage.tsx`

- [ ] **Step 1: 替换为 TrainingEngine + devTools**

```typescript
// frontend/src/pages/AdminDebugPage.tsx
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { timerPlugin } from "@/plugins/timer";
import { inquiryPlugin } from "@/plugins/inquiry";
import { scoringDisplayPlugin } from "@/plugins/scoring-display";
import { devToolsPlugin } from "@/plugins/dev-tools";

export default function AdminDebugPage() {
  const { recordId } = useParams<{ recordId: string }>();

  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;

  return (
    <TrainingEngine
      recordId={recordId}
      scenarioConfig={{
        features: {
          physical_exam: true,
          patient_initiative: false,
          emotion: false,
        },
      }}
      plugins={[
        timerPlugin,
        inquiryPlugin,
        scoringDisplayPlugin,
        devToolsPlugin,
      ]}
    />
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/pages/AdminDebugPage.tsx
git commit -m "refactor: replace standalone AdminDebugPage with TrainingEngine + devTools"
```

---

### Task 22: 后端 PipelinePlugin 接口

**Files:**
- Create: `backend/contexts/training/pipeline/plugin.py`

- [ ] **Step 1: 写入 PipelinePlugin 定义**

```python
# backend/contexts/training/pipeline/plugin.py
from dataclasses import dataclass, field
from typing import Callable, Awaitable, Any

# PipelineMiddleware = async callable(ctx: PipelineContext) -> PipelineContext
PipelineMiddleware = Callable[[Any], Awaitable[Any]]


@dataclass
class PipelinePluginMeta:
    description: str = ""
    author: str = ""
    version: str = "1.0.0"
    tags: list[str] = field(default_factory=list)


@dataclass
class PipelinePlugin:
    id: str
    name: str
    feature_flag: str | None = None
    requires: list[str] = field(default_factory=list)
    meta: PipelinePluginMeta = field(default_factory=PipelinePluginMeta)

    middleware: list[PipelineMiddleware] = field(default_factory=list)
    on_record_create: Callable | None = None
    on_phase_change: Callable | None = None
    on_end: Callable | None = None
    on_score: Callable | None = None


# ── 插件注册表 ──
_registry: dict[str, PipelinePlugin] = {}


def register_plugin(plugin: PipelinePlugin) -> None:
    _registry[plugin.id] = plugin


def get_plugin(plugin_id: str) -> PipelinePlugin | None:
    return _registry.get(plugin_id)


def get_all_plugins() -> list[PipelinePlugin]:
    return list(_registry.values())


def get_active_plugins(feature_flags: dict[str, bool]) -> list[PipelinePlugin]:
    active = []
    for plugin in _registry.values():
        if plugin.feature_flag and not feature_flags.get(plugin.feature_flag, False):
            continue
        if plugin.requires:
            if not all(_registry.get(dep_id) for dep_id in plugin.requires):
                continue
        active.append(plugin)
    return active
```

- [ ] **Step 2: 提交**

```bash
git add backend/contexts/training/pipeline/plugin.py
git commit -m "feat: add PipelinePlugin interface and registry for backend plugins"
```

---

### Task 23: 后端三个流水线插件定义与注册

**Files:**
- Create: `backend/contexts/training/pipeline/middleware/emotion_tracker.py`
- Create: `backend/contexts/training/pipeline/middleware/initiative_timer_reset.py`
- Create: `backend/contexts/training/plugins.py`

- [ ] **Step 1: 写入 emotion_tracker 中间件**

```python
# backend/contexts/training/pipeline/middleware/emotion_tracker.py
from backend.contexts.patient.emotion import get_emotion, classify_intent


async def emotion_tracker(ctx):
    """情绪跟踪中间件：分类意图 → 更新情绪状态 → 写入 ctx.state"""
    student_text = ctx.student_display or ctx.student_input
    if not student_text:
        return ctx

    emotion = get_emotion(ctx.record.id)
    intent = classify_intent(student_text)
    emotion.update(intent)

    ctx.state["emotion_note"] = emotion.note
    return ctx
```

- [ ] **Step 2: 写入 initiative_timer_reset 中间件**

```python
# backend/contexts/training/pipeline/middleware/initiative_timer_reset.py
from backend.contexts.patient.initiative import update_initiative_timer


async def initiative_timer_reset(ctx):
    """主动回复计时器重置中间件：每次患者回复后重置计时"""
    update_initiative_timer(ctx.record.id)
    return ctx
```

- [ ] **Step 3: 写入插件注册文件**

```python
# backend/contexts/training/plugins.py
from backend.contexts.training.pipeline.plugin import PipelinePlugin, PipelinePluginMeta, register_plugin
from backend.contexts.training.pipeline.middleware.emotion_tracker import emotion_tracker
from backend.contexts.training.pipeline.middleware.initiative_timer_reset import initiative_timer_reset
from backend.contexts.training.pipeline.middleware.operation_detector import operation_detector
from backend.contexts.training.pipeline.middleware.operation_executor import operation_executor
from backend.contexts.patient.initiative import init_initiative_timer, clear_initiative_timer
from backend.contexts.patient.emotion import purge_emotion_cache


emotion_plugin = PipelinePlugin(
    id="emotion",
    name="患者情绪状态机",
    feature_flag="emotion",
    requires=[],
    meta=PipelinePluginMeta(
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化",
        tags=["patient", "emotion"],
    ),
    middleware=[emotion_tracker],
    on_end=lambda ctx: purge_emotion_cache(ctx.record.id),
)

initiative_plugin = PipelinePlugin(
    id="initiative",
    name="患者主动回复",
    feature_flag="patient_initiative",
    requires=["emotion"],
    meta=PipelinePluginMeta(
        description="患者根据性格/情绪/等待时长主动发言",
        tags=["patient", "initiative"],
    ),
    middleware=[initiative_timer_reset],
    on_record_create=lambda ctx: init_initiative_timer(ctx.record.id),
    on_end=lambda ctx: clear_initiative_timer(ctx.record.id),
)

physical_exam_plugin = PipelinePlugin(
    id="physical-exam",
    name="护理查体锚点交互",
    feature_flag="physical_exam",
    requires=[],
    meta=PipelinePluginMeta(
        description="操作检测 + 执行 + 锚点数据注入",
        tags=["exam", "operation"],
    ),
    middleware=[operation_detector, operation_executor],
)


def register_all_plugins():
    for p in [emotion_plugin, initiative_plugin, physical_exam_plugin]:
        register_plugin(p)
```

- [ ] **Step 4: 提交**

```bash
git add backend/contexts/training/pipeline/middleware/emotion_tracker.py
git add backend/contexts/training/pipeline/middleware/initiative_timer_reset.py
git add backend/contexts/training/plugins.py
git commit -m "feat: define and register 3 backend pipeline plugins"
```

---

### Task 24: 后端 pipeline 动态组装

**Files:**
- Modify: `backend/contexts/training/pipeline/registry.py`

- [ ] **Step 1: 改造 registry.py 添加 build_pipeline()**

```python
# backend/contexts/training/pipeline/registry.py
# 保留现有 import 和 _DEFAULT_CHAIN，新增以下函数：

from backend.contexts.training.pipeline.plugin import get_active_plugins


def build_pipeline(feature_flags: dict[str, bool]) -> list:
    """根据 feature_flags 动态组装流水线中间件链"""
    from backend.contexts.training.pipeline.middleware.phase_guard import phase_guard
    from backend.contexts.training.pipeline.middleware.phase_transition import phase_transition
    from backend.contexts.training.pipeline.middleware.prompt_builder import prompt_builder
    from backend.contexts.training.pipeline.middleware.llm_caller import _llm_caller
    from backend.contexts.training.pipeline.middleware.persister import persister

    core = [phase_guard, phase_transition, prompt_builder, _llm_caller, persister]

    plugins = get_active_plugins(feature_flags)
    plugin_middlewares = []
    for plugin in plugins:
        plugin_middlewares.extend(plugin.middleware)

    # guard → [plugin_middlewares] → transition → prompt_builder → llm → persister
    return [phase_guard] + plugin_middlewares + [phase_transition, prompt_builder, _llm_caller, persister]


def get_pipeline(phase_id: str, feature_flags: dict[str, bool] | None = None) -> list:
    """获取流水线，优先使用动态组装"""
    flags = feature_flags or {}
    return build_pipeline(flags)
```

- [ ] **Step 2: 在 runner.py 中调用 build_pipeline 时传入 feature_flags**

在 `backend/contexts/training/pipeline/runner.py` 中，`run_pipeline()` 和 `stream_pipeline()` 函数调用 `get_pipeline()` 时，需传入从 `ctx.record.config_snapshot` 解析的 feature_flags。

- [ ] **Step 3: 改造 prompt_builder.py 的 author_note 收集**

```python
# 在 build_messages 函数中，替换现有的 author_note 构建逻辑：

def _collect_author_note(ctx) -> str:
    notes = []
    if ctx.state.get("emotion_note"):
        notes.append(ctx.state["emotion_note"])
    if ctx.state.get("operation_note"):
        notes.append(ctx.state["operation_note"])
    return "【" + " | ".join(notes) + "】" if notes else ""

# author_note = _collect_author_note(ctx)
# 替换原有的 emotion.note 直接赋值
```

- [ ] **Step 4: 新增 feature_flags.py 中的 emotion flag**

```python
# backend/core/feature_flags.py
# 在 FEATURE_FLAGS dict 中新增：
"emotion": FeatureFlag(
    key="emotion",
    label="患者情绪状态机",
    default=False,
    description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），根据学生用语动态变化，注入 author_note 影响患者表现",
),
```

- [ ] **Step 5: 提交**

```bash
git add backend/contexts/training/pipeline/registry.py
git add backend/contexts/training/pipeline/runner.py
git add backend/contexts/training/pipeline/middleware/prompt_builder.py
git add backend/core/feature_flags.py
git commit -m "feat: dynamic pipeline assembly from registered plugins"
```

---

### Task 25: 后端场景 API

**Files:**
- Create: `backend/routers/admin/scenarios.py`
- Create: `backend/routers/admin/plugins.py`
- Create: `backend/data/scenarios/standard-assessment.json`
- Create: `backend/data/scenarios/full-simulation.json`

- [ ] **Step 1: 写入场景管理 API**

```python
# backend/routers/admin/scenarios.py
from fastapi import APIRouter, HTTPException
from backend.models.scenario_config import ScenarioConfig

router = APIRouter(prefix="/api/admin/scenarios", tags=["admin-scenarios"])

_scenarios_store: dict[str, dict] = {}

@router.get("")
async def list_scenarios():
    return list(_scenarios_store.values())

@router.get("/{scenario_id}")
async def get_scenario(scenario_id: str):
    s = _scenarios_store.get(scenario_id)
    if not s:
        raise HTTPException(404, "场景不存在")
    return s

@router.post("")
async def create_scenario(data: dict):
    sid = data.get("id")
    if not sid:
        raise HTTPException(400, "缺少 id")
    _scenarios_store[sid] = data
    return data

@router.put("/{scenario_id}")
async def update_scenario(scenario_id: str, data: dict):
    _scenarios_store[scenario_id] = data
    return data

@router.delete("/{scenario_id}")
async def delete_scenario(scenario_id: str):
    _scenarios_store.pop(scenario_id, None)
    return {"ok": True}
```

- [ ] **Step 2: 写入插件列表 API**

```python
# backend/routers/admin/plugins.py
from fastapi import APIRouter
from backend.contexts.training.pipeline.plugin import get_all_plugins

router = APIRouter(prefix="/api/admin/plugins", tags=["admin-plugins"])

@router.get("")
async def list_plugins():
    return [
        {
            "id": p.id,
            "name": p.name,
            "feature_flag": p.feature_flag,
            "requires": p.requires,
            "middleware_count": len(p.middleware),
            "has_hooks": {
                "on_record_create": p.on_record_create is not None,
                "on_phase_change": p.on_phase_change is not None,
                "on_end": p.on_end is not None,
                "on_score": p.on_score is not None,
            },
            "meta": {
                "description": p.meta.description,
                "tags": p.meta.tags,
            },
        }
        for p in get_all_plugins()
    ]
```

- [ ] **Step 3: 注册路由**

在 `backend/main.py` 或路由注册处引入：
```python
from backend.routers.admin.scenarios import router as admin_scenarios_router
from backend.routers.admin.plugins import router as admin_plugins_router
app.include_router(admin_scenarios_router)
app.include_router(admin_plugins_router)
```

- [ ] **Step 3b: 写入训练端场景查询 API**

```python
# backend/routers/training/scenarios.py
from fastapi import APIRouter, Depends
from backend.routers.deps import get_db
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/training/scenarios", tags=["training-scenarios"])

@router.get("")
async def list_training_scenarios():
    """返回所有系统内置场景配置"""
    from backend.data import scenarios
    return scenarios.list_all()

@router.get("/{scenario_id}")
async def get_training_scenario(scenario_id: str):
    from backend.data import scenarios
    return scenarios.get(scenario_id)
```

在 `backend/routers/training/__init__.py` 中引入此路由。

- [ ] **Step 4: 提交**

```bash
git add backend/routers/admin/scenarios.py
git add backend/routers/admin/plugins.py
git add backend/data/scenarios/
git commit -m "feat: add admin APIs for scenario and plugin management"
```

---

### Task 25b: 场景配置 API 前端接入

**Files:**
- Create: `frontend/src/api/scenarios.ts`
- Create: `frontend/src/hooks/useScenario.ts`

- [ ] **Step 1: 写入场景 API 客户端**

```typescript
// frontend/src/api/scenarios.ts
import { api } from "@/api/axios-instance";

export interface ScenarioConfigResponse {
  id: string;
  name: string;
  phases: Array<{ id: string; order: number }>;
  features: Record<string, boolean>;
  scoring: { rubric_id: string; auto_delay_seconds: number };
  layout?: any;
  frontend_plugins: string[];
  backend_plugins: string[];
  default_duration: number;
}

export function fetchScenarios(): Promise<ScenarioConfigResponse[]> {
  return api.get("/training/scenarios").then((r) => r.data as ScenarioConfigResponse[]);
}

export function fetchScenario(id: string): Promise<ScenarioConfigResponse> {
  return api.get(`/training/scenarios/${id}`).then((r) => r.data as ScenarioConfigResponse);
}

export function fetchRecordScenario(recordId: string): Promise<ScenarioConfigResponse> {
  return api.get(`/training/records/${recordId}/scenario`).then((r) => r.data as ScenarioConfigResponse);
}
```

- [ ] **Step 2: 写入 useScenario hook**

```typescript
// frontend/src/hooks/useScenario.ts
import { useEffect, useState } from "react";
import { fetchRecordScenario, type ScenarioConfigResponse } from "@/api/scenarios";

export function useScenario(recordId: string | undefined) {
  const [scenario, setScenario] = useState<ScenarioConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!recordId) return;
    setLoading(true);
    fetchRecordScenario(recordId)
      .then(setScenario)
      .catch(() => setScenario(null))
      .finally(() => setLoading(false));
  }, [recordId]);

  return { scenario, loading };
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/scenarios.ts
git add frontend/src/hooks/useScenario.ts
git commit -m "feat: add scenario config API client and useScenario hook"
```

---

### Task 26: 管理界面前端页面

**Files:**
- Create: `frontend/src/pages/admin/PluginDashboard.tsx`
- Create: `frontend/src/pages/admin/ScenarioComposer.tsx`
- Modify: `frontend/src/App.tsx` (添加路由)

- [ ] **Step 1: 写入 PluginDashboard**

```typescript
// frontend/src/pages/admin/PluginDashboard.tsx
import { useEffect, useState } from "react";
import { api } from "@/api/axios-instance";

interface BackendPlugin {
  id: string;
  name: string;
  feature_flag: string | null;
  requires: string[];
  middleware_count: number;
  has_hooks: Record<string, boolean>;
  meta: { description: string; tags: string[] };
}

export default function PluginDashboard() {
  const [plugins, setPlugins] = useState<BackendPlugin[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/plugins").then((res) => {
      setPlugins(res.data as BackendPlugin[]);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6">加载中...</div>;

  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">插件注册表</h1>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {plugins.map((p) => (
          <div key={p.id} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{p.name}</h3>
              <span className={`rounded px-2 py-0.5 text-xs ${
                p.feature_flag ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-600"
              }`}>
                {p.feature_flag ? `flag: ${p.feature_flag}` : "始终启用"}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{p.meta.description}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.meta.tags.map((t) => (
                <span key={t} className="rounded bg-muted px-1.5 py-0.5 text-xs">{t}</span>
              ))}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              中间件: {p.middleware_count} 个
              {p.requires.length > 0 && ` | 依赖: ${p.requires.join(", ")}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 写入 ScenarioComposer（简化版占位）**

```typescript
// frontend/src/pages/admin/ScenarioComposer.tsx
export default function ScenarioComposer() {
  return (
    <div className="p-6">
      <h1 className="mb-6 text-2xl font-bold">场景编辑器</h1>
      <p className="text-muted-foreground">场景编辑器将在后续迭代中实现完整功能。</p>
    </div>
  );
}
```

- [ ] **Step 3: 在 App.tsx 添加路由**

```typescript
// frontend/src/App.tsx —— 在现有 lazy imports 后添加：
const PluginDashboard = lazy(() => import("@/pages/admin/PluginDashboard"));
const ScenarioComposer = lazy(() => import("@/pages/admin/ScenarioComposer"));

// 在 Routes 内添加：
<Route path="admin/plugins" element={<ProtectedRoute permission="score_review"><Layout><PluginDashboard /></Layout></ProtectedRoute>} />
<Route path="admin/scenarios" element={<ProtectedRoute permission="score_review"><Layout><ScenarioComposer /></Layout></ProtectedRoute>} />
```

- [ ] **Step 4: 提交**

```bash
git add frontend/src/pages/admin/PluginDashboard.tsx
git add frontend/src/pages/admin/ScenarioComposer.tsx
git add frontend/src/App.tsx
git commit -m "feat: add plugin dashboard and scenario composer admin pages"
```

---

### Task 27: 清理与验证

- [ ] **Step 1: TypeScript 编译验证**

```bash
cd frontend; npx tsc --noEmit 2>&1 | Select-Object -First 50
```

- [ ] **Step 2: 前端构建验证**

```bash
cd frontend; npm run build
```

- [ ] **Step 3: 后端 lint 验证**

```bash
ruff check backend/
```

- [ ] **Step 4: 后端测试**

```bash
pytest backend/tests/test_training.py -v
```

- [ ] **Step 5: 清理旧文件**

检查并移除 `components/training/` 下不再使用的文件（TrainingHeader, ChatInput, OperationPanel, PatientPortrait, ScoreCard, ScoringOverlay 的旧版本）。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore: cleanup, verification, and final integration"
```

---

## 验证清单

| # | 验证项 | 预期结果 |
|---|--------|---------|
| 1 | `tsc --noEmit` | 无错误 |
| 2 | `npm run build` | 构建成功 |
| 3 | ChatTraining 页面加载 | 8 个插件正常渲染，训练可进行 |
| 4 | AdminDebugPage 页面加载 | 4 个插件正常渲染，DevTools 面板可见 |
| 5 | 关闭 physical_exam flag | ExamPanel 不渲染，后端 operation_detector 不执行 |
| 6 | 关闭 emotion flag | author_note 为空字符串，提示词干净 |
| 7 | 关闭 patient_initiative flag | 无轮询，backend timer 不重置 |
| 8 | DevTools 面板 | 可查看插件状态、事件流、切换 feature flag |
| 9 | 移动端视口 | sidebar→sheet, panel→drawer 布局自动切换 |
| 10 | `ruff check` 通过 + `pytest` 通过 | 后端无回归 |
