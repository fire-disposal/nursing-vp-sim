# TrainingEngine 重构修复设计

## 背景

插件化 TrainingEngine 重构后，审计发现 33 个问题（致命 4 / 高危 6 / 中危 12 / 低危 11）。核心对话链路断裂，评分/TTS/Inquiry 依赖 DOM 查询已失效。

## 架构原则

- **消息渲染和输入框是核心能力，不属于插件。** 由 TrainingEngine 直接渲染在 content/footer 槽位。
- **核心层向插件提供 MessageBus 事件和 React state，插件不碰 DOM。**
- **消除所有 `document.querySelector` 调用。** 数据流通通过 StreamManager state / MessageBus 完成。

```
┌─────────────────────────────────────────────┐
│  TrainingEngine (核心引擎)                    │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │ content  │ │ footer   │ │input-toolbar │  │
│  │ChatDisplay│ │ChatInput │ │ (voice 注入) │  │
│  │ 消息列表  │ │ 文本输入  │ │              │  │
│  └──────────┘ └──────────┘ └─────────────┘  │
│  ┌──────────────────────────────────────┐    │
│  │ StreamManager / ScoreManager / Bus   │    │
│  └──────────────────────────────────────┘    │
├─────────────────────────────────────────────┤
│  插件层 (SlotRenderer 注入)                   │
│  header: timer, inquiry                     │
│  panel:  physical-exam, nursing-record      │
│  overlay: scoring-display, questionnaire    │
│  input-toolbar: voice                       │
└─────────────────────────────────────────────┘
```

## 一、核心对话链路（致命）

### 1.1 ChatDisplay（content 槽位）
- 新建 `engine/ChatDisplay.tsx`
- 由 TrainingEngine 在 content 槽位直接渲染（非 SlotRenderer）
- 消费 `StreamManager.getMessages()` 通过 subscribe 同步到 state
- 复用 `ChatBubble.tsx`，补充 `data-role="patient|student|system"`
- 自动滚动：流式 chunk 触发 `scrollIntoView({ behavior: "smooth" })`；用户上翻 >100px 暂停，滚回底部恢复
- 合并 `ChatBubble` 的 `ChatMessage` 到 `engine/types.ts`，删除 `types/chat.ts` 重复定义

### 1.2 ChatInput（footer 槽位）
- 复用 `components/training/ChatInput.tsx`
- 由 TrainingEngine 在 footer 槽位直接渲染
- 内部渲染 `input-toolbar` 子槽位，voice 插件注入语音按钮
- `DEFAULT_LAYOUT` slots 增加 `"input-toolbar": { render: "inline" }`

### 1.3 StreamManager 修复
- `catch` 块补充 `callbacks.onError?.(err)`
- `Date.now()` 改 `crypto.randomUUID()`

### 1.4 评分链路修复
- `ScoreManager` 构造函数接收 `MessageBus`
- `_notify()` 时 `bus.emit("score:ready", data)`
- ScoringDisplay 已有监听，直接生效

### 1.5 TTS / Inquiry 消除 DOM 查询
- `TTSManager.extractLastPatientMessage()`：改为监听 StreamManager subscribe，取 messages 最后一条 `role="patient"` 的 content
- `InquirySidebar`：subscribe → 遍历 messages 按 role=patient + 文本包含匹配问诊项
- 删除 `ChatBubble` 中 `showSpeakButton`/`isSpeaking`/`onSpeakToggle` props

### 1.6 滚动策略修复
- `ChatDisplay` 使用 `isNearBottom` ref + scroll 事件
- 仅 nearBottom 时流式更新才触发 scrollIntoView

## 二、引擎层修复（高危）

### 2.1 Feature Flag 统一
- TrainingEngine 初始化 `pluginRegistry.setFeatureFlags(scenarioConfig?.features ?? {})`
- `activePlugins` 依赖 `registryVersion` state
- DevTools toggle 时 `registryVersion++`，触发重算

### 2.2 slotProps 稳定化
- `ctx` 对象 useMemo 单独稳定，移除 `messages`/`sending` 依赖
- 插件需消息数据通过 `ctx.bus` 监听 `messages:updated`
- `slotProps` 只依赖 `recordId, patient, sendMessage, endTraining, features`

### 2.3 定时器修复
- `endTraining()` 加 `hasEndedRef` 守卫，只执行一次
- `useEffect` 依赖移除 `ctx`，用 `useRef` 持有引用

### 2.4 插件数组稳定化
- `ChatTraining.tsx` 的 `plugins={[...]}` 改为 `useMemo(() => [...], [])`

## 三、插件修复 + 槽位清理（中危）

### 3.1 槽位修正
- `input-toolbar` 加入 `DEFAULT_LAYOUT.slots`
- `sidebar-tray` 移除（inquiry 已通过 header 渲染）
- `footer` / `content` 由核心直接渲染

### 3.2 NursingRecord 副作用修复
- `saveValues()` 移到 `useEffect` 响应 values 变化

### 3.3 问卷 import 去重
- 顶层 `import { api } from "@/api/axios-instance"`，删除三处 `await import()`

### 3.4 ScoreManager 轮询防重入
- `poll()` 加 `_polling` 标志

### 3.5 SlotRenderer 错误边界
- 每个 slot 外包 ErrorBoundary 包装组件

### 3.6 ScoreManager 轮询间隔稳定性
- 不修改核心逻辑，仅加固

## 四、代码清理 + 类型修复（低危）

### 4.1 死文件删除
- `hooks/useRecordLoader.ts`
- `hooks/useTypingFreeze.ts`
- `engine/tts/volcengine-tts.ts`

### 4.2 类型统一
- 删除 `types/chat.ts` 的 `ChatMessage`，统一 `engine/types.ts`
- 全局引用更新
- 删除 `nursing-record/types.ts` 的 `ReadonlySheetValue`

### 4.3 死代码清理
- `ChatBubble` 未使用 props 删除
- `ChatBubble:61` 死代码 `{message.content || (message.streaming ? "" : "")}` → `{message.content}`
- `timerPlugin.onEnd` 空 hook 删除
- `physicalExamPlugin` 组件内冗余 feature flag guard 删除
- `TTSManager` 中 `chat:beforeSend` 死监听删除

### 4.4 PluginRegistry
- `register()` 重复注册加 `console.warn`
- `setMessages` 从 `PluginContext` 移除，插件通过 `bus.emit("system:message", text)` 发送系统消息

### 4.5 useResponsiveLayout
- resize handler 加 150ms debounce

## 涉及文件

| 操作 | 文件 |
|------|------|
| 新建 | `engine/ChatDisplay.tsx` |
| 修改 | `engine/TrainingEngine.tsx` |
| 修改 | `engine/StreamManager.ts` |
| 修改 | `engine/ScoreManager.ts` |
| 修改 | `engine/MessageBus.ts` |
| 修改 | `engine/PluginRegistry.ts` |
| 修改 | `engine/SlotRenderer.tsx` |
| 修改 | `engine/types.ts` |
| 修改 | `engine/useResponsiveLayout.ts` |
| 修改 | `plugins/inquiry/InquirySidebar.tsx` |
| 修改 | `plugins/voice/VoiceButton.tsx` |
| 修改 | `plugins/timer/TimerDisplay.tsx` |
| 修改 | `plugins/nursing-record/index.ts` |
| 修改 | `plugins/questionnaire/QuestionnaireOverlay.tsx` |
| 修改 | `plugins/physical-exam/ExamPanel.tsx` |
| 修改 | `plugins/scoring-display/ScoringDisplaySlot.tsx` |
| 修改 | `components/ChatBubble.tsx` |
| 删除 | `hooks/useRecordLoader.ts` |
| 删除 | `hooks/useTypingFreeze.ts` |
| 删除 | `engine/tts/volcengine-tts.ts` |
| 删除 | `types/chat.ts`（ChatMessage 迁移后） |
| 引用更新 | 所有 `@/types/chat` → `@/engine/types` |
