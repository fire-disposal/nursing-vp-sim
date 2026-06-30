# Scene 系统与主训练流程的集成方案

> 基于沙盒中验证的 SceneProps 协议，分析如何将场景系统接入现有的 TrainingEngine + LLM Pipeline。

---

## 1. 现状：场景与训练的间隙

### 前端缺口

`TRAINING_SCENES` 注册表只传 `recordId`，场景拿不到 `MessageBus`：

```
TrainingEntry
  └─ TRAINING_SCENES[type] ──→ ComponentType<{ recordId: string }>
       │
       └─ HistoryTakingScene
            ├─ TrainingEngine     ← bus 在此内部创建，不对外暴露
            └─ TabStack (panels)  ← panels 通过 PanelContext 拿 bus

  → 场景完全无法监听或发送 bus 事件
  → 沙盒中的 SceneProps (bus + mode) 无法直接使用
```

`TrainingContext` 当前导出值：

```typescript
interface TrainingContextValue {
  recordId, patient, features, ttsAutoPlay, sending,
  featuresLocked, fromAssignment, timeLimitMinutes,
  remainingSeconds, voiceStatus,
  toggleFeature, toggleTts, endTraining
  // ❌ bus 不在其中
}
```

### 后端缺口

LLM prompt 装配（`prompt_builder.py`）只注入了 `case_data` + `author_note`。没有「场景状态」这个一级概念：

```python
# 当前 kwargs 进入 prompt
kwargs = {
    "patient_name": ..., "chief_complaint": ...,
    "personality": ..., "emotion_note": ...,
    "author_note": ...,
    # ❌ 没有 scene_state: { environment, patient_position, vitals, ... }
}
```

---

## 2. 集成协议

### 2.1 核心机制：MessageBus 是唯一的耦合界面

场景不直接引用 TrainingEngine、不调用 API、不依赖 React Context。它只和 `MessageBus` 对话。

```
┌──────────────┐    消费事件          ┌──────────────┐
│  TrainingEngine │ ────────────────→ │    场景       │
│  (LLM / Pipeline)│                   │  (3D / 2D)   │
│              │ ←──────────────── │              │
└──────────────┘    发送事件          └──────────────┘
     │                                      │
     │ 内部                                  │ 内部
     ▼                                      ▼
 对话 + 评分 + 情绪                      渲染 + 交互
```

### 2.2 事件清单

**场景消费的事件**（Training → Scene）：

| 事件 | 数据 | 触发时机 | 场景响应 |
|------|------|---------|---------|
| `emotion:changed` | `{ state, trust, comfort }` | 每轮 LLM 回复 | 更新患者面部表情、色调 |
| `scene:state` | `Partial<SceneState>` | phase 切换 / 操作触发 | 更新环境/设备/体位 |
| `initiative:triggered` | `{ content }` | 患者主动发言 | 患者动作/口型 |
| `training:ended` | — | 训练结束 | 场景淡出/关闭 |
| `vitals:updated` | `{ hr, bp, spo2, ... }` | 查体操作 | 监护仪数值变化 |

**场景发送的事件**（Scene → Training）：

| 事件 | 数据 | 含义 | 可能被谁消费 |
|------|------|------|------------|
| `scene:interaction` | `{ hotspotId }` | 学生点击了某物体 | TrainingEngine → 触发 `sendMessage` 或 exam 操作 |
| `scene:observation` | `{ observation, confidence }` | 学生注意到某个体征 | Scoring → 记录观察项 |
| `scene:completed` | `{ procedureId }` | 操作步骤完成 | Phase → 推进阶段 |

### 2.3 SceneState 结构（前后端共享）

```typescript
// frontend sandbox 已定义的 SceneState
// 后端也需要相同的结构
interface SceneState {
  environment: {
    type: "icu" | "ward" | "er" | "clinic" | "home"
    time_of_day: "morning" | "day" | "night"
    equipment: string[]
    noise_level?: "quiet" | "moderate" | "loud"
  }
  patient: {
    position: "supine" | "sitting" | "semi-recumbent" | "lateral"
    consciousness: "alert" | "lethargic" | "confused" | "unresponsive"
    visible_symptoms: string[]
    expression: string
  }
  vitals: {
    hr?: number; bp_sys?: number; bp_dia?: number
    rr?: number; spo2?: number; temp?: number
    pain?: number
  }
  phase: string
  procedure_step?: number
}
```

---

## 3. 前端集成方案（最小变更路径）

### 3.1 暴露 bus 给场景

**修改 `TrainingContext`** —— 增加 `bus` 字段：

```typescript
// TrainingContext.ts
+ import type { MessageBus } from "./types"

export interface TrainingContextValue {
+ bus: MessageBus         // ← 新增
  recordId: string
  // ... 其余不变
}
```

**修改 `TrainingEngine.tsx`** —— 在 context value 中注入 bus：

```typescript
<TrainingContext.Provider value={{
+ bus: busRef.current,
  recordId, patient, features,
  // ...
}}>
```

### 3.2 场景连接 bus

场景拿到 bus 后，直接复用沙盒中的 `SceneProps` 接口：

```typescript
// 在 HistoryTakingScene.tsx 中
function HistoryTakingScene({ recordId }) {
  const { bus } = useTrainingContext()  // ← 现在拿得到

  return (
    <div className="flex h-screen">
      <div className="flex-1 min-w-0">
        <TrainingEngine recordId={recordId} />
      </div>
+     <SceneRenderer
+       bus={bus}
+       mode="training"
+       recordId={recordId}
+     />
      <TabStack tabs={tabs} />
    </div>
  )
}
```

### 3.3 组件树变化

```
Before:
  HistoryTakingScene
    ├─ TrainingEngine (bus 私有的)
    └─ TabStack

After:
  HistoryTakingScene
    ├─ TrainingEngine (bus 通过 context 暴露)
    ├─ SceneRenderer (从 context 取的 bus)
    └─ TabStack
```

SceneRenderer 就是一个适配器，根据 `training_type` 选择加载哪个场景组件：

```typescript
function SceneRenderer({ bus, mode, recordId }: SceneProps & { recordId: string }) {
  // 从 record 读取 training_type，加载对应场景
  // 或者通过 profile 的 manifest 声明是否启用场景
  return <Scene3D bus={bus} mode={mode} />
}
```

---

## 4. 后端集成方案

### 4.1 运行时存储

`TrainingRecord.runtime_state` 已是一个 JSONB 字段，新增 `scene` 键：

```python
# runtime_state 结构
{
    "exam_results": {...},
    "phase_op_count": {...},
+   "scene": {
+       "environment": {"type": "ward", ...},
+       "patient": {"position": "semi-recumbent", ...},
+       "vitals": {"hr": 88, ...},
+       "phase": "history_taking"
+   }
}
```

### 4.2 Prompt 注入

在 `prompt_builder.py` 中的 `kwargs` 增加 `scene_state`：

```python
kwargs = {
    **cached,
    "author_note": author_note,
+   "scene_state": format_scene_for_prompt(ctx.record.runtime_state.get("scene", {})),
}
```

其中 `format_scene_for_prompt` 将场景状态序列化成一段自然语言描述：

```python
def format_scene_for_prompt(scene: dict) -> str:
    env = scene.get("environment", {})
    pt = scene.get("patient", {})
    vt = scene.get("vitals", {})
    parts = [
        f"当前环境: {env.get('type', '诊室')}",
        f"患者体位: {pt.get('position', '平卧')}",
        f"意识状态: {pt.get('consciousness', '清醒')}",
    ]
    if vt.get("hr"): parts.append(f"心率: {vt['hr']}")
    if vt.get("spo2"): parts.append(f"血氧: {vt['spo2']}%")
    return "；".join(parts)
```

LLM prompt 将包含类似：

```
[场景信息]
当前环境: 内科病房；患者体位: 半卧位；意识状态: 嗜睡
心率: 112；血氧: 94%
```

LLM 自然在对话中体现这些信息，无需额外编排。

### 4.3 状态更新触发器

| 触发动作 | 更新的 SceneState 字段 |
|---------|----------------------|
| Phase 转换 | `phase`, `patient.position` |
| 查体操作 (vitals) | `vitals.*` |
| 学生长时间无操作 | `patient.consciousness` (恶化) |
| 学生给出正确治疗 | `patient.expression` (好转) |
| 定时事件 | `environment.time_of_day` |

状态更新在 service 层完成，通过 UoW 持久化后，广播 bus 事件到前端。

---

## 5. 场景的启用/禁用

通过现有的 `Capability` 系统控制：

```python
# core/capabilities.py
ALL_CAPABILITIES = {
    ...
+   "scene_3d": Capability(
+       key="scene_3d",
+       label="3D 场景渲染",
+       default=False,
+       description="启用 3D 诊室环境渲染",
+   ),
}
```

老师在创建练习时勾选 "启用 3D 场景" → `features.scene_3d = true` → 前端才加载 `SceneRenderer`。

---

## 6. 从沙盒到生产的迁移路径

```
阶段 1（当前）
  沙盒：独立 localhost:4000，MockBus
  主应用：无场景

阶段 2（最小集成）
  沙盒：不变
  主应用：TrainingContext 暴露 bus
         HistoryTakingScene 可选加载 Scene3D（被 capa 开关控制）
         场景只消费事件（emotion:changed），不发送

阶段 3（双向通信）
  场景发送 scene:interaction / scene:observation
  TrainingEngine 响应这些事件（触发 exam / sendMessage）

阶段 4（完整闭环）
  后端 SceneState 持久化 + prompt 注入
  场景状态随 phase / exam / timer 自动更新
  场景作者只写 SceneState 配置，不碰业务逻辑
```

---

## 7. 关键决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 场景如何拿 bus | 从 TrainingContext 暴露 | 最小改动，场景只需 useTrainingContext() |
| 场景在哪渲染 | HistoryTakingScene 层 | 场景是布局级元素，不应嵌在 TrainingEngine 内 |
| 场景是否可选 | 是（Capability 开关） | 老师可以按练习关闭 3D 场景 |
| LLM 如何感知场景 | Prompt 注入 scene_state | 无需额外 API，LLM 自然反应 |
| 场景状态谁更新 | 后端 service 层 | 避免 LLM 篡改临床状态（SSOT 原则） |
