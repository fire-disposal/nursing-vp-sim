# 训练页面插件化架构设计

> 状态：已核准 | 日期：2026-06-09

---

## 1. 问题陈述

### 当前架构痛点

**前端**：
- `ChatTraining.tsx`（413 行）是"超级组件"，管理 22+ state 变量、8 个 hooks、7 个子组件
- `AdminDebugPage.tsx`（491 行）独立实现，与 ChatTraining 大量重复代码
- 训练功能（查体、语音、问卷、主动追问等）与页面强耦合，无统一启用/禁用机制
- 布局硬编码为"左侧患者信息 + 中间聊天 + 右侧面板"，无法按场景切换
- 无移动端布局特化，H5 适配困难

**后端**：
- 流水线中间件链硬编码在 `registry.py`，不可按场景动态组装
- 情绪状态机在 `prompt_builder.py` 中始终运行，feature flag 关闭时仍有代码路径
- 主动回复计时器在 `side_effects.py` 中始终重置，不激活时仍有开销
- 查体操作检测/执行中间件在 flag 关闭时执行空跑逻辑
- "先执行再判断"的伪开关 —— 非真正插件化

### 目标

1. **功能可插拔**：训练功能可独立启用/禁用/替换，互不影响
2. **调试与生产统一**：AdminDebugPage 复用 TrainingEngine，仅插件集合不同
3. **第三方可扩展**：通过正式接口契约，外部可开发自定义插件
4. **移动端原生兼容**：布局系统感知 viewport，自动适配 desktop/tablet/mobile
5. **场景驱动**：训练模式（病史采集、查体、综合仿真、急救演练等）为一等概念，前后端联动

---

## 2. 核心架构

### 2.1 分层总览

```
┌──────────────────────────────────────────────────────────┐
│ 页面层 (Pages)                                            │
│ ┌───────────────────────┐  ┌─────────────────────────────┐│
│ │ ChatTraining.tsx ~30行│  │ AdminDebugPage.tsx ~30行    ││
│ │ <TrainingEngine       │  │ <TrainingEngine             ││
│ │  scenario="history"   │  │  scenario="history"         ││
│ │  recordId={id} />     │  │  recordId={id}              ││
│ │                       │  │  extraPlugins={[devTools]} />││
│ └───────────┬───────────┘  └──────────────┬──────────────┘│
├─────────────┼──────────────────────────────┼──────────────┤
│ 引擎层      ▼                              ▼              │
│ ┌───────────────────────────────────────────────────────┐ │
│ │              TrainingEngine                           │ │
│ │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │ │
│ │  │PluginReg │ │MessageBus│ │SlotRender│ │Lifecycle │ │ │
│ │  │istry     │ │(event)   │ │(自适应)  │ │hooks     │ │ │
│ │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ │ │
│ │  ┌──────────┐ ┌──────────┐ ┌─────────────────────┐   │ │
│ │  │StreamMgr │ │ScoreMgr  │ │PatientProvider      │   │ │
│ │  │(不可替换)│ │(不可替换)│ │(不可替换)           │   │ │
│ │  └──────────┘ └──────────┘ └─────────────────────┘   │ │
│ └───────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────┤
│ 前端插件层                                                │
│ ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐  │
│ │patient   │ │chatInput │ │voice    │ │physicalExam  │  │
│ │Plugin    │ │Plugin    │ │Plugin   │ │Plugin        │  │
│ └──────────┘ └──────────┘ └─────────┘ └──────────────┘  │
│ ┌──────────┐ ┌──────────┐ ┌─────────┐ ┌──────────────┐  │
│ │timer     │ │question- │ │scoring  │ │inquiry       │  │
│ │Plugin    │ │naire     │ │Plugin   │ │Plugin        │  │
│ └──────────┘ └──────────┘ └─────────┘ └──────────────┘  │
│ ┌──────────┐ ┌──────────┐                               │
│ │initiative│ │nursing   │  + 预留第三方插件槽位          │
│ │Plugin    │ │Record    │                               │
│ └──────────┘ └──────────┘                               │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│ 后端流水线                                                │
│ ┌──────────────────────────────────────────────────────┐ │
│ │              PipelineRunner                          │ │
│ │  动态组装: core_chain + active_plugin_middlewares    │ │
│ │                                                     │ │
│ │  core_chain = [phase_guard, phase_transition,        │ │
│ │               prompt_builder, llm_caller, persister] │ │
│ │                                                     │ │
│ │  plugin_middlewares (按插件注入):                    │ │
│ │    情绪插件激活 → [+emotion_tracker,                 │ │
│ │                     +emotion_author_note]            │ │
│ │    查体插件激活 → [+operation_detector,              │ │
│ │                     +operation_executor,             │ │
│ │                     +exam_anchor_note]               │ │
│ │    主动回复插件激活 → [+initiative_timer_reset]      │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 2.2 边界定义

**核心引擎（不可插拔，不可替换）**：
| 模块 | 前/后端 | 职责 |
|------|---------|------|
| StreamManager | 前端 | SSE 消息发送/接收/abort |
| ScoreManager | 前端 | 结束训练 → 轮询评分 → 进度 |
| PatientProvider | 前端 | 加载 record → Context 提供患者数据 |
| PluginRegistry | 前端 | 注册/解析/启用插件 |
| MessageBus | 前端 | 插件间事件订阅/发布 |
| SlotRenderer | 前端 | 按 layout 定义渲染各 slot |
| phase_guard | 后端 | 验证当前阶段有效 |
| phase_transition | 后端 | 阶段切换逻辑 |
| prompt_builder | 后端 | 组装 LLM 消息（收集插件注入的 author_note） |
| llm_caller | 后端 | LLM 调用 |
| persister | 后端 | 消息持久化 |

**插件（可插拔，可替换，可第三方扩展）**：
| 插件 ID | 层 | 功能 |
|---------|----|------|
| timer | 前端 | 倒计时 + 超时自动结束 |
| voice | 前端 | TTS 朗读 + 语音输入 |
| inquiry | 前端 | 问诊清单进度 |
| physical-exam | 前端 | 查体操作面板 |
| nursing-record | 前端 | 护理记录面板 |
| questionnaire | 前端 | 前/后问卷 |
| patient-initiative | 前端 | 主动追问轮询 |
| scoring-display | 前端 | 评分结果展示 |
| emotion | 后端 | 5 态情绪状态机 |
| initiative | 后端 | 主动回复计时器 + 消息生成 |
| physical-exam | 后端 | 操作检测 + 执行 + 锚点数据 |

---

## 3. 前端插件接口

### 3.1 TypeScript 接口

```typescript
interface TrainingPlugin {
  /** 全局唯一标识 */
  id: string;

  /** 显示名称 */
  name: string;

  /** 关联后端 feature flag key，未设置 = 始终启用 */
  featureFlag?: string;

  /** 依赖的其他插件 ID */
  requires?: string[];

  /** UI 注入点：slot 名称 → React 组件 */
  slots?: Partial<Record<SlotName, React.FC<SlotProps>>>;

  /** 生命周期钩子 */
  hooks?: Partial<LifecycleHooks>;

  /** 轮询配置（如 initiative 需要轮询 state） */
  pollConfig?: PollConfig;
}

type SlotName =
  | 'header'          // 顶部操作栏
  | 'sidebar'         // 左侧信息区
  | 'content'         // 主内容区（聊天消息流）
  | 'panel'           // 右侧/底部操作面板
  | 'overlay'         // 全屏覆盖层（评分进度、问卷）
  | 'footer'          // 底部输入区
  | 'input-toolbar'   // 输入框内工具栏（语音按钮等）
  | 'sidebar-tray'    // 移动端患者信息弹出层

interface LifecycleHooks {
  onInit?: (ctx: PluginContext) => void | (() => void);
  beforeSend?: (message: string) => string;
  afterReceive?: (message: ChatMessage) => void;
  onPhaseChange?: (from: string, to: string) => void;
  onEnd?: (reason: 'manual' | 'timeout' | 'admin') => void;
  onScoreReady?: (score: ScoreData) => void;
  onDestroy?: () => void;
}

interface PluginContext {
  recordId: string;
  bus: MessageBus;
  patient: PatientData;
  sendMessage: (text: string) => void;
  endTraining: () => Promise<void>;
}

interface PollConfig {
  path: string;           // 轮询 API 路径片段
  interval: number;       // 间隔（ms）
}
```

### 3.2 插件通信（MessageBus）

插件之间不直接引用，通过引擎事件总线发布/订阅：

```typescript
bus.emit('voice:start', {});
bus.emit('score:ready', score);
bus.emit('phase:changed', { from: 'history_taking', to: 'physical_exam' });
bus.emit('timer:tick', { remaining: 300 });
bus.emit('training:end', { reason: 'timeout' });

bus.on('voice:start', () => { /* 暂停 TTS */ });
bus.on('score:ready', (score) => { /* 展示评分 */ });
```

### 3.3 页面最终形态

```typescript
// ChatTraining.tsx —— 生产训练页
function ChatTraining() {
  const { recordId } = useParams();
  const scenario = useScenarioFromRecord(recordId);

  return (
    <TrainingEngine
      recordId={recordId}
      scenario={scenario}
      plugins={[
        timer,
        voice,
        inquiry,
        physicalExam,
        nursingRecord,
        questionnaire,
        patientInitiative,
        scoringDisplay,
      ]}
    />
  );
}

// AdminDebugPage.tsx —— 调试训练页
function AdminDebugPage() {
  const { recordId } = useParams();
  const scenario = useScenarioFromRecord(recordId);

  return (
    <TrainingEngine
      recordId={recordId}
      scenario={scenario}
      plugins={[
        timer,
        inquiry,
        scoringDisplay,
        devTools,        // 独有：实时状态面板 + 功能开关
      ]}
    />
  );
}
```

---

## 4. 布局系统（含响应式）

### 4.1 核心概念

每个场景携带 `layout` 定义，引擎根据 viewport 自动切换渲染策略。

### 4.2 类型定义

```typescript
interface LayoutDef {
  breakpoints: {
    desktop: SlotGrid;     // ≥1024px
    tablet?: SlotGrid;     // 768-1023px（可选，默认 fallback 到 mobile）
    mobile: SlotGrid;      // <768px
  };
  sidebarBehavior: 'fixed' | 'collapsible' | 'drawer';
  panelBehavior: 'inline' | 'drawer' | 'sheet';
}

interface SlotGrid {
  areas: string[][];       // CSS Grid 区域矩阵
  slots: Record<SlotName, SlotDefinition>;
}

interface SlotDefinition {
  render: 'inline' | 'drawer' | 'sheet' | 'modal';
  priority?: number;       // 空间不足时隐藏优先级（低优先先隐藏）
}
```

### 4.3 默认病史采集场景布局

```
Desktop (≥1024px):                   Mobile (<768px):
┌────────────────────────────────┐   ┌─────────────────────┐
│ slot:header                    │   │ slot:header          │
├──────────┬─────────────────────┤   │ (timer + endBtn)     │
│ slot:    │ slot:content        │   ├─────────────────────┤
│ sidebar  │ (chat messages)     │   │ slot:content         │
│ (patient │                     │   │ (全宽聊天流)          │
│  info)   │                     │   │                     │
│          ├─────────────────────┤   │ ── 上拉抽屉 ──      │
│          │ slot:footer         │   │ slot:panel           │
│          │ (input + voice)     │   │ (ex: 查体面板)       │
│          ├─────────────────────┤   ├─────────────────────┤
│          │ slot:panel          │   │ slot:sidebar-tray    │
│          │ (ex: 查体操作面板)   │   │ (患者信息弹层)       │
└──────────┴─────────────────────┘   ├─────────────────────┤
                                     │ slot:footer          │
                                     │ (input + voice)      │
                                     └─────────────────────┘
```

### 4.4 布局配置示例

```typescript
const historyTakingLayout: LayoutDef = {
  breakpoints: {
    desktop: {
      areas: [
        ['header',  'header',  'header'],
        ['sidebar', 'content', 'panel'],
        ['footer',  'footer',  'panel'],
      ],
      slots: {
        header:   { render: 'inline' },
        sidebar:  { render: 'inline', priority: 1 },
        content:  { render: 'inline' },
        panel:    { render: 'inline', priority: 2 },
        footer:   { render: 'inline' },
        overlay:  { render: 'modal' },
      },
    },
    mobile: {
      areas: [
        ['header'],
        ['content'],
        ['footer'],
      ],
      slots: {
        header:   { render: 'inline' },
        content:  { render: 'inline' },
        footer:   { render: 'inline' },
        sidebar:  { render: 'sheet', priority: 1 },
        panel:    { render: 'drawer', priority: 2 },
        overlay:  { render: 'modal' },
      },
    },
  },
  sidebarBehavior: 'fixed',
  panelBehavior: 'inline',
};
```

---

## 5. 场景驱动设计

### 5.1 核心概念

```
Scenario = 训练模式（一等领域概念）

组成 = 流程阶段定义
      + 可用功能集合 (feature flags)
      + 前端插件清单
      + 后端插件清单
      + UI 布局定义
      + 评分策略
      + 默认时长
```

### 5.2 场景数据模型

```python
# backend/models/scenario_config.py
class ScenarioConfig(BaseModel):
    id: str                        # "history_taking" | "comprehensive"
    name: str                      # "病史采集" | "综合仿真"
    phases: list[PhaseDef]
    features: dict[str, bool]      # physical_exam, patient_initiative, emotion
    scoring: ScoringDef
    layout: LayoutDef              # 前端布局定义
    frontend_plugins: list[str]    # 前端插件 ID 列表
    backend_plugins: list[str]     # 后端插件 ID 列表
    default_duration: int          # 默认时长（分钟）
```

### 5.3 场景示例

```json
{
  "id": "standard_assessment",
  "name": "标准问诊评估",
  "phases": [
    { "id": "history_taking", "order": 1, "auto": false }
  ],
  "features": {
    "physical_exam": false,
    "patient_initiative": false,
    "emotion": false
  },
  "scoring": {
    "rubric_id": "history_taking",
    "auto_delay_seconds": 3
  },
  "frontend_plugins": ["timer", "voice", "inquiry", "nursing-record",
                        "questionnaire", "scoring-display"],
  "backend_plugins": [],
  "default_duration": 30
}
```

```json
{
  "id": "full_simulation",
  "name": "全功能仿真训练",
  "phases": [
    { "id": "history_taking", "order": 1, "operations": ["chat"], "auto": false },
    { "id": "physical_exam", "order": 2, "operations": ["chat", "vitals", "bp", "temp", "spo2", "hr", "rr", "skin", "pain"], "auto": false }
  ],
  "features": {
    "physical_exam": true,
    "patient_initiative": true,
    "emotion": true
  },
  "scoring": {
    "rubric_id": "comprehensive",
    "auto_delay_seconds": 5
  },
  "frontend_plugins": ["timer", "voice", "inquiry", "physical-exam",
                        "nursing-record", "questionnaire", "patient-initiative",
                        "scoring-display"],
  "backend_plugins": ["emotion", "initiative", "physical-exam"],
  "default_duration": 45
}
```

### 5.4 API 端点

```
GET  /api/training/scenarios              → 所有可用场景列表
GET  /api/training/scenarios/{id}         → 单个场景完整配置
GET  /api/training/records/{id}/scenario  → 训练记录关联的场景配置
```

---

## 6. 后端流水线插件化

### 6.1 当前问题

```python
# prompt_builder.py — 当前实现
emotion = get_emotion(ctx.record.id)      # 总是执行
intent = classify_intent(...)             # 总是执行
emotion.update(intent)                    # 总是执行
author_note = emotion.note                # 总是注入

# 即使 physical_exam feature flag 关闭
if ctx.operation:                         # 仍走这条路径
    author_note = f"{author_note}\n{operation_note}"  # 判断逻辑仍在
```

三个功能采用"先执行再判断"的伪开关模式。

### 6.2 改造目标

```
Active 插件:   中间件被编入管道 → 正常执行 → 可安全注入 prompt
Inactive 插件: 中间件完全不被编入管道 → 零开销 → prompt 无痕迹
```

### 6.3 流水线插件接口

```python
@dataclass
class PipelinePlugin:
    """后端流水线插件定义"""
    id: str                                 # "emotion" | "initiative" | "physical_exam"
    name: str
    feature_flag: str | None                # 关联 feature_flag key
    requires: list[str]                     # 依赖的插件 ID

    middleware: list[PipelineMiddleware]    # 注入到流水线的中间件
    on_record_create: Callable | None       # 记录创建时钩子
    on_phase_change: Callable | None        # 阶段切换时钩子
    on_end: Callable | None                 # 训练结束时钩子
    on_score: Callable | None               # 评分完成后钩子
```

### 6.4 三个后端插件定义

```python
emotion_plugin = PipelinePlugin(
    id="emotion",
    name="患者情绪状态机",
    feature_flag="emotion",
    requires=[],
    middleware=[
        emotion_tracker,           # classify_intent → update emotion → 写入 ctx.state["emotion_note"]
    ],
    on_end=lambda ctx: purge_emotion_cache(ctx.record.id),
)

initiative_plugin = PipelinePlugin(
    id="initiative",
    name="患者主动回复",
    feature_flag="patient_initiative",
    requires=["emotion"],          # 依赖情绪状态决定发言类型
    middleware=[
        initiative_timer_reset,    # 每次回复后重置计时器
    ],
    on_record_create=lambda ctx: init_initiative_timer(ctx.record.id),
    on_end=lambda ctx: clear_initiative_timer(ctx.record.id),
)

physical_exam_plugin = PipelinePlugin(
    id="physical-exam",
    name="护理查体锚点交互",
    feature_flag="physical_exam",
    requires=[],
    middleware=[
        operation_detector,        # 检测 /vitals /bp 等操作指令
        operation_executor,        # 执行操作 → 写入 ctx.state["operation_note"]
    ],
)
```

### 6.5 动态管道组装

```python
# registry.py 改造
def build_pipeline(phase: Phase, active_plugins: list[PipelinePlugin]) -> list[Middleware]:
    """根据场景配置动态组装流水线"""
    core = [phase_guard, phase_transition, prompt_builder, llm_caller, persister]

    plugin_middlewares = []
    for plugin in active_plugins:
        plugin_middlewares.extend(plugin.middleware or [])

    # 插入顺序：guard → plugin_middlewares → transition → prompt_builder → llm → persister
    return [phase_guard] + plugin_middlewares + [phase_transition, prompt_builder, llm_caller, persister]
```

### 6.6 prompt_builder 改造

```python
def build_author_note(ctx) -> str:
    """收集所有已激活插件的动态提示，未激活的插件不贡献任何内容"""
    notes = []
    if "emotion_note" in ctx.state:
        notes.append(ctx.state["emotion_note"])
    if "operation_note" in ctx.state:
        notes.append(ctx.state["operation_note"])

    return "【" + " | ".join(notes) + "】" if notes else ""

# 情绪插件激活时 → emotion_tracker 设置 ctx.state["emotion_note"]
# 情绪插件未激活 → ctx.state 中无此 key → author_note 干净
# 查体插件激活时 → operation_executor 设置 ctx.state["operation_note"]
# 查体插件未激活 → ctx.state 中无此 key → author_note 无操作痕迹
```

### 6.7 Feature Flag 新增

```python
FEATURE_FLAGS = {
    "physical_exam": FeatureFlag(
        key="physical_exam", label="护理查体", default=False,
        description="允许学生触发护理操作，查体锚点数据注入 prompt"
    ),
    "patient_initiative": FeatureFlag(
        key="patient_initiative", label="患者主动追问", default=False,
        description="患者根据性格/情绪/等待时长主动发言"
    ),
    "emotion": FeatureFlag(       # 新增
        key="emotion", label="患者情绪状态机", default=False,
        description="5态情绪模型（withdrawn/defensive/neutral/relaxed/open），"
                    "根据学生用语动态变化，注入 author_note 影响患者表现"
    ),
}
```

---

## 7. 插件可视化管理

插件化机制自身需要可观测、可配置、可调试。提供三套界面：

| 界面 | 路由 | 面向 | 用途 |
|------|------|------|------|
| Plugin Registry Dashboard | `/admin/plugins` | 管理员 | 全局查看/管理所有已注册插件 |
| Scenario Composer | `/admin/scenarios` | 管理员 | 可视化创建/编辑训练场景 |
| DevTools 插件 | 训练页内嵌 | 开发者/教师 | 实时监控插件状态、事件流 |

---

### 7.1 Plugin Registry Dashboard（`/admin/plugins`）

**功能**：全局插件目录，展示系统内所有已注册的前端和后端插件。

```
┌─────────────────────────────────────────────────────────┐
│  插件注册表                                    [+注册插件] │
│                                                         │
│  ┌─────────────────── 筛选栏 ───────────────────────┐   │
│  │ [层: 全部 ▼] [状态: 全部 ▼] [slot: 全部 ▼]      │   │
│  │ 🔍 搜索插件名称...                                │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────── 插件列表 ─────────────────────┐   │
│  │                                                    │   │
│  │  ┌─ 前端插件 ──────────────────────────────────┐  │   │
│  │  │ ┌─────────────────────────────────────────┐ │  │   │
│  │  │ │ timer                    [已启用] [编辑] │ │  │   │
│  │  │ │ slot: header   hooks: onEnd            │ │  │   │
│  │  │ │ 来源: useTrainingTimer                  │ │  │   │
│  │  │ │ featureFlag: —                          │ │  │   │
│  │  │ │ 使用场景: standard, comprehensive       │ │  │   │
│  │  │ └─────────────────────────────────────────┘ │  │   │
│  │  │ ┌─────────────────────────────────────────┐ │  │   │
│  │  │ │ voice                    [已启用] [编辑] │ │  │   │
│  │  │ │ slot: input-toolbar  hooks: afterReceive│ │  │   │
│  │  │ │ 来源: useVoice                           │ │  │   │
│  │  │ │ featureFlag: —                          │ │  │   │
│  │  │ └─────────────────────────────────────────┘ │  │   │
│  │  │ ┌─────────────────────────────────────────┐ │  │   │
│  │  │ │ physical-exam           [已启用] [编辑] │ │  │   │
│  │  │ │ slot: panel  hooks: onPhaseChange       │ │  │   │
│  │  │ │ featureFlag: physical_exam ← 已绑定     │ │  │   │
│  │  │ └─────────────────────────────────────────┘ │  │   │
│  │  │ ...                                        │  │   │
│  │  └───────────────────────────────────────────┘ │  │   │
│  │                                                    │   │
│  │  ┌─ 后端插件 ──────────────────────────────────┐  │   │
│  │  │ ┌─────────────────────────────────────────┐ │  │   │
│  │  │ │ emotion                  [已启用] [编辑] │ │  │   │
│  │  │ │ middleware: emotion_tracker             │ │  │   │
│  │  │ │ featureFlag: emotion ← 已绑定            │ │  │   │
│  │  │ │ 钩子: on_end                            │ │  │   │
│  │  │ └─────────────────────────────────────────┘ │  │   │
│  │  │ ┌─────────────────────────────────────────┐ │  │   │
│  │  │ │ initiative              [已启用] [编辑] │ │  │   │
│  │  │ │ requires: emotion                       │ │  │   │
│  │  │ │ middleware: initiative_timer_reset       │ │  │   │
│  │  │ │ featureFlag: patient_initiative ← 已绑定 │ │  │   │
│  │  │ └─────────────────────────────────────────┘ │  │   │
│  │  │ ...                                        │  │   │
│  │  └───────────────────────────────────────────┘ │  │   │
│  └────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

**点击展开插件详情**：

```
┌─────────────────────────────────────────────────────────┐
│  emotion 插件详情                         [启用] [禁用]  │
│                                                         │
│  基本信息                                                │
│  ├─ ID: emotion                                         │
│  ├─ 名称: 患者情绪状态机                                 │
│  ├─ 层: 后端流水线                                       │
│  ├─ Feature Flag: emotion (已绑定)                       │
│  └─ 依赖: 无                                            │
│                                                         │
│  中间件 (2)                                              │
│  ├─ emotion_tracker  ✓ 正常                              │
│  │   · classify_intent → update emotion                  │
│  │   · 注入 ctx.state["emotion_note"]                    │
│  │   · 最后调用: 2 分钟前                                │
│  └─ (无更多中间件)                                       │
│                                                         │
│  钩子                                                    │
│  └─ on_end: purge_emotion_cache                         │
│                                                         │
│  关联场景 (2)                                            │
│  ├─ full_simulation (全功能仿真训练)   [查看]            │
│  └─ comprehensive_assessment (综合评估)  [查看]          │
│                                                         │
│  运行统计                                                │
│  ├─ 24h 调用次数: 1,247                                 │
│  ├─ 平均耗时: 3.2ms                                     │
│  └─ 错误率: 0.02%                                       │
└─────────────────────────────────────────────────────────┘
```

**数据来源**：前端插件通过 `PluginRegistry.getRegistered()` 获取运行时元数据；后端插件新增 `GET /api/admin/plugins` 端点返回注册列表。统计数据来自 middleware 耗时埋点。

---

### 7.2 Scenario Composer（`/admin/scenarios`）

**功能**：可视化创建/编辑训练场景，拖拽组合插件。

```
┌─────────────────────────────────────────────────────────┐
│  场景编辑器                                     [保存]   │
│                                                         │
│  ┌─ 场景列表 ───────┐  ┌─ 编辑区 ──────────────────────┐│
│  │                  │  │                                 ││
│  │ ○ standard_      │  │  场景名称: [全功能仿真训练____] ││
│  │   assessment     │  │                                 ││
│  │                  │  │  ┌─ 基础配置 ────────────────┐  ││
│  │ ○ comprehensive  │  │  │ 默认时长: [45] 分钟       │  ││
│  │                  │  │  │ 评分模板: [comprehensive ▼] │  ││
│  │ ● full_simul-    │  │  │ 评分延迟: [5] 秒          │  ││
│  │   ation ← 当前   │  │  └──────────────────────────┘  ││
│  │                  │  │                                 ││
│  │ [+ 新建场景]     │  │  ┌─ 阶段配置 ────────────────┐  ││
│  │                  │  │  │ ┌─ Phase 1 ─────────────┐ │  ││
│  │                  │  │  │ │ history_taking        │ │  ││
│  │                  │  │  │ │ 可用操作: chat        │ │  ││
│  │                  │  │  │ └───────────────────────┘ │  ││
│  │                  │  │  │ ┌─ Phase 2 ─────────────┐ │  ││
│  │                  │  │  │ │ physical_exam         │ │  ││
│  │                  │  │  │ │ 可用操作: all         │ │  ││
│  │                  │  │  │ └───────────────────────┘ │  ││
│  │                  │  │  │ [+添加阶段]               │  ││
│  │                  │  │  └──────────────────────────┘  ││
│  │                  │  │                                 ││
│  │                  │  │  ┌─ 功能开关 ────────────────┐  ││
│  │                  │  │  │ [✓] physical_exam 护理查体│  ││
│  │                  │  │  │ [✓] patient_initiative    │  ││
│  │                  │  │  │ [✓] emotion 患者情绪      │  ││
│  │                  │  │  └──────────────────────────┘  ││
│  │                  │  │                                 ││
│  │                  │  │  ┌─ 插件编排 ────────────────┐  ││
│  │                  │  │  │ ┌──────────────────────┐   │  ││
│  │                  │  │  │ │ 已选插件 (8)          │   │  ││
│  │                  │  │  │ │ ┌──────────────────┐ │   │  ││
│  │                  │  │  │ │ │ timer          ✕ │ │   │  ││
│  │                  │  │  │ │ │ voice          ✕ │ │   │  ││
│  │                  │  │  │ │ │ inquiry        ✕ │ │   │  ││
│  │                  │  │  │ │ │ physical-exam  ✕ │ │   │  ││
│  │                  │  │  │ │ │ nursing-record ✕ │ │   │  ││
│  │                  │  │  │ │ │ questionnaire  ✕ │ │   │  ││
│  │                  │  │  │ │ │ patient-init   ✕ │ │   │  ││
│  │                  │  │  │ │ │ scoring-display✕ │ │   │  ││
│  │                  │  │  │ │ └──────────────────┘ │   │  ││
│  │                  │  │  │ │                      │   │  ││
│  │                  │  │  │ │ ← 拖拽添加 ──────────│   │  ││
│  │                  │  │  │ │                      │   │  ││
│  │                  │  │  │ │ 可用插件库           │   │  ││
│  │                  │  │  │ │ ┌──────────────────┐ │   │  ││
│  │                  │  │  │ │ │ timer           → │ │   │  ││
│  │                  │  │  │ │ │ voice           → │ │   │  ││
│  │                  │  │  │ │ │ inquiry         → │ │   │  ││
│  │                  │  │  │ │ │ ...              │ │   │  ││
│  │                  │  │  │ │ └──────────────────┘ │   │  ││
│  │                  │  │  │ └──────────────────────┘   │  ││
│  │                  │  │  └──────────────────────────┘  ││
│  │                  │  │                                 ││
│  │                  │  │  ┌─ 布局预览 ────────────────┐  ││
│  │                  │  │  │ [Desktop] [Tablet] [Mobile] │  ││
│  │                  │  │  │ ┌────desktop 预览───────┐  │  ││
│  │                  │  │  │ │ [ hdr  | hdr  | hdr ] │  │  ││
│  │                  │  │  │ │ [ side | main | pnl ] │  │  ││
│  │                  │  │  │ │ [ foot | foot | pnl ] │  │  ││
│  │                  │  │  │ └───────────────────────┘  │  ││
│  │                  │  │  └──────────────────────────┘  ││
│  └──────────────────┘  └─────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**后端 API**：

```
GET    /api/admin/scenarios                  → 场景列表
GET    /api/admin/scenarios/{id}             → 场景详情
POST   /api/admin/scenarios                  → 创建场景
PUT    /api/admin/scenarios/{id}             → 更新场景
DELETE /api/admin/scenarios/{id}             → 删除场景
POST   /api/admin/scenarios/{id}/validate    → 校验场景完整性（插件依赖、slot 冲突等）
GET    /api/admin/plugins                    → 所有后端插件元数据
```

**校验规则**：
- 插件的 `requires` 依赖必须在同一场景中满足
- 前端插件的 slot 不能有不可解决的冲突（同一 slot 多个 inline 渲染需 priority 排序）
- 后端插件的 middleware 顺序不能循环依赖
- Feature flag 必须已定义

---

### 7.3 DevTools 插件（训练内嵌调试面板）

**定位**：作为前端插件自身存在，仅调试页加载。提供实时训练可观测性。

```
┌──────────────────────────────────────────────┐
│  🔧 DevTools                     [_] [□] [X] │
├──────────────────────────────────────────────┤
│  ┌─ 插件状态 ──────────────────────────────┐ │
│  │ timer          ● 运行中  slot:header    │ │
│  │ voice          ● 运行中  slot:input-bar │ │
│  │ inquiry        ● 运行中  slot:header    │ │
│  │ physical-exam  ○ 未激活  (flag: false) │ │
│  │ nursing-record ● 运行中  slot:panel     │ │
│  │ questionnaire  ● 运行中  slot:overlay   │ │
│  │ patient-init   ○ 未激活  (flag: false) │ │
│  │ scoring        ◐ 等待中  (onEnd 触发)   │ │
│  │                         [重新加载插件]   │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 事件总线 ──────────────────────────────┐ │
│  │ 14:31:02  timer:tick        {rem: 287}  │ │
│  │ 14:31:02  phase:changed     h→p_exam    │ │
│  │ 14:31:05  voice:start       {}          │ │
│  │ 14:31:08  emotion:changed   neutral→d-1  │ │
│  │ 14:31:10  stream:chunk      {token:"... │ │
│  │ ── 实时 ─────────────────────────────── │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ Feature Flags ─────────────────────────┐ │
│  │ [✓] physical_exam     护理查体          │ │
│  │ [✓] patient_initiative 主动追问          │ │
│  │ [✓] emotion           情绪状态机         │ │
│  │                          [应用更改]      │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 轮询状态 ──────────────────────────────┐ │
│  │ initiative poll  next: 2.3s  ● active   │ │
│  │ score poll       next: —      ○ idle     │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  ┌─ 当前 Phase ────────────────────────────┐ │
│  │ history_taking                           │ │
│  │ message_count: 12  op_count: 0           │ │
│  │ auto_after: 9999 (manual only)           │ │
│  │                    [手动推进到下一阶段]    │ │
│  └─────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

**DevTools 插件特有能力**：

| 功能 | 说明 |
|------|------|
| 插件实时状态 | 每个插件的激活/待命/错误状态，带颜色指示 |
| 事件总线监控 | 实时滚动显示所有 MessageBus 事件，支持暂停/过滤 |
| Feature Flag 热切换 | 训练中实时切换 feature flag，即时生效（调试用） |
| 轮询状态 | 显示所有插件轮询的间隔和下次触发时间 |
| Phase 手动控制 | 手动推进阶段，查看 phase_transition 效果 |
| 插件热重载 | 重新加载插件代码（开发用，Vite HMR 配合） |

**实现方式**：`DevToolsPlugin` 自身就是一个 `TrainingPlugin`，hook 入 `onInit` 挂载 MessageBus 监听、入 `onDestroy` 卸载。slot 为 `panel`（桌面）或 `drawer`（移动端）。

---

### 7.4 插件元数据自描述

每个插件携带自描述元数据，供管理界面展示：

```typescript
interface TrainingPlugin {
  // ... 现有字段 ...

  /** 自描述元数据（供管理 UI 使用） */
  meta: {
    description: string;        // 功能说明
    icon?: string;              // 图标（lucide icon name）
    author?: string;            // 作者
    version?: string;           // 版本号
    tags?: string[];            // 分类标签: ["UI", "communication", "assessment"]
    source?: string;            // 来源文件路径
  };

  /** 运行时指标（引擎自动注入） */
  runtime?: {
    status: 'active' | 'inactive' | 'error' | 'waiting';
    activatedAt?: number;
    hookCalls: Record<string, number>;   // 各钩子调用次数
    lastError?: string;
  };
}
```

后端等价：

```python
@dataclass
class PipelinePluginMeta:
    description: str
    author: str = ""
    version: str = "1.0.0"
    tags: list[str] = field(default_factory=list)
```

---

## 8. 实现计划

### 8.1 第一批迁移（17 个组件）

**训练功能插件（14 个）**：

| # | 插件 ID | 层 | 来源 | 目标 Slot | 钩子 |
|---|---------|----|------|-----------|------|
| 1 | `timer` | 前端 UI | `useTrainingTimer.ts` | `header` | `onEnd('timeout')` |
| 2 | `voice` | 前端 UI | `useVoice.ts` | `input-toolbar` | `afterReceive` |
| 3 | `inquiry` | 前端 UI | `InquirySidebar.tsx` | `header` + `sidebar-tray` | — |
| 4 | `physical-exam` | 前端 UI | `OperationPanel.tsx` | `panel` | `onPhaseChange` |
| 5 | `nursing-record` | 前端 UI | `components/nursing-record/` | `panel` | — |
| 6 | `questionnaire` | 前端 UI | `useQuestionnaire.ts` | `overlay` | `onInit`, `onEnd` |
| 7 | `patient-initiative` | 前端逻辑 | `api/training-state.ts` | — | `pollState` |
| 8 | `scoring-display` | 前端 UI | `ScoreCard + ScoringOverlay` | `overlay` | `onScoreReady` |
| 9 | `emotion` | 后端流水线 | `emotion.py` | — | `on_end` |
| 10 | `initiative` | 后端流水线 | `initiative.py` | — | `on_record_create`, `on_end` |
| 11 | `physical-exam` | 后端流水线 | `exam.py + op_detector + op_executor` | — | — |

**插件管理界面（3 个）**：

| # | 模块 | 层 | 路由 | 所属章节 |
|---|------|----|------|----------|
| 12 | Plugin Registry Dashboard | 前端页面 | `/admin/plugins` | 7.1 |
| 13 | Scenario Composer | 前端页面 | `/admin/scenarios` | 7.2 |
| 14 | DevTools 插件 | 前端插件 | 训练页内嵌（调试模式） | 7.3 |
| 15 | Plugin Admin API | 后端 API | `/api/admin/plugins` | 7.1 |
| 16 | Scenario Admin API | 后端 API | `/api/admin/scenarios` | 7.2 |
| 17 | Plugin Meta 接口 | 前后端类型 | — | 7.4 |

### 8.2 施工阶段

**Phase 1 — 引擎核心（新建）**：
- 前端：`TrainingEngine` 组件（PluginRegistry, MessageBus, SlotRenderer）
- 前端：`StreamManager`（抽取自 `useChatStream.ts`）
- 前端：`ScoreManager`（抽取自 `useScorePolling.ts` + `useScoreProgress.ts`）
- 前端：`PatientProvider`（抽取自 `useRecordLoader.ts` + `PatientPortrait.tsx`）
- 前端：`LayoutEngine`（useResponsiveLayout + SlotRenderer）
- 后端：`PipelinePlugin` 接口 + `build_pipeline()` 动态组装
- 后端：`ScenarioConfig` 数据模型 + API 端点

**Phase 2 — 插件迁移（改造）**：
- 将上述 11 个前端插件 + 3 个后端插件逐一迁移
- 每迁移一个即验证：激活时正常、关闭时不干扰

**Phase 3 — 页面瘦身（删除冗余）**：
- `ChatTraining.tsx` 瘦身到 ~30 行纯组装
- `AdminDebugPage.tsx` 复用 `TrainingEngine`，添加 `devTools` 插件
- 删除 `AdminDebugPage.tsx` 中的重复实现

**Phase 4 — 场景系统（新建）**：
- 创建场景配置文件
- 实现 `GET /api/training/scenarios` API
- 前端 `useScenario()` hook

**Phase 5 — 插件可视化管理（新建）**：
- Plugin Registry Dashboard 页面（`/admin/plugins`）
- Scenario Composer 页面（`/admin/scenarios`）
- 后端 `GET /api/admin/plugins` + 场景 CRUD API
- DevTools 插件（MessageBus 监听 + Feature Flag 热切换 + Phase 控制）

**Phase 6 — 插件 SDK 导出（可选）**：
- 导出 `createTrainingPlugin()` 工厂函数
- 导出类型定义包
- 编写插件开发文档

### 8.3 文件结构（最终目标）

```
frontend/src/
├── engine/                              # 核心引擎（新建）
│   ├── TrainingEngine.tsx               # 编排器
│   ├── PluginRegistry.ts                # 插件注册/解析
│   ├── MessageBus.ts                    # 事件总线
│   ├── SlotRenderer.tsx                 # 槽位渲染器
│   ├── SlotLayout.tsx                   # 响应式布局
│   ├── useResponsiveLayout.ts           # viewport 检测
│   ├── StreamManager.ts                 # SSE 管理
│   ├── ScoreManager.ts                  # 评分管理
│   ├── PatientProvider.tsx              # 患者数据 Context
│   ├── types.ts                         # PluginContext, SlotName, etc.
│   └── index.ts
├── plugins/                             # 插件目录（新建）
│   ├── timer/
│   │   ├── index.ts                     # createTimerPlugin()
│   │   └── TimerDisplay.tsx
│   ├── voice/
│   │   ├── index.ts
│   │   └── VoiceButton.tsx
│   ├── inquiry/
│   │   ├── index.ts
│   │   └── InquirySidebar.tsx
│   ├── physical-exam/
│   │   ├── index.ts
│   │   └── OperationPanel.tsx
│   ├── nursing-record/
│   │   ├── index.ts
│   │   ├── NursingRecordPanel.tsx
│   │   ├── config.ts
│   │   └── items/
│   ├── questionnaire/
│   │   ├── index.ts
│   │   └── QuestionnaireModal.tsx
│   ├── patient-initiative/
│   │   └── index.ts                     # 纯逻辑插件
│   ├── scoring-display/
│   │   ├── index.ts
│   │   ├── ScoreCard.tsx
│   │   └── ScoringOverlay.tsx
│   └── dev-tools/                       # 调试页专用
│       ├── index.ts                     # createDevToolsPlugin()
│       ├── PluginStatusPanel.tsx        # 插件状态表
│       ├── EventBusMonitor.tsx          # 事件总线监控
│       ├── FeatureFlagPanel.tsx         # Feature Flag 热切换
│       ├── PhaseControl.tsx             # 手动阶段控制
│       └── PollStatusMonitor.tsx        # 轮询状态
├── pages/
│   ├── ChatTraining.tsx                 # ~30 行
│   ├── AdminDebugPage.tsx               # ~30 行
│   ├── admin/
│   │   ├── PluginDashboard.tsx          # 新增：/admin/plugins
│   │   └── ScenarioComposer.tsx         # 新增：/admin/scenarios
│   └── ...
├── components/
│   ├── training/                        # 迁移后逐步清空
│   ├── ui/                              # 保留：通用 UI 原语
│   └── ...
├── hooks/
│   ├── useScenario.ts                   # 新增：加载场景配置
│   ├── useChatStream.ts                 # 保留：StreamManager 内部使用
│   └── ...
└── api/
    ├── scenarios.ts                     # 新增：场景 API
    └── admin/
        ├── plugins.ts                   # 新增：插件管理 API
        └── scenarios.ts                 # 新增：场景管理 API

backend/
├── contexts/training/pipeline/
│   ├── plugin.py                        # 新建：PipelinePlugin 接口 + meta
│   ├── registry.py                      # 改造：build_pipeline() 动态组装
│   ├── middleware/
│   │   ├── emotion_tracker.py           # 新建（拆自 prompt_builder）
│   │   ├── initiative_timer_reset.py    # 新建（拆自 side_effects）
│   │   ├── operation_detector.py        # 保留（现有）
│   │   ├── operation_executor.py        # 保留（现有）
│   │   ├── prompt_builder.py            # 改造：author_note 收集
│   │   ├── phase_guard.py               # 保留
│   │   ├── phase_transition.py          # 保留
│   │   ├── persister.py                 # 保留
│   │   └── llm_caller.py                # 保留
│   └── ...
├── models/
│   └── scenario_config.py               # 新建：ScenarioConfig
├── router/
│   ├── scenarios.py                     # 新建：GET /api/training/scenarios
│   └── admin/
│       ├── plugins.py                   # 新建：GET /api/admin/plugins
│       └── scenarios.py                 # 新建：场景 CRUD + 校验
├── core/
│   └── feature_flags.py                 # 新增 emotion flag
└── data/
    └── scenarios/                       # 新建：场景 JSON 配置文件
        ├── standard-assessment.json
        ├── full-simulation.json
        └── ...
```

---

## 9. 风险与注意事项

1. **向后兼容**：旧训练记录不携带 `scenario_id`，需 fallback 到默认场景
2. **插件替换机制**：同一 slot 可注册多个组件，引擎按 priority 决定展示哪个，或全部渲染
3. **多阶段场景**：phases 数组长度 > 1 时，阶段切换需重新解析 layout 和启用的插件子集
4. **session 状态**：插件 onDestroy 必须可靠调用（useEffect cleanup / pipeline finalization）
5. **移动端测试**：Sheet/Drawer/Modal 的 touch 交互需在真机验证
6. **插件管理权限**：Plugin Dashboard 和 Scenario Composer 需独立权限 gate，不与 score_review 混用
7. **Feature Flag 热切换副作用**：训练中动态切换 flag 可能导致流水线状态不一致，DevTools 需标记"实验性"

---

## 10. 长期扩展方向

- **stepper 布局**：多步骤场景（急救演练），每步切换 phase + layout
- **多角色对话**：患者 + 家属 + 医生，插件可为每个角色注入独立 author_note
- **操作评分集成**：查体操作的次数、顺序、正确性纳入评分 rubric
- **插件市场**：前端插件 npm 包 + 后端插件 Python 包，通过 manifest 注册
- **A/B 测试**：同一场景的不同插件组合，对比教学效果
- **插件沙箱**：第三方插件运行时隔离，防止污染核心引擎状态
