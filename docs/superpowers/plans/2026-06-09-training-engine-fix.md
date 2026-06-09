# TrainingEngine 重构修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 TrainingEngine 重构后的所有 33 个问题，从核心对话链路、引擎层、插件层到代码清理。

**Architecture:** 消息渲染和输入框作为核心能力（非可替换插件），由 TrainingEngine 直接管理。插件通过 MessageBus 和 PluginContext 消费数据，不碰 DOM。Feature flag 统一到 pluginRegistry。

**Tech Stack:** React 19 + TypeScript + Vite + Tailwind CSS + Zustand

---

## Task 1: 扩展 PluginContext，添加 messages 和 voice 字段

**Files:**
- Modify: `frontend/src/engine/types.ts`
- Modify: `frontend/src/engine/TrainingEngine.tsx`

**Context:** `ChatDisplay` 插件需要 `ctx.messages`（只读消息列表）和 `ctx.tts`（TTS 控制）。当前 PluginContext 没有这两个字段，导致 ChatDisplay 访问 `undefined.length` 崩溃（白屏根因）。

- [ ] **Step 1: 扩展 PluginContext 类型**

在 `frontend/src/engine/types.ts` 的 `PluginContext` 接口中添加两个字段：

```typescript
export interface PluginContext {
  recordId: string;
  bus: MessageBus;
  patient: PatientData;
  sendMessage: (text: string) => void;
  endTraining: () => Promise<void>;
  messages: ChatMessage[];             // 新增：只读消息列表
  loading: boolean;                   // 新增：是否正在发送
  tts: {                              // 新增：TTS 控制
    isAutoPlay: boolean;
    setAutoPlay: (v: boolean) => void;
  };
}
```

同时删除 `setMessages` 字段（无插件使用，`useRecordLoader` 已死）：

```typescript
// 删除：setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
```

- [ ] **Step 2: TrainingEngine 提供 messages 和 tts 到 slotProps**

在 `frontend/src/engine/TrainingEngine.tsx` 的 `slotProps` useMemo 中：

```typescript
const [ttsAutoPlay, setTtsAutoPlay] = useState(true);

const slotProps: SlotProps = useMemo(
  () => ({
    ctx: {
      recordId,
      bus: busRef.current,
      patient: patient!,
      sendMessage,
      endTraining,
      messages,  // 新增
      loading: sending,  // 新增
      tts: {     // 新增
        isAutoPlay: ttsAutoPlay,
        setAutoPlay: setTtsAutoPlay,
      },
    },
    features: scenarioConfig?.features ?? {},
    currentPhase: "history_taking",
    phaseCount: 1,
    advancePhase: () => {},
  }),
  [recordId, patient, sendMessage, endTraining, messages, sending, ttsAutoPlay, scenarioConfig?.features],
);
```

删除旧的 `setMessages` 回调和相关 `(action)` 逻辑。

- [ ] **Step 3: 验证 ChatDisplay 可渲染**

```bash
cd frontend; npx tsc --noEmit
```

确保无类型错误。

---

## Task 2: 类型统一 — 删除 types/chat.ts 重复定义

**Files:**
- Delete: `frontend/src/types/chat.ts`
- Modify: `frontend/src/components/ChatBubble.tsx:3`
- Modify: `frontend/src/hooks/useChatStream.ts:3`
- Verify: other references (useRecordLoader is dead, ignore)

**Context:** `ChatMessage` 在 `types/chat.ts` 和 `engine/types.ts` 有两份定义，需要统一。

- [ ] **Step 1: 确保 engine/types.ts 的 ChatMessage 包含所有字段**

```typescript
export interface ChatMessage {
  id?: number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
  timestamp?: string;
}
```

（已包含所有字段，无需修改）

- [ ] **Step 2: 更新 ChatBubble.tsx 导入**

```typescript
// 改前：import type { ChatMessage } from "@/types/chat";
// 改后：
import type { ChatMessage } from "@/engine/types";
```

- [ ] **Step 3: 更新 useChatStream.ts 导入**

```typescript
// 改前：import type { ChatMessage } from "@/types/chat";
// 改后：
import type { ChatMessage } from "@/engine/types";
```

- [ ] **Step 4: 删除文件并验证**

```bash
Remove-Item "frontend\src\types\chat.ts"
cd frontend; npx tsc --noEmit
```

---

## Task 3: ChatBubble — 添加 data-role 属性 + 清理死代码

**Files:**
- Modify: `frontend/src/components/ChatBubble.tsx`

**Context:** TTS 和 Inquiry 依赖 `[data-role]` DOM 选择器，ChatBubble 未设置该属性。同时删除未使用的 speak 按钮 props。

- [ ] **Step 1: 添加 data-role 属性**

```tsx
// 系统消息 (line 17)
<div className="flex justify-center" data-role="system">

// 患者消息 (line 28)
<div className="flex items-end gap-2 justify-start" data-role="patient">

// 学生消息 (line 52)
<div className="flex items-end gap-2 justify-end" data-role="student">
```

- [ ] **Step 2: 删除未使用的 speak 按钮相关代码**

从 interface 删除：
```typescript
// 删除：
showSpeakButton?: boolean;
isSpeaking?: boolean;
onSpeakToggle?: (text: string) => void;
```

从函数签名删除对应 props，删除 JSX 中的 speak 按钮（lines 39-47）和相关的 import（Volume2, VolumeX — 如果不再需要）。

- [ ] **Step 3: 修复 student 消息的死代码 (line 61)**

```tsx
// 改前：{message.content || (message.streaming ? "" : "")}
// 改后：
{message.content}
```

- [ ] **Step 4: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 4: ChatDisplay — 修复滚动死锁 + 适配新 PluginContext

**Files:**
- Modify: `frontend/src/plugins/chat-display/ChatDisplay.tsx`

**Context:** 滚动 useEffect 依赖 `scrollToBottom`（useCallback 依赖 `isNearBottom`），用户上翻时 `isNearBottom` 变为 false → `scrollToBottom` 引用变化 → effect 再次触发 `scrollToBottom(true)` → 强制回底。同时 `ctx.messages` 现在来自 PluginContext。

- [ ] **Step 1: 修复滚动死锁**

移除 "Scroll to bottom on mount" effect（lines 54-57），它因依赖链变化导致死锁：

```tsx
// 删除整个 effect：
// useEffect(() => {
//   scrollToBottom(true);
// }, [scrollToBottom]);

// 改为仅在初始 mount 时滚动一次：
useEffect(() => {
  bottomRef.current?.scrollIntoView({ behavior: "auto" });
}, []); // 空依赖，仅 mount 时执行
```

- [ ] **Step 2: 使用 ref 避免 isNearBottom 闭合陷阱**

```tsx
const isNearBottomRef = useRef(true);

const handleScroll = useCallback(() => {
  const nearBottom = checkNearBottom();
  isNearBottomRef.current = nearBottom;
  setIsNearBottom(nearBottom);
}, [checkNearBottom]);
```

stream:chunk 监听中使用 ref 而非 state：

```tsx
useEffect(() => {
  const unsub = ctx.bus.on("stream:chunk", () => {
    if (isNearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  });
  return unsub;
}, [ctx.bus]);
```

- [ ] **Step 3: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 5: ChatInput — 创建 footer 槽位核心输入组件

**Files:**
- Create: `frontend/src/plugins/chat-input/index.ts`
- Create: `frontend/src/plugins/chat-input/ChatInput.tsx`
- Modify: `frontend/src/pages/ChatTraining.tsx`

**Context:** footer 槽位无插件，用户无法输入。创建 chat-input 插件，复用旧 ChatInput 逻辑。

- [ ] **Step 1: 创建插件定义**

`frontend/src/plugins/chat-input/index.ts`:

```typescript
import type { TrainingPlugin } from "@/engine/types";
import { ChatInput } from "./ChatInput";

export const chatInputPlugin: TrainingPlugin = {
  id: "chat-input",
  name: "消息输入",
  meta: {
    description: "文本输入框，发送消息，语音按钮槽位",
    icon: "send",
    tags: ["ui", "footer", "core"],
  },
  slots: {
    footer: ChatInput,
  },
};
```

- [ ] **Step 2: 创建 ChatInput 组件**

`frontend/src/plugins/chat-input/ChatInput.tsx`:

```tsx
import { useCallback, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { SlotProps } from "@/engine/types";

export function ChatInput({ ctx }: SlotProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const { sendMessage } = ctx;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || ctx.loading) return;
    sendMessage(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, sendMessage, ctx.loading]);

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
    <div className="flex items-end gap-2 px-3 py-2 border-t bg-background">
      <div className="flex-1">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息与患者对话..."
          disabled={ctx.loading}
          className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary disabled:opacity-50"
        />
      </div>
      <button
        type="button"
        onClick={handleSend}
        disabled={ctx.loading || !text.trim()}
        className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-50"
      >
        <Send size={16} />
      </button>
    </div>
  );
}
```

- [ ] **Step 3: 在 ChatTraining 中注册 chatInputPlugin**

在 `frontend/src/pages/ChatTraining.tsx` 添加 import 和注册：

```typescript
import { chatInputPlugin } from "@/plugins/chat-input";

// plugins 数组中添加：
plugins={[
  chatDisplayPlugin,
  chatInputPlugin,
  timerPlugin,
  inquiryPlugin,
  physicalExamPlugin,
  nursingRecordPlugin,
  questionnairePlugin,
  patientInitiativePlugin,
  scoringDisplayPlugin,
]}
```

- [ ] **Step 4: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 6: PluginContext 移除 setMessages 后清理残留引用

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx`

**Context:** Task 1 从 PluginContext 删除了 `setMessages`，TrainingEngine 中的 wiring 代码需要清理。

- [ ] **Step 1: 清理 TrainingEngine 中的 setMessages wiring**

在 `TrainingEngine.tsx` 的 `slotProps` 中，删除 `setMessages` 相关的闭包代码（原 lines 125-128）。新的 `ctx` 对象不再包含 `setMessages`。

- [ ] **Step 2: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 7: StreamManager — catch 块补 onError + UUID 替代 Date.now()

**Files:**
- Modify: `frontend/src/engine/StreamManager.ts`

- [ ] **Step 1: catch 块补上 onError 回调**

```typescript
// StreamManager.ts ~line 148
} catch (err: any) {
  this.messages = this.messages.filter((m) => !m.streaming && !addedIds.has(m.id ?? 0));
  this.notify();
  this.setLoading(false);
  callbacks.onError?.(err?.message || "发送失败");  // 新增
} finally {
```

- [ ] **Step 2: Date.now() 改为 crypto.randomUUID()**

```typescript
// 将 send() 方法中的 Date.now() 替换为 crypto.randomUUID()
const studentId = Date.now();
// 改为：
const studentId = crypto.randomUUID();
```

所有 `Date.now()` 和 `Date.now() + 1` 都替换。

- [ ] **Step 3: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 8: ScoreManager — 接收 MessageBus + 发射 score:ready

**Files:**
- Modify: `frontend/src/engine/ScoreManager.ts`
- Modify: `frontend/src/engine/TrainingEngine.tsx`

- [ ] **Step 1: ScoreManager 构造函数接收 MessageBus**

读取 `frontend/src/engine/ScoreManager.ts`，修改构造函数：

```typescript
import type { MessageBus } from "./types";

export class ScoreManager {
  private recordId: number | null;
  private bus: MessageBus;
  // ...

  constructor(recordId: number | null, bus: MessageBus) {
    this.recordId = recordId;
    this.bus = bus;
  }

  private notify(): void {
    // 原有 listeners 通知
    for (const fn of this.listeners) fn();
    // 发射 bus 事件
    this.bus.emit("score:ready", this.score);
  }
}
```

- [ ] **Step 2: TrainingEngine 传入 bus**

```typescript
// TrainingEngine.tsx
const scoreRef = useRef(new ScoreManager(recordNum, busRef.current));
```

- [ ] **Step 3: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 9: Feature Flag 统一到 pluginRegistry

**Files:**
- Modify: `frontend/src/engine/TrainingEngine.tsx`
- Modify: `frontend/src/engine/PluginRegistry.ts`

- [ ] **Step 1: PluginRegistry 添加 version 计数**

```typescript
// PluginRegistry.ts
export class PluginRegistry {
  private plugins = new Map<string, TrainingPlugin>();
  private featureFlags: Record<string, boolean> = {};
  private _version = 0;

  get version(): number { return this._version; }

  setFeatureFlags(flags: Record<string, boolean>): void {
    this.featureFlags = { ...flags };
    this._version++;
  }
  // ...
}
```

- [ ] **Step 2: TrainingEngine 使用 registryVersion 驱动 activePlugins**

```typescript
// TrainingEngine.tsx
const [registryVersion, setRegistryVersion] = useState(0);

useEffect(() => {
  pluginRegistry.setFeatureFlags(scenarioConfig?.features ?? {});
  for (const p of plugins) pluginRegistry.register(p);
  setRegistryVersion(pluginRegistry.version);
}, []); // 仅初始化一次

const activePlugins = useMemo(
  () => pluginRegistry.getActive(),
  [registryVersion],
);
```

- [ ] **Step 3: DevToolsPanel toggle 时同步更新 TrainingEngine**

DevToolsPanel 已有 `pluginRegistry.setFeatureFlags(newFlags)`。在 TrainingEngine 中通过 bus 事件同步版本：

```typescript
useEffect(() => {
  const unsub = busRef.current.on("plugins:updated", () => {
    setRegistryVersion(pluginRegistry.version);
  });
  return unsub;
}, []);
```

DevToolsPanel toggle 后 emit `bus.emit("plugins:updated")`。

- [ ] **Step 4: plugins 数组用 useMemo 稳定化**

在 `ChatTraining.tsx` 中：

```typescript
const plugins = useMemo(() => [
  chatDisplayPlugin,
  chatInputPlugin,
  timerPlugin,
  inquiryPlugin,
  physicalExamPlugin,
  nursingRecordPlugin,
  questionnairePlugin,
  patientInitiativePlugin,
  scoringDisplayPlugin,
], []);
```

- [ ] **Step 5: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 10: TimerDisplay — 修复重复 endTraining 和依赖抖动

**Files:**
- Modify: `frontend/src/plugins/timer/TimerDisplay.tsx`

- [ ] **Step 1: 添加 hasEndedRef 守卫**

```typescript
import { useEffect, useRef, useState } from "react";

export function TimerDisplay({ ctx, duration = 30 }: TimerDisplayProps) {
  const [remaining, setRemaining] = useState(duration * 60);
  const [paused, setPaused] = useState(false);
  const hasEndedRef = useRef(false);
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;  // 保持 ctx 引用最新

  useEffect(() => {
    if (paused) return;
    if (remaining <= 0) {
      if (hasEndedRef.current) return;  // 守卫
      hasEndedRef.current = true;
      ctxRef.current.bus.emit("timer:timeout");
      ctxRef.current.endTraining();
      return;
    }
    const id = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(id);
  }, [remaining, paused]);  // 移除 ctx 依赖
  // ... rest unchanged
}
```

- [ ] **Step 2: 删除 timerPlugin 的空 onEnd hook**

在 `frontend/src/plugins/timer/index.ts`:

```typescript
// 删除 hooks 块（lines 15-19）
export const timerPlugin: TrainingPlugin = {
  id: "timer",
  name: "倒计时",
  meta: { /* ... */ },
  slots: { header: TimerDisplay },
  // hooks 已删除
};
```

- [ ] **Step 3: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 11: Inquiry/TTS — 消除 DOM 查询

**Files:**
- Modify: `frontend/src/plugins/inquiry/InquirySidebar.tsx`
- Create/Modify: TTS logic (voice plugin)

- [ ] **Step 1: InquirySidebar 改为使用 ctx.messages**

读取当前 `InquirySidebar.tsx`，将所有 `document.querySelectorAll("[data-role='patient']")` 替换为：

```tsx
// 从 ctx 获取 messages
const patientMessages = ctx.messages.filter(m => m.role === "patient");
patientMessages.forEach(msg => {
  const text = (msg.content ?? "").toLowerCase();
  for (const q of inquiries) {
    if (text.includes(q.toLowerCase())) {
      setCompleted(prev => new Set([...prev, q]));
    }
  }
});
```

监听 `stream:done` 事件或 message 变化来触发检测。

- [ ] **Step 2: 清理 voice/TTS Manager 的 DOM 查询**

voice 插件目录尚不存在，Task 10 在 ChatInput 中预留了 `input-toolbar` 槽位。TTS Manager 逻辑暂保留在 `useVoice.ts`（旧代码），后续通过 bus 事件桥接。本步仅确认现有 TTS 代码不阻塞页面。

- [ ] **Step 3: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 12: 中危问题批量修复

**Files:**
- Modify: `frontend/src/plugins/nursing-record/index.ts`
- Modify: `frontend/src/plugins/questionnaire/QuestionnaireOverlay.tsx`
- Modify: `frontend/src/plugins/physical-exam/ExamPanel.tsx`
- Modify: `frontend/src/engine/ScoreManager.ts`
- Modify: `frontend/src/engine/SlotRenderer.tsx`
- Modify: `frontend/src/engine/useResponsiveLayout.ts`

- [ ] **Step 1: NursingRecord — saveValues 移到 useEffect**

在 `NursingRecordSlotAdapter` 中。

当前 `setValues` 内调用 `saveValues()` 有副作用。改为：

```tsx
useEffect(() => {
  saveValues(recordId, values);
}, [values, recordId]);
```

从 `updateValue` 中删除 `saveValues()` 调用。

- [ ] **Step 2: Questionnaire — 移除 dynamic import**

```typescript
// 改前：const { api } = await import("@/api/axios-instance");
// 改后：顶层已有 import，直接使用
import { api } from "@/api/axios-instance";  // 加到文件顶部

// 删除三处 await import()
```

- [ ] **Step 3: ExamPanel — 删除冗余 feature guard**

```tsx
// 删除：
if (!features.physical_exam) return null;
```
 pluginRegistry 已按 flag 过滤，组件内不再需要。

- [ ] **Step 4: ScoreManager — 轮询防重入**

```typescript
private _polling = false;

async poll(): Promise<void> {
  if (this._polling) return;
  this._polling = true;
  try {
    // ... existing poll logic ...
  } finally {
    this._polling = false;
  }
}
```

- [ ] **Step 5: SlotRenderer — 加错误边界**

```tsx
// SlotRenderer.tsx
import { Component } from "react";

class SlotErrorBoundary extends Component<{ children: React.ReactNode }> {
  state = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      console.warn(`[SlotErrorBoundary] ${this.props["data-slot"]}:`, this.state.error);
      return null; // 静默降级
    }
    return this.props.children;
  }
}

// 在 SlotRenderer 中包裹每个 Component
<SlotErrorBoundary key={plugin.id} data-slot={name}>
  <Component {...slotProps} />
</SlotErrorBoundary>
```

- [ ] **Step 6: useResponsiveLayout — 加 debounce**

```typescript
useEffect(() => {
  let timer: ReturnType<typeof setTimeout>;
  const handler = () => {
    clearTimeout(timer);
    timer = setTimeout(() => setBp(getBreakpoint()), 150);
  };
  window.addEventListener("resize", handler);
  return () => {
    window.removeEventListener("resize", handler);
    clearTimeout(timer);
  };
}, []);
```

- [ ] **Step 7: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 13: 死文件删除 + PluginRegistry 警告

**Files:**
- Delete: `frontend/src/hooks/useRecordLoader.ts`
- Delete: `frontend/src/hooks/useTypingFreeze.ts`
- Modify: `frontend/src/engine/PluginRegistry.ts`

- [ ] **Step 1: 删除死文件**

```bash
Remove-Item "frontend\src\hooks\useRecordLoader.ts"
Remove-Item "frontend\src\hooks\useTypingFreeze.ts"
```

这两个文件确认无任何 import 引用。

- [ ] **Step 2: PluginRegistry 重复注册警告**

```typescript
register(plugin: TrainingPlugin): void {
  if (this.plugins.has(plugin.id)) {
    console.warn(`[PluginRegistry] duplicate plugin id ignored: ${plugin.id}`);
    return;
  }
  this.plugins.set(plugin.id, { ...plugin });
}
```

- [ ] **Step 3: 验证**

```bash
cd frontend; npx tsc --noEmit
```

---

## Task 14: 最终验证与提交

- [ ] **Step 1: TypeScript 全量检查**

```bash
cd frontend; npx tsc --noEmit
```

- [ ] **Step 2: 前端构建验证**

```bash
cd frontend; npx vite build --mode development
```

- [ ] **Step 3: 提交所有变更**

```bash
git add -A
git status  # 确认变更列表
git commit -m "🐛 fix: comprehensive training engine refactor fixes (33 issues)"
```
