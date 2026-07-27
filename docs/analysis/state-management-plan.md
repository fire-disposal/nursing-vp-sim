# 前端状态管理与数据流改进方案

> 2026-07-27 · 基于全面审计的架构改进设计
>
> 审计覆盖: 51 个 useQuery · 14 个 useMutation · 12 个 Context · 1 个 Zustand Store · 4 个 ref 服务 · 28 个数据消费文件

---

## 一、审计发现分类

### 1.1 数据查询问题（6 项）

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| 1 | **同一 record 被 3 个 observer 独立查询** — TrainingEntry + PatientProvider + TrainingEngineContent 各自调用 `getRecordDetail`，使用不同 retry/staleTime 配置 | 🔴 P0 | TrainingEntry, useTrainingRecord, TrainingEngine |
| 2 | **`queryKeys.training.record()` 和 `.detail()` 完全相同** — 两个命名产生相同 key `["training","detail",id]`，但给维护者造成了"不同"的错觉 | 🟡 P1 | query-keys.ts |
| 3 | **VoiceUsage 同文件内查询重复** — VoiceTTSTab.tsx 中两个组件各自 query `voice.usage` | 🟡 P1 | VoiceTTSTab.tsx |
| 4 | **getMe 不通过 React Query** — authStore 直接调 axios，导致用户信息无法享受缓存/重试/去重 | 🟡 P2 | authStore.ts |
| 5 | **~80% 数据消费页面为 lazy chunk** — 大量 useQuery 位于 Suspense 边界后的懒加载组件中 | 🟡 P1 | navigation.tsx |
| 6 | **`getRecordDetail` 在 TrainingEntry 中 retry:5，useTrainingRecord 中 retry:1** — 同一 cache 的 observer 选项不一致 | 🟡 P1 | TrainingEntry, useTrainingRecord |

### 1.2 Context 架构问题（3 项）

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| 7 | **FeedbackProvider value 未 memo** — 每次状态变更重建对象，触发全树重渲染 | 🟡 P1 | FeedbackProvider.tsx |
| 8 | **TrainingContext 过度广播** — messages 变化导致 SceneRenderer/SceneToolbar（不需要 messages）也重渲染 | 🟡 P1 | TrainingContext.ts |
| 9 | **TrainingContext 包含 13 个字段** — 单一巨石 Context，违反关注点分离 | 🟡 P1 | TrainingContext.ts |

### 1.3 状态管理层问题（3 项）

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| 10 | **gradesClassesStore 是僵尸代码** — 类型定义存在但从未实现 | 🟢 P2 | types/store.ts |
| 11 | **模块级可变状态管理 token refresh** — isRefreshing/refreshTimer 在 Zustand 外部管理，与 React 生命周期脱钩 | 🟡 P2 | authStore.ts |
| 12 | **401→refresh→retry 逻辑 4 处重复** — client.ts(axios) + chat.ts(fetch) + qa.ts(fetch) + VolcTTSProvider(fetch) | 🟡 P1 | client.ts, chat.ts, qa.ts, VolcTTSProvider |

### 1.4 服务生命周期问题（2 项）

| # | 问题 | 严重度 | 位置 |
|---|------|--------|------|
| 13 | **ScoreManager 构造函数冗余 SSE 注册** — constructor 注册后立即被 setRecordId 覆盖 | 🟢 P3 | ScoreManager.ts |
| 14 | **StreamManager.setRecordId 不中断进行中的流** — 理论上可在 recordId 变更时泄露旧流 | 🟢 P3 | StreamManager.ts |

---

## 二、架构设计原则

基于审计结果，确立以下 5 条原则指导重构：

### 原则 1：数据所有权集中在路由入口

```
❌ 当前:
RouteComponent (lazy)
  └─ useQuery("getX")     ← 首次查询
       └─ ChildA
            └─ useQuery("getX")  ← 二次查询（cache hit 但配置不同）
                 └─ ChildB
                      └─ useQuery("getX")  ← 三次查询

✅ 改进:
RouteComponent (lazy)
  └─ useQuery("getX")     ← 唯一查询，唯一配置
       └─ <DataContext value={data}>
            └─ ChildA (useContext)
                 └─ ChildB (useContext)
```

**规则**：同一 API 端点在一个路由子树中最多 1 个 `useQuery`。下游通过 Context 消费。

### 原则 2：Context 按更新频率分层

```
StaticContext   (不变/极少变): recordId, bus, capabilities, timeLimit
DynamicContext  (高频变):      messages, sending, remainingSeconds
UIStateContext  (UI 状态):     ttsAutoPlay, voiceStatus, activePanel
```

**规则**：一个 Context 中的所有字段应具有相似的更新频率。高频字段不应与静态字段同在。

### 原则 3：服务封装为 Hook，统一生命周期

```
❌ 当前: useRef(new Service()) + 分散的 useEffect(setRecordId) + 手工 dispose
✅ 改进: useService(recordId) → 返回 { service, ... }
         Hook 内部管理: 创建 → setRecordId → cleanup
```

### 原则 4：加载/错误状态契约统一

每个数据消费组件暴露 3 种状态，统一处理模式：

```
{ data, isLoading, error } → <DataGate>
  ├─ isLoading → <Skeleton variant="..." />
  ├─ error     → <ErrorDisplay error={error} onRetry={refetch} />
  └─ !data     → <EmptyState />
       └─ data → {children}
```

### 原则 5：减少 lazy 层级，合并相关 chunk

训练场景的 3 层 lazy（TrainingEntry → Scene → Engine）在 Vite 下收益递减。合并为 1-2 层。

---

## 三、训练页具体重构方案

### 3.1 新的组件树

```
TrainingEntry (route entry, lazy ①)
  │  useTrainingData(recordId) — 唯一查询
  │  retry: 3, staleTime: 30s, gcTime: 10min
  │
  ├─ isLoading → <TrainingSkeleton />    ← 统一骨架屏
  ├─ error     → <ErrorDisplay />
  ├─ !record   → <EmptyState />
  │
  └─ <TrainingDataProvider value={record}>
       │  // record 中包含所有原始数据
       │  // PatientData/ChatMessage[] 由下游 useMemo 派生
       │
       └─ <HistoryTakingScene recordId={recordId} />
            │  // 不再是 lazy — 与 TrainingEntry 合并 chunk
            │  // 或作为独立 chunk 但无自身数据查询
            │
            └─ <TrainingEngine recordId={recordId}>
                 │  // 不再是 lazy — 同步 import
                 │  // 不自行查询数据
                 │
                 ├─ <TrainingStaticProvider>   ← bus, recordId, capabilities, patient, timeLimit
                 │    └─ <TrainingHeader />
                 │    └─ <SceneRenderer />
                 │
                 ├─ <TrainingDynamicProvider>  ← messages, sending
                 │    └─ <ChatArea />
                 │    └─ <InquiryProgress />
                 │
                 ├─ <TrainingUIProvider>       ← ttsAutoPlay, voiceStatus, toggleTts
                 │
                 └─ <PanelStateProvider>       ← emotion, trust, comfort, portraitUrl
```

### 3.2 删除项

| 删除 | 理由 |
|------|------|
| `useTrainingRecord` 中的独立 `useQuery` | 合并到 TrainingEntry 的单一查询 |
| `TrainingEngineContent` 中的 `_restoreRecord` 查询 | 数据已在 TrainingDataContext 中 |
| `queryKeys.training.record` / `.detail` 双命名之一 | 统一为 `.detail`（`record` 作为 alias 保留兼容） |
| `HistoryTakingScene` 内的 `lazy(() => import("@/engine"))` | 改为同步 import |
| `PatientProvider` 中的 `useTrainingRecord` 调用 | 改为从 TrainingDataContext 读取 |

### 3.3 新增项

| 新增 | 用途 |
|------|------|
| `TrainingDataContext` | 训练页唯一数据源，由 TrainingEntry 提供 |
| `TrainingStaticContext` + `TrainingDynamicContext` + `TrainingUIStateContext` | 替代单一 TrainingContext，按更新频率分层 |
| `useTrainingEngine(recordId, bus)` hook | 封装 StreamManager + ScoreManager + TTSManager 生命周期 |
| `DataGate` 组件 | 统一 isLoading/error/empty 三态渲染 |
| `TrainingSkeleton` 组件 | 训练页专属骨架屏，替代嵌套 LoadingState |

### 3.4 关键代码

**TrainingDataContext — 单一数据源**：

```typescript
// frontend/src/engine/TrainingDataContext.ts
import { createContext, useContext } from "react";
import type { components } from "@/api/api-types.gen";

type TrainingRecord = components["schemas"]["TrainingRecordDetail"];

const TrainingDataContext = createContext<TrainingRecord | null>(null);

export function TrainingDataProvider({
  value,
  children,
}: {
  value: TrainingRecord | null;
  children: React.ReactNode;
}) {
  return (
    <TrainingDataContext.Provider value={value}>
      {children}
    </TrainingDataContext.Provider>
  );
}

export function useTrainingData(): TrainingRecord | null {
  return useContext(TrainingDataContext);
}

// 派生 hooks — 从 record 计算，不发起查询
export function usePatientData() {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record) return null;
    // ... 计算 PatientData（原 useTrainingRecord 逻辑）
  }, [record]);
}

export function useInitialMessages() {
  const record = useTrainingData();
  return useMemo(() => {
    if (!record?.messages) return [];
    return record.messages.map(m => ({
      id: String(m.id),
      role: m.role as "student" | "patient" | "system",
      content: m.content,
    }));
  }, [record]);
}
```

**TrainingEntry — 简化后**：

```typescript
// frontend/src/pages/TrainingEntry.tsx
export default function TrainingEntry() {
  const { recordId } = useParams<{ recordId: string }>();

  const { data: record, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.training.detail(recordId ?? ""),
    queryFn: () => getRecordDetail(Number(recordId!)).then(r => r.data),
    enabled: !!recordId,
    retry: 3,
    staleTime: 30_000,
  });

  if (!recordId) return <div>缺少训练记录 ID</div>;
  if (isLoading) return <TrainingSkeleton />;
  if (error) return <ErrorDisplay error={error} onRetry={refetch} />;
  if (!record) return <EmptyState title="记录不存在" />;

  const SceneComponent = TRAINING_SCENES[record.training_type || "history_taking"];
  if (!SceneComponent) return <div>未知训练类型: {record.training_type}</div>;

  return (
    <TrainingDataProvider value={record}>
      {/* 问卷模态框保持不变 */}
      <SceneComponent key={recordId} recordId={recordId} />
    </TrainingDataProvider>
  );
}
```

**TrainingEngine — Context 分层**：

```typescript
// frontend/src/engine/TrainingEngine.tsx (核心部分)
function TrainingEngineContent({ recordId, children }: TrainingEngineProps) {
  const record = useTrainingData();        // ← 从 Context 取，不查询
  const patient = usePatientData();        // ← 派生计算
  const initialMessages = useInitialMessages(); // ← 派生计算

  const bus = useRef(createMessageBus()).current;
  const { stream, score, tts, sending, messages, trainingEnded } =
    useTrainingEngine(recordId, bus, initialMessages); // ← Hook 封装

  // ... emotion/portrait 状态保持不变 ...

  // 分层 Context
  const staticCtx = useMemo(() => ({
    bus, recordId, patient, capabilities, timeLimit: record?.time_limit ?? 20,
    recordDetail: record as TrainingRecordDetail | null,
  }), [bus, recordId, patient, capabilities, record]);

  const dynamicCtx = useMemo(() => ({
    messages, sending,
  }), [messages, sending]);

  const uiCtx = useMemo(() => ({
    ttsAutoPlay, toggleTts, voiceStatus,
    remainingSeconds, endTraining,
  }), [ttsAutoPlay, toggleTts, voiceStatus, remainingSeconds, endTraining]);

  return (
    <TrainingStaticProvider value={staticCtx}>
      <TrainingDynamicProvider value={dynamicCtx}>
        <TrainingUIProvider value={uiCtx}>
          <TrainingHeader />
          <ChatArea />
          {children} {/* SceneRenderer */}
          <ScoringOverlay />
          <ScoreCard />
        </TrainingUIProvider>
      </TrainingDynamicProvider>
    </TrainingStaticProvider>
  );
}
```

**useTrainingEngine — 服务生命周期 Hook**：

```typescript
// frontend/src/engine/useTrainingEngine.ts
export function useTrainingEngine(
  recordId: string,
  bus: MessageBus,
  initialMessages: ChatMessage[],
) {
  const recordNum = Number(recordId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [trainingEnded, setTrainingEnded] = useState(false);

  // 所有服务在 Hook 内部管理生命周期
  const streamRef = useRef<StreamManager | null>(null);
  const scoreRef = useRef<ScoreManager | null>(null);
  const ttsRef = useRef<TTSManager | null>(null);

  // 初始化
  useEffect(() => {
    streamRef.current = new StreamManager(recordNum);
    scoreRef.current = new ScoreManager(recordNum, bus);
    ttsRef.current = new TTSManager({ autoPlay: true, recordId: recordNum });
    ttsRef.current.attach(bus);

    return () => {
      streamRef.current?.dispose();
      scoreRef.current?.dispose();
      ttsRef.current?.detach();
    };
  }, []); // 仅 mount/unmount

  // recordId 变更时更新
  useEffect(() => {
    streamRef.current?.setRecordId(recordNum);
    scoreRef.current?.setRecordId(recordNum);
    ttsRef.current?.setRecordId(recordNum);
  }, [recordNum]);

  // merge initialMessages
  useEffect(() => {
    if (initialMessages.length > 0) {
      streamRef.current?.mergeHistory(initialMessages);
    }
  }, [initialMessages]);

  // subscribe to stream changes
  useEffect(() => {
    const unsub = streamRef.current?.subscribe(() => {
      setMessages([...streamRef.current!.getMessages()]);
    });
    const unsubLoading = streamRef.current?.onLoadingChange(setSending);
    // sync initial state
    setMessages([...streamRef.current!.getMessages()]);
    setSending(streamRef.current?.loading ?? false);
    return () => { unsub?.(); unsubLoading?.(); };
  }, [recordNum]);

  const sendMessage = useCallback(async (text: string) => {
    // ... 保持不变 ...
  }, []);

  const endTraining = useCallback(async () => {
    await scoreRef.current?.end();
    setTrainingEnded(true);
    bus.emit("training:ended");
  }, [bus]);

  return {
    stream: streamRef.current,
    score: scoreRef.current,
    tts: ttsRef.current,
    messages,
    sending,
    trainingEnded,
    sendMessage,
    endTraining,
  };
}
```

---

## 四、全局改进（跨页面）

### 4.1 FeedbackProvider memo 修复

```typescript
// components/FeedbackProvider.tsx
const value = useMemo(
  () => ({ openFeedback, isOpen, showPrompt, setShowPrompt, closeFeedback }),
  [openFeedback, isOpen, showPrompt, closeFeedback],
);
```

### 4.2 TrainingContext 分层（训练页）

见 3.4 节。

### 4.3 401 refresh 去重

将 `chat.ts`、`qa.ts`、`VolcTTSProvider.ts` 中的 fetch 401→refresh→retry 逻辑抽取为共享函数：

```typescript
// api/refresh-utils.ts
export async function fetchWithAuthRefresh(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<Response> {
  const token = useAuthStore.getState().token;
  // ... 统一 401 处理 ...
}
```

### 4.4 queryKeys 清理

```typescript
// api/query-keys.ts
training: {
  // ...
  /** @deprecated use detail() instead — same key */
  record: (id) => queryKeys.training.detail(id),
  detail: (id) => [...queryKeys.training.all, "detail", id] as const,
}
```

### 4.5 gradesClassesStore 僵尸代码删除

```typescript
// types/store.ts — 删除 GradesClassesState 接口
// 该接口从未被实现，当前系统中不存在 gradesClassesStore
```

---

## 五、实施路径

### Phase 1：训练页核心重构（~2 天）

| 步骤 | 内容 | 风险 |
|------|------|------|
| 1 | 创建 `TrainingDataContext` + 派生 hooks | 低（新增文件） |
| 2 | 重构 `TrainingEntry` — 单一查询 + Context 提供 | 中（删除 useTrainingRecord 查询） |
| 3 | 移除 `HistoryTakingScene`/`TriageScene` 内的 `lazy(Engine)` | 低（改 import） |
| 4 | 创建 `useTrainingEngine` hook 封装服务生命周期 | 中（移动逻辑，不改行为） |
| 5 | TrainingContext 分层为 Static/Dynamic/UIState | 中（Consumer 更新） |
| 6 | 回归测试：训练开始→对话→评分→结束全流程 | — |

### Phase 2：全局清理（~1 天）

| 步骤 | 内容 | 风险 |
|------|------|------|
| 7 | FeedbackProvider memo 修复 | 低 |
| 8 | queryKeys 清理（record/detail 统一） | 低（alias 保留兼容） |
| 9 | gradesClassesStore 僵尸代码删除 | 低 |
| 10 | 401→refresh→retry 抽取（chat/qa/TTS） | 中（fetch 行为变更） |

### Phase 3：加载 UX 统一（~1 天）

| 步骤 | 内容 | 风险 |
|------|------|------|
| 11 | 创建 `DataGate` 统一三态组件 | 低 |
| 12 | 创建 `TrainingSkeleton` 训练专属骨架屏 | 低 |
| 13 | 替换各处的 `if (isLoading) return <LoadingState />` | 中（散落改动多） |

---

## 六、不变项（明确不动的部分）

| 项目 | 理由 |
|------|------|
| MessageBus 事件总线 | 经过 TypedMessageBus 封装，类型安全，适合跨组件通信 |
| useTrainingWS WebSocket 单例 | ref-counting 和重连逻辑正确，无需改动 |
| SceneRenderer / SceneToolbar 面板系统 | 插件化架构清晰，仅需改为从分层 Context 消费 |
| QuestionnaireModal 问卷系统 | 独立功能，不在本次重构范围 |
| Admin 页面查询模式 | 每个 admin 页面独立查询各自数据，无重复问题 |
| zustand authStore 核心逻辑 | login/logout/refresh 逻辑正确，只需清理模块级 mutable state |
