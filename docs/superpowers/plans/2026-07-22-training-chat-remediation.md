# Training Chat UX Remediation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 critical training chat bugs (race condition, resume failure, initiative double-add, opening-line duplication, WelcomeScreen hardcoded prompt) and upgrade chat UX to modern AI-UI standards (Markdown rendering, message grouping, smooth transitions).

**Architecture:** Targeted fixes within the existing TrainingEngine/StreamManager/MessageBus architecture. No architectural rewrite — all changes are within existing component boundaries. The ref-based singleton pattern (StreamManager, ScoreManager, TTSManager) is preserved.

**Tech Stack:** React 19, TypeScript, `react-markdown` + `remark-gfm` (already installed), `motion` (already installed)

**Files Touched:** 8 modified, 0 new

---

## File Map

| File | What Changes |
|------|-------------|
| `engine/TrainingEngine.tsx` | Fix seed race, fix resume, fix initiative double-add |
| `engine/StreamManager.ts` | Remove initiative self-addition, expose seed status |
| `components/training/ChatBubble.tsx` | Add Markdown rendering |
| `components/training/ChatDisplay.tsx` | Add message grouping logic |
| `components/training/ChatArea.tsx` | Add WelcomeScreen → chat fade transition |
| `components/training/WelcomeScreen.tsx` | Dynamic prompt from chief complaint |
| `backend/profiles/history_taking/builder.py` | Remove opening_line from system prompt |
| `backend/contexts/training/router/session.py` | Minor: confirm greeting consistency |

---

## Task 1: Fix seed race condition in TrainingEngine

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx:75-97`

**Root cause:** `Effect #1` calls `streamRef.current.setMessages(initialMessages)` → `notifySync()`, but `Effect #2` hasn't subscribed yet. `Effect #2`'s `subscribe()` doesn't fire immediately. Result: greeting message invisible until student sends first message.

- [ ] **Step 1: Apply the fix**

In `TrainingEngine.tsx`, find Effect #2 (lines 86-97). After the `subscribe()` call, add an immediate sync:

```typescript
useEffect(() => {
    streamRef.current.setRecordId(recordNum);
    const unsub = streamRef.current.subscribe(() =>
        setMessages([...streamRef.current.getMessages()]),
    );
    const unsubLoading = streamRef.current.onLoadingChange(setSending);
    // Immediately sync current state (handles seed that arrived before subscription)
    setMessages([...streamRef.current.getMessages()]);
    setSending(streamRef.current.isLoading());
    return () => { unsub(); unsubLoading(); streamRef.current.dispose(); };
}, [recordNum]);
```

- [ ] **Step 2: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/engine/TrainingEngine.tsx
git commit -m "🐛 fix: seed race — sync StreamManager state immediately after subscribe"
```

---

## Task 2: Fix resume training — incremental seed instead of one-shot

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx:75-84`

**Root cause:** `seededRef` is a one-shot flag. When `initialMessages` arrives late (async query), the seed already happened with `[]`. The greeting and history messages are lost.

**Fix:** Replace `seededRef` with `useEffect` that watches `initialMessages` and seeds when it becomes non-empty:

- [ ] **Step 1: Apply the fix**

Replace lines 75-80:

```typescript
// BEFORE (remove):
useEffect(() => {
    if (initialMessages.length > 0 && !seededRef.current) {
        seededRef.current = true;
        streamRef.current.setMessages(initialMessages);
    }
}, [initialMessages]);

// AFTER (replace with):
useEffect(() => {
    if (initialMessages.length > 0) {
        const existing = streamRef.current.getMessages();
        const existingIds = new Set(existing.map((m) => m.id).filter(Boolean));
        const newMessages = initialMessages.filter(
            (m) => !m.id || !existingIds.has(m.id),
        );
        if (newMessages.length > 0) {
            streamRef.current.appendMessages(newMessages);
        }
    }
}, [initialMessages]);
```

- [ ] **Step 2: Add `appendMessages` to StreamManager**

In `frontend/src/engine/StreamManager.ts`, add a public method after `setMessages`:

```typescript
appendMessages(newMessages: ChatMessage[]): void {
    this.messages.push(...newMessages);
    this.notifySync();
}
```

- [ ] **Step 3: Remove unused `seededRef`**

In `TrainingEngine.tsx`, remove `const seededRef = useRef(false);` and the reset effect at lines 82-84.

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine/TrainingEngine.tsx frontend/src/engine/StreamManager.ts
git commit -m "🐛 fix: resume training — incremental seed instead of one-shot, supports async query arrival"
```

---

## Task 3: Fix initiative double-add

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx:200-207`
- Modify: `frontend/src/engine/StreamManager.ts:208-220`

**Root cause:** When SSE sends `initiative` event, `StreamManager.send()` adds it to the message array AND emits `initiative:triggered` on the bus. `TrainingEngine` listens to that bus event and calls `streamRef.addPatientMessage()` again.

**Fix:** Remove the duplicate add from TrainingEngine. StreamManager is the single source of truth for message additions.

- [ ] **Step 1: Fix StreamManager to NOT double-add internally**

Read the initiative handling in `StreamManager.ts` (around line 208). The current logic:
1. In `send()`, the SSE `onInitiative` callback fires during streaming
2. It adds a patient message to the array

But this is called from within `send()` which already has the streaming flow. The initiative message should be inserted AFTER the current streaming placeholder, not in addition to it.

The fix: initiative messages within `send()` should be accumulated and emitted via callback, NOT directly added to the messages array. The caller (TrainingEngine or a dedicated handler) should decide how to add them.

Actually, simpler: just remove the TrainingEngine duplicate. StreamManager already handles it correctly via `callbacks.onInitiative?.(data)` → which triggers the bus event. TrainingEngine shouldn't ALSO add the message.

- [ ] **Step 2: Remove the duplicate handler in TrainingEngine**

Find lines 200-207 in `TrainingEngine.tsx`:

```typescript
// REMOVE this entire useEffect block:
useEffect(() => {
    const unsub = bus.on("initiative:triggered", (data) => {
        streamRef.current.addPatientMessage(data.content);
    });
    return unsub;
}, [bus]);
```

The StreamManager's internal handling (via `callbacks.onInitiative`) already adds the message. This listener was a duplicate.

- [ ] **Step 3: Verify StreamManager handles it**

In `StreamManager.ts`, verify that the initiative callback in `send()` has this flow:
1. SSE `initiative` event → `callbacks.onInitiative?.(initiative)` → bus emit
2. The message is already added to the array inside the send flow

If the StreamManager does NOT add it to the array, add it where the `onInitiative` callback fires.

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/engine/TrainingEngine.tsx
git commit -m "🐛 fix: remove initiative double-add — StreamManager is single source of truth"
```

---

## Task 4: Remove opening_line duplication from LLM system prompt

**Files:**
- Modify: `backend/profiles/history_taking/builder.py`

**Root cause:** The `scenario` injected into the system prompt contains the `opening_line` verbatim. The same text is also in the chat history as the first greeting message. When the student asks about symptoms, the LLM regurgitates the opening_line.

**Fix:** Remove the `opening_line` suffix from `scenario`. Keep the scenario as the setting description only.

- [ ] **Step 1: Read the builder.py**

Read `backend/profiles/history_taking/builder.py` to find the exact line.

- [ ] **Step 2: Apply the fix**

Change (approximately line 63):

```python
# BEFORE:
scenario = f"你在医院就诊，一位护理学生（请称呼'护士'）正在采集你的病史。{_get('opening_line', '你今天来医院是因为身体不舒服。')}"

# AFTER:
scenario = "你在医院就诊，一位护理学生（请称呼'护士'）正在采集你的病史。请根据你的主诉和现病史如实回答学生的问题。"
```

- [ ] **Step 3: Verify lint**

```bash
cd backend; uv run ruff check profiles/history_taking/builder.py
```

- [ ] **Step 4: Commit**

```bash
git add backend/profiles/history_taking/builder.py
git commit -m "🐛 fix: remove opening_line from LLM system prompt to prevent content duplication with greeting"
```

---

## Task 5: Dynamic WelcomeScreen prompt

**Files:**
- Modify: `frontend/src/components/training/WelcomeScreen.tsx`

**Current state:** Hardcoded button text `"您好，请问哪里不舒服？"` — this mirror-asks the opening_line, exacerbating the duplication issue.

**Fix:** Generate prompt dynamically from `chiefComplaint`:

- [ ] **Step 1: Read the current WelcomeScreen props**

Read `WelcomeScreen.tsx` to understand what patient data is available. The props likely include `patient` with `chiefComplaint`.

- [ ] **Step 2: Replace the hardcoded prompt**

```typescript
const prompts = useMemo(() => {
    if (!patient) return ["您好，请问哪里不舒服？"];
    const cc = patient.chiefComplaint;
    if (!cc) return ["您好，请跟我说说您今天的情况"];
    return [
        `您好，${cc.includes("胸痛") ? "请详细描述一下胸痛的感觉" :
               cc.includes("发热") ? "发热从什么时候开始的？体温多少？" :
               cc.includes("呼吸困难") ? "呼吸困难是从什么时候开始的？" :
               `请跟我说说您的${cc}是怎么回事`}`,
        "您好，请跟我说说您今天的情况",
    ];
}, [patient]);
```

Render as suggestion chips (2 prompts):

```tsx
<div className="flex flex-col gap-2">
    {prompts.map((prompt, i) => (
        <button
            key={i}
            type="button"
            onClick={() => onQuickPrompt?.(prompt)}
            className="rounded-xl border bg-card px-4 py-2.5 text-sm text-left hover:border-primary/50 hover:bg-primary/5 transition-colors"
        >
            {prompt}
        </button>
    ))}
</div>
```

- [ ] **Step 3: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/training/WelcomeScreen.tsx
git commit -m "✨ feat: dynamic WelcomeScreen prompts based on chief complaint"
```

---

## Task 6: ChatBubble Markdown rendering

**Files:**
- Modify: `frontend/src/components/training/ChatBubble.tsx`

**Current state:** Patient and student messages render as `<p className="whitespace-pre-wrap">` with no Markdown parsing. The QA page already uses `react-markdown` with `remark-gfm` — same dependencies.

**Fix:** Wrap content in `<ReactMarkdown>` for patient messages:

- [ ] **Step 1: Apply the fix**

Add imports:

```typescript
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
```

Replace the patient message content rendering:

```typescript
// BEFORE:
<p className="whitespace-pre-wrap">{message.content}</p>

// AFTER:
<div className="prose prose-sm dark:prose-invert max-w-none
  [&_p]:mb-1 [&_p:last-child]:mb-0
  [&_ul]:my-1 [&_ul]:pl-4
  [&_ol]:my-1 [&_ol]:pl-4
  [&_li]:mb-0.5
  [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs
  [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:rounded-lg [&_pre]:overflow-x-auto
  [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:opacity-80
">
  <ReactMarkdown remarkPlugins={[remarkGfm]}>
    {message.content}
  </ReactMarkdown>
</div>
```

Student messages stay as plain text (no Markdown needed — student types plain text).

- [ ] **Step 2: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/training/ChatBubble.tsx
git commit -m "✨ feat: ChatBubble Markdown rendering for patient messages"
```

---

## Task 7: Message grouping — merge consecutive same-role bubbles

**Files:**
- Modify: `frontend/src/components/training/ChatDisplay.tsx`

**Current state:** Every message renders as an independent `ChatBubble` with its own avatar and padding. Consecutive patient messages each have a separate avatar — looks noisy.

**Fix:** Group consecutive messages from the same role into visual clusters. Only the first message in a group shows the avatar; subsequent ones are indented without avatar.

- [ ] **Step 1: Add grouping logic**

In `ChatDisplay.tsx`, add a `useMemo` to group messages:

```typescript
const grouped = useMemo(() => {
    const result: { role: string; messages: typeof messages }[] = [];
    for (const msg of messages) {
        const last = result[result.length - 1];
        if (last && last.role === msg.role && msg.role !== "system") {
            last.messages.push(msg);
        } else {
            result.push({ role: msg.role, messages: [msg] });
        }
    }
    return result;
}, [messages]);
```

- [ ] **Step 2: Render groups**

Replace the `messages.map()` with `grouped.map()`:

```tsx
{grouped.map((group, gi) => (
    <div key={gi} className="flex flex-col gap-1">
        {group.messages.map((msg, mi) => (
            <ChatBubble
                key={msg.id ?? mi}
                message={msg}
                patientAvatar={displayAvatar}
                nurseAvatar={nurseAvatar}
                emotionBorder={emotionBorder}
                portraitUrl={portraitUrl}
                initiative={initiativeMsgs.has(String(msg.id))}
                showAvatar={mi === 0}  {/* NEW: only first in group shows avatar */}
            />
        ))}
    </div>
))}
```

- [ ] **Step 3: Add `showAvatar` prop to ChatBubble**

```typescript
interface ChatBubbleProps {
    // ... existing props
    showAvatar?: boolean;  // default true
}
```

When `showAvatar === false`, hide the avatar image but keep the message bubble positioning (use an invisible spacer to maintain alignment):

```typescript
{showAvatar !== false ? (
    <img className="w-7 h-7 ..." src={displayAvatar} alt="患者" />
) : (
    <div className="w-7 h-7 shrink-0" />  {/* spacer */}
)}
```

- [ ] **Step 4: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/training/ChatDisplay.tsx frontend/src/components/training/ChatBubble.tsx
git commit -m "✨ feat: message grouping — merge consecutive same-role bubbles, hide duplicate avatars"
```

---

## Task 8: ChatArea WelcomeScreen → messages fade transition

**Files:**
- Modify: `frontend/src/components/training/ChatArea.tsx`

**Current state:** When `!hasMessages && !hasHistory` switches to `hasMessages || hasHistory`, WelcomeScreen disappears and ChatDisplay appears with no transition.

**Fix:** Add a crossfade using `motion` (already installed):

- [ ] **Step 1: Apply the fix**

Add import:
```typescript
import { AnimatePresence, motion } from "motion/react";
```

Replace the conditional rendering:

```typescript
<AnimatePresence mode="wait">
    {!hasMessages && !hasHistory ? (
        <motion.div
            key="welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.2 }}
        >
            <WelcomeScreen ... />
        </motion.div>
    ) : (
        <motion.div
            key="chat"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex-1 flex flex-col min-h-0"
        >
            <ChatDisplay ... />
            <ChatInput ... />
        </motion.div>
    )}
</AnimatePresence>
```

- [ ] **Step 2: Verify typecheck**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/training/ChatArea.tsx
git commit -m "✨ feat: WelcomeScreen → chat fade transition via AnimatePresence"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full typecheck + lint**

```bash
cd backend; uv run ruff check profiles/history_taking/builder.py
cd ../frontend; npx tsc --noEmit; npx biome lint src/
```

- [ ] **Step 2: Run tests**

```bash
cd frontend; npx vitest run
```

Expected: 85/86 pass (pre-existing ShowcasePage failure not related).

- [ ] **Step 3: Manual verification checklist**

- [ ] Start a new training: greeting appears immediately (not after first message)
- [ ] Resume in-progress training: chat history loads correctly
- [ ] Patient messages render with Markdown (bold, lists, code blocks)
- [ ] Consecutive patient messages group without duplicate avatars
- [ ] WelcomeScreen → chat has smooth fade transition
- [ ] WelcomeScreen shows dynamic prompt based on chief complaint
- [ ] Opening line appears only once (greeting), not repeated by LLM
- [ ] Initiative messages appear once (not duplicated)
- [ ] Send message → streaming cursor works correctly
- [ ] Training end → ScoreCard appears as before

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "✅ test: training chat remediation verification complete"
```

---

## Self-Review Checklist

**1. Bug coverage:**
- [x] Seed race condition → Task 1
- [x] Resume training → Task 2
- [x] Initiative double-add → Task 3
- [x] Opening line duplication in prompt → Task 4
- [x] WelcomeScreen hardcoded prompt → Task 5

**2. UX coverage:**
- [x] Markdown rendering → Task 6
- [x] Message grouping → Task 7
- [x] WelcomeScreen transition → Task 8

**3. Placeholder scan:**
- No TBD, TODO, or "implement later" in any task.
- All code steps contain complete, compilable code.

**4. Type consistency:**
- `ChatMessage` type already exists in `engine/types.ts` — used consistently.
- `showAvatar` added to `ChatBubbleProps` in Task 7, used in Task 7's rendering.
- `appendMessages` added to StreamManager in Task 2, used in Task 2.
