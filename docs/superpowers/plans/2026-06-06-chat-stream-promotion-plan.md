# 对话流式机制系统级推广 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提取 `useChatStream` / `useTypingFreeze` / `ChatBubble` 共享模块，重构 AdminDebugPage 和 ChatTraining 统一使用。

**Architecture:** 3 层：类型层 (`types/chat.ts`) → hooks 层 (`useChatStream`、`useTypingFreeze`) → 组件层 (`ChatBubble`)。hooks 管理消息状态和流式生命周期，通过 options 注入页面特有逻辑（voice、toast 等）。

**Tech Stack:** React 18 + TypeScript + biome lint/format + vitest

---

## 文件结构

| 操作 | 路径 | 职责 |
|------|------|------|
| 新建 | `frontend/src/types/chat.ts` | `ChatMessage` 类型定义 |
| 新建 | `frontend/src/hooks/useTypingFreeze.ts` | 打字冻结逻辑 |
| 新建 | `frontend/src/hooks/useChatStream.ts` | 流式发送/接收/消息状态管理 |
| 新建 | `frontend/src/components/ChatBubble.tsx` | 统一消息气泡渲染 |
| 修改 | `frontend/src/pages/AdminDebugPage.tsx` | 接入 hooks + ChatBubble，删除内联逻辑 |
| 修改 | `frontend/src/pages/ChatTraining.tsx` | 接入 hooks + ChatBubble，删除内联逻辑 |

---

### Task 1: 创建 `ChatMessage` 类型

**Files:**
- Create: `frontend/src/types/chat.ts`

- [ ] **Step 1: 写入类型文件**

```typescript
export interface ChatMessage {
  id?: number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/types/chat.ts
git commit -m "feat: add ChatMessage type definition"
```

---

### Task 2: 创建 `useTypingFreeze` hook

**Files:**
- Create: `frontend/src/hooks/useTypingFreeze.ts`

- [ ] **Step 1: 写入 hook**

```typescript
import { useCallback, useRef, useState } from "react";

export interface UseTypingFreezeReturn {
  typingFrozen: boolean;
  markTyping: () => void;
}

export function useTypingFreeze(freezeMs = 2000): UseTypingFreezeReturn {
  const [typingFrozen, setTypingFrozen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markTyping = useCallback(() => {
    setTypingFrozen(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setTypingFrozen(false), freezeMs);
  }, [freezeMs]);

  return { typingFrozen, markTyping };
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/hooks/useTypingFreeze.ts
git commit -m "feat: add useTypingFreeze hook"
```

---

### Task 3: 创建 `useChatStream` hook

**Files:**
- Create: `frontend/src/hooks/useChatStream.ts`
- Read ref: `frontend/src/api/api-client.ts:30-102` (sendMessageStream 签名)
- Read ref: `frontend/src/pages/AdminDebugPage.tsx:147-224` (现有 handleSend 逻辑)

- [ ] **Step 1: 写入 hook 完整实现**

```typescript
import { useCallback, useRef, useState } from "react";
import { sendMessageStream } from "@/api/api-client";
import type { ChatMessage } from "@/types/chat";

interface UseChatStreamOptions {
  onPatientChunk?: (chunk: string) => void;
  onPatientDone?: () => void;
  onError?: (err: string) => void;
  onSanitized?: (reply: string) => void;
}

export function useChatStream(recordId: number | null, options?: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const addedIdsRef = useRef<Set<number>>(new Set());

  const onPatientChunkRef = useRef(options?.onPatientChunk);
  onPatientChunkRef.current = options?.onPatientChunk;
  const onPatientDoneRef = useRef(options?.onPatientDone);
  onPatientDoneRef.current = options?.onPatientDone;
  const onErrorRef = useRef(options?.onError);
  onErrorRef.current = options?.onError;
  const onSanitizedRef = useRef(options?.onSanitized);
  onSanitizedRef.current = options?.onSanitized;

  const isOperation = useCallback(
    (content: string) => content.startsWith("/") || content.startsWith("测") || content.startsWith("观察"),
    [],
  );

  const send = useCallback(
    async (content: string) => {
      if (!recordId || loading) return;
      setLoading(true);
      addedIdsRef.current.clear();

      const op = isOperation(content);

      if (!op) {
        const studentId = Date.now();
        addedIdsRef.current.add(studentId);
        setMessages((prev) => [...prev, { id: studentId, role: "student", content }]);
      } else {
        const sysId = Date.now();
        addedIdsRef.current.add(sysId);
        setMessages((prev) => [...prev, { id: sysId, role: "system", content: `正在${content}...` }]);
      }

      if (!op) {
        const placeholderId = Date.now() + 1;
        addedIdsRef.current.add(placeholderId);
        setMessages((prev) => [...prev, { id: placeholderId, role: "patient", content: "", streaming: true }]);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await sendMessageStream(
          recordId,
          content,
          (chunk: string) => {
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]?.streaming) {
                  next[i] = { ...next[i], content: next[i].content + chunk };
                  return next;
                }
              }
              next.push({ id: Date.now(), role: "patient", content: chunk, streaming: true });
              return next;
            });
            onPatientChunkRef.current?.(chunk);
          },
          (doneId?: number) => {
            setMessages((prev) => {
              const next = [...prev];
              for (let i = next.length - 1; i >= 0; i--) {
                if (next[i]?.streaming) {
                  next[i] = { ...next[i], streaming: false, id: doneId || next[i].id };
                  return next;
                }
              }
              return next;
            });
            onPatientDoneRef.current?.();
            setLoading(false);
            if (abortRef.current === controller) abortRef.current = null;
          },
          (err: string) => {
            setMessages((prev) =>
              prev.filter((m) => !m.streaming && !addedIdsRef.current.has(m.id ?? 0)),
            );
            addedIdsRef.current.clear();
            setLoading(false);
            onErrorRef.current?.(err);
            if (abortRef.current === controller) abortRef.current = null;
          },
          (reply: string) => {
            onSanitizedRef.current?.(reply);
          },
          (sysMsg: string) => {
            setMessages((prev) => [...prev, { id: Date.now(), role: "system", content: sysMsg }]);
          },
          controller.signal,
        );
      } catch {
        setMessages((prev) =>
          prev.filter((m) => !m.streaming && !addedIdsRef.current.has(m.id ?? 0)),
        );
        addedIdsRef.current.clear();
        setLoading(false);
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [recordId, loading, isOperation],
  );

  return { messages, setMessages, send, loading, isOperation, abortRef };
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/hooks/useChatStream.ts
git commit -m "feat: add useChatStream hook"
```

---

### Task 4: 创建 `ChatBubble` 组件

**Files:**
- Create: `frontend/src/components/ChatBubble.tsx`
- Read ref: `frontend/src/pages/AdminDebugPage.tsx:327-349` (现有系统/患者/学生气泡渲染)
- Read ref: `frontend/src/pages/ChatTraining.tsx:674-701` (现有患者/学生气泡渲染)

- [ ] **Step 1: 写入组件**

```typescript
import { Info, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatMessage } from "@/types/chat";

interface ChatBubbleProps {
  message: ChatMessage;
  patientAvatar: string;
  nurseAvatar: string;
  showSpeakButton?: boolean;
  isSpeaking?: boolean;
  onSpeakToggle?: (text: string) => void;
}

export default function ChatBubble({
  message,
  patientAvatar,
  nurseAvatar,
  showSpeakButton = false,
  isSpeaking = false,
  onSpeakToggle,
}: ChatBubbleProps) {
  if (message.role === "system") {
    return (
      <div className="flex justify-center">
        <div className="flex items-start gap-2 max-w-[85%] rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
          <Info className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
          <div className="whitespace-pre-wrap leading-relaxed text-blue-800">{message.content}</div>
        </div>
      </div>
    );
  }

  if (message.role === "patient") {
    return (
      <div className="flex items-end gap-2 justify-start">
        <img
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted"
          src={patientAvatar}
          alt="患者"
        />
        <div
          className={cn(
            "max-w-[80%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl text-sm leading-relaxed break-words",
            "bg-card text-foreground border border-border rounded-bl-md",
            message.streaming && "after:content-['▎'] after:animate-pulse after:text-primary after:font-bold",
          )}
        >
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
        {showSpeakButton && !message.streaming && (
          <button
            className="w-7 h-7 rounded-md border border-border bg-card flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            onClick={() => onSpeakToggle?.(message.content)}
            title={isSpeaking ? "停止朗读" : "朗读"}
          >
            {isSpeaking ? <VolumeX size={13} /> : <Volume2 size={13} />}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2 justify-end">
      <div
        className={cn(
          "max-w-[80%] sm:max-w-[70%] px-3.5 py-2.5 sm:px-4 sm:py-2.5 rounded-2xl rounded-br-md text-sm leading-relaxed break-words",
          "bg-primary text-primary-foreground",
          message.streaming && "after:content-['|'] after:animate-pulse",
        )}
      >
        {message.content || (message.streaming ? "" : "")}
      </div>
      <img
        className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover shrink-0 bg-muted"
        src={nurseAvatar}
        alt="护士"
      />
    </div>
  );
}
```

注意：患者气泡和护士气泡放在同一个文件，因为它们是紧密耦合的对话渲染单元。

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/ChatBubble.tsx
git commit -m "feat: add ChatBubble component"
```

---

### Task 5: 重构 `AdminDebugPage` 接入共享模块

**Files:**
- Modify: `frontend/src/pages/AdminDebugPage.tsx`

这是一次完整的替换：删除内联的消息类型、handleSend 逻辑、气泡渲染 JSX，替换为 hooks + ChatBubble。

- [ ] **Step 1: 替换 imports 和移除 ChatMessage 内联定义**

删除第 26-31 行的 `interface ChatMessage`，新增 imports：

```typescript
// 新增
import { sendMessageStream } from "@/api/api-client";  // 删除此行 —— 页面不再直接调用
import ChatBubble from "@/components/ChatBubble";
import { useChatStream } from "@/hooks/useChatStream";
import { useTypingFreeze } from "@/hooks/useTypingFreeze";
import type { ChatMessage } from "@/types/chat";
```

具体操作：将如下旧 imports：
```typescript
import { endTraining, getCases, getTrainingState, sendMessageStream, startTraining, triggerInitiative, updateTrainingFeatures } from "@/api/api-client";
```
改为：
```typescript
import { endTraining, getCases, getTrainingState, startTraining, triggerInitiative, updateTrainingFeatures } from "@/api/api-client";
```

并新增：
```typescript
import ChatBubble from "@/components/ChatBubble";
import { useChatStream } from "@/hooks/useChatStream";
import { useTypingFreeze } from "@/hooks/useTypingFreeze";
import type { ChatMessage } from "@/types/chat";
```

- [ ] **Step 2: 替换状态定义和 hooks 调用**

删除以下 state（行 72-85 中不再需要手动管理）：
- `const [messages, setMessages] = useState<ChatMessage[]>([]);`
- `const [input, setInput] = useState("");`
- `const [loading, setLoading] = useState(false);`
- `const abortRef = useRef<AbortController | null>(null);`
- `const [typingFrozen, setTypingFrozen] = useState(false);`
- `const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);`

改为：
```typescript
const { messages, setMessages, send, loading, isOperation, abortRef } = useChatStream(recordId);
const { typingFrozen, markTyping } = useTypingFreeze();
```

保留不变：`input`、`ending`、`selectedCaseId`、`recordId`、`cases`、`state`、`opResults`、`showDebug`、`msgTimestamps`、`initiativeFiredRef`、`messagesEndRef`、`pollRef`。

- [ ] **Step 3: 替换 `handleSend`**

删除整个 `handleSend` 函数（行 147-224），替换为：

```typescript
const handleSend = async (retryContent?: string) => {
  const content = (retryContent ?? input).trim();
  if (!content || !recordId || loading) return;
  setInput("");
  setMsgTimestamps((prev) => [...prev, Date.now()]);
  if (abortRef.current) abortRef.current.abort();
  const controller = new AbortController();
  abortRef.current = controller;
  await send(content);
};
```

注意：`abortRef` 从 hook 解构，hook 内部不再自行 abort，由各页面在 `send()` 前处理。

- [ ] **Step 4: 替换输入框 onChange**

将第 360-365 行：
```typescript
onChange={(e) => {
  setInput(e.target.value);
  setTypingFrozen(true);
  if (typingTimerRef.current) clearTimeout(typingTimerRef.current);
  typingTimerRef.current = setTimeout(() => setTypingFrozen(false), 2000);
}}
```
改为：
```typescript
onChange={(e) => {
  setInput(e.target.value);
  markTyping();
}}
```

- [ ] **Step 5: 替换消息气泡渲染 JSX**

将第 327-349 行的整个 `messages.map(...)` 渲染块替换为：

```typescript
{messages.map((msg, i) => (
  <ChatBubble
    key={msg.id ?? i}
    message={msg}
    patientAvatar={getPatientAvatar()}
    nurseAvatar={getNurseAvatar()}
  />
))}
```

- [ ] **Step 6: 替换 `handleStart` 中的 setMessages 调用**

将 `handleStart`（行 133-145）中的：
```typescript
setMessages([{ role: "patient", content: r.data.greeting }]);
```
改为：
```typescript
setMessages([{ id: Date.now(), role: "patient", content: r.data.greeting }]);
```

同理，pollRef 中 initiative 触发的消息（行 107）也加上 `id: Date.now()`：
```typescript
setMessages((prev) => [...prev, { id: Date.now(), role: "patient", content: trigger.data.message as string }]);
```

- [ ] **Step 7: 运行 lint 和 typecheck 验证**

```bash
cd frontend; npx biome check src/pages/AdminDebugPage.tsx --write; if ($?) { npx tsc --noEmit }
```
Expected: 无类型错误、lint 通过。

- [ ] **Step 8: 提交**

```bash
git add frontend/src/pages/AdminDebugPage.tsx
git commit -m "refactor: AdminDebugPage use shared hooks + ChatBubble"
```

---

### Task 6: 重构 `ChatTraining` 接入共享模块

**Files:**
- Modify: `frontend/src/pages/ChatTraining.tsx`

ChatTraining 更复杂，变化点更多。需要小心处理页面特有逻辑（voice、retry、score 等）。

- [ ] **Step 1: 替换 imports**

移除不再直接使用的 `sendMessageStream` import，新增共享模块 imports：

```typescript
// 旧:
import { endTraining, getRecordDetail, sendMessageStream } from "@/api/api-client";

// 新:
import { endTraining, getRecordDetail } from "@/api/api-client";
```

新增：
```typescript
import ChatBubble from "@/components/ChatBubble";
import { useChatStream } from "@/hooks/useChatStream";
import { useTypingFreeze } from "@/hooks/useTypingFreeze";
import type { ChatMessage } from "@/types/chat";
```

- [ ] **Step 2: 删除内联 `interface ChatMessage`**

删除第 36-41 行：
```typescript
interface ChatMessage {
  id: number;
  role: string;
  content: string;
  streaming?: boolean;
}
```

- [ ] **Step 3: 删除页面 `messages` 和 `loading` state、`abortRef`，新增 hooks 和 ref**

删除：
```typescript
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [loading, setLoading] = useState(false);
const abortRef = useRef<AbortController | null>(null);
```

在 `voice` hook（行 204）之后新增：
```typescript
const pendingContentRef = useRef("");
const { messages, setMessages, send, loading, abortRef } = useChatStream(recordId ? Number(recordId) : null, {
  onPatientChunk: (chunk) => voice.speakStreamChunk(chunk),
  onPatientDone: () => voice.flushStreamSpeak(),
  onError: (err) => {
    toast.error(err);
    failedMessageRef.current = pendingContentRef.current;
  },
});

const { typingFrozen, markTyping } = useTypingFreeze();
```

- [ ] **Step 4: 替换 `handleSend`**

删除旧 `handleSend`（行 379-432），替换为：

```typescript
const handleSend = async (retryContent?: string) => {
  const content = retryContent || input.trim();
  if (!content || loading) return;
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
```

注意：`abortRef` 来自 hook，由调用方在 `send()` 前自行 abort。hook 内部不自行 abort。

- [ ] **Step 5: CSS 清理 — 移除 `.msg-bubble` 和 `@keyframes blink`**

ChatBubble 组件已使用 tailwind-only 样式（`after:animate-pulse`），不再依赖页面自定义 CSS。删除 ChatTraining.tsx 底部 `<style>` 标签（行 866-895）中的：

```css
/* 删除以下规则 */
.msg-bubble.streaming::after {
  content: "|";
  animation: blink 0.8s infinite;
  color: var(--primary);
  font-weight: 700;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
```

**保留** `.typing-dots` 和 `@keyframes bounce-dot` 规则（loading 占位符仍使用这些）。

- [ ] **Step 6: 更新输入框 onChange 和 `loading` 引用**

输入框（行 787-791）添加 typing freeze：
```typescript
onChange={(e) => {
  setInput(e.target.value);
  markTyping();
}}
```

所有引用 `loading` 的地方保持原样（hooks 提供了同名 loading state）。

- [ ] **Step 7: 替换消息气泡渲染 JSX**

将第 674-701 行的 `messages.map(...)` 替换为：

```typescript
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
```

- [ ] **Step 8: 更新 `getRecordDetail` 加载历史消息时的类型适配**

第 309-312 行加载历史消息的代码保持原样。原有逻辑从 `detail.messages` 读取消息数组，消息已有 `id` 字段，与 `ChatMessage` 的 `id?: number` 兼容。

- [ ] **Step 9: 确保 `useChatStream` 在 `voice` hook 之后调用**

由于 `useChatStream` 的 options 引用了 `voice.speakStreamChunk` 等方法，必须在 `voice` hook 之后调用。当前代码中 `voice`（行 204）在大部分 state 之前定义，所以 hook 调用放在紧接着的其他 state 之后即可。

- [ ] **Step 10: 运行 lint 和 typecheck**

```bash
cd frontend; npx biome check src/pages/ChatTraining.tsx --write; if ($?) { npx tsc --noEmit }
```
Expected: 无类型错误、lint 通过。

- [ ] **Step 11: 提交**

```bash
git add frontend/src/pages/ChatTraining.tsx
git commit -m "refactor: ChatTraining use shared hooks + ChatBubble"
```

---

### Task 7: 全量验证

- [ ] **Step 1: 运行完整 typecheck**

```bash
cd frontend; npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 2: 运行 lint**

```bash
cd frontend; npx biome check src/ --write
```
Expected: 无错误。

- [ ] **Step 3: 运行现有测试**

```bash
cd frontend; npx vitest run
```
Expected: 所有测试通过。

- [ ] **Step 4: 验证构建**

```bash
cd frontend; npm run build
```
Expected: build 成功。

- [ ] **Step 5: 检查 git diff 确认改动范围**

```bash
git diff --stat
```
Expected: 6 个新文件 + 2 个修改文件，ChatTraining 和 AdminDebugPage 行数显著减少。

- [ ] **Step 6: 提交最终验证**

```bash
git add -A
git commit -m "refactor: extract shared chat stream modules, unify both pages"
```
