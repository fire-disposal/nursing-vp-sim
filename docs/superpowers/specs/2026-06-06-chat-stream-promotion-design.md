# 对话流式机制系统级推广设计

> 分支: `feat/patient-interaction-v2` | 目标: 提取共享模块、统一两页面

---

## 一、背景

近期 15 个提交在 `AdminDebugPage.tsx` 调试工坊中实现了创新对话机制：

- **操作指令双通道**：护理操作被拦截，结果通过 Author's Note 注入 LLM，学生不可见
- **SSE 协议扩展**：流式响应新增 `data.system` 事件，前端 `onSystem` 回调
- **流式渲染优化**：placeholder 先行 + 反向查找 streaming 气泡逐 chunk 追加
- **打字冻结**：输入时暂停主动追问计时

这些能力仅限调试页，**生产页 `ChatTraining.tsx` 完全未集成**。

---

## 二、目标

1. 提取共享模块：操作拦截 + 流式生命周期 + 打字冻结 + 消息气泡渲染
2. 两页统一：AdminDebugPage 和 ChatTraining 使用同一套核心逻辑
3. 页面特有能力不变：调试面板、录音、评分、问卷等各自保留

---

## 三、新增文件

### 3.1 `frontend/src/types/chat.ts` — 统一消息类型

```typescript
export interface ChatMessage {
  id?: number;
  role: "student" | "patient" | "system";
  content: string;
  streaming?: boolean;
}
```

复用调试页已验证的 `id` 可选 + 反向搜索模式（比 ChatTraining 的 id-based 更稳健）。

### 3.2 `frontend/src/hooks/useChatStream.ts` — 流式消息核心

```typescript
function useChatStream(recordId: number, options?: {
  onPatientChunk?: (chunk: string) => void;   // voice
  onPatientDone?: () => void;                 // voice flush
  onError?: (err: string) => void;            // toast
  onSanitized?: (reply: string) => void;      // identity leak retry
})
```

内部管理 `messages: ChatMessage[]` 状态，封装 `sendMessageStream` 全生命周期：

| 步骤 | 逻辑 |
|------|------|
| 操作检测 | `startsWith("/")`、`"测"`、`"观察"` |
| 操作路径 | 不追加 student 消息 → 追加 `"正在..."` system → chunk 追加到 patient 气泡 → 完成后追加 system 结果播报 |
| 非操作路径 | 追加 student → patient placeholder → chunk 反向查找追加 → 完成标记 streaming=false |
| 错误路径 | 清理所有 streaming 气泡 |
| 扩展点 | `onPatientChunk`（voice）、`onPatientDone`（voice flush）、`onError`（toast） |

返回 `{ messages, setMessages, send, loading, isOperation, abortRef }`。

### 3.3 `frontend/src/hooks/useTypingFreeze.ts` — 打字冻结

```typescript
function useTypingFreeze(freezeMs = 2000)
```

返回 `{ typingFrozen, wrapOnChange }`。`wrapOnChange` 包装 setState，输入时标记冻结 2s。

### 3.4 `frontend/src/components/ChatBubble.tsx` — 统一消息气泡

```typescript
function ChatBubble(props: {
  message: ChatMessage;
  patientAvatar: string;
  nurseAvatar: string;
  showSpeakButton?: boolean;
  isSpeaking?: boolean;
  onSpeakToggle?: (text: string) => void;
})
```

三种角色渲染：
- `system` → 居中蓝色 info 气泡（兼容两页）
- `patient` → 左对齐 + 头像 + streaming 光标 + 可选朗读按钮
- `student` → 右对齐 + 头像

---

## 四、修改文件

### 4.1 `ChatTraining.tsx`

| 删除 | 替换为 |
|------|--------|
| 内联 `interface ChatMessage` | `@/types/chat` |
| `handleSend` 内部的所有消息操作逻辑 | `const { messages, send, ... } = useChatStream(recordId, { onPatientChunk: voice.speakStreamChunk, ... })` |
| 内联消息气泡渲染 JSX | `<ChatBubble>` |
| `onChange={(e) => setInput(e.target.value)}` | `onChange={wrapOnChange(setInput)}` |
| `sendMessageStream` 调用 `onSystem` 传 `undefined` | 由 hook 内部自动处理 `onSystem` |

页面特有部分不变：录音、朗读、计时器、评分覆盖、问卷、患者画像、问诊要点侧边栏、auto-end、重发。

### 4.2 `AdminDebugPage.tsx`

| 删除 | 替换为 |
|------|--------|
| 内联 `interface ChatMessage` | `@/types/chat` |
| `handleSend` 内部的消息操作逻辑 | `useChatStream(recordId)` |
| 内联消息气泡渲染 JSX | `<ChatBubble>` |
| `onChange` + `setTypingFrozen` + `typingTimerRef` 逻辑 | `useTypingFreeze` |

页面特有部分不变：状态面板（情绪/人格/体征/追问）、feature toggle、病例切换、历史按钮、对话统计。

### 4.3 `index.ts` / barrel 导出（可选）

如项目有 `index.ts` 统一导出模式，按需添加。

---

## 五、不变部分

| ChatTraining 专属 | AdminDebugPage 专属 |
|---|---|
| 录音条 + 朗读按钮 + 自动播放 | 情绪引擎面板 |
| 倒计时 + auto-end | 患者人格面板 |
| 评分覆盖 + ScoreCard | 体征锚点面板 |
| 问诊要点侧边栏 | Feature toggle 开关 |
| 患者画像 PatientPortrait | 病例切换下拉 |
| 问卷弹窗 | 历史记录按钮 |
| 重发 + 网络检测 | 对话统计面板 |
| OperationPanel（底部工具栏） | OperationPanel（底部 + 结果展示） |

---

## 六、风险

| 风险 | 等级 | 应对 |
|------|------|------|
| ChatTraining 消息 id 语义变化 | 🟡 中 | 旧逻辑用 `msg.id === patientMsgId` 匹配，改为反向搜索；确保 done 回调兼容 |
| Voice 集成延迟 | 🟢 低 | `onPatientChunk` / `onPatientDone` 通过 options 注入，不影响时序 |
| 系统消息在 ChatTraining 中出现 | 🟢 低 | ChatTraining 用 `ChatBubble` 渲染时会正确显示蓝色 system 气泡，属于预期行为 |

---

> 撰写日期: 2026-06-06
