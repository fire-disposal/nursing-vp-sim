# 训练页面加载体验问题分析

> 2026-07-27 · 问题：首次启动训练页面必然白屏，刷新或导航返回重进后才正常

---

## 一、现状数据流全景

```
TrainingSelect（病例选择页）
  │ startTraining(caseId) → POST /api/training/start
  │ backend: _create_record → db.commit() → 返回 record_id
  │ onSuccess → navigate(`/training/${recordId}`)
  ▼
<App Suspense fallback={<PageLoader />}>
  └─ <Layout>
       └─ <AdaptiveShell>        ← 根据路由匹配 activity="practice"
            └─ <PracticeShell>    ← <div className="relative">
                 └─ <ShellTransition>  ← motion.div opacity 0→1 fade
                      └─ <Outlet />
                           └─ TrainingEntry                      [lazy ①]
                                │ useQuery ①: queryKeys.training.record(recordId)
                                │   queryFn: getRecordDetail(Number(recordId))
                                │   retry: 5, gcTime: 10min (default)
                                │   用途: 路由守卫 loading gate
                                │
                                ├─ isLoading → <LoadingState />
                                ├─ error    → 错误 UI + 重试按钮
                                ├─ !record  → "记录不存在"
                                │
                                └─ <SceneComponent key={recordId} /> [lazy ②]
                                     └─ HistoryTakingScene
                                          │ <Suspense fallback={<LoadingState />}>
                                          └─ <TrainingEngine>        [lazy ③]
                                               └─ <PatientProvider>
                                               │    └─ useTrainingRecord(recordId)
                                               │         useQuery ②: queryKeys.training.detail(recordId)
                                               │           queryFn: getRecordDetail(recordId)
                                               │           staleTime: 5min, gcTime: 5min
                                               │           refetchInterval: 15s (status=in_progress)
                                               │           用途: patient/capabilities/initialMessages
                                               │
                                               └─ TrainingEngineContent
                                                    │ useQuery ③: queryKeys.training.record(String(recordNum))
                                                    │   用途: _restoreRecord (emotion/scene 播种)
                                                    │
                                                    ├─ if (loading)  → <LoadingSkeleton />
                                                    ├─ if (!patient) → "患者信息加载失败"
                                                    └─ 正常渲染 → ChatArea + Panels + Scoring
```

**同一数据 3 个 observer**（query key 均为 `["training", "detail", id]`），分布在 3 个不同组件层级。

---

## 二、白屏根因

### 根因 A（主因）：Suspense 边界撕裂 React Query observer 生命周期

训练页的加载涉及 **3 层 lazy 代码分割**，每层都触发 App 顶层 `<Suspense>` 回退到 `<PageLoader />`：

| 层级 | 组件 | lazy 位置 | Suspense 载体 |
|------|------|-----------|---------------|
| ① | TrainingEntry | `navigation.tsx:25` | App.tsx `<Suspense>` |
| ② | SceneComponent | `scene-registry.ts:7` | App.tsx `<Suspense>` |
| ③ | TrainingEngine | `HistoryTakingScene.tsx:6` | HistoryTakingScene 内 `<Suspense>` |

**关键时序**：

```
T0   navigate(/training/123)
T1   App Suspense catch TrainingEntry ①    → <PageLoader />
T2   TrainingEntry chunk loaded
T3   TrainingEntry mount → useQuery ① fires → isLoading: true
     → TrainingEntry renders <LoadingState />  (useQuery ① observer = 1)
T4   API 响应 → isLoading: false → record 存在
T5   TrainingEntry 尝试渲染 <SceneComponent /> [lazy ②]
     → React throw promise → App Suspense catch → <PageLoader />
     → ⚠️ TrainingEntry 渲染树被 React 丢弃
     → useQuery ① observer 被卸载 (observer count → 0)
T6   SceneComponent chunk loaded
T7   React 重新渲染 TrainingEntry（全新 mount）
     → useQuery ① 重新订阅缓存 → observer count: 0→1
     → isLoading: false（数据在缓存中） → 渲染 SceneComponent（已加载）
     → HistoryTakingScene mount → TrainingEngine [lazy ③]
     → HistoryTakingScene 内 Suspense catch → <LoadingState className="h-full" />
T8   TrainingEngine chunk loaded
     → PatientProvider mount → useTrainingRecord 订阅缓存 (observer count: 1→2)
     → TrainingEngineContent render
```

**正常路径**（T0-T8）中，由于 React Query 的 `gcTime: 10min`（App.tsx 默认配置），缓存不会在 Suspense 期间被 GC，所以 T7 时数据仍在。

**但存在以下退化场景**：

1. **冷启动 + 慢网络**：T3 的 `getRecordDetail` 和 T5/T7 的 chunk 加载叠加，总耗时可能超过 10 秒。用户感知为多段 loading spinner 交替闪烁，被误认为"白屏"。

2. **后端冷启动**：首次 `getRecordDetail` 触发 Python 模块加载、DB 连接池初始化等，响应时间可能超过 axios 的 120s 默认超时。若 5 次重试全部超时，进入 error 状态。

3. **Suspense + refetch 竞态**：`useTrainingRecord` 设置了 `staleTime: 5min`。当 T7 重新订阅时，如果数据恰好被标记为 stale，React Query 会**同时**返回缓存数据 + 触发后台 refetch。`query.isLoading` 为 false（有缓存），但 `query.isFetching` 为 true。如果 TrainingEngineContent 在 refetch 期间检查了 `isFetching`（虽然当前代码只检查 `isLoading`），可能出现闪烁。

### 根因 B（数据流）：PatientProvider 的 `loading`/`patient` 二态死胡同

```typescript
// PatientProvider.tsx
const value = useMemo(() => ({
    patient: data?.patient ?? null,   // ⚠️ 可能为 null
    loading,                           // ⚠️ 可能为 false
}), [data, loading, error]);

// TrainingEngineContent.tsx:321-339
if (loading) return <LoadingSkeleton />;           // 状态 1
if (!patient) return <div>患者信息加载失败</div>;    // 状态 2 ← 死胡同
```

**触发条件**：
- `getRecordDetail` 返回成功（非 error）
- 但响应中 `patient_info` 为 `null` 或 `{}`
- 或者后端因某种原因返回了不含 `patient_info` 的响应

此时 `loading === false`（query 成功），`patient === null`（数据为空），进入状态 2。**这是死胡同状态**——无自动恢复、无重试、无有效的用户操作路径。用户看到"患者信息加载失败"文字，可能将其描述为"白屏"。

**为什么刷新后正常**：后端 warm-up 后响应包含完整数据，`patient` 正确填充。

### 根因 C（架构）：三层查询的选项不一致

| | useQuery ① (TrainingEntry) | useQuery ② (useTrainingRecord) | useQuery ③ (TrainingEngineContent) |
|---|---|---|---|
| `queryKey` | `record(recordId)` | `detail(recordId)` | `record(String(recordNum))` |
| `retry` | **5** | 1 (default) | 1 (default) |
| `staleTime` | 30s (default) | **5min** | 30s (default) |
| `gcTime` | 10min (default) | **5min** | 10min (default) |
| `refetchInterval` | - | **15s** (polling) | - |

虽然三者共享同一 query key（均为 `["training", "detail", id]`），但 React Query 在合并选项时使用**最高值策略**（如 staleTime 取最大值）。这意味着实际生效的选项取决于 observer 的订阅顺序：

- 如果 ① 先订阅 → staleTime=30s → ② 订阅 → staleTime 变为 5min
- 如果 ② 先订阅 → staleTime=5min → ① 订阅 → staleTime 保持 5min

**实际风险**：Suspense 重渲染期间，① 被卸载 → 只剩 ②（如果已挂载）或 0 个 observer。当 ① 重新订阅时，options merge 可能触发非预期行为（如从 5min staleTime 切换回 30s）。

### 根因 D（加载 UX）：连续 3 段 loading 状态

用户从点击"开始训练"到看到训练 UI：

```
点击按钮 → PageLoader(①) → LoadingState(数据) → PageLoader(②) → LoadingState(③) → 训练 UI
           ↑ 训练模块 JS    ↑ API 请求            ↑ 场景模块 JS    ↑ 引擎模块 JS
              0.5-2s            0.1-1s               0.3-1s            0.3-1s
```

**总计 3-6 秒的加载动画**，其中包含 2 次 `<PageLoader />`（全屏 spinner）和 2 次 `<LoadingState />`。在慢网络下，用户看到 4 段不同的 loading UI 依次闪烁，感知为"白屏、不动、卡死"。

**为什么刷新后正常**：JS chunks 被浏览器缓存（disk cache），②③ 的 lazy 加载近乎瞬时，仅剩一次 API 调用。

---

## 三、改进方案

### 方案 1（推荐：治本）：单数据源 + 消除冗余查询

**核心思路**：将训练页的查询职责收归 `TrainingEntry`，通过 Context 向下传递，消除多层查询。

```typescript
// === TrainingEntry.tsx (改造后) ===
export default function TrainingEntry() {
    const { recordId } = useParams<{ recordId: string }>();

    const query = useQuery({
        queryKey: queryKeys.training.record(recordId),
        queryFn: () => getRecordDetail(Number(recordId!)).then((r) => r.data),
        enabled: !!recordId,
        retry: 3,             // 减少至合理值
        staleTime: 30_000,
    });

    // ... loading/error guards ...

    return (
        <TrainingDataProvider value={query.data}>
            <SceneComponent key={recordId} recordId={recordId} />
        </TrainingDataProvider>
    );
}

// === PatientProvider.tsx (改造后) ===
// 不再自行 useQuery，改为从 TrainingDataContext 读取
export function PatientProvider({ recordId, children }) {
    const record = useTrainingData();  // ← 从 Context 取
    const value = useMemo(() => ({
        patient: /* 从 record 计算 */,
        loading: !record,
        ...
    }), [record]);
    return <PatientContext.Provider value={value}>{children}</PatientContext.Provider>;
}

// === useTrainingRecord.ts → 删除 ===
// 功能合并到 TrainingDataContext
```

**变更量**：
- 新增 `TrainingDataContext`（~30 行）
- 删除 `useTrainingRecord` 中的独立 `useQuery`（~10 行净删除）
- 删除 `TrainingEngineContent` 中的 `_restoreRecord` 独立查询（~20 行删除）
- `PatientProvider` 改为从 context 读取（~5 行修改）

**收益**：
- 单一数据源，无 observer 生命周期冲突
- 无 Suspense 重渲染导致的查询卸载问题
- 减少 2 次不必要的 `getRecordDetail` 请求

### 方案 2（快速修复：治标）：`useSuspenseQuery` + 减少 lazy 层级

```typescript
// TrainingEntry.tsx
import { useSuspenseQuery } from "@tanstack/react-query";

const { data: record } = useSuspenseQuery({
    queryKey: queryKeys.training.record(recordId),
    queryFn: () => getRecordDetail(Number(recordId!)).then((r) => r.data),
});
// Suspense 挂起时 React Query 保持 observer 存活，不会被卸载
```

同时合并 HistoryTakingScene 和 TrainingEngine 为单一 chunk：

```typescript
// HistoryTakingScene.tsx
import { TrainingEngine } from "@/engine";  // 同步 import，非 lazy

export default function HistoryTakingScene({ recordId }) {
    return (
        <div className="flex flex-col h-screen overflow-hidden" style={{ height: "100dvh" }}>
            <TrainingEngine recordId={recordId}>
                <SceneRenderer />
            </TrainingEngine>
        </div>
    );
}
```

消除 2 层 lazy 边界（从 3 层减为 1 层），减少 Suspense 挂起次数。

**变更量**：~15 行修改。

**风险**：`TrainingEngine` 不再代码分割，首屏 JS bundle 增大 ~15KB（gzip）。对于训练页这种低频访问页面，收益大于成本。

### 方案 3（防御性修复）：PatientProvider 死胡同恢复

```typescript
// PatientProvider.tsx
const [retryCount, setRetryCount] = useState(0);

const value = useMemo(() => ({
    patient: data?.patient ?? null,
    loading,
    error,
    retry: () => setRetryCount(c => c + 1),  // ← 新增
}), [data, loading, error, retryCount]);

// TrainingEngineContent.tsx
if (loading) return <LoadingSkeleton />;
if (!patient) {
    return (
        <div className="flex h-screen items-center justify-center">
            <div className="text-center">
                <p className="text-muted-foreground mb-3">{error || "患者信息加载失败"}</p>
                <Button onClick={() => window.location.reload()}>刷新页面</Button>
            </div>
        </div>
    );
}
```

**变更量**：~10 行。

### 方案 4（加载 UX 优化）：骨架屏 + 渐进式渲染

替代多段 loading spinner 为单一骨架屏：

```typescript
// TrainingEntry.tsx
if (isLoading) {
    return (
        <div className="flex flex-col h-screen" style={{ height: "100dvh" }}>
            <div className="p-3 border-b">
                <LoadingSkeleton variant="stats" />
            </div>
            <div className="flex-1 p-4 flex flex-col gap-4">
                <LoadingSkeleton variant="card" className="flex-1" />
                <div className="h-12">
                    <LoadingSkeleton variant="text" />
                </div>
            </div>
        </div>
    );
}
```

这样在整个加载链（TrainingEntry → SceneComponent → TrainingEngine）完成之前，用户只看到一段连续的骨架屏，而非 4 段交替的 spinner。

---

## 四、状态管理改进方向

### 当前问题

1. **数据所有权分散**：同一份 `TrainingRecordDetail` 被 3 个 hooks 独立查询
2. **Context 层次过深**：TrainingContext → PanelContext → PatientContext，数据通过多层 Provider 传递
3. **ref + class 混用**：StreamManager、ScoreManager、TTSManager 通过 `useRef` 创建，与 React 渲染周期脱钩
4. **MessageBus 事件驱动**：组件间通信依赖自定义事件总线，缺乏类型安全和可追溯性

### 改进方向

```
现状:
TrainingEntry (data fetch)
  └─ Scene (lazy boundary)
       └─ TrainingEngine (data fetch AGAIN)
            └─ PatientProvider (data fetch AGAIN + Context)
                 └─ TrainingEngineContent (combine + render)

改进后:
TrainingEntry (data fetch + TrainingDataContext)
  └─ Scene (single lazy boundary)
       └─ TrainingEngine (consumer only, no fetch)
            └─ PatientProvider (consumer only, compute from context)
                 └─ TrainingEngineContent (render)
```

**原则**：
1. 数据查询集中在路由入口组件
2. 下游组件通过 Context 消费，不做独立查询
3. 减少 lazy 层级：场景 + 引擎合并为单个 chunk
4. `useRef` 创建的服务对象应封装在自定义 hook 中，统一生命周期管理

---

## 五、优先级建议

| 优先级 | 方案 | 原因 |
|--------|------|------|
| **P0** | 方案 2（useSuspenseQuery + 减少 lazy） | 最小改动，解决核心 Suspense 撕裂问题 |
| **P0** | 方案 3（死胡同恢复） | 防御性修复，避免不可恢复的错误状态 |
| **P1** | 方案 4（骨架屏） | 提升加载 UX，减少用户困惑 |
| **P2** | 方案 1（单数据源重构） | 架构优化，需较大变更量，建议在训练类型插件化重构时一并完成 |
