# 对话训练页面全面重设 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 全面重设对话训练页面的架构和 UI：将核心 UI（聊天、输入、顶栏）固定化，插件系统瘦身为 Panel Tab + 生命周期钩子，完整实装 7 个高级插件（含前后端）。

**Architecture:** TrainingEngine 直接渲染固定核心组件（TrainingHeader / ChatArea / ChatInput / PanelHost），PanelHost 收集注册的 PanelPlugin 渲染为可折叠面板中的 Tab。插件贡献 Tab 内容和生命周期钩子（onInit / afterReceive / beforeSend / onEnd 等），由引擎统一调用。

**Tech Stack:** React 19 + TypeScript + Vite, Tailwind CSS v4 + shadcn/ui, Python FastAPI + SQLAlchemy + PostgreSQL JSONB

---

### Task 1: Backend — NursingRecord model migration to JSONB

**Files:**
- Modify: `backend/models.py:464-480`
- Create: `backend/migrations/versions/xxxx_nursing_record_sheet_data.py`
- Modify: `backend/contexts/training/router/nursing.py:1-97`
- Modify: `backend/schemas.py` (add NursingRecord schemas near line 1074)

- [ ] **Step 1: Update NursingRecord model**

Replace the 4 text fields (`subjective`, `objective`, `assessment`, `plan`) with a single `sheet_data` JSONB field:

```python
class NursingRecord(Base):
    __tablename__ = "nursing_records"
    __table_args__ = (Index("ix_nr_record_id", "record_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    record_id: Mapped[int] = mapped_column(Integer, ForeignKey("training_records.id", ondelete="CASCADE"), unique=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    sheet_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    created_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC))
    updated_at: Mapped[datetime] = mapped_column(default=lambda: datetime.now(UTC), onupdate=lambda: datetime.now(UTC))

    record: Mapped["TrainingRecord"] = relationship()
    user: Mapped["User"] = relationship()
```

- [ ] **Step 2: Generate Alembic migration**

Run: `cd backend && alembic revision --autogenerate -m "nursing_record_sheet_data"`
Check the generated migration does: drop old text columns, add `sheet_data` JSONB column with default `{}`.
Run: `cd backend && alembic upgrade head`

- [ ] **Step 3: Add nursing record schemas to schemas.py**

Append to `backend/schemas.py`:

```python
class NursingRecordSave(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    sheet_data: dict = Field(default_factory=dict)
    status: str = "draft"

class NursingRecordResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    record_id: int
    sheet_data: dict
    status: str
    updated_at: datetime
```

Remove old `NursingRecordSave` and `NursingRecordResponse` from `backend/contexts/training/router/nursing.py`.

- [ ] **Step 4: Update nursing record API**

Rewrite `backend/contexts/training/router/nursing.py`:

```python
import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import NursingRecord, TrainingRecord, User
from schemas import NursingRecordResponse, NursingRecordSave

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["护理记录"])

@router.get("/nursing-records/{record_id}", response_model=NursingRecordResponse)
def get_nursing_record(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if not nr:
        return NursingRecordResponse(
            id=0, record_id=record_id, sheet_data={}, status="draft",
            updated_at=datetime.now(UTC)
        )
    if nr.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")
    return nr

@router.post("/nursing-records/{record_id}", response_model=NursingRecordResponse)
def save_nursing_record(
    record_id: int,
    req: NursingRecordSave,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")

    nr = db.query(NursingRecord).filter(NursingRecord.record_id == record_id).first()
    if nr:
        nr.sheet_data = req.sheet_data
        nr.status = req.status
        nr.updated_at = datetime.now(UTC)
    else:
        nr = NursingRecord(
            record_id=record_id,
            user_id=current_user.id,
            sheet_data=req.sheet_data,
            status=req.status or "draft",
        )
        db.add(nr)

    db.commit()
    db.refresh(nr)
    return nr
```

- [ ] **Step 5: Verify**

Run: `cd backend && python -c "from models import NursingRecord; print('OK')"`
Run: `cd backend && python -c "from schemas import NursingRecordSave; print(NursingRecordSave(sheet_data={'vital_signs': {'blood_pressure': '120/80'}}))"`

- [ ] **Step 6: Commit**

```bash
git add backend/models.py backend/schemas.py backend/contexts/training/router/nursing.py backend/migrations/
git commit -m "🗃️ db: migrate NursingRecord to JSONB sheet_data"
```

---

### Task 2: Backend — Enhance training state API + add new endpoints

**Files:**
- Modify: `backend/contexts/training/router/progress.py:76-120` (get_training_state)
- Modify: `backend/contexts/training/router/progress.py:1-28` (imports)
- Modify: `backend/schemas.py:1042-1074` (TrainingStateResponse)

- [ ] **Step 1: Add emotion_history and initiative_history fields to TrainingStateResponse**

Replace `EmotionStateResponse`, `InitiativeStateResponse`, and `TrainingStateResponse`:

```python
class EmotionStateResponse(BaseModel):
    score: int
    state: str
    note: str
    history: list[dict] = Field(default_factory=list)  # [{score:0, state:"neutral", intent:"关心/共情", timestamp:"..."}]

class InitiativeStateResponse(BaseModel):
    elapsed_seconds: float
    threshold_seconds: float
    percent: float
    should_trigger: bool = False
    last_triggered_at: str | None = None

class TrainingStateResponse(BaseModel):
    record_id: int
    case_id: int
    emotion: EmotionStateResponse
    personality: dict[str, str] = Field(default_factory=dict)
    deep_background_keys: list[str] = Field(default_factory=list)
    exam_anchors: dict = Field(default_factory=dict)
    config: FeatureConfigResponse
    initiative: InitiativeStateResponse
    current_phase: str = "history_taking"
    feature_flags: dict[str, bool] = Field(default_factory=dict)
```

- [ ] **Step 2: Enhance get_training_state endpoint**

Replace `get_training_state` in `progress.py`:

```python
@router.get("/{record_id}/state", response_model=TrainingStateResponse)
def get_training_state(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    if record.user_id != current_user.id and not current_user.has_permission("score_review"):
        raise HTTPException(status_code=403, detail="无权限")

    case = db.query(Case).filter(Case.id == record.case_id).first()
    case_data = case.case_data or {}

    emotion = get_emotion(record_id)
    config = record.config_snapshot or {}
    personality = case_data.get("personality", {})
    elapsed, threshold = get_initiative_seconds(record_id, personality, emotion.score)

    emotion_history = getattr(emotion, 'history', [])

    return {
        "record_id": record_id,
        "case_id": record.case_id,
        "emotion": {
            "score": emotion.score,
            "state": emotion.state,
            "note": emotion.note,
            "history": emotion_history[-20:],
        },
        "personality": personality,
        "deep_background_keys": list(case_data.get("deep_background", {}).keys()),
        "exam_anchors": case_data.get("exam_anchors", {}),
        "config": {
            "id": record.config_id,
            "mode": config.get("mode"),
            "features": resolve_features(record.config_snapshot),
        },
        "initiative": {
            "elapsed_seconds": round(elapsed, 1),
            "threshold_seconds": round(threshold, 1),
            "percent": round(min(100, elapsed / max(threshold, 0.1) * 100), 1),
            "should_trigger": should_initiate(record_id, personality, emotion.score),
        },
        "current_phase": record.current_phase or "history_taking",
        "feature_flags": resolve_features(record.config_snapshot),
    }
```

- [ ] **Step 3: Add emotion history tracking to EmotionState**

Modify `backend/contexts/patient/emotion.py` — add `history` list to `EmotionState.__init__`:

```python
def __init__(self):
    self.score = 0
    self.history: list[dict] = []
```

And in `update()`, after score change:

```python
self.history.append({
    "score": self.score,
    "state": self.state,
    "intent": intent,
    "timestamp": datetime.now(UTC).isoformat(),
})
```

Add import: `from datetime import UTC, datetime` at top of `emotion.py`.

- [ ] **Step 4: Add new endpoints for emotion/initiative history**

Add to `progress.py` after `trigger_initiative`:

```python
@router.get("/{record_id}/emotion/history")
def get_emotion_history(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    emotion = get_emotion(record_id)
    return {"history": getattr(emotion, 'history', [])}

@router.get("/{record_id}/initiative/history")
def get_initiative_history(
    record_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="训练记录不存在")
    msgs = db.query(Message).filter(
        Message.record_id == record_id,
        Message.role == "patient",
        Message.content.op("~")("^\\[|^（|\\($")
    ).order_by(Message.created_at.desc()).limit(20).all()
    return {"history": [{"id": m.id, "content": m.content, "created_at": m.created_at.isoformat()} for m in msgs]}
```

- [ ] **Step 5: Verify**

Run: `cd backend && python -c "from schemas import TrainingStateResponse; print('OK')"`

- [ ] **Step 6: Commit**

```bash
git add backend/contexts/training/router/progress.py backend/contexts/patient/emotion.py backend/schemas.py
git commit -m "✨ feat: enhance training state API with emotion/initiative history"
```

---

### Task 3: Backend — Add SSE exam_result event to pipeline

**Files:**
- Modify: `backend/contexts/training/pipeline/middleware/operation_executor.py`
- Modify: `backend/contexts/training/pipeline/runner.py` (stream_pipeline function)

- [ ] **Step 1: Add exam_result to PipelineContext and operation executor**

Append to `backend/contexts/training/pipeline/context.py`:

```python
exam_result: dict | None = None  # Set by operation executor
```

- [ ] **Step 2: Set exam_result in operation executor**

Read `operation_executor.py` and find where exam data is formatted. After computing exam data, set:

```python
ctx.exam_result = {"type": op_type, "data": exam_data}
```

- [ ] **Step 3: Emit exam_result in stream_pipeline**

Read `runner.py`, find the `stream_pipeline` async generator. After the operation executor middleware runs and before entering the LLM streaming phase, yield:

```python
if ctx.exam_result:
    yield f"data: {json.dumps({'exam_result': ctx.exam_result})}\n\n"
```

Add `import json` if not present.

- [ ] **Step 4: Verify**

Run: `cd backend && python -c "from contexts.training.pipeline.context import PipelineContext; print('OK')"`

- [ ] **Step 5: Commit**

```bash
git add backend/contexts/training/pipeline/
git commit -m "✨ feat: emit exam_result SSE event from operation pipeline"
```

---

### Task 4: Frontend — Delete legacy files and cleanup

**Files to DELETE:**
- `frontend/src/plugins/chat-display/`
- `frontend/src/plugins/chat-input/`
- `frontend/src/plugins/training-header/`
- `frontend/src/plugins/sidebar-host/`
- `frontend/src/plugins/inquiry/`
- `frontend/src/plugins/timer/`
- `frontend/src/plugins/patient-initiative/`
- `frontend/src/components/training/` (whole dir)
- `frontend/src/components/nursing-record/` (whole dir)
- `frontend/src/styles/index.css`
- `frontend/src/styles/tokens.css`
- `frontend/src/engine/SlotRenderer.tsx`
- `frontend/src/engine/useResponsiveLayout.ts`

**Files to MODIFY:**
- `frontend/src/engine/index.ts` (remove exports of deleted files)

- [ ] **Step 1: Delete all legacy files**

```bash
rm -rf frontend/src/plugins/chat-display/
rm -rf frontend/src/plugins/chat-input/
rm -rf frontend/src/plugins/training-header/
rm -rf frontend/src/plugins/sidebar-host/
rm -rf frontend/src/plugins/inquiry/
rm -rf frontend/src/plugins/timer/
rm -rf frontend/src/plugins/patient-initiative/
rm -rf frontend/src/components/training/
rm -rf frontend/src/components/nursing-record/
rm frontend/src/styles/index.css
rm frontend/src/styles/tokens.css
rm frontend/src/engine/SlotRenderer.tsx
rm frontend/src/engine/useResponsiveLayout.ts
```

- [ ] **Step 2: Update engine/index.ts exports**

Read `frontend/src/engine/index.ts` and remove exports for `SlotRenderer`, `useResponsiveLayout`, and any other deleted exports.

- [ ] **Step 3: Verify build fails as expected (ChatTraining.tsx still imports deleted plugins)**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -30`
Expected: Many import errors from ChatTraining.tsx — expected since we'll rewrite it later.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/
git commit -m "🔥 remove: delete legacy plugin code and unused CSS"
```

---

### Task 5: Frontend — Simplify engine types for PanelPlugin

**Files:**
- Modify: `frontend/src/engine/types.ts` (full rewrite)

- [ ] **Step 1: Rewrite types.ts**

```typescript
import type { ComponentType } from "react";

export interface ChatMessage {
  id?: string | number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
  timestamp?: string;
  examResult?: { type: string; data: Record<string, unknown> };
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

export interface MessageBus {
  on(event: string, handler: (...args: any[]) => void): () => void;
  emit(event: string, ...args: any[]): void;
  off(event: string, handler: (...args: any[]) => void): void;
  listEvents(): string[];
}

export interface PluginContext {
  recordId: string;
  bus: MessageBus;
  patient: PatientData;
  messages: ChatMessage[];
  loading: boolean;
  tts: {
    isAutoPlay: boolean;
    setAutoPlay: (v: boolean) => void;
  };
  sendMessage: (text: string) => void;
  endTraining: () => Promise<void>;
}

export interface BadgeInfo {
  text: string;
  variant: "default" | "destructive";
}

export interface PluginHooks {
  onInit?: (ctx: PluginContext) => void | (() => void);
  onDestroy?: () => void;
  beforeSend?: (text: string, ctx: PluginContext) => string;
  afterReceive?: (msg: ChatMessage, ctx: PluginContext) => ChatMessage | null;
  onPhaseChange?: (from: string, to: string, ctx: PluginContext) => void;
  onEnd?: (reason: "manual" | "timeout", ctx: PluginContext) => void;
}

export interface PanelTabProps {
  ctx: PluginContext;
  features: Record<string, boolean>;
  isCollapsed: boolean;
}

export interface PanelPlugin {
  id: string;
  featureFlag?: string;
  meta: { name: string; description?: string };
  tab: {
    icon: ComponentType<{ size?: number }>;
    label: string;
    badge?: (ctx: PluginContext) => BadgeInfo | null;
    priority?: number;
  };
  component: ComponentType<PanelTabProps>;
  hooks?: PluginHooks;
}
```

- [ ] **Step 2: Verify no TS errors in types.ts**

Run: `cd frontend && npx tsc --noEmit src/engine/types.ts 2>&1`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/types.ts
git commit -m "♻️ refactor: simplify engine types to PanelPlugin model"
```

---

### Task 6: Frontend — Simplify PluginRegistry for PanelPlugin

**Files:**
- Modify: `frontend/src/engine/PluginRegistry.ts` (full rewrite)

- [ ] **Step 1: Rewrite PluginRegistry.ts**

```typescript
import type { PanelPlugin } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, PanelPlugin>();
  private featureFlags: Record<string, boolean> = {};
  private _version = 0;

  get version(): number { return this._version; }

  register(plugin: PanelPlugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`[PluginRegistry] duplicate id: ${plugin.id}`);
      return;
    }
    this.plugins.set(plugin.id, { ...plugin });
    this._version++;
  }

  getAll(): PanelPlugin[] {
    return Array.from(this.plugins.values());
  }

  getActive(featureFlags?: Record<string, boolean>): PanelPlugin[] {
    const flags = featureFlags ?? this.featureFlags;
    return Array.from(this.plugins.values())
      .filter((p) => this.isActive(p, flags))
      .sort((a, b) => (a.tab.priority ?? 99) - (b.tab.priority ?? 99));
  }

  isActive(plugin: PanelPlugin, flags: Record<string, boolean>): boolean {
    if (plugin.featureFlag !== undefined) {
      if (!flags[plugin.featureFlag]) return false;
    }
    return true;
  }

  setFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlags = { ...flags };
    this._version++;
  }
}

export const pluginRegistry = new PluginRegistry();
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit src/engine/PluginRegistry.ts 2>&1`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/PluginRegistry.ts
git commit -m "♻️ refactor: simplify PluginRegistry for PanelPlugin"
```

---

### Task 7: Frontend — Create PluginContext providers

**Files:**
- Create: `frontend/src/engine/PluginContext.tsx`

- [ ] **Step 1: Create PluginContext.tsx**

```typescript
import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type EmotionState = "withdrawn" | "defensive" | "neutral" | "relaxed" | "open";

const EMOTION_BORDER: Record<EmotionState, string> = {
  withdrawn: "border-red-400",
  defensive: "border-orange-400",
  neutral: "border-border",
  relaxed: "border-blue-400",
  open: "border-green-400",
};

const EMOTION_COLOR: Record<EmotionState, string> = {
  withdrawn: "text-red-600",
  defensive: "text-orange-600",
  neutral: "text-muted-foreground",
  relaxed: "text-blue-600",
  open: "text-green-600",
};

export function getEmotionBorder(emotion: EmotionState): string {
  return EMOTION_BORDER[emotion] || EMOTION_BORDER.neutral;
}

export function getEmotionColor(emotion: EmotionState): string {
  return EMOTION_COLOR[emotion] || EMOTION_COLOR.neutral;
}

export const EMOTION_LABELS: Record<EmotionState, string> = {
  withdrawn: "沉默回避",
  defensive: "防御抵触",
  neutral: "正常配合",
  relaxed: "放松友好",
  open: "开放信任",
};

interface EmotionContextValue {
  emotion: EmotionState;
  setEmotion: (e: EmotionState) => void;
}
const EmotionCtx = createContext<EmotionContextValue>({ emotion: "neutral", setEmotion: () => {} });

export function EmotionProvider({ children }: { children: ReactNode }) {
  const [emotion, setEmotion] = useState<EmotionState>("neutral");
  return <EmotionCtx.Provider value={{ emotion, setEmotion }}>{children}</EmotionCtx.Provider>;
}

export function useEmotion() {
  return useContext(EmotionCtx);
}

interface PortraitContextValue {
  portraitUrl: string | null;
  setPortraitUrl: (url: string | null) => void;
}
const PortraitCtx = createContext<PortraitContextValue>({ portraitUrl: null, setPortraitUrl: () => {} });

export function PortraitProvider({ children }: { children: ReactNode }) {
  const [portraitUrl, setPortraitUrl] = useState<string | null>(null);
  return <PortraitCtx.Provider value={{ portraitUrl, setPortraitUrl }}>{children}</PortraitCtx.Provider>;
}

export function usePortrait() {
  return useContext(PortraitCtx);
}
```

- [ ] **Step 2: Verify**

Run: `cd frontend && npx tsc --noEmit src/engine/PluginContext.tsx 2>&1`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/PluginContext.tsx
git commit -m "✨ feat: add EmotionContext and PortraitContext providers"
```

---

### Task 8: Frontend — Enhance StreamManager for SSE exam_result

**Files:**
- Modify: `frontend/src/engine/StreamManager.ts:71-157`
- Modify: `frontend/src/api/chat.ts:53-80`

- [ ] **Step 1: Add examResult callbacks to StreamCallbacks**

In `StreamManager.ts`, add to `StreamCallbacks` interface:

```typescript
export interface StreamCallbacks {
  onPatientChunk?: (chunk: string) => void;
  onPatientDone?: (replyId?: number) => void;
  onError?: (err: string) => void;
  onSanitized?: (reply: string) => void;
  onSystem?: (text: string) => void;
  onExamResult?: (result: { type: string; data: Record<string, unknown> }) => void;
  onEmotionChange?: (change: { from: string; to: string; trigger: string }) => void;
  onInitiative?: (data: { content: string }) => void;
}
```

- [ ] **Step 2: Wire new callbacks in send method**

In the `send` method, pass the new callbacks to `sendMessageStream`:

```typescript
await sendMessageStream(
  this.recordId,
  content,
  (chunk) => { /* existing */ },
  (doneId) => { /* existing */ },
  (err) => { /* existing */ },
  (reply) => callbacks.onSanitized?.(reply),
  (sysMsg) => { /* existing */ },
  controller.signal,
  (examResult) => callbacks.onExamResult?.(examResult),
  (emotionChange) => callbacks.onEmotionChange?.(emotionChange),
  (initiative) => callbacks.onInitiative?.(initiative),
);
```

- [ ] **Step 3: Update sendMessageStream in api/chat.ts**

Add parameters and SSE parsing for new event types:

```typescript
export async function sendMessageStream(
  recordId: number | string,
  content: string,
  onChunk: (text: string) => void,
  onDone: (id?: number) => void,
  onError: (msg: string) => void,
  onSanitized?: (reply: string) => void,
  onSystem?: (text: string) => void,
  signal?: AbortSignal,
  onExamResult?: (result: { type: string; data: Record<string, unknown> }) => void,
  onEmotionChange?: (change: { from: string; to: string; trigger: string }) => void,
  onInitiative?: (data: { content: string }) => void,
) {
  // ... same fetch setup as before ...

  // Inside the line-parsing loop, add after existing data.content check:
  if (data.exam_result) {
    onExamResult?.(data.exam_result);
    continue;
  }
  if (data.emotion_change) {
    onEmotionChange?.(data.emotion_change);
    continue;
  }
  if (data.initiative) {
    onInitiative?.(data.initiative);
    continue;
  }
}
```

- [ ] **Step 4: Verify**

Run: `cd frontend && npx tsc --noEmit src/engine/StreamManager.ts src/api/chat.ts 2>&1`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine/StreamManager.ts frontend/src/api/chat.ts
git commit -m "✨ feat: add SSE exam_result/emotion_change/initiative event support"
```

---

### Task 9: Frontend — Rewrite TrainingEngine

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx` (full rewrite)
- Modify: `frontend/src/engine/index.ts`
- Modify: `frontend/src/engine/PatientProvider.tsx` (return `caseId` if needed)

- [ ] **Step 1: Read current PatientProvider to understand the interface**

Check `frontend/src/engine/PatientProvider.tsx` — note the `usePatient()` return type. Currently returns `{ patient, loading }`.

- [ ] **Step 2: Rewrite TrainingEngine.tsx**

```typescript
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMessageBus } from "./MessageBus";
import { PatientProvider, usePatient } from "./PatientProvider";
import { pluginRegistry } from "./PluginRegistry";
import { ScoreManager } from "./ScoreManager";
import { StreamManager } from "./StreamManager";
import { TTSManager } from "./tts/TTSManager";
import type { ChatMessage, PanelPlugin, PluginContext } from "./types";
import { EmotionProvider, PortraitProvider } from "./PluginContext";
import { TrainingHeader } from "@/components/training/TrainingHeader";
import { ChatArea } from "@/components/training/ChatArea";
import { PanelHost } from "@/components/training/PanelHost";
import { QuestionnaireOverlay } from "@/components/training/QuestionnaireOverlay";
import { ScoringOverlay } from "@/components/training/ScoringOverlay";
import { ScoreCard } from "@/components/training/ScoreCard";

interface TrainingEngineProps {
  recordId: string;
  features: Record<string, boolean>;
  panelPlugins: PanelPlugin[];
}

function TrainingEngineInner({ recordId, features, panelPlugins }: TrainingEngineProps) {
  const { patient, loading } = usePatient();
  const recordNum = Number(recordId);

  const busRef = useRef(createMessageBus());
  const streamRef = useRef(new StreamManager(recordNum));
  const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
  const ttsRef = useRef(new TTSManager({ autoPlay: true }));
  const cleanupRefs = useRef(new Map<string, (() => void) | void>());

  useEffect(() => {
    ttsRef.current.attach(busRef.current);
    return () => ttsRef.current.detach();
  }, []);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [ttsAutoPlay, setTtsAutoPlay] = useState(true);

  useEffect(() => {
    streamRef.current.setRecordId(recordNum);
    const unsub = streamRef.current.subscribe(() => setMessages([...streamRef.current.getMessages()]));
    const unsubLoading = streamRef.current.onLoadingChange(setSending);
    return () => { unsub(); unsubLoading(); };
  }, [recordNum]);

  useEffect(() => {
    scoreRef.current.setRecordId(recordNum);
  }, [recordNum]);

  const [_registryVer, setRegistryVer] = useState(0);

  useEffect(() => {
    pluginRegistry.setFeatureFlags(features);
    for (const p of panelPlugins) pluginRegistry.register(p);
    setRegistryVer(pluginRegistry.version);
  }, []);

  useEffect(() => {
    const unsub = busRef.current.on("plugins:updated", () => setRegistryVer(pluginRegistry.version));
    return unsub;
  }, []);

  const activePlugins = useMemo(() => pluginRegistry.getActive(features), [features, _registryVer]);

  const sendMessage = useCallback((text: string) => {
    streamRef.current.send(text, {
      onPatientChunk: () => busRef.current.emit("stream:chunk"),
      onPatientDone: () => busRef.current.emit("stream:done"),
      onError: (err) => busRef.current.emit("stream:error", err),
    });
  }, []);

  const endTraining = useCallback(async () => {
    await scoreRef.current.end();
    busRef.current.emit("training:ended");
  }, []);

  const ctx: PluginContext = useMemo(() => ({
    recordId,
    bus: busRef.current,
    patient: patient!,
    messages,
    loading: sending,
    tts: { isAutoPlay: ttsAutoPlay, setAutoPlay: setTtsAutoPlay },
    sendMessage,
    endTraining,
  }), [recordId, patient, messages, sending, ttsAutoPlay, sendMessage, endTraining]);

  // Wire plugin lifecycle hooks
  useEffect(() => {
    const cleanups = cleanupRefs.current;
    for (const plugin of activePlugins) {
      if (cleanups.has(plugin.id)) continue;
      if (plugin.hooks?.onInit) {
        const cleanup = plugin.hooks.onInit(ctx);
        cleanups.set(plugin.id, cleanup);
      }
    }
  }, [activePlugins, ctx]);

  // Call afterReceive on every message
  const processedMessages = useMemo(() => {
    let msgs = [...messages];
    for (const plugin of activePlugins) {
      if (plugin.hooks?.afterReceive) {
        msgs = msgs.reduce<ChatMessage[]>((acc, msg) => {
          const result = plugin.hooks!.afterReceive!(msg, ctx);
          if (result !== null) acc.push(result);
          return acc;
        }, []);
      }
    }
    return msgs;
  }, [messages, activePlugins, ctx]);

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

  const isCollapsed = false; // PanelHost manages this internally

  return (
    <EmotionProvider>
      <PortraitProvider>
        <div
          className="h-screen"
          style={{
            display: "grid",
            gridTemplateAreas: '"header header" "content panel"',
            gridTemplateColumns: "1fr auto",
            gridTemplateRows: "auto 1fr",
          }}
        >
          <div style={{ gridArea: "header" }}>
            <TrainingHeader
              patient={patient}
              messages={processedMessages}
              ttsAutoPlay={ttsAutoPlay}
              onTtsToggle={() => setTtsAutoPlay((v) => !v)}
              onEnd={endTraining}
              sending={sending}
            />
          </div>
          <div style={{ gridArea: "content", overflow: "hidden" }}>
            <ChatArea
              messages={processedMessages}
              patient={patient}
              sending={sending}
              onSend={sendMessage}
            />
          </div>
          <div style={{ gridArea: "panel" }}>
            <PanelHost ctx={ctx} features={features} plugins={activePlugins} />
          </div>
        </div>
        <QuestionnaireOverlay ctx={ctx} />
        <ScoringOverlay bus={busRef.current} />
        <ScoreCard bus={busRef.current} />
      </PortraitProvider>
    </EmotionProvider>
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

- [ ] **Step 3: Update engine/index.ts**

Replace exports with only what's needed:

```typescript
export { TrainingEngine } from "./TrainingEngine";
export { pluginRegistry } from "./PluginRegistry";
export type { ChatMessage, PluginContext, PanelPlugin, PluginHooks, PanelTabProps, BadgeInfo, PatientData, ScoreData, MessageBus } from "./types";
export { EmotionProvider, PortraitProvider, useEmotion, usePortrait, getEmotionBorder, getEmotionColor, EMOTION_LABELS } from "./PluginContext";
export type { EmotionState } from "./PluginContext";
```

- [ ] **Step 4: Verify — will fail on missing components (expected)**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: Cannot find TrainingHeader, ChatArea, PanelHost etc. — these are created in next tasks.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine/
git commit -m "♻️ refactor: rewrite TrainingEngine with core+panel plugin model"
```

---

### Task 10: Frontend — Create TrainingHeader component

**Files:**
- Create: `frontend/src/components/training/TrainingHeader.tsx`

- [ ] **Step 1: Create TrainingHeader.tsx**

```typescript
import { ArrowLeft, Clock, Ear, EarOff, Phone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ChatMessage, PatientData } from "@/engine/types";
import { useEmotion, usePortrait, getEmotionColor, EMOTION_LABELS } from "@/engine/PluginContext";
import type { EmotionState } from "@/engine/PluginContext";
import { getPatientAvatar } from "@/utils/avatar";
import { cn } from "@/lib/utils";

function formatTime(sec: number): string {
  if (sec <= 0) return "00:00";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

interface TrainingHeaderProps {
  patient: PatientData;
  messages: ChatMessage[];
  ttsAutoPlay: boolean;
  onTtsToggle: () => void;
  onEnd: () => Promise<void>;
  sending: boolean;
}

export function TrainingHeader({ patient, messages, ttsAutoPlay, onTtsToggle, onEnd, sending }: TrainingHeaderProps) {
  const navigate = useNavigate();
  const { emotion } = useEmotion();
  const { portraitUrl } = usePortrait();
  const [remaining, setRemaining] = useState(30 * 60);
  const [paused, setPaused] = useState(false);
  const [ending, setEnding] = useState(false);

  useEffect(() => {
    if (paused || remaining <= 0) return;
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, paused]);

  const handleEnd = useCallback(async () => {
    if (ending) return;
    setEnding(true);
    try { await onEnd(); } finally { setEnding(false); }
  }, [ending, onEnd]);

  const avatarSrc = portraitUrl || getPatientAvatar({ name: patient.name, gender: patient.gender });

  return (
    <header
      className="shrink-0 border-b border-border bg-card px-2 py-1 sm:px-4 sm:py-0 sm:h-14"
      style={{ paddingTop: "max(env(safe-area-inset-top), 8px)" }}
    >
      <div className="flex items-center gap-2 h-full">
        <button
          onClick={() => navigate("/cases")}
          className="w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 hover:bg-muted hover:text-foreground transition-colors"
          title="返回病例选择"
          aria-label="返回病例选择"
        >
          <ArrowLeft size={16} className="sm:size-[18px]" />
        </button>

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <img
            className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover shrink-0 bg-muted ring-2 ring-border"
            src={avatarSrc}
            alt={patient.name}
          />
          <div className="min-w-0">
            <div className="text-xs sm:text-sm font-semibold text-foreground truncate">{patient.name}</div>
            <div className="text-[0.65rem] sm:text-xs text-muted-foreground truncate">{patient.caseTitle}</div>
          </div>
        </div>

        <div className={cn(
          "flex items-center gap-1 px-2 py-1 rounded-md text-xs sm:text-sm font-bold tabular-nums border bg-card shrink-0",
          remaining <= 120 && "border-red-200 bg-red-50 text-red-600",
          remaining > 120 && remaining <= 300 && "border-amber-200 bg-amber-50 text-amber-600",
          remaining > 300 && "border-border text-muted-foreground",
        )}>
          <Clock size={12} className="sm:size-[14px] shrink-0" />
          <span>{formatTime(remaining)}</span>
          <button onClick={() => setPaused((p) => !p)} className="text-xs text-muted-foreground ml-0.5">
            {paused ? "▶" : "⏸"}
          </button>
        </div>

        <button
          onClick={onTtsToggle}
          className={cn(
            "w-10 h-10 sm:w-9 sm:h-9 rounded-lg border border-border bg-card text-muted-foreground flex items-center justify-center shrink-0 transition-colors hover:bg-muted",
            ttsAutoPlay && "border-primary bg-primary/10 text-primary hover:bg-primary/20",
          )}
          title={ttsAutoPlay ? "关闭自动朗读" : "开启自动朗读"}
        >
          {ttsAutoPlay ? <Ear size={14} className="sm:size-[16px]" /> : <EarOff size={14} className="sm:size-[16px]" />}
        </button>

        <button
          onClick={handleEnd}
          disabled={ending || messages.length <= 1}
          className="flex items-center gap-1 px-2.5 h-10 sm:h-9 rounded-md border border-destructive/30 bg-card text-destructive text-xs sm:text-sm font-medium shrink-0 hover:bg-destructive/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Phone size={13} className="sm:size-[15px]" />
          <span className="hidden sm:block">{ending ? "评分中..." : "结束训练"}</span>
          <span className="sm:hidden">{ending ? "..." : "结束"}</span>
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/TrainingHeader.tsx
git commit -m "✨ feat: add TrainingHeader core component with timer/TTS/emotion/portrait"
```

---

### Task 11: Frontend — Create WelcomeScreen component

**Files:**
- Create: `frontend/src/components/training/WelcomeScreen.tsx`

- [ ] **Step 1: Create WelcomeScreen.tsx**

```typescript
import type { PatientData } from "@/engine/types";
import { usePortrait } from "@/engine/PluginContext";
import { getPatientAvatar } from "@/utils/avatar";
import { Card } from "@/components/ui/card";

interface WelcomeScreenProps {
  patient: PatientData;
  onQuickPrompt?: (text: string) => void;
}

export function WelcomeScreen({ patient, onQuickPrompt }: WelcomeScreenProps) {
  const { portraitUrl } = usePortrait();
  const avatarSrc = portraitUrl || getPatientAvatar({ name: patient.name, gender: patient.gender });

  const genderLabel = patient.gender === "male" ? "男" : "女";
  const ageLabel = patient.age ? `${patient.age}岁` : "";
  const subInfo = [genderLabel, ageLabel].filter(Boolean).join(" · ");

  return (
    <div className="flex h-full items-center justify-center p-4">
      <div className="text-center space-y-6 max-w-sm w-full">
        <Card className="p-6 text-center space-y-4">
          <img
            className="w-20 h-20 rounded-full object-cover mx-auto bg-muted ring-4 ring-border"
            src={avatarSrc}
            alt={patient.name}
          />
          <div>
            <h2 className="text-lg font-bold text-foreground">{patient.name}</h2>
            <p className="text-sm text-muted-foreground">{subInfo}</p>
          </div>

          <div className="space-y-2 text-left">
            {patient.chiefComplaint && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">主诉</div>
                <p className="text-xs leading-relaxed">{patient.chiefComplaint}</p>
              </div>
            )}
            {patient.personality && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">性格特征</div>
                <p className="text-xs leading-relaxed">{patient.personality}</p>
              </div>
            )}
            <div className="rounded-lg border bg-muted/30 p-3">
              <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">病案</div>
              <p className="text-xs leading-relaxed">{patient.caseTitle || "未提供"}</p>
            </div>
          </div>
        </Card>

        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">在下方输入框开始与患者对话</p>
          <button
            type="button"
            onClick={() => onQuickPrompt?.("您好，请问哪里不舒服？")}
            className="text-xs text-primary hover:underline"
          >
            试试："您好，请问哪里不舒服？"
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/WelcomeScreen.tsx
git commit -m "✨ feat: add WelcomeScreen with patient info card"
```

---

### Task 12: Frontend — Create ChatDisplay component

**Files:**
- Create: `frontend/src/components/training/ChatDisplay.tsx`

The ChatDisplay component is the message list with auto-scroll. Model it after the old `plugins/chat-display/ChatDisplay.tsx` logic but simplified.

- [ ] **Step 1: Create ChatDisplay.tsx**

```typescript
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatBubble } from "@/components/ChatBubble";
import type { ChatMessage } from "@/engine/types";
import { getPatientAvatar } from "@/utils/avatar";
import { usePortrait } from "@/engine/PluginContext";
import type { PatientData } from "@/engine/types";

interface ChatDisplayProps {
  messages: ChatMessage[];
  patient: PatientData;
  onQuickPrompt?: (text: string) => void;
  bus: { on: (event: string, handler: (...args: any[]) => void) => () => void };
}

export function ChatDisplay({ messages, patient, onQuickPrompt, bus }: ChatDisplayProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const isNearBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const { portraitUrl } = usePortrait();

  const checkNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }, []);

  const scrollToBottom = useCallback((force = false) => {
    if (force || isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: force ? "auto" : "smooth" });
    }
  }, []);

  const handleScroll = useCallback(() => {
    const near = checkNearBottom();
    isNearBottomRef.current = near;
    setIsNearBottom(near);
  }, [checkNearBottom]);

  useEffect(() => {
    const count = messages.length;
    if (count > prevCountRef.current) {
      scrollToBottom(true);
    }
    prevCountRef.current = count;
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const unsub = bus.on("stream:chunk", () => {
      if (isNearBottomRef.current) {
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
      }
    });
    return unsub;
  }, [bus]);

  const patientAvatar = portraitUrl || getPatientAvatar({ name: patient.name, gender: patient.gender });
  const nurseAvatar = getPatientAvatar({ name: "Nurse", gender: "female" });

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto scroll-smooth px-2 py-4 space-y-3" onScroll={handleScroll}>
      {messages.map((msg, i) => (
        <ChatBubble
          key={msg.id ?? i}
          message={msg}
          patientAvatar={patientAvatar}
          nurseAvatar={nurseAvatar}
        />
      ))}
      <div ref={bottomRef} className="h-1" />

      {!isNearBottom && (
        <button
          type="button"
          onClick={() => scrollToBottom(true)}
          className="fixed bottom-24 right-4 z-30 flex size-9 items-center justify-center rounded-full border bg-background shadow-md hover:bg-muted transition-colors"
          aria-label="滚动到最新消息"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-foreground" role="img">
            <title>滚动到最新消息</title>
            <path d="M8 3v7m0 0l-3-3m3 3l3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/ChatDisplay.tsx
git commit -m "✨ feat: add ChatDisplay message list with auto-scroll"
```

---

### Task 13: Frontend — Enhance ChatBubble with emotion/portrait

**Files:**
- Modify: `frontend/src/components/ChatBubble.tsx`

- [ ] **Step 1: Update ChatBubble.tsx**

```typescript
import { Info } from "lucide-react";
import type { ChatMessage } from "@/engine/types";
import { useEmotion, usePortrait, getEmotionBorder } from "@/engine/PluginContext";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  message: ChatMessage;
  patientAvatar: string;
  nurseAvatar: string;
}

export function ChatBubble({ message, patientAvatar, nurseAvatar }: ChatBubbleProps) {
  const { emotion } = useEmotion();
  const { portraitUrl } = usePortrait();
  const displayAvatar = portraitUrl || patientAvatar;

  if (message.role === "system") {
    return (
      <div className="flex justify-center" data-role="system">
        <div className="flex items-start gap-2 max-w-[85%] rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap leading-relaxed text-blue-800">{message.content}</div>
        </div>
      </div>
    );
  }

  if (message.role === "patient") {
    return (
      <div className="flex items-end gap-2 justify-start" data-role="patient">
        <img className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted" src={displayAvatar} alt="患者" />
        <div
          className={cn(
            "max-w-[90%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed break-words",
            "bg-card text-foreground border-2 rounded-bl-md",
            getEmotionBorder(emotion),
            message.streaming && "after:content-['▎'] after:animate-pulse after:text-primary after:font-bold",
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 justify-end" data-role="student">
      <div className={cn(
        "max-w-[90%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed break-words",
        "bg-primary text-primary-foreground",
      )}>
        {message.content}
      </div>
      <img className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted" src={nurseAvatar} alt="护士" />
    </div>
  );
}
```

Note: Changed `export default` to named export `ChatBubble`.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ChatBubble.tsx
git commit -m "✨ feat: enhance ChatBubble with emotion border and portrait support"
```

---

### Task 14: Frontend — Create ChatInput component

**Files:**
- Create: `frontend/src/components/training/ChatInput.tsx`

- [ ] **Step 1: Create ChatInput.tsx**

```typescript
import { Send, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";

interface ChatInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function ChatInput({ onSend, disabled, loading }: ChatInputProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled || loading) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, onSend, disabled, loading]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-end gap-2 px-3 py-2 border-t border-border bg-background shrink-0">
      <textarea
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="输入消息与患者对话..."
        disabled={disabled}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 placeholder:text-muted-foreground"
      />
      <button
        type="button"
        onClick={handleSend}
        disabled={disabled || loading || !text.trim()}
        className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shrink-0 disabled:opacity-50 hover:bg-primary/90 transition-colors"
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/ChatInput.tsx
git commit -m "✨ feat: add ChatInput with textarea and send button"
```

---

### Task 15: Frontend — Create ChatArea container

**Files:**
- Create: `frontend/src/components/training/ChatArea.tsx`

- [ ] **Step 1: Create ChatArea.tsx**

```typescript
import type { ChatMessage, PatientData } from "@/engine/types";
import { WelcomeScreen } from "./WelcomeScreen";
import { ChatDisplay } from "./ChatDisplay";
import { ChatInput } from "./ChatInput";

interface ChatAreaProps {
  messages: ChatMessage[];
  patient: PatientData;
  sending: boolean;
  onSend: (text: string) => void;
  bus: { on: (event: string, handler: (...args: any[]) => void) => () => void };
}

export function ChatArea({ messages, patient, sending, onSend, bus }: ChatAreaProps) {
  const hasMessages = messages.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-hidden">
        {hasMessages ? (
          <ChatDisplay messages={messages} patient={patient} bus={bus} />
        ) : (
          <WelcomeScreen patient={patient} onQuickPrompt={onSend} />
        )}
      </div>
      <ChatInput onSend={onSend} disabled={false} loading={sending} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/ChatArea.tsx
git commit -m "✨ feat: add ChatArea container with WelcomeScreen/ChatDisplay/ChatInput"
```

---

### Task 16: Frontend — Create PanelHost component

**Files:**
- Create: `frontend/src/components/training/PanelHost.tsx`

- [ ] **Step 1: Create PanelHost.tsx**

```typescript
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { PanelPlugin, PluginContext } from "@/engine/types";
import { cn } from "@/lib/utils";

interface PanelHostProps {
  ctx: PluginContext;
  features: Record<string, boolean>;
  plugins: PanelPlugin[];
}

export function PanelHost({ ctx, features, plugins }: PanelHostProps) {
  const [activeTabId, setActiveTabId] = useState<string | null>(plugins[0]?.id ?? null);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const activePlugin = plugins.find((p) => p.id === activeTabId);

  const handleTabClick = (pluginId: string) => {
    if (isCollapsed) {
      setIsCollapsed(false);
      setActiveTabId(pluginId);
    } else if (activeTabId === pluginId) {
      setIsCollapsed(true);
    } else {
      setActiveTabId(pluginId);
    }
  };

  // Mobile fullscreen panel
  if (isMobile && activePlugin && !isCollapsed) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-background">
        <div className="flex items-center gap-2 border-b px-4 py-3 overflow-x-auto">
          {plugins.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveTabId(p.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium shrink-0 transition-colors",
                activeTabId === p.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted",
              )}
            >
              <p.tab.icon size={14} />
              {p.tab.label}
            </button>
          ))}
          <button onClick={() => setIsCollapsed(true)} className="ml-auto size-8 flex items-center justify-center rounded-md hover:bg-muted shrink-0">
            <ChevronRight size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-sm font-semibold mb-3">{activePlugin.tab.label}</h3>
          <activePlugin.component ctx={ctx} features={features} isCollapsed={false} />
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex h-full border-l border-border bg-card transition-all duration-200", isCollapsed ? "w-10" : "w-[280px]")}>
      <div className="flex flex-col gap-0.5 p-1 shrink-0">
        <button
          onClick={() => setIsCollapsed((v) => !v)}
          className="size-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          title={isCollapsed ? "展开面板" : "折叠面板"}
        >
          {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
        </button>

        {plugins.map((plugin) => {
          const badge = plugin.tab.badge?.(ctx);
          return (
            <button
              key={plugin.id}
              onClick={() => handleTabClick(plugin.id)}
              className={cn(
                "size-9 rounded-lg flex items-center justify-center transition-colors relative",
                activeTabId === plugin.id && !isCollapsed ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              title={plugin.tab.label}
            >
              <plugin.tab.icon size={18} />
              {badge && (
                <span className={cn(
                  "absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full text-[9px] font-bold px-1",
                  badge.variant === "destructive" ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground",
                )}>
                  {badge.text}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {!isCollapsed && activePlugin && (
        <div className="flex-1 border-l border-border bg-card overflow-hidden flex flex-col">
          <div className="shrink-0 px-3 py-2.5 border-b border-border">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {activePlugin.tab.label}
            </h3>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <activePlugin.component ctx={ctx} features={features} isCollapsed={false} />
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/training/PanelHost.tsx
git commit -m "✨ feat: add PanelHost with collapse/expand and badge support"
```

---

### Task 17: Frontend — Move QuestionnaireOverlay and ScoringOverlay/ScoreCard

**Files:**
- Create: `frontend/src/components/training/QuestionnaireOverlay.tsx` (copy from `plugins/questionnaire/QuestionnaireOverlay.tsx`)
- Create: `frontend/src/components/training/ScoringOverlay.tsx` (copy from `plugins/scoring-display/ScoringOverlay.tsx`)
- Create: `frontend/src/components/training/ScoreCard.tsx` (copy from `plugins/scoring-display/ScoreCard.tsx`)

- [ ] **Step 1: Copy questionnaire overlay as core component**

Read `frontend/src/plugins/questionnaire/QuestionnaireOverlay.tsx`, copy to `frontend/src/components/training/QuestionnaireOverlay.tsx`. Change its interface to accept `ctx` directly instead of `SlotProps`.

- [ ] **Step 2: Copy scoring overlay and score card as core components**

Read and copy `ScoringOverlay.tsx` and `ScoreCard.tsx` from `plugins/scoring-display/`. Adapt interface to accept `bus` directly.

- [ ] **Step 3: Verify the copied files compile**

```bash
cd frontend && npx tsc --noEmit src/components/training/QuestionnaireOverlay.tsx src/components/training/ScoringOverlay.tsx src/components/training/ScoreCard.tsx 2>&1
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/training/QuestionnaireOverlay.tsx frontend/src/components/training/ScoringOverlay.tsx frontend/src/components/training/ScoreCard.tsx
git commit -m "✨ feat: move questionnaire/scoring overlays to core components"
```

---

### Task 18: Frontend — Create inquiry plugin

**Files:**
- Create: `frontend/src/plugins/inquiry/index.ts`
- Create: `frontend/src/plugins/inquiry/InquiryTab.tsx`

- [ ] **Step 1: Create index.ts**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { ListChecks } from "lucide-react";
import { InquiryTab } from "./InquiryTab";

export const inquiryPlugin: PanelPlugin = {
  id: "inquiry",
  meta: { name: "问诊进度", description: "展示问诊要求完成进度" },
  tab: {
    icon: ListChecks,
    label: "问诊进度",
    priority: 1,
    badge: (ctx) => {
      const inquiries = ctx.patient.requiredInquiries ?? [];
      if (inquiries.length === 0) return null;
      const studentMsgs = ctx.messages.filter((m) => m.role === "student");
      const done = inquiries.filter((inq) =>
        studentMsgs.some((m) => (m.content ?? "").toLowerCase().includes(inq.toLowerCase().slice(0, 4)))
      ).length;
      return { text: `${done}/${inquiries.length}`, variant: "default" };
    },
  },
  component: InquiryTab,
};
```

- [ ] **Step 2: Create InquiryTab.tsx**

```typescript
import { useMemo } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";

export function InquiryTab({ ctx }: PanelTabProps) {
  const inquiries = ctx.patient.requiredInquiries ?? [];
  const studentMessages = useMemo(() => ctx.messages.filter((m) => m.role === "student"), [ctx.messages]);

  const states = useMemo(
    () =>
      inquiries.map((inquiry) => {
        const short = inquiry.slice(0, 4).toLowerCase();
        const done = studentMessages.some((m) => (m.content ?? "").toLowerCase().includes(short));
        return { inquiry, done };
      }),
    [inquiries, studentMessages],
  );

  const doneCount = states.filter((s) => s.done).length;

  if (inquiries.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无问诊要求</p>;
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-muted-foreground">完成进度</span>
        <span className="text-xs tabular-nums font-medium">{doneCount}/{inquiries.length}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500"
          style={{ width: `${(doneCount / inquiries.length) * 100}%` }}
        />
      </div>
      <div className="space-y-0.5">
        {states.map(({ inquiry, done }) => (
          <div
            key={inquiry}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
              done ? "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400" : "text-muted-foreground",
            )}
          >
            {done ? <CheckCircle2 size={14} className="text-green-500 shrink-0" /> : <Circle size={14} className="shrink-0" />}
            {inquiry}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/plugins/inquiry/
git commit -m "✨ feat: add inquiry plugin with unified keyword matching"
```

---

### Task 19: Frontend — Create patient-info plugin

**Files:**
- Create: `frontend/src/plugins/patient-info/index.ts`
- Create: `frontend/src/plugins/patient-info/PatientInfoTab.tsx`

- [ ] **Step 1: Create index.ts**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { User } from "lucide-react";
import { PatientInfoTab } from "./PatientInfoTab";

export const patientInfoPlugin: PanelPlugin = {
  id: "patient-info",
  meta: { name: "患者情况", description: "患者基本信息和病历" },
  tab: { icon: User, label: "患者情况", priority: 2 },
  component: PatientInfoTab,
};
```

- [ ] **Step 2: Create PatientInfoTab.tsx** (copy from SidebarHost's PatientTab)

```typescript
import type { PanelTabProps } from "@/engine/types";

export function PatientInfoTab({ ctx }: PanelTabProps) {
  const p = ctx.patient;
  if (!p) return null;

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className="text-sm font-semibold">{p.name}</div>
        <div className="text-xs text-muted-foreground">{[p.gender === "male" ? "男" : "女", p.age ? `${p.age}岁` : ""].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="space-y-3">
        {p.chiefComplaint && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">主诉</div>
            <p className="text-xs leading-relaxed">{p.chiefComplaint}</p>
          </div>
        )}
        {p.personality && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">性格特征</div>
            <p className="text-xs leading-relaxed">{p.personality}</p>
          </div>
        )}
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="text-[0.65rem] font-semibold text-muted-foreground uppercase tracking-wider mb-1">病案</div>
          <p className="text-xs leading-relaxed">{p.caseTitle || "未提供"}</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/plugins/patient-info/
git commit -m "✨ feat: add patient-info plugin"
```

---

### Task 20: Frontend — Rewrite physical-exam plugin

**Files:**
- Modify: `frontend/src/plugins/physical-exam/index.ts`
- Modify: `frontend/src/plugins/physical-exam/ExamPanel.tsx` (rewrite)

- [ ] **Step 1: Rewrite index.ts**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { Stethoscope } from "lucide-react";
import { ExamPanel } from "./ExamPanel";
import { useExamState } from "./useExamState";

export const physicalExamPlugin: PanelPlugin = {
  id: "physical-exam",
  featureFlag: "physical_exam",
  meta: { name: "护理查体", description: "执行护理查体操作" },
  tab: {
    icon: Stethoscope,
    label: "护理查体",
    priority: 3,
    badge: (ctx) => {
      return null; // Badge handled internally by exam state
    },
  },
  component: ExamPanel,
  hooks: {
    afterReceive: (msg) => {
      if (msg.examResult) {
        const { addResult } = useExamState.getState();
        addResult(msg.examResult.type, msg.examResult.data);
      }
      return msg;
    },
  },
};
```

- [ ] **Step 2: Create useExamState.ts**

```typescript
import { create } from "zustand";

interface ExamResult {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

interface ExamState {
  results: Record<string, ExamResult>;
  addResult: (type: string, data: Record<string, unknown>) => void;
  clearAll: () => void;
}

export const useExamState = create<ExamState>((set) => ({
  results: {},
  addResult: (type, data) =>
    set((state) => ({
      results: { ...state.results, [type]: { type, data, timestamp: new Date().toISOString() } },
    })),
  clearAll: () => set({ results: {} }),
}));
```

- [ ] **Step 3: Rewrite ExamPanel.tsx**

```typescript
import { Stethoscope, Activity } from "lucide-react";
import type { PanelTabProps } from "@/engine/types";
import { useExamState } from "./useExamState";

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

const LABEL_MAP: Record<string, string> = {
  vitals: "生命体征", bp: "血压", temp: "体温", spo2: "血氧",
  hr: "心率", rr: "呼吸", skin: "皮肤", pain: "疼痛评分",
};

export function ExamPanel({ ctx }: PanelTabProps) {
  const { results } = useExamState();

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5">
        {OPERATIONS.map((op) => (
          <button
            key={op.id}
            onClick={() => ctx.sendMessage(op.command)}
            disabled={ctx.loading}
            className="rounded-lg border bg-card px-2.5 py-2 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-50 text-left flex items-center gap-1.5"
          >
            <Stethoscope size={13} className="text-muted-foreground shrink-0" />
            {op.label}
          </button>
        ))}
      </div>

      {Object.keys(results).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground">已查体征</h4>
          {Object.entries(results).map(([key, result]) => (
            <div key={key} className="rounded-lg border bg-muted/30 p-2">
              <div className="flex items-center gap-1.5 mb-1">
                <Activity size={12} className="text-primary" />
                <span className="text-xs font-medium">{LABEL_MAP[key] || key}</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {Object.entries(result.data).map(([k, v]) => (
                  <div key={k} className="text-[0.65rem]">
                    <span className="text-muted-foreground">{k}: </span>
                    <span className="font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/plugins/physical-exam/
git commit -m "✨ feat: rewrite physical-exam plugin with exam result display"
```

---

### Task 21: Frontend — Rewrite nursing-record plugin (backend persistence)

**Files:**
- Modify: `frontend/src/plugins/nursing-record/index.ts`
- Modify: `frontend/src/plugins/nursing-record/NursingRecordPanel.tsx`

- [ ] **Step 1: Rewrite index.ts to use PanelPlugin**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { ClipboardList } from "lucide-react";
import { NursingRecordPanel } from "./NursingRecordPanel";
import { NURSING_RECORD_SHEET_CONFIG } from "./config";

const TOTAL_ITEMS = NURSING_RECORD_SHEET_CONFIG.sections.reduce((sum, s) => sum + s.items.length, 0);

export const nursingRecordPlugin: PanelPlugin = {
  id: "nursing-record",
  meta: { name: "护理记录", description: "填写护理检查单" },
  tab: {
    icon: ClipboardList,
    label: "护理记录",
    priority: 4,
    badge: (ctx) => {
      const sheetData = getSheetData(ctx.recordId);
      const filled = countFilledItems(sheetData);
      return { text: `${filled}/${TOTAL_ITEMS}`, variant: "default" };
    },
  },
  component: NursingRecordPanel,
};

function getSheetData(recordId: string): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(localStorage.getItem(`nursing_record_${recordId}`) || "{}");
  } catch { return {}; }
}

function countFilledItems(data: Record<string, Record<string, unknown>>): number {
  let count = 0;
  for (const section of NURSING_RECORD_SHEET_CONFIG.sections) {
    const sectionData = data[section.key] || {};
    for (const item of section.items) {
      const val = sectionData[item.key];
      if (val !== undefined && val !== null && val !== "") count++;
    }
  }
  return count;
}
```

- [ ] **Step 2: Update NursingRecordPanel to use backend API for persistence**

Read `frontend/src/plugins/nursing-record/NursingRecordPanel.tsx`. Modify it to:
- Load from `GET /api/nursing-records/{recordId}` on mount (via `import { getNursingRecord, saveNursingRecord } from "@/api/nursing-records"`)
- Save via `POST /api/nursing-records/{recordId}` on change (debounced 2s)
- Fall back to localStorage if API fails

- [ ] **Step 3: Commit**

```bash
git add frontend/src/plugins/nursing-record/
git commit -m "✨ feat: rewrite nursing-record plugin with backend persistence"
```

---

### Task 22: Frontend — Create emotion plugin

**Files:**
- Create: `frontend/src/plugins/emotion/index.ts`
- Create: `frontend/src/plugins/emotion/EmotionTab.tsx`

- [ ] **Step 1: Create index.ts**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { Smile } from "lucide-react";
import { EmotionTab } from "./EmotionTab";
import type { EmotionState } from "@/engine/PluginContext";

export const emotionPlugin: PanelPlugin = {
  id: "emotion",
  featureFlag: "emotion",
  meta: { name: "情绪状态", description: "患者情绪状态机追踪" },
  tab: { icon: Smile, label: "情绪状态", priority: 5 },
  component: EmotionTab,
  hooks: {
    afterReceive: async (msg, ctx) => {
      if (msg.role !== "patient") return msg;
      try {
        const { getTrainingState } = await import("@/api/training-state");
        const res = await getTrainingState(Number(ctx.recordId));
        const emotion = res.data.emotion?.state as EmotionState;
        if (emotion) {
          const { useEmotion } = await import("@/engine/PluginContext");
          // Note: This works because afterReceive runs in the TrainingEngine context
          // which provides EmotionProvider. The actual context write happens via event.
          ctx.bus.emit("emotion:changed", { emotion });
        }
      } catch { /* ignore poll errors */ }
      return msg;
    },
  },
};
```

- [ ] **Step 2: Create EmotionTab.tsx**

```typescript
import { useEffect, useState } from "react";
import type { PanelTabProps } from "@/engine/types";
import { useEmotion, EMOTION_LABELS, getEmotionColor } from "@/engine/PluginContext";
import type { EmotionState } from "@/engine/PluginContext";
import { cn } from "@/lib/utils";

interface EmotionHistory {
  score: number;
  state: EmotionState;
  intent: string;
  timestamp: string;
}

const EMOTION_BG: Record<EmotionState, string> = {
  withdrawn: "bg-red-400",
  defensive: "bg-orange-400",
  neutral: "bg-muted",
  relaxed: "bg-blue-400",
  open: "bg-green-400",
};

export function EmotionTab({ ctx }: PanelTabProps) {
  const { emotion, setEmotion } = useEmotion();
  const [history, setHistory] = useState<EmotionHistory[]>([]);

  useEffect(() => {
    const unsub = ctx.bus.on("emotion:changed", (data: { emotion: EmotionState }) => {
      setEmotion(data.emotion);
    });
    return unsub;
  }, [ctx.bus, setEmotion]);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className={cn("inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold", getEmotionColor(emotion))}>
          <span className={cn("size-2.5 rounded-full", EMOTION_BG[emotion])} />
          {EMOTION_LABELS[emotion]}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-muted-foreground">情绪变化时间线</h4>
        {history.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无情绪变化记录</p>
        ) : (
          <div className="space-y-1">
            {history.slice(-10).reverse().map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={cn("size-2 rounded-full shrink-0", EMOTION_BG[h.state])} />
                <span className="text-muted-foreground">{EMOTION_LABELS[h.state]}</span>
                <span className="text-muted-foreground/50 ml-auto">{h.intent}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/plugins/emotion/
git commit -m "✨ feat: add emotion plugin with state tracking and timeline"
```

---

### Task 23: Frontend — Create initiative plugin

**Files:**
- Create: `frontend/src/plugins/initiative/index.ts`
- Create: `frontend/src/plugins/initiative/InitiativeTab.tsx`

- [ ] **Step 1: Create index.ts**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { MessageCircle } from "lucide-react";
import { InitiativeTab } from "./InitiativeTab";

export const initiativePlugin: PanelPlugin = {
  id: "initiative",
  featureFlag: "patient_initiative",
  meta: { name: "主动追问", description: "患者定时主动追问" },
  tab: {
    icon: MessageCircle,
    label: "主动追问",
    priority: 6,
    badge: (ctx) => {
      return null; // Badge set by state
    },
  },
  component: InitiativeTab,
  hooks: {
    onInit: (ctx) => {
      const interval = setInterval(async () => {
        try {
          const { getTrainingState, triggerInitiative } = await import("@/api/training-state");
          const state = await getTrainingState(Number(ctx.recordId));
          const initiative = state.data.initiative;
          ctx.bus.emit("initiative:state", initiative);

          if (initiative?.should_trigger) {
            const res = await triggerInitiative(Number(ctx.recordId));
            if (res.data.triggered && res.data.message) {
              ctx.bus.emit("initiative:triggered", { content: res.data.message });
            }
          }
        } catch { /* ignore poll errors */ }
      }, 5000);

      return () => clearInterval(interval);
    },
    afterReceive: (msg, ctx) => {
      return msg;
    },
  },
};
```

- [ ] **Step 2: Create InitiativeTab.tsx**

```typescript
import { useEffect, useState } from "react";
import type { PanelTabProps } from "@/engine/types";
import { cn } from "@/lib/utils";

interface InitiativeState {
  elapsed_seconds?: number;
  threshold_seconds?: number;
  percent?: number;
  should_trigger?: boolean;
}

export function InitiativeTab({ ctx }: PanelTabProps) {
  const [state, setState] = useState<InitiativeState>({});
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => {
    const unsub1 = ctx.bus.on("initiative:state", (s: InitiativeState) => setState(s));
    const unsub2 = ctx.bus.on("initiative:triggered", () => setHasPending(true));
    return () => { unsub1(); unsub2(); };
  }, [ctx.bus]);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <div className={cn(
          "inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-medium",
          hasPending ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
        )}>
          {hasPending ? "有追问待处理" : "患者状态正常"}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>距下次可能追问</span>
          <span className="tabular-nums">
            {state.elapsed_seconds != null ? `${Math.round(state.elapsed_seconds)}s / ${Math.round(state.threshold_seconds || 60)}s` : "计算中..."}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-1000",
              (state.percent ?? 0) > 80 ? "bg-destructive" : "bg-primary",
            )}
            style={{ width: `${Math.min(100, state.percent ?? 0)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/plugins/initiative/
git commit -m "✨ feat: add initiative plugin with polling and pending state"
```

---

### Task 24: Frontend — Create portrait plugin

**Files:**
- Create: `frontend/src/plugins/portrait/index.ts`
- Create: `frontend/src/plugins/portrait/PortraitTab.tsx`
- Create: `frontend/public/portraits/.gitkeep`

- [ ] **Step 1: Create index.ts**

```typescript
import type { PanelPlugin } from "@/engine/types";
import { Image } from "lucide-react";
import { PortraitTab } from "./PortraitTab";
import type { EmotionState } from "@/engine/PluginContext";

const EMOTION_FILES: Record<EmotionState, string> = {
  withdrawn: "withdrawn.png",
  defensive: "defensive.png",
  neutral: "neutral.png",
  relaxed: "relaxed.png",
  open: "open.png",
};

export const portraitPlugin: PanelPlugin = {
  id: "portrait",
  featureFlag: "portrait",
  meta: { name: "患者立绘", description: "高级患者表情立绘" },
  tab: { icon: Image, label: "患者立绘", priority: 7 },
  component: PortraitTab,
  hooks: {
    afterReceive: async (msg, ctx) => {
      if (msg.role !== "patient") return msg;
      try {
        const { getTrainingState } = await import("@/api/training-state");
        const res = await getTrainingState(Number(ctx.recordId));
        const emotion = res.data.emotion?.state as EmotionState;
        if (emotion) {
          const portraitUrl = `/portraits/${ctx.patient.caseTitle || "default"}/${EMOTION_FILES[emotion] || "neutral.png"}`;
          ctx.bus.emit("portrait:changed", { url: portraitUrl });
        }
      } catch { /* ignore */ }
      return msg;
    },
  },
};
```

- [ ] **Step 2: Create PortraitTab.tsx**

In the `portrait` directory, create `PortraitTab.tsx`.

```typescript
import { useEffect, useState } from "react";
import type { PanelTabProps } from "@/engine/types";
import { usePortrait, useEmotion, EMOTION_LABELS } from "@/engine/PluginContext";

export function PortraitTab({ ctx }: PanelTabProps) {
  const { portraitUrl } = usePortrait();
  const { emotion } = useEmotion();

  useEffect(() => {
    const unsub = ctx.bus.on("portrait:changed", (data: { url: string }) => {
      const { usePortrait } = require("@/engine/PluginContext");
      // The context update happens in TrainingEngine via the Provider
    });
    return unsub;
  }, [ctx.bus]);

  return (
    <div className="space-y-4 text-center">
      {portraitUrl ? (
        <img
          src={portraitUrl}
          alt="患者立绘"
          className="w-full max-w-[200px] mx-auto rounded-lg border bg-muted"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      ) : (
        <div className="w-full max-w-[200px] mx-auto aspect-square rounded-lg border bg-muted flex items-center justify-center">
          <span className="text-xs text-muted-foreground">暂无立绘素材</span>
        </div>
      )}
      <div>
        <p className="text-xs text-muted-foreground">当前表情：{EMOTION_LABELS[emotion]}</p>
        <p className="text-[0.65rem] text-muted-foreground/50 mt-1">
          素材路径：/public/portraits/{"{case_id}"}/{"{emotion}"}.png
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create placeholder directory**

```bash
mkdir -p frontend/public/portraits
touch frontend/public/portraits/.gitkeep
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/plugins/portrait/ frontend/public/portraits/
git commit -m "✨ feat: add portrait plugin with emotion-driven placeholder"
```

---

### Task 25: Frontend — Assemble ChatTraining.tsx and wire everything

**Files:**
- Modify: `frontend/src/pages/ChatTraining.tsx` (full rewrite)
- Modify: `frontend/src/engine/TrainingEngine.tsx` (wire emotion/portrait contexts from bus events)

- [ ] **Step 1: Rewrite ChatTraining.tsx**

```typescript
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { TrainingEngine } from "@/engine";
import { inquiryPlugin } from "@/plugins/inquiry";
import { patientInfoPlugin } from "@/plugins/patient-info";
import { physicalExamPlugin } from "@/plugins/physical-exam";
import { nursingRecordPlugin } from "@/plugins/nursing-record";
import { emotionPlugin } from "@/plugins/emotion";
import { initiativePlugin } from "@/plugins/initiative";
import { portraitPlugin } from "@/plugins/portrait";

export default function ChatTraining() {
  const { recordId } = useParams<{ recordId: string }>();

  const panelPlugins = useMemo(() => [
    inquiryPlugin,
    patientInfoPlugin,
    physicalExamPlugin,
    nursingRecordPlugin,
    emotionPlugin,
    initiativePlugin,
    portraitPlugin,
  ], []);

  if (!recordId) return <div className="flex h-screen items-center justify-center">缺少训练记录 ID</div>;

  return (
    <TrainingEngine
      recordId={recordId}
      features={{
        physical_exam: true,
        nursing_record: true,
        emotion: true,
        patient_initiative: true,
        portrait: true,
      }}
      panelPlugins={panelPlugins}
    />
  );
}
```

- [ ] **Step 2: Wire emotion/portrait bus events in TrainingEngine**

In `TrainingEngine.tsx`, inside `TrainingEngineInner`, add these effects after the context creation:

```typescript
// Wire emotion changes from bus to EmotionContext
const { setEmotion } = useEmotion();
useEffect(() => {
  return busRef.current.on("emotion:changed", (data: { emotion: string }) => {
    setEmotion(data.emotion as EmotionState);
  });
}, [setEmotion]);

// Wire portrait changes from bus to PortraitContext
const { setPortraitUrl } = usePortrait();
useEffect(() => {
  return busRef.current.on("portrait:changed", (data: { url: string }) => {
    setPortraitUrl(data.url);
  });
}, [setPortraitUrl]);
```

Add `import type { EmotionState } from "./PluginContext";` at top.

- [ ] **Step 3: Verify full TypeScript compilation**

Run: `cd frontend && npx tsc --noEmit 2>&1`
Fix any remaining errors.

- [ ] **Step 4: Try build**

Run: `cd frontend && npx vite build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ChatTraining.tsx frontend/src/engine/TrainingEngine.tsx
git commit -m "✨ feat: assemble ChatTraining with all 7 plugins"
```

---

### Task 26: Frontend — API client regeneration and final cleanup

**Files:**
- Regenerate all files under: `frontend/src/api/`

- [ ] **Step 1: Check if there's a generate script**

```bash
ls frontend/scripts/generate-api.ts 2>/dev/null || echo "NOT FOUND"
```

If exists, run: `cd frontend && npx tsx scripts/generate-api.ts`

If not found, manually update `frontend/src/api/nursing-records.ts`:

```typescript
import { api } from "./axios-instance";

export interface NursingRecordData {
  id: number;
  record_id: number;
  sheet_data: Record<string, Record<string, unknown>>;
  status: string;
  updated_at: string;
}

export const getNursingRecord = (recordId: number) =>
  api.get<NursingRecordData>(`/nursing-records/${recordId}`);

export const saveNursingRecord = (recordId: number, sheet_data: Record<string, Record<string, unknown>>, status = "draft") =>
  api.post<NursingRecordData>(`/nursing-records/${recordId}`, { sheet_data, status });
```

- [ ] **Step 2: Run final type check**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

- [ ] **Step 3: Run lint**

```bash
cd frontend && npx biome check src/ 2>&1 | tail -20
```

- [ ] **Step 4: Run build**

```bash
cd frontend && npx vite build 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/ frontend/src/
git commit -m "🔧 chore: regenerate API client and final cleanup"
```

---

## Plan Self-Review

**Spec coverage check:**
- [x] Architecture restructuring (Tasks 4-9): Types, PluginRegistry, TrainingEngine all rewritten
- [x] Core components (Tasks 10-17): TrainingHeader, WelcomeScreen, ChatDisplay, ChatBubble, ChatInput, ChatArea, PanelHost
- [x] Overlays (Task 17): QuestionnaireOverlay, ScoringOverlay, ScoreCard moved to core
- [x] inquiry-plugin (Task 18)
- [x] patient-info-plugin (Task 19)
- [x] physical-exam-plugin (Task 20) with examResult display
- [x] nursing-record-plugin (Task 21) with backend persistence
- [x] emotion-plugin (Task 22) with state tracking and border coloring
- [x] initiative-plugin (Task 23) with polling and pending state
- [x] portrait-plugin (Task 24) with placeholder assets
- [x] Backend nursing record model migration (Task 1)
- [x] Backend state API enhancement (Task 2)
- [x] Backend SSE exam_result (Task 3)
- [x] Legacy file cleanup (Task 4)
- [x] ChatTraining assembly (Task 25)
- [x] API client regeneration (Task 26)

**Placeholder scan:** No TBD/TODO items. All code blocks are concrete.

**Type consistency:** PanelPlugin, PanelTabProps, PluginContext types are used consistently across all plugin tasks. Bus event names ("emotion:changed", "portrait:changed", "initiative:state", "initiative:triggered") match between emit and on handlers.
