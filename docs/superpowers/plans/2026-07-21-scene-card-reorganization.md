# Scene Card System Reorganization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize scene card data access to a single channel (typed props), eliminate WebSocket backdoor, delete dead code, and unify duplicated maps.

**Architecture:** `TrainingContext` gains a `recordDetail` field (already fetched by TrainingEngine). Cards receive it via `SceneCardProps` — no more duplicate `getRecordDetail` calls. PhysicalExam requests go through `bus.emit("exam:request")` → `useExamBridge` bridges to WS singleton. Dead protocol events, dead props, and dead files are removed.

**Tech Stack:** React 19, TypeScript, TanStack Query, MessageBus

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `frontend/src/engine/TrainingContext.ts` | Modify | Add `recordDetail` field |
| `frontend/src/engine/TrainingEngine.tsx` | Modify | Pass recordDetail to context |
| `frontend/src/engine/scene-card.ts` | Modify | Remove `mode`, add `recordDetail` |
| `frontend/src/engine/scene-state.ts` | Modify | Delete dead events, `emitSceneEvent` |
| `frontend/src/engine/MessageBus.ts` | Modify | Add `exam:request` event |
| `frontend/src/engine/types.ts` | Modify | Add `TrainingRecordDetail` type |
| `frontend/src/components/training/SceneRenderer.tsx` | Modify | Pass recordDetail, extract shared icons |
| `frontend/src/components/training/SceneToolbar.tsx` | Modify | Pass recordDetail, remove TITLES/ICONS dup |
| `frontend/src/components/training/scene-cards/registry.ts` | Modify | Export shared CARD_META (icons+titles) |
| `frontend/src/components/training/scene-cards/PhysicalAssessmentCard.tsx` | Modify | Bus-based exam, remove WS direct, use recordDetail |
| `frontend/src/components/training/scene-cards/NursingRecordCard.tsx` | Modify | Typed API, unify save paths, remove raw client |
| `frontend/src/components/training/scene-cards/InquiryCard.tsx` | Modify | Use recordDetail from props |
| `frontend/src/components/training/scene-cards/PatientInfoCard.tsx` | Modify | Use recordDetail from props |
| `frontend/src/components/training/panels/MewsPanel.tsx` | Modify | Use recordDetail from props |
| `frontend/src/hooks/useExamBridge.ts` | Modify | Bridge `exam:request` bus→WS + WS→bus |
| `frontend/src/components/training/TrainingConfigSheet.tsx` | **Delete** | Orphaned component |
| `frontend/src/components/training/scenes/scene-registry.ts` | Modify | Delete `KnownTrainingType` |
| `sandbox/src/scene-card.ts` | **Delete** | Duplicate of engine/scene-card.ts |
| `backend/contexts/training/router/scoring.py` | Modify | Delete dead `_check_scoring_threshold` + imports |
| `backend/core/config.py` | Modify | Delete unused `AUTO_SCORE_*` constants |

---

### Task 1: Delete Dead Code (Frontend Files)

- [ ] **Step 1: Delete orpahned TrainingConfigSheet.tsx**

```bash
git rm frontend/src/components/training/TrainingConfigSheet.tsx
```

- [ ] **Step 2: Delete duplicate sandbox/src/scene-card.ts**

```bash
git rm sandbox/src/scene-card.ts
```

- [ ] **Step 3: Delete unused KnownTrainingType export**

In `frontend/src/components/training/scenes/scene-registry.ts`, remove lines 10-11:

```typescript
// DELETE these two lines:
export type KnownTrainingType = keyof typeof SCENE_REGISTRY;
```

And remove the `KnownTrainingType` reference from line 13 (the `type: KnownTrainingType` annotation on `SceneEntry` — just remove the annotation or change to `string`).

- [ ] **Step 4: Verify no imports reference deleted files**

```bash
rg "TrainingConfigSheet" frontend/src/ --type ts
rg "sandbox/src/scene-card" sandbox/src/ --type ts
```

Expected: zero matches.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "🔥 remove: dead TrainingConfigSheet, sandbox scene-card dup, KnownTrainingType"
```

---

### Task 2: Delete Dead Code (Backend)

- [ ] **Step 1: Delete dead `_check_scoring_threshold` function and related config**

In `backend/contexts/training/router/scoring.py`, delete lines 47-59 (the function definition):

```python
# DELETE the entire function (lines 47-59):
def _check_scoring_threshold(db: Session, record_id: int) -> str | None:
    student_msgs = db.query(Message).filter(Message.record_id == record_id, Message.role == "student").all()
    ...
    return None
```

Also remove the import of `AUTO_SCORE_STUDENT_CHARS_MIN` and `AUTO_SCORE_STUDENT_MSG_MIN` from the imports (lines 12-14):

```python
# REMOVE these two lines from the import block:
    AUTO_SCORE_STUDENT_CHARS_MIN,
    AUTO_SCORE_STUDENT_MSG_MIN,
```

In `backend/core/config.py`, delete lines 117-118:

```python
# DELETE these two lines:
AUTO_SCORE_STUDENT_MSG_MIN = int(os.getenv("AUTO_SCORE_STUDENT_MSG_MIN", "3"))
AUTO_SCORE_STUDENT_CHARS_MIN = int(os.getenv("AUTO_SCORE_STUDENT_CHARS_MIN", "200"))
```

- [ ] **Step 2: Run backend tests**

```bash
cd backend && uv run python -m pytest tests/scoring/ -x -q
```

Expected: all pass (no tests reference these constants anymore).

- [ ] **Step 3: Run ruff + ty check**

```bash
cd backend && uv run ruff check && uv run ty check
```

Expected: all pass, no unused import warnings.

- [ ] **Step 4: Commit**

```bash
git add backend/contexts/training/router/scoring.py backend/core/config.py
git commit -m "🔥 remove: dead _check_scoring_threshold and AUTO_SCORE config constants"
```

---

### Task 3: Delete Dead Bus Events + emitSceneEvent

- [ ] **Step 1: Clean up scene-state.ts**

In `frontend/src/engine/scene-state.ts`, delete the dead events and function:

Remove lines 35-49 (the `SceneBusProtocol` interface and `emitSceneEvent` function — they are never used by any card):

```typescript
// REMOVE lines 33-49 entirely:
/** Bus protocol: well‑typed scene ↔ host events */
export interface SceneBusProtocol {
  "scene:interaction": [{ hotspotId: string; metadata?: Record<string, unknown> }];
  "scene:state":      [Partial<SceneState>];
  "scene:load":       [{ dsl: unknown }];
  "scene:exam":       [{ op_type: string; value: string; label?: string; unit?: string }];
  "tts:degraded":     [{ provider: string }];
}

/** Emit a scene event with correct payload type. */
export function emitSceneEvent<K extends keyof SceneBusProtocol>(
  bus: MessageBus,
  event: K,
  ...args: SceneBusProtocol[K]
): void {
  bus.emit(event, ...(args as unknown[]));
}
```

Keep the `SceneProps` and `SceneState` interfaces — they are still used by `SceneStateProvider`.

- [ ] **Step 2: Verify no imports reference deleted items**

```bash
rg "emitSceneEvent\|SceneBusProtocol\|scene:interaction\|scene:load\|tts:degraded" frontend/src/ --type ts
```

Expected: zero matches in source files (may appear in docs which is fine).

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/engine/scene-state.ts
git commit -m "🔥 remove: dead SceneBusProtocol events and emitSceneEvent"
```

---

### Task 4: Hoist recordDetail to TrainingContext + SceneCardProps

- [ ] **Step 1: Add `recordDetail` to TrainingContextValue**

In `frontend/src/engine/TrainingContext.ts`, add the new field:

```typescript
import type { ChatMessage, MessageBus, PatientData } from "./types";

export interface TrainingRecordDetail {
  case_data?: Record<string, unknown>;
  exam_results?: Array<{ type: string; value: string; label?: string; unit?: string }>;
  required_inquiries?: string[];
  triage_result?: Record<string, unknown>;
  sheet_data?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TrainingContextValue {
  bus: MessageBus;
  recordId: string;
  trainingType: string;
  patient: PatientData;
  messages: ChatMessage[];
  features: Record<string, boolean>;
  recordDetail: TrainingRecordDetail | null;
  ttsAutoPlay: boolean;
  sending: boolean;
  timeLimitMinutes: number;
  remainingSeconds: number | null;
  voiceStatus: { provider: string; latencyMs: number } | null;
  toggleTts: () => void;
  endTraining: () => Promise<void>;
}
```

Also add `recordDetail: null` to the default context value on line 22-31.

- [ ] **Step 2: Pass recordDetail from TrainingEngine to context**

In `frontend/src/engine/TrainingEngine.tsx`, find where the context value is constructed. Add `recordDetail` field. The TrainingEngine already calls `useTrainingRecord(recordId)` which returns `data` containing the full record. Pass it through:

```typescript
// In TrainingEngine.tsx, inside the context value object, add:
recordDetail: data as TrainingRecordDetail | null,
```

Import `TrainingRecordDetail` from `./TrainingContext`.

- [ ] **Step 3: Update SceneCardProps to include recordDetail**

In `frontend/src/engine/scene-card.ts`, modify:

```typescript
import type { ComponentType } from "react";
import type { MessageBus } from "./types";
import type { TrainingRecordDetail } from "./TrainingContext";

export interface SceneCard {
  id: string;
  component: ComponentType<SceneCardProps>;
  featureFlag?: string;
  priority: number;
}

export interface SceneCardProps {
  bus: MessageBus;
  recordId: string;
  recordDetail: TrainingRecordDetail | null;
}
```

Remove `mode: "sandbox" | "training"` — it was dead code (zero cards use it).

- [ ] **Step 4: Update SceneRenderer to pass recordDetail**

In `frontend/src/components/training/SceneRenderer.tsx`:

```typescript
// Change the context consumption to include recordDetail:
const { bus, features, recordId, trainingType, recordDetail } = useTrainingContext();

// Update cardProps:
const cardProps: SceneCardProps = { bus, recordId, recordDetail };
```

- [ ] **Step 5: Update SceneToolbar to pass recordDetail**

In `frontend/src/components/training/SceneToolbar.tsx`:

```typescript
// Change context consumption:
const { bus, features, trainingType, recordId, recordDetail } = useTrainingContext();

// Update cardProps:
const cardProps: SceneCardProps = { bus, recordId, recordDetail };
```

- [ ] **Step 6: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: type errors in scene cards that still reference `mode` — will be fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "♻️ refactor: hoist recordDetail to TrainingContext, remove dead mode prop"
```

---

### Task 5: Extract Shared CARD_META from Registry

- [ ] **Step 1: Add CARD_META to registry.ts**

In `frontend/src/components/training/scene-cards/registry.ts`, add after the imports:

```typescript
export const CARD_META: Record<string, { icon: string; title: string }> = {
  "patient-info":   { icon: "👤", title: "患者信息" },
  "inquiry":        { icon: "📋", title: "问诊指引" },
  "physical-exam":  { icon: "💓", title: "护理查体" },
  "nursing-record": { icon: "📄", title: "护理记录" },
  "mews":           { icon: "📊", title: "MEWS 评分" },
};
```

- [ ] **Step 2: Update SceneRenderer to use CARD_META**

In `frontend/src/components/training/SceneRenderer.tsx`, replace the local `ICONS` map:

```typescript
// REMOVE:
const ICONS: Record<string, string> = { ... };

// REPLACE with import:
import { CARD_META } from "./scene-cards/registry";

// Update usage: ICONS[card.id] → CARD_META[card.id]?.icon
// Update usage: ALL_CAPABILITIES[activeCard.featureFlag]?.label → CARD_META[activeCard.id]?.title
```

Also update the icon bar rendering (line 86):
```tsx
<span className="text-sm">{CARD_META[card.id]?.icon ?? "◻"}</span>
```

And the panel header (line 103):
```tsx
{CARD_META[activeCard.id]?.icon ?? "◻"} {CARD_META[activeCard.id]?.title ?? activeCard.id}
```

And the error fallback (line 127):
```tsx
{CARD_META[activeCard.id]?.title ?? activeCard.id}
```

- [ ] **Step 3: Update SceneToolbar to use CARD_META**

In `frontend/src/components/training/SceneToolbar.tsx`, replace `ICONS` and `TITLES`:

```typescript
// REMOVE both:
const ICONS: Record<string, string> = { ... };
const TITLES: Record<string, string> = { ... };

// REPLACE with import:
import { CARD_META } from "./scene-cards/registry";

// Update usages:
// ICONS[card.id] → CARD_META[card.id]?.icon
// TITLES[card.id] → CARD_META[card.id]?.title
```

- [ ] **Step 4: Typecheck + lint**

```bash
cd frontend && npx tsc --noEmit && npx biome check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/training/scene-cards/registry.ts frontend/src/components/training/SceneRenderer.tsx frontend/src/components/training/SceneToolbar.tsx
git commit -m "♻️ refactor: extract shared CARD_META, eliminate duplicate ICONS/TITLES"
```

---

### Task 6: Eliminate WS Backdoor — Bus-Based Exam Requests

- [ ] **Step 1: Add `exam:request` to BusEvents**

In `frontend/src/engine/MessageBus.ts`, add the event type:

```typescript
// Add to the BusEvents interface:
"exam:request": [number, string]; // [recordId, opType]
```

- [ ] **Step 2: Bridge exam:request in useExamBridge**

Rewrite `frontend/src/hooks/useExamBridge.ts`:

```typescript
import { useEffect, useRef } from "react";
import type { MessageBus } from "@/engine/types";
import { useTrainingWS } from "./useTrainingWS";

export function useExamBridge(bus: MessageBus) {
  const { sendExam } = useTrainingWS();

  useEffect(() => {
    const onExamRequest = (recordId: number, opType: string) => {
      sendExam(recordId, opType);
    };
    bus.on("exam:request", onExamRequest);
    return () => { bus.off("exam:request", onExamRequest); };
  }, [bus, sendExam]);

  useTrainingWS((msg) => {
    const m = msg as unknown as {
      type: string;
      op_type?: string;
      data?: { value: string; label?: string; unit?: string };
      scene?: Partial<import("@/engine/scene-state").SceneState>;
    };
    if (m.type === "exam:done") {
      if (m.scene) bus.emit("scene:state", m.scene);
      if (m.op_type && m.data?.value) {
        bus.emit("scene:exam", {
          op_type: m.op_type,
          value: m.data.value,
          label: m.data.label,
          unit: m.data.unit,
        });
      }
    }
  });
}
```

- [ ] **Step 3: Update PhysicalAssessmentCard to use bus instead of WS directly**

In `frontend/src/components/training/scene-cards/PhysicalAssessmentCard.tsx`:

Remove the `useTrainingWS` import and usage. Replace with:

```typescript
// REMOVE:
import { useTrainingWS } from "@/hooks/useTrainingWS";
const { sendExam } = useTrainingWS(onWSMessage);

// REPLACE with bus.emit:
// In the button handler (around line 150), replace:
// sendExam(Number(props.recordId), opId);
// with:
bus.emit("exam:request", Number(props.recordId), opId);

// Replace the WS listener (useTrainingWS(onWSMessage)) with bus listener:
useEffect(() => {
  const handler = (data: { op_type: string; value: string; label?: string; unit?: string }) => {
    setResults(prev => {
      const next = new Map(prev);
      next.set(data.op_type, `${data.value}${data.unit ? ` ${data.unit}` : ""}`);
      return next;
    });
    if (data.op_type) setSelected((s: string | null) => s);
  };
  bus.on("scene:exam", handler);
  return () => { bus.off("scene:exam", handler); };
}, [bus]);

// Remove the examTimersRef setTimeout map — use a simpler per-op timeout:
// Instead of a ref map, store pending ops in a Set<string> ref
const pendingRef = useRef<Set<string>>(new Set());
// Clear pending on unmount — no timeouts needed
```

The key change: instead of `sendExam(rid, opId)` directly calling the WS singleton, the card emits `bus.emit("exam:request", rid, opId)`. `useExamBridge` intercepts this and forwards it to the WS. WS responses come back through `bus.emit("scene:exam", ...)` which the card listens to.

Also replace the `getRecordDetail` query with `props.recordDetail`:

```typescript
// REMOVE:
const { data: record } = useQuery({ queryKey: queryKeys.training.detail(props.recordId), ... });

// REPLACE with:
const recordDetail = props.recordDetail;
const priorResults = (recordDetail?.exam_results as Array<{ type: string; value: string }>) ?? [];
```

- [ ] **Step 4: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useExamBridge.ts frontend/src/components/training/scene-cards/PhysicalAssessmentCard.tsx frontend/src/engine/MessageBus.ts
git commit -m "♻️ refactor: bus-based exam requests, eliminate WS backdoor from PhysicalAssessmentCard"
```

---

### Task 7: Normalize Cards to Use recordDetail Props

- [ ] **Step 1: Update InquiryCard**

In `frontend/src/components/training/scene-cards/InquiryCard.tsx`:

```typescript
// REMOVE the useQuery + getRecordDetail block (approximately lines 12-21)
// REMOVE useTrainingContext import (it's reading messages)
// Instead, read from props:

import type { SceneCardProps } from "@/engine/scene-card";

export default function InquiryCard(props: SceneCardProps) {
  const recordDetail = props.recordDetail;
  const cd = (recordDetail?.case_data as Record<string, unknown>) ?? {};
  const requiredInquiries = (cd.required_inquiries as string[]) ?? [];
  // ... rest of component
}
```

Wait — InquiryCard also uses `useTrainingContext` to read `messages` for checking keyword coverage. Keep that — messages are per-turn dynamic and not in recordDetail.

```typescript
// KEEP:
import { useTrainingContext } from "@/engine/TrainingContext";
const { messages } = useTrainingContext();

// REPLACE (remove getRecordDetail call):
// Just use props.recordDetail for static case data
```

- [ ] **Step 2: Update PatientInfoCard**

In `frontend/src/components/training/scene-cards/PatientInfoCard.tsx`:

```typescript
// REMOVE:
import { useQuery } from "@tanstack/react-query";
import { getRecordDetail } from "@/api/training";
import { queryKeys } from "@/api/query-keys";

// The ~20 lines of useQuery + data extraction...

// REPLACE with:
import type { SceneCardProps } from "@/engine/scene-card";

export default function PatientInfoCard(props: SceneCardProps) {
  const cd = (props.recordDetail?.case_data as Record<string, unknown>) ?? {};
  const patient = (cd.patient_info as Record<string, unknown>) ?? {};
  // ... rest uses cd.* directly
}
```

- [ ] **Step 3: Update MewsPanel**

In `frontend/src/components/training/panels/MewsPanel.tsx`:

```typescript
// REMOVE the useQuery + getRecordDetail block (~lines 34-52)
// REPLACE with props.recordDetail:
const triageResult = (props.recordDetail?.triage_result as Record<string, unknown>) ?? null;
```

- [ ] **Step 4: Update NursingRecordCard — typed API + recordDetail**

In `frontend/src/components/training/scene-cards/NursingRecordCard.tsx`:

Replace raw `api.get/api.post` with:
```typescript
import { getNursingRecord, saveNursingRecord } from "@/api/training";

// Replace:
// api.get(`/nursing-records/${props.recordId}`)
// with:
// getNursingRecord(Number(props.recordId))

// Replace:
// api.post(`/nursing-records/${props.recordId}`, body)
// with:
// saveNursingRecord(Number(props.recordId), body)
```

Check if `getNursingRecord` and `saveNursingRecord` exist in `@/api/training`. If not, add them:

```typescript
// In frontend/src/api/training.ts, add:
import type { ApiPath } from "@/api/api-types.gen";

const NURSING_RECORD = "/nursing-records/{record_id}" satisfies ApiPath;

export function getNursingRecord(recordId: number) {
  return api.get(NURSING_RECORD.replace("{record_id}", String(recordId)));
}

export function saveNursingRecord(recordId: number, data: { sheet_data: Record<string, unknown>; status?: string }) {
  return api.post(NURSING_RECORD.replace("{record_id}", String(recordId)), data);
}
```

Also seed initial sheet_data from `props.recordDetail?.sheet_data` if available, avoiding the initial fetch for existing data.

Unify the two save paths (auto-save + manual save) — both should use the same mutation with `queryClient.invalidateQueries`.

- [ ] **Step 5: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/training/scene-cards/InquiryCard.tsx frontend/src/components/training/scene-cards/PatientInfoCard.tsx frontend/src/components/training/panels/MewsPanel.tsx frontend/src/components/training/scene-cards/NursingRecordCard.tsx frontend/src/api/training.ts
git commit -m "♻️ refactor: normalize scene cards to use props.recordDetail, typed API for nursing"
```

---

### Task 8: Clean Up Remaining Imports & Verify

- [ ] **Step 1: Remove unused imports from cards**

Check each card for imports that are no longer needed after the refactor:
- `@tanstack/react-query` / `useQuery` — removed from InquiryCard, PatientInfoCard, MewsPanel, PhysicalAssessmentCard
- `@/api/query-keys` — removed where no longer used
- `@/api/training` `getRecordDetail` — removed from individual cards (still imported by TrainingEngine)
- `@/hooks/useTrainingWS` — removed from PhysicalAssessmentCard
- `@/api/client` `api` — removed from NursingRecordCard (switched to typed)

Run: `rg "getRecordDetail\|useTrainingWS\|from '@/api/client'" frontend/src/components/training/ --type ts`
Verify only expected locations remain.

- [ ] **Step 2: Run full frontend checks**

```bash
cd frontend && npx tsc --noEmit
cd frontend && npx biome check
```

- [ ] **Step 3: Run backend checks**

```bash
cd backend && uv run ruff check && uv run ty check
cd backend && uv run python -m pytest tests/training/ tests/scoring/ -x -q
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "🔧 chore: final cleanup — unused imports, typecheck, lint"
```

---

### Task 9: Regenerate Frontend Capabilities

- [ ] **Step 1: Regenerate capabilities.gen.ts from updated backend**

```bash
pnpm run api:update
```

This synchronizes the "6态" description from backend to frontend.

- [ ] **Step 2: Verify the generated file**

Check that `frontend/src/engine/capabilities.gen.ts` line 21 now shows "6态" instead of "5态".

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/capabilities.gen.ts
git commit -m "🔧 chore: regenerate capabilities.gen.ts — 6-state emotion description"
```
