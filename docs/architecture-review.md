# 护理虚拟患者模拟系统 — 架构审查与场景系统设计讨论

> 本文档用于汇总当前系统架构现状、已识别的问题、正在讨论的设计方向，供更专业的外部专家评审参考。

---

## 1. 项目概况

护理虚拟患者模拟训练系统 (Nursing VP Sim)，基于 LLM (DeepSeek) 驱动的标准化病人交互。

- **前端**: React 19 + TypeScript + Vite + Tailwind CSS v4 + TanStack Query
- **后端**: FastAPI + SQLAlchemy ORM + PostgreSQL 15 + Alembic
- **LLM**: DeepSeek API，用于患者对话生成、评分、情绪分析
- **部署**: Docker Compose (Staging / Production)，双服务器架构

### 核心业务

护生（学生）与一个 LLM 驱动的虚拟患者进行对话式问诊/分诊训练。学生提问，LLM 扮演患者回答，系统在训练结束后进行评分。

---

## 2. 当前架构

### 2.1 前端训练引擎

```
TrainingEntry (page, /training/:recordId)
  └─ TRAINING_SCENES[type]    ← Record<string, ComponentType<{recordId: string}>>
       ├─ HistoryTakingScene.tsx    (问诊 — 使用 TrainingEngine)
       │    ├─ TrainingEngine
       │    │    ├─ MessageBus      ← 事件总线（引擎内部创建）
       │    │    ├─ StreamManager   ← SSE 流管理
       │    │    ├─ ScoreManager    ← 评分轮询
       │    │    └─ TTSManager      ← 语音合成
       │    └─ TabStack             ← 侧边面板（患者信息/问诊/查体/护理记录/笔记）
       └─ TriageScene.tsx           (分诊 — 完全自定义 UI，不使用 TrainingEngine)
```

**关键观察**：
- `TRAINING_SCENES` 的接口合约仅为 `ComponentType<{ recordId: string }>`——只有一个 recordId。
- `MessageBus` 在 `TrainingEngine` 内部创建，只通过 `PanelContext` 暴露给侧边面板，**场景本身拿不到 bus**。
- 每个场景是一个完全自包含的 React 组件，无共享抽象层。
- `TriageScene` 与 `HistoryTakingScene` 零代码复用。

### 2.2 MessageBus 事件系统

```typescript
// TypedMessageBus — 核心跨组件通信渠道
interface BusEvents {
  "stream:chunk": []                       // LLM 响应流式块
  "stream:done": [text?]                   // 流结束
  "stream:error": [err]                    // 流错误
  "training:ended": []                     // 训练结束
  "score:ready": [score]                   // 评分完成
  "emotion:changed": [{state, trust, comfort}]  // 患者情绪变化
  "initiative:state": [{percent, ...}]     // 患者主动追问计时器
  "initiative:triggered": [{content}]      // 患者主动发起对话
  "portrait:changed": [{url}]             // 头像变更
  "tts:*": [...]                           // TTS 生命周期
  "chat:beforeSend": []                    // 发送消息前
}
```

Bus 是前端唯一的解耦机制，但当前仅限于引擎内部通信，**对场景系统封闭**。

### 2.3 后端管线架构

```
学生消息 → POST /api/chat/{id}/message[/stream]
  │
  ▼
Pipeline (middleware chain):
  [0] phase_guard       — 检查当前阶段允许的操作
  [1] phase_transition  — 自动/手动阶段推进
  [2] prompt_builder    — 组装 LLM 消息（system + dynamic + history）
  [3] llm_caller        — 调用 LLM，含身份泄露检测重试
  [4] persister         — 保存消息到数据库
  [5] side_effects      — 情绪分析 + 主动追问状态
```

**TrainingProfile 系统** —— 每种训练类型定义其行为：

```python
@dataclass
class TrainingProfile:
    name: str
    initial_phase: str
    phases: list[PhaseConfig]
    prompts: PromptCollection
    rubric: dict
    capabilities: list[str]    # 功能开关
    has_emotion: bool
    has_initiative: bool
    note_sources: list[type[NoteSource]]
```

### 2.4 当前场景概念

项目目前仅有"训练场景" (`scenes/` 下的 React 组件)，没有"场景状态"这个一级概念。唯一接近的是：

- `TrainingRecord.runtime_state` (JSONB) — 运行时状态字典
- `case_data` (JSONB) — 病例定义数据
- `practice_snapshot` (JSONB) — 训练配置快照

这些数据都在后端，前端场景需要各自通过 API 独立获取。

### 2.5 患者面部系统

当前实现：基于情绪状态切换静态 PNG 头像。

6 种情绪 → 6 组 PNG → `import.meta.glob` 加载 → 情绪变化时 crossfade 过渡。

```typescript
EMOTION_SUFFIX = {
  withdrawn: "-s", defensive: "-a", anxious: "-n",
  neutral: "", relaxed: "-h", open: "-h",
}
```

近期已改进：交叉过渡时加入 `blur-sm` 滤镜，遮蔽 PNG 间面部位置偏移。

---

## 3. 已发现并解决的问题

### 3.1 Sandbox 独立入口（已定方案）

需要一个不依赖后端、不走完整训练流程的场景开发/调试环境。

**方案**: Vite 多入口 + `VITE_BUILD_SANDBOX` 环境变量。

```typescript
// vite.config.ts
const buildSandbox = process.env.VITE_BUILD_SANDBOX === 'true'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...(buildSandbox && { sandbox: resolve(__dirname, 'sandbox/index.html') }),
      },
    },
  },
})
```

| 阶段 | VITE_BUILD_SANDBOX | 线上能否访问 |
|------|-------------------|-------------|
| Dev | 无所谓 | localhost:3000/sandbox/ 实时可用 |
| Build(当前) | false (默认) | 代码不进 bundle |
| Build(上线时) | true | 独立 entry，nginx 子路径托管 |

### 3.2 患者头像过渡改进（已实施）

原实现中，新图片瞬间全显、旧图淡出，导致"弹跳感"。改进为双向渐变 + 过渡期 `blur-sm` 遮蔽位置偏移。

---

## 4. 核心架构讨论

### 4.1 问题陈述：LLM 兼任了两层职责

当前系统中，LLM 同时扮演两个角色：

1. **患者的声⾳**（应该的）—— 自然语言对话
2. **临床状态的仲裁者**（不应该的）—— 通过回复文本隐式创造临床实时

结果：LLM 回复"我发烧了 38.5 度"时，它在同时做两件事——演戏和决定剧情。结构化数据（case_data 中的 vitals）和 LLM 输出之间没有明确的权威层级。

### 4.2 三层架构模型（提案）

```
┌─────────────────────────────────────────────┐
│  Layer 3: 呈现层 (Presentation)              │
│  · 场景视觉渲染 (2D/3D/无)                   │
│  · 患者面部动画                              │
│  · 环境/设备可视化                           │
│  · 消费 bus 事件，不产生临床状态              │
└──────────────────┬──────────────────────────┘
                   ← MessageBus 广播状态变化
┌──────────────────▼──────────────────────────┐
│  Layer 1: 临床状态层 (Clinical SSOT)         │
│  · 结构化、可测试、LLM 无关                   │
│  · 生命体征 / 查体结果 / 阶段 / 体位          │
│  · 病例作者定义，状态机/操作触发推进           │
│  · SSOT (Single Source of Truth)             │
└──────┬─────────────────────┬────────────────┘
       │ 读 (不写)            │ 读 (不写)
┌──────▼──────────┐  ┌──────▼──────────────────┐
│  Layer 2: 叙事层 │  │  Scene State (提案)      │
│  (LLM)          │  │  · 序列化 memory state   │
│  · 患者自然语言   │  │  · 注入 LLM prompt      │
│  · 情感表达      │  │  · 可选的视觉渲染         │
│  · 只能读临床状态 │  │  · 三层的通讯语言        │
└─────────────────┘  └─────────────────────────┘
```

**关键约束**：

| 操作 | LLM (Layer 2) | 临床状态 (Layer 1) | 场景 (Layer 3) |
|------|:---:|:---:|:---:|
| 决定体温 | ❌ | ✅ | ❌ |
| 决定查体结果 | ❌ | ✅ | ❌ |
| 决定阶段推进 | ❌ | ✅ | ❌ |
| 用语言表述症状 | ✅ | ❌ | ❌ |
| 用视觉呈现病情 | ❌ | ❌ | ✅ |
| 表达情绪 | ✅ 影响 | ✅ 定基线 | ✅ 视觉化 |

### 4.3 "场景"作为轻内存状态（核心洞察）

绕开"3D 场景"的复杂度和视觉陷阱，**场景的本质是一段 LLM 可以读的文本**。

```
场景 = 一段结构化、可序列化的内存状态
       ↓ 注入 LLM prompt
       LLM 自然地在对话中体现场景信息
       ↓ 可选的
       视觉渲染器（给人看）
```

**人可以没有视觉渲染。LLM 不能没有场景状态。**

当前 prompt 中已有类似机制（case_data → prompt builder、emotion state → NoteSource、note_collector），但散落在各模块中，没有统一成"场景状态"这个一级概念。

```typescript
// 提案：统一的 SceneState 结构
interface SceneState {
  environment: {
    type: "icu" | "ward" | "er" | "clinic" | "home"
    time_of_day: "morning" | "day" | "night"
    equipment: string[]          // ["monitor", "iv_pump", "oxygen"]
    lighting?: string
    noise_level?: "quiet" | "moderate" | "loud"
  }
  patient: {
    position: "supine" | "sitting" | "semi-recumbent" | "lateral"
    consciousness: "alert" | "lethargic" | "confused" | "unresponsive"
    visible_symptoms: string[]   // ["pale", "diaphoretic", "jaundiced"]
    expression: EmotionState
    speaking: boolean
  }
  vitals: {
    hr?: number
    bp_sys?: number
    bp_dia?: number
    rr?: number
    spo2?: number
    temp?: number
    pain?: number
  }
  phase: string                  // training phase id
  procedure_step?: number        // for step-by-step procedures
}
```

**这个 SceneState**：

1. 存储在 `TrainingRecord.runtime_state.scene` (JSONB)
2. 每次变更 → `prompt_builder` 注入到 LLM system prompt
3. 每次变更 → `MessageBus` 广播 `scene:changed` → 前端可选渲染
4. 病例作者通过配置和阶段过渡间接控制，不需要直接写 JSON

### 4.4 与现有系统的融合

```
TrainingRecord.runtime_state.scene (JSONB)
       │
       ├──→ prompt_builder: serialize → [{role:"system", content:"场景说明..."}]
       │       ↓
       │    LLM 自然反应 → "大夫，我躺在这儿头晕..."
       │
       ├──→ MessageBus: scene:changed
       │       ↓
       │    前端 SceneRenderer（可选）→ 更新 2D/3D 界面
       │
       └──→ phase transition / exam operations / timers
               ↓
            自动更新 SceneState 字段
```

### 4.5 Sandbox 与两个 DEMO 的重新定位

在这个架构理解下，sandbox 的两个 demo 重新定位：

| Demo | 实质 | 验证目标 |
|------|------|---------|
| **Demo 2D: 点触交互** | 场景状态编辑器 | 验证"状态变化 → LLM 自然反应"的闭环 |
| **Demo 3D: R3F 诊室** | 可选的视觉渲染器 | 验证呈现层和状态层解耦 |

**3D 场景从"必需品"降级为"可插拔的可视化方案"**。核心价值全在 SceneState + LLM prompt injection 管道上。

---

## 5. 待定事项与开放问题

### 5.1 场景状态的来源

- [ ] SceneState 的默认值从 case_data 中派生？还是在 TrainingProfile 中定义？
- [ ] 阶段 (phase) 推进时自动更新哪些字段？——谁来写这个映射？
- [ ] 设备/环境变更谁触发？——Student 操作？定时器？Phase transition？

### 5.2 LLM 的边界

- [ ] LLM 是否应该有任何能力**直接**修改 SceneState？（当前直觉：不应该）
- [ ] 如果学生问"患者看起来脸色苍白吗？"——LLM 可以说"是的我脸色苍白"，但苍白这个状态应该已经在 SceneState 中了。LLM 发现状态和对话不匹配时怎么处理？
- [ ] LLM 生成的"患者体位"和 SceneState 中的体位不一致时，谁优先？

### 5.3 分层边界验证

- [ ] 关掉 LLM（回退脚本）时，临床状态层和呈现层能否独立运行？
- [ ] 关掉视觉渲染（纯文本训练）时，LLM 能否仅靠 SceneState 文本提供足够丰富的体验？
- [ ] 三层架构是否过度设计？是否有更简单的模式既能保持 LLM 灵活性又能保证临床一致性？

### 5.4 场景状态的细粒度

- [ ] SceneState 应该多细？——"患者半卧位 + 面色苍白 + 呼吸急促" 是否应该拆成独立布尔值？
- [ ] 状态变化是离散跳变还是连续过渡？——连续过渡更适合视觉呈现但对 LLM prompt 无意义。
- [ ] 状态历史是否需要追踪？——LLM 需要知道"5 分钟前患者还在笑"吗？

### 5.5 场景作者的体验

- [ ] 场景作者应该写代码，还是配置 JSON，还是通过可视化编辑器编辑 SceneState？
- [ ] 场景的"可移植性"意味着什么？——场景定义 = JSON 配置 + 可选的 React 组件？
- [ ] 复杂场景（如多步骤护理操作）是否应该有自己的小型状态机，与 Layer 1 的主状态机协同？

### 5.6 与现有 Capability 系统的关系

当前 Capability 系统 (`backend/core/capabilities.py`) 定义了功能开关：`emotion`、`patient_initiative`、`physical_exam`、`questionnaire`。SceneState 应该是 Capability 的下层承载机制吗？即：

- 开启 `physical_exam` → SceneState 中增加 exam 相关字段
- 开启 `emotion` → SceneState 中增加 emotion 字段

---

## 6. 关键代码路径

| 路径 | 说明 |
|------|------|
| `frontend/src/engine/TrainingEngine.tsx` | 主训练引擎，创建 MessageBus |
| `frontend/src/engine/MessageBus.ts` | 类型化事件总线 |
| `frontend/src/engine/types.ts` | 核心类型：PanelContext, PanelHooks, PanelDef |
| `frontend/src/training/scenes/registry.ts` | 场景注册表 |
| `frontend/src/training/scenes/HistoryTakingScene.tsx` | 问诊场景 |
| `frontend/src/training/scenes/TriageScene.tsx` | 分诊场景 |
| `frontend/src/components/training/PatientPortrait.tsx` | 患者头像组件 |
| `backend/profiles/registry.py` | TrainingProfile 注册系统 |
| `backend/contexts/training/pipeline/` | 消息处理管线 |
| `backend/contexts/training/pipeline/phase.py` | 阶段状态机 |
| `backend/contexts/training/pipeline/middleware/prompt_builder.py` | LLM prompt 组装 |
| `backend/core/capabilities.py` | 功能开关系统 |

---

## 7. 当前讨论焦点（供专家评审参考）

1. **三层架构是否合理？** 临床状态层、LLM 叙事层、呈现层——是否缺一层或多一层？
2. **LLM 的职权边界在哪里？** 读临床状态但不可修改——这是否可实施？LLM 生成的文本隐式包含了临床信息，如何和结构化状态协调？
3. **场景作为"可注入 LLM prompt 的轻内存状态"**——这个抽象级别是否准确？是否有现成设计模式可以参考？
4. **从纯文本到 3D 渲染的渐进路径**——SceneState 是否足够灵活同时支持文本注入和未来 3D 呈现？
5. **与其他 LLM-VP 系统的横向对比**——类似系统（如 Body Interact、Shadow Health、PCS Spark）如何处理场景与 LLM 的关系？
6. **是否存在我们没看到的技术债务风险？** 当前架构中哪些决策会在未来 6 个月成为瓶颈？
