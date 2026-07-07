# 训练架构重构备忘

> 2026-06-29 · 讨论涉及: 训练类型插件化、提示词/评分系统、前端场景化

---

## 一、核心结论

### 1. 单一场景现状

系统 100% 围绕"护患对话问诊"构建。第二个训练类型（预检分诊）已箭在弦上，现有架构不支撑。

```
CaseDataSchema 锁死       →  需要: 按 training_type 路由 validator
current_phase CHECK       →  需要: 自由字符串 + 类型自定阶段
messages.role CHECK       →  需要: 自由字符串
_create_record 写死       →  需要: 从 profile 读取初始 phase
greeting 假设患者先开口    →  需要: 按 profile 决定首个消息
NoteSources 三件套固定注册 →  需要: 按 profile 配置
emotion/initiative 无条件跑→  需要: 按 profile 开关
max_rounds=8 硬编码       →  需要: 按 profile 配置
```

### 2. DB 化 prompt/rubric 是伪动态

- 切换 prompt 需改 Python 变量注入 → 本质还是要改代码
- 管理员从未在后台修改过 → 800 行基础设施零运营价值
- **方向**: 回纳为代码配置，评分时冻结快照到 TrainingRecord

### 3. Profile 模式（后端） + Scene 模式（前端）

```
后端                         前端
TrainingProfile            TrainingScene
  ├─ case_schema            ├─ component（场景组件）
  ├─ phases                 ├─ panels（场景面板集）
  ├─ prompts                └─ layout（场景布局）
  ├─ rubric
  ├─ note_sources
  ├─ capabilities
  └─ has_emotion 等开关
```

---

## 二、Profile 模式详述

### TrainingProfile 契约

```python
# backend/profiles/registry.py
@dataclass
class TrainingProfile:
    name: str
    initial_phase: str
    phases: list[PhaseConfig]
    note_sources: list[type[NoteSource]]
    prompts: PromptCollection
    rubric: dict
    capabilities: list[str]
    max_rounds: int
    has_emotion: bool
    has_initiative: bool
```

### 适配现有代码

| 文件 | 改动 |
|------|------|
| `_create_record()` | `record.current_phase = get_profile(record.training_type).initial_phase` |
| `builder.py` | `collector.add(src_cls()) for src_cls in profile.note_sources` |
| `side_effects.py` | `if profile.has_emotion:` 包裹 |
| `prompt_builder.py` | `profile.prompts.system`, `profile.prompts.dynamic` |
| `prompt.py:99` | `build_patient_chat_messages(max_rounds=profile.max_rounds)` |
| `score_engine.py` | 评分前 `record.prompt_snapshot = profile.prompts` + `record.rubric_snapshot = profile.rubric` |
| `physical_exam.py` | 查体操作 ∈ `history_taking` profile，新类型注册自己的 ops |
| `exam.py` | 值解析逻辑保留，操作定义迁入 profile |

### PromptCollection

```python
@dataclass
class PromptCollection:
    system: str          # Character Card
    dynamic: str         # 病情数据块
    author_note: str     # Author's Note 模板
    scoring: str         # 评分 system prompt
    scoring_user: str    # 评分 user prompt
    scoring_feedback: str        # 反馈 system prompt
    scoring_feedback_user: str   # 反馈 user prompt
```

所有模板是纯文本字符串，`string.Template` 渲染。DB 不再存储。

### 迁移后 prompts/ 目录

```
backend/
  prompts/                # ← 保留，但不再有 __init__.py 导出的 Python 常量
    history_taking/
      system.txt
      dynamic.txt
      scoring.txt
      scoring_user.txt
      scoring_feedback.txt
      scoring_feedback_user.txt
    triage/               # ← 新增
      ...
```

## 三、Scene 模式详述

### 路由变更

```
当前:  /training/:recordId  →  TrainingEntry → TRAINING_SCENES[type] → TrainingEngine
改为:  /training/:recordId  →  TrainingEntry
                                ├── fetch record.training_type
                                └── render TRAINING_SCENES[type].component
```

### TrainingScene 契约

```typescript
// frontend/src/training/scenes/types.ts
interface SceneProps {
  recordId: string;
  bus: MessageBus;
  training: TrainingRecordDetail;
}

interface SceneModule {
  default: React.FC<SceneProps>;
}

// 注册（lazy import）
const TRAINING_SCENES: Record<string, () => Promise<SceneModule>> = {
  history_taking: () => import("../scenes/history-taking"),
  triage: () => import("../scenes/triage"),
};
```

### 共享服务 Hook 化

```typescript
// 当前: TrainingEngine useRef 创建 StreamManager/ScoreManager/TTSManager
// 改为: 独立 hook，场景按需组合

function useSSE(recordId: string, bus: MessageBus): SSEController;    // 对话流式
function useScoring(recordId: string, bus: MessageBus): ScoreController;  // 评分轮询
function useTTS(recordId: string, bus: MessageBus): TTSController;       // 语音
```

分诊场景: `useScoring` 即可，不需要 `useSSE` 和 `useTTS`。

### 当前 TrainingEngine 拆分

348 行的 `TrainingEngine.tsx` 拆为:

```
TrainingEntry (新增, ~30 行)     — 路由分发 + 共享覆盖层
HistoryTakingScene (迁入, ~280 行) — 当前 engine 内容（SSE + TTS + panels + chat）
```

`panels/index.ts` 的全局 `PANELS` 数组移入 `HistoryTakingScene`。

## 四、评分快照

### snapshot 写入时机

```
评分触发前（_run_scoring_background）
  → 检查 record.prompt_snapshot 是否已存在
  → 不存在: get_profile(record.training_type) 读取当前 prompt/rubric
  → 冻结写入 TrainingRecord（JSONB）
  → 评分引擎使用 snapshot 渲染
```

### snapshot 结构

```json
{
  "prompt_snapshot": {
    "system": "你正在扮演一位真实患者...",
    "dynamic": "## 病情信息\n**主诉**: $chief_complaint...",
    "scoring": "...",
    "scoring_user": "...",
    "scoring_feedback": "...",
    "scoring_feedback_user": "..."
  },
  "rubric_snapshot": {
    "name": "nursing_history_v1",
    "version": "1.0",
    "raw_max": 57,
    "dimensions": [{"name": "沟通技能", "items": [...]}, ...]
  }
}
```

### 当前 rubric_frozen 替换

`rubric_frozen`（当前是字符串引用，如 `"nursing_history_v1@1.0"`）→ 删除，被 `rubric_snapshot` 替代。

## 五、删除清单

| 删除对象 | 行数 | 理由 |
|---------|:----:|------|
| `infrastructure/prompt/manager.py` DB 部分 | ~200 | prompt 改为代码配置 |
| `infrastructure/prompt/registry.py` | 320 | 变量注册表只供后台预览 |
| `services/prompt.py` | — | prompt CRUD |
| `services/rubric.py` | — | rubric CRUD |
| `routers/admin/prompts.py` | — | 管理 API |
| `routers/admin/rubrics.py` | — | 管理 API |
| `models/llm.py` 中 `PromptTemplate` | — | DB 表一同移除 |
| `models/case_practice.py` 中 `Rubric` | — | DB 表一同移除 |
| `case_data` 列 `PydanticJSONB(CaseDataSchema)` | — | 改为 `JSONB`，验证下放到 service 层 |

**保留**: `manager.py` 中的 `render_template()` 函数（~10 行，可一直保留）和 `PromptTemplateObj` 数据类（简化去掉 DB 依赖）。

### 额外死亡/过度工程

审计确认以下遗留问题：

| 问题 | 位置 | 行数 | 状态 |
|------|------|:----:|------|
| `detect_operation()` | `exam.py:70` + `_DEFAULT_ALIASES` | ~40 | **死代码**（0 个消费者） |
| `initiative.py` 规则路径 | `initiative.py:73-124` | 51 | **死代码**（生产中仅用 LLM 路径） |
| `initiative.py` 阈值逻辑 | 两份相同公式 | 重复 | 可抽取共享函数 |
| `EmotionState.decay()` | `emotion.py:64-74` | 10 | **死方法**（定义但未调用） |
| `effective_features()` vs `resolve_features()` | `capabilities.py:66-90` | ~20 | 重复度 ~80%，可合并 |
| 问卷系统 | 5 表 + 2 服务 + 360 行路由 | ~800 | 功能独立，与训练流水线仅表面集成 |
| Repository 基类 | `repositories/base.py` | 86 | 多为透传，自定义查询在子类中 |

其中 `detect_operation`、`EmotionState.decay()`、`initiative.py` 规则路径为可立即删除的死代码。问卷系统的精简可在 P1 之后评估。

## 六、Case 系统重构

### 现有问题

| 问题 | 现状 | 影响 |
|------|------|------|
| **单 schema 巨石** | `case_data` 列 `PydanticJSONB(CaseDataSchema)`，`extra="ignore"` 静默丢弃未知字段 | 任何非病史采集数据无法存入 |
| **无 training_type** | Case 表不含类型字段 | 不知道一个 case 是什么类型 |
| **扁平 payload** | `patient_info`, `personality`, `phases`, `exam_anchors` 全混在同一个 JSONB | 13+ 处代码读取 `case_data.get()` |
| **管理表单绑定** | `CaseForm.tsx` 硬编码 4 个 section 全部为病史采集字段 | 分诊 case 无法编辑 |
| **AI 生成绑定** | `case_generation.py` 输出固定 JSON 结构 | 无法生成分诊场景 case |

### 改动方案

```
Case 表加列:
  training_type: str = "history_taking"     ← 新列，默认值兼容
  difficulty: int = 1                        ← 从 case_data 提升
  time_limit_minutes: int = 20               ← 从 case_data 提升

case_data: PydanticJSONB(CaseDataSchema) →  JSONB（无列级别 schema 约束）
  ├── history_taking: 保留全部现有字段，所有 case_data.get() 继续有效
  └── triage: 新字段 arrival_mode/triage_level/red_flags/mews

验证: 从列级别 PydanticJSONB 下放到 service 层
  validator = _VALIDATORS[record.training_type]
  validator(case_data)  # 类型特有 Pydantic schema
```

### 适配清单

| 层 | 改动 | 风险 |
|------|------|:----:|
| DB migration | 加 3 列 + `case_data` 改 `JSONB` + 数据迁移 | 需验证现有数据无损 |
| `CaseService.create/update` | `assert_valid_case_data` → `_VALIDATORS[type](data)` | 低（保持相同接口） |
| 所有 `case_data.get("xxx")` 调用 | **不动**—history_taking 数据里这些字段永远存在 | 零 |
| `_create_record:185` | `case_data.get("time_limit")` → `case.time_limit_minutes` | 低 |
| 前端 `CaseForm.tsx` | 按 `training_type` 渲染不同表单 section | 中（前端结构重排） |
| AI 生成 | `POST /api/cases/generate` 接收 `training_type` 参数 | 中（路由逻辑） |
| `CaseBrief`/`CaseManageItem` | 加 `training_type` 字段 | 低 |

### 数据自描述：消除 exam_anchors 等冗余元数据

当前 case_data 有三层重复标记：

```
exam_anchors: { groups: [...], ops: [...] }    // A: 支持哪些查体
supported_plugins: ["physical_exam"]            // B: 又标记一次
phases[].operations: ["temp","bp"]             // C: 再标记一次
```

三者描述同一件事（"这个 case 支持测体温和血压"），但各自维护，容易不一致。

**数据本身就是最好的标记**：case_data 包含 physiology 字段（定义生命体征基线），profile 据此自动推断可用操作。不需要独立的元数据层。

```
# history_taking profile 内部
def infer_operations(case_data: dict) -> list[str]:
    """从数据推断可用操作，无需独立 exam_anchors"""
    ops = ["chat"]
    physiology = case_data.get("physiology", {})
    if physiology.get("timeline"):
        # timeline 包含 temp → 自动注册体温操作
        ops.extend(k for k in physiology["timeline"]["0m"] if k in _KNOWN_VITALS)
    return ops
```

这条原则对 `exam_anchors`、`supported_plugins`、`phases[].operations` 三层都适用：
- **数据存在 = 能力存在**
- **数据不存在 = 能力不存在**
- **没有独立的"开关"层**

删除 `exam_anchors`、`supported_plugins`、`phases[].operations` 三个字段的元数据。profile 在启动时从数据自检推断操作列表。

### 与 Profile 的关系

```
profile: history_taking        profile: triage
  └─ schema: CaseDataSchema      └─ schema: TriageCaseSchema
  └─ 实例: Case                  └─ 实例: Case
       training_type=               training_type=
         "history_taking"              "triage"
       case_data={...}               case_data={...}
  └─ 读取: build_patient_         └─ 读取: triage profile 的
       context_kwargs()                context builder
```

## 七、域变更分析

以下按 `docs/domain-division-guide.md` 的域划分，分析每个子功能在当前重构目标下的变更目标和现有问题。

### auth/ — 认证与用户

**变更**: 无。认证系统不感知训练类型。

### training/ — 训练引擎（核心变更域）

| 组件 | 变更目标 | 现存问题 |
|------|----------|----------|
| `pipeline/builder.py` | NoteSources 从硬编码改为 `profile.note_sources` 动态注册 | 三个源固定 |
| `pipeline/middleware/prompt_builder.py` | 模板来源从 `pm.get()` 改为 `profile.prompts` | PM DB 化冗余 |
| `pipeline/middleware/side_effects.py` | 情绪/主动行为改为 `profile.has_emotion/has_initiative` 包裹 | 无条件执行 |
| `pipeline/middleware/llm_caller.py` | 无需改动 | — |
| `pipeline/middleware/phase_guard.py` | 可改为操作白名单 | 当前形同虚设 |
| `pipeline/middleware/phase_transition.py` | 无需改动 | — |
| `pipeline/middleware/persister.py` | 无需改动 | — |
| `pipeline/phase.py` | `_default_phase` 移除，由 profile 提供 phases | 硬编码回退 |
| `router/physical_exam.py` | 保持精简（已做到），新类型自行注册 ops | — |
| `router/chat.py` | 无需改动 | — |
| `patient/exam.py` | 值解析保留，操作定义迁入 profile | 操作硬编码 |
| `patient/note_source.py` | 已拆 `ExamExperienceSource`；新类型自注册源 | — |
| `patient/emotion.py` | 移至 `profiles/history_taking/` | trust/comfort 非通用 |
| `patient/guards.py` | 移至 `profiles/history_taking/` | 身份守卫非通用 |
| `patient/initiative.py` | 移至 `profiles/history_taking/` | 主动发言非通用 |
| `patient/prompt.py` | 移至 `profiles/history_taking/` | `build_patient_chat_messages` 通用框架可保留 |

### scoring/ — 评分引擎

| 组件 | 变更目标 | 现存问题 |
|------|----------|----------|
| `score_engine.py` | 评分前快照 `profile.prompts` + `profile.rubric`→`TrainingRecord` | 当前读 `rubric_frozen` 字符串引用 |
| `router/scoring.py` | `_run_scoring_background` 传入 training_type 参数 | 当前硬编码传 `pm` |
| 前端 `ScoringOverlay.tsx` | 无需改动（通用覆盖层） | — |
| 前端 `ScoreCard.tsx` | 无需改动 | — |

### qa/ — 护理问答

**变更**: 无。QA 系统是完全独立的功能，不经过训练 pipeline。

### admin/ — 管理后台

| 组件 | 变更目标 | 现存问题 |
|------|----------|----------|
| `routers/admin/prompts.py` | **删除** | DB prompt CRUD，无运营价值 |
| `routers/admin/rubrics.py` | **删除** | DB rubric CRUD，无运营价值 |
| `services/prompt.py` | **删除** | prompt CRUD 附属品 |
| `services/rubric.py` | **删除** | rubric CRUD 附属品 |
| `routers/admin/practices.py` | Practice 列表/表单感知 `training_type` | 当前只显示 features |
| 前端 `PracticesPage.tsx` | 加 `training_type` 显式过滤 | 当前全靠 features 隐式表达 |

### cases/ — 病例管理

| 组件 | 变更目标 | 现存问题 |
|------|----------|----------|
| `models/case_practice.py` `Case` | 加 `training_type`/`difficulty`/`time_limit_minutes` 列；`case_data` 改 `JSONB` | 单 schema 约束 |
| `core/case_schema.py` | 保留为 `history_taking` schema，解除列级别绑定 | 不能换 schema |
| `services/case.py` | `assert_valid_case_data` → `_VALIDATORS[type](data)` | 硬编码验证 |
| `routers/cases.py` | `POST /generate` 接收 `training_type`；case 列表返回类型 | 生成结构绑定 |
| 前端 `CaseForm.tsx` | 按 `training_type` 渲染不同表单 | 4 section 全部病史采集 |
| 前端 `CaseSelect.tsx` | 可选显示类型徽标 | — |
| AI 生成 prompt | `case_generation.py` 接收 `training_type` 参数 | 输出结构绑定 |

## 八、前瞻：游戏级生理模拟

> 非短期需求，列为长期探索方向。不阻止 P1-P4 推进。

### 现有查体系统的定位

当前 `exam.py:_resolve_value()` 是**无状态随机取值**：每次查体从范围中取随机数，不感知历史状态、不随时间变化、不响应护理操作。这对于 Demo 验证已足够，但不支撑"查体结果是可解释的"这一期望。

### 参考案例：Casualties: Unknown

该游戏实现了"模拟肢体和心血管系统"——身体作为互锁状态变量网络，操作（包扎/止血）改变状态，状态影响患者表现。关键在于**不是科研级精度，而是游戏级内部一致性**：不追求准确，追求可解释。

### 院内护理场景的差异

| Casualties: Unknown | 我们的场景 |
|---------------------|-----------|
| 外伤驱动（出血→感染→截肢） | 疾病驱动（感染→器官功能→代偿） |
| 时间尺度：分钟级恶化 | 时间尺度：小时-天级趋势 |
| 患者无意识或沉默 | 患者清醒可对话 |
| 致死风险高 | 恶化风险缓 |

### 适合我们的模型

```
生命体征联动网络（核心）
  HR ↑ 当 BP ↓（代偿性心动过速）
  RR ↑ 当 SpO₂ ↓（呼吸代偿）
  Temp ↑ 当感染进展
  BP ↓ 当血容量不足
  SpO₂ ↓ 当肺部问题/体位不当

病情时间线（case 配置）
  术后1h: BP偏低, HR偏快, 疼痛评分6
  术后6h: BP回升, HR稳定, 疼痛评分4
  术后24h: 基本正常, 可能发热（感染）

护理操作影响
  半卧位 → SpO₂ ↑ 2-3%
  止痛药 → 疼痛↓, HR↓
  补液   → BP↑, HR↓
  翻身   → 皮肤压力↓
  不干预 → 按时间线恶化
```

### 架构影响预测

```python
class PhysiologyEngine:
    """院内场景的生理模拟 — 状态机 + 趋势线"""

    def __init__(self, case_data: dict, seed: int):
        self.timeline = case_data["physiology"]["timeline"]
        self.elapsed = 0
        self.state = self._interpolate(0)
        self.modifiers = {}

    def tick(self, minutes: int):
        self.elapsed += minutes
        self.state = self._interpolate(self.elapsed)
        self._apply_modifiers()

    def apply_operation(self, op_type: str) -> dict:
        # 读取当前状态，非独立随机
        return {"value": f"{self.state[op_type]}"}

    def apply_intervention(self, action: str):
        # 修正常量，叠加在时间线基线上
        self.modifiers[action] = self._effect(action)
```

替换关系：

```
当前: exam.py → _resolve_value() → random.uniform(lo, hi)
改为: physiology.py → apply_operation() → self.state[op]

调用链不变: perform_exam() → handle_operation() → 取值
```

生理模拟是 `history_taking` profile 的可选组件。其他类型（如图片+点击、纯表单）可以不启用它，直接返回预设值。此方向不影响当前 P1-P4 规划。

## 九、Scene 架构边界

### 框架 vs 场景 — 各自的权责

```
┌──────────────────────────────────────────────────────┐
│  TrainingEntry（框架层）                              │
│                                                      │
│  选定场景: 读 record.training_type → 渲染对应 Scene  │
│  共享覆盖: ScoringOverlay / QuestionnaireOverlay     │
│  共享 hook: useScoring / useMessageBus / useTraining │
│  错误隔离: ErrorBoundary 包裹 Scene                  │
│  基础设施: React Query / Axios / Auth / Router       │
│                                                      │
│  Scene 不可见 / 不干涉 / 不假设:                     │
│  ├─ 场景的 DOM 树                                    │
│  ├─ 场景的 layout / panel / sidebar                 │
│  ├─ 场景的 SSE / WebSocket / 轮询                    │
│  └─ 场景的 loading / empty / error 状态              │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  Scene（场景层）                                     │
│                                                      │
│  入口组件: 全权控制渲染树                            │
│  交互模式: 不限（聊天/表单/3D/图片+区域/游戏）       │
│  数据获取: 自由调用 API                              │
│  辅助 UI: 场景私有 panel/sidebar/toolbar             │
│  操作触发: 场景自定义（按钮/点击/手势/时间线）       │
│                                                      │
│  Scene 可选的共享设施:                               │
│  ├─ useScoring(recordId, bus) → 评分生命周期        │
│  ├─ useMessageBus() → 事件总线                       │
│  └─ useTraining(recordId) → 训练记录 + case 数据    │
└──────────────────────────────────────────────────────┘
```

### Scene 契约

```typescript
// frontend/src/training/scenes/types.ts
interface SceneProps {
  recordId: string;
  bus: MessageBus;           // 事件总线（评分/问卷事件从此发出）
  training: TrainingRecordDetail;  // 包括 case_data、features 等
}

interface SceneModule {
  default: React.FC<SceneProps>;
}

// 注册
const TRAINING_SCENES: Record<string, () => Promise<SceneModule>> = {
  history_taking: () => import("../scenes/history-taking"),
  triage: () => import("../scenes/triage"),
};
```

### 交互范例

```tsx
// A: 聊天场景（当前 history_taking）
function ChatScene({ recordId, bus, training }: SceneProps) {
  const sse = useSSE(recordId, bus);
  return (
    <div className="flex flex-col h-screen">
      <Header patient={training.patient_info} />
      <div className="flex flex-1">
        <ChatArea bus={bus} sse={sse} />
        <PanelSidebar panels={PANELS} />           // ← 场景私有
      </div>
    </div>
  );
}

// B: 图片+点击区域（实用简单交互）
function ImageClickScene({ recordId, bus }: SceneProps) {
  const [phase, setPhase] = useState(0);
  const steps = [
    { image: "/triage/arrival.jpg", hotspots: [{ x: 30, y: 50, label: "测体温", action: "vitals" }] },
    { image: "/triage/assessment.jpg", hotspots: [...] },
  ];
  return (
    <div className="relative w-full h-screen bg-cover" style={{ backgroundImage: `url(${steps[phase].image})` }}>
      {steps[phase].hotspots.map((hs) => (
        <button key={hs.label}
          className="absolute w-16 h-16 rounded-full bg-red-500/50 animate-pulse"
          style={{ left: `${hs.x}%`, top: `${hs.y}%` }}
          onClick={() => handleAction(hs.action)}
        />
      ))}
    </div>
  );
}

// C: 3D 交互（R3F）
function ThreeScene({ recordId, bus }: SceneProps) {
  const scoring = useScoring(recordId, bus);
  return (
    <Canvas shadows>
      <PatientModel />
      <ExamTools onInteract={handleInteraction} />
      <Html>
        <ScoreBadge status={scoring.status} />
      </Html>
    </Canvas>
  );
}

// D: 表单决策（分诊）
function TriageScene({ recordId, bus }: SceneProps) {
  const [vitals, setVitals] = useState({});
  const [category, setCategory] = useState<Category>();
  return (
    <div className="grid grid-cols-[1fr_300px] h-screen">
      <TriageForm vitals={vitals} onChange={setVitals} />
      <SidePanel>
        <VitalsMonitor data={vitals} />
        <MEWSCalculator vitals={vitals} />
        <CategorySelector onSelect={setCategory} />
      </SidePanel>
    </div>
  );
}

// E: 纯按钮交互（查体训练）
function ButtonScene({ recordId, bus }: SceneProps) {
  // 没有聊天、没有面板 — 纯操作反馈
  const [count, setCount] = useState(0);
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4">
      <p className="text-lg">请依次完成以下检查：</p>
      <div className="grid grid-cols-2 gap-3">
        {OPS.map((op) => (
          <button key={op.id} onClick={() => performExam(recordId, op.id)}>
            {op.label}
          </button>
        ))}
      </div>
      <ProgressBar value={count} max={OPS.length} />
    </div>
  );
}
```

### Panel 重新定位

当前全局 `PANELS` 数组 → 场景私有：

```
当前（框架概念）         →   重新定位（场景概念）
PANELS（全局数组）       →   场景组件内的 panel 变量
PanelDef.badge 全局计算  →   场景内自行决定角标逻辑
```

### Operations 取代 Exam

"查体操作"泛化为"场景交互操作"，不再假设触发方式或 UI 形态：

```typescript
// 后端不再有"查体"概念 — 每个 profile 定义自己的 operations
interface ProfileOperation {
  id: string;
  description: string;           // 注入 NoteSource 的描述文本
  trigger: "button" | "decision" | "auto" | "gesture";
}

// history_taking 的 exam ops → 普通 button operations
OPS = [
  { id: "temp", description: "体温测量（体温计置于腋下）", trigger: "button" },
  { id: "bp", description: "血压测量（袖带绑在左上臂）", trigger: "button" },
]

// triage 的 operations
OPS = [
  { id: "mews_calc", description: "MEWS 评分计算", trigger: "decision" },
  { id: "assign_category", description: "分配分诊级别", trigger: "decision" },
]

// 游戏场景的 operations
OPS = [
  { id: "pickup_tool", description: "拾取检查工具", trigger: "gesture" },
  { id: "apply_stethoscope", description: "听诊", trigger: "gesture" },
]
```

后端 `OperationNoteSource`（取代 `ExamExperienceSource`）不再区分操作类型：

```python
class OperationNoteSource(NoteSource):
    async def collect(self, ctx) -> str | None:
        ops = (ctx.record.runtime_state or {}).get("operations", [])
        descriptions = [op["description"] for op in ops[-5:]]
        if not descriptions:
            return None
        return "护士对你进行了以下操作：\n- " + "\n- ".join(descriptions)
```

### 对 3D/游戏/任意场景的可用性保证

| 保证 | 实现 |
|------|------|
| 全屏渲染权 | Scene 完全控制 DOM 子树，框架不注入额外元素 |
| 无侵入覆盖 | ScoringOverlay/Questionnaire 使用 `position: fixed; z-index: 9999` |
| 共享 API 设施 | `useScoring`/`useMessageBus`/`useTraining` 在所有 Scene 中可 imports |
| Canvas 兼容 | 共享 hook 不读写 DOM 结构，与 R3F `Canvas` 兼容 |
| 错误隔离 | `TrainingEntry` 用 `ErrorBoundary` 包裹 Scene，崩溃不影响页面导航 |
| 资源加载 | Scene 自行管理自己需要的 assets（3D models / 图片 / 音频） |
| 无假设 | 框架不导入 React Three、不依赖任何特定包 |

## 九、P0 当前分支状态

分支 `refactor/prompt-engineering-clarity` 已完成 6 项物理查体相关的 prompt 修复：

1. `note_source.py`: `ExamResultsSource` → `ExamExperienceSource`
2. `prompt.py`: 修复 system→assistant role 映射 bug
3. `physical_exam.py`: 232→61 行，删除 emotion bridge
4. `patient_chat.py`: 第 5 条改为"感知检查但不自知结果"
5. `builder.py`: 更新 NoteCollector 注册
6. `TrainingConfigModal.tsx`: 标记废弃

当前分支工作与此架构的对齐：

| 改动 | 对齐项 |
|------|--------|
| `ExamResultsSource` → `ExamExperienceSource` | 操作注入泛化的前奏 |
| `physical_exam.py` 精简 | 操作定义迁出路由的第一步 |
| `exam.py` 保留值解析 | 操作逻辑保持可用 |
| role mapping 修复 | 通用 pipeline 增强 |

## 十、实施路径

```
P0 [当前]  prompt 修复 — 消除暴露式泄露                   已完成
P1 [下一]  profile 注册框架 + migration                   估计 2-3 天
           ├─ TrainingRecord 加 training_type/prompt_snapshot/rubric_snapshot
           ├─ Case 加 training_type/difficulty/time_limit_minutes
           ├─ case_data 改 JSONB + service 层类型路由验证
           ├─ _create_record 解耦（从 profile 读 initial_phase）
           ├─ score_engine 写入 snapshot（替代 rubric_frozen）
           ├─ 删除 CHECK 约束（current_phase + messages.role）
           └─ 删除 DB prompt/rubric 表 + CRUD 路由和服务
P2 [后续]  前端 CaseForm Scene 适配                         估计 2-3 天
P3 [后续]  前端 TrainingEngine → HistoryTakingScene 迁移     估计 2-3 天
P4 [后续]  Triage 场景实现（后端 + 前端）                    独立评估
```

每步都是可独立部署的状态，不需要一次性全部完成。
