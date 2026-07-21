# 病例编辑器翻新 — 设计规格

**日期**: 2026-07-21
**状态**: 待用户复核
**类型**: 重构 + 新功能

---

## 1. 现状问题

当前 `CaseForm.tsx` (917 行) 是扁平表单，用 `if (HT) else (triage)` 两大分支硬编码。以下 8 个关键字段零 UI 表示：

| 字段 | 运行时消费者 | 后果 |
|------|-------------|------|
| `personality` | EmotionEngine、InitiativeSystem、LLM prompt | 性格配置形同虚设 |
| `exam_anchors` | PhysicalAssessmentCard、PhysicalExamService | 查体功能无锚点数据 |
| `quiz` | QuizCard (刚实现) | 题目能力存在但不可编辑 |
| `phases` | PhaseTransition 管道 | 阶段训练不可配置 |
| `deep_background` | LLM prompt builder | 隐藏背景无法输入 |
| `example_dialogues` | LLM prompt builder | 示例对话不可编辑 |
| `hidden_info` | LLM prompt | 仅 AI 可生成，无手动编辑 |
| `required_inquiries` | InquiryCard | 仅 AI 可生成，无手动编辑 |

附加问题：
- `voice_type` 有 UI 但被 `CaseDataSchema(extra="ignore")` 静默丢弃
- `capabilities` 仅在 HT 分支渲染，triage 无此区块
- `scoring_criteria` AI 生成后因 schema 不包含该字段而被丢弃

---

## 2. 架构

```
CaseForm.tsx (thin shell, ~120 行)
├── form state: CaseFormData (单一类型，镜像 CaseDataSchema)
├── 基础字段: name / difficulty / time_limit / description / is_open
│
├── PatientSection (trainingType-aware)
│   ├── patient_info (name/age/gender)
│   ├── chief_complaint / opening_line
│   └── [triage] arrival_mode / red_flags / vitals / consciousness
│
├── PersonalitySection
│   ├── health_literacy (select: low/normal/high/medium)
│   ├── verbosity (select: terse/normal/verbose)
│   ├── anxiety_trait (select: calm/normal/anxious)
│   ├── patience (select: low/normal/high)
│   └── communication_style (textarea)
│
├── ClinicalSection [HT only]
│   ├── present_illness / past_history / medication_history
│   ├── allergy_history / family_history / social_history
│   └── voice_type (select)
│
├── CapabilitiesSection
│   └── 根据 trainingType 渲染 applicable capabilities 的 checkbox 列表
│
├── ExamAnchorsEditor
│   └── key-value 对列表: anchor_id → value (支持范围格式 "36.8-37.2")
│
├── QuizEditor
│   ├── title 输入
│   └── questions 列表 (add/remove):
│       ├── stem (textarea)
│       ├── options (key-value 对: key → text, add/remove)
│       ├── answer (select from options)
│       └── explanation (textarea)
│
├── PhasesEditor
│   └── phases 列表 (add/remove/reorder):
│       ├── id / name / order / prompt_profile
│       ├── operations (tag input)
│       └── transition (auto/manual_label/min_messages/min_operations/auto_after_messages)
│
├── DialoguesEditor
│   └── QA 对列表 (add/remove):
│       ├── question (textarea)
│       └── answer (textarea)
│
├── BackgroundEditor
│   └── key-value 对列表 (add/remove): key → value (string)
│
└── AiFieldsSection
    ├── hidden_info (tag input)
    ├── required_inquiries (tag input)
    └── AI 生成按钮 (填充 hidden_info + required_inquiries + example_dialogues)
```

---

## 3. 类型系统

### 3.1 `caseFormTypes.ts` — 核心类型（镜像后端 `CaseDataSchema`）

```typescript
export interface CaseFormData {
  name: string;
  difficulty: number;
  time_limit: number;
  description: string;

  patient_info: PatientInfo;
  chief_complaint: string;
  opening_line: string;

  personality: PersonalityConfig;
  communication_style: string;

  present_illness: string;
  past_history: string;
  medication_history: string;
  allergy_history: string;
  family_history: string;
  social_history: string;
  voice_type: string;

  capabilities: Record<string, boolean>;

  exam_anchors: Record<string, string>;
  quiz: QuizFormData;
  phases: PhaseConfig[];
  deep_background: Record<string, string>;
  example_dialogues: DialogPair[];

  hidden_info: string[];
  required_inquiries: string[];
  scoring_criteria: Record<string, unknown>;
}

export interface PatientInfo {
  name: string;
  age: number;
  gender: "男" | "女";
  visible_symptoms: string[];
  expression: string;
}

export interface PersonalityConfig {
  health_literacy: "low" | "normal" | "high" | "medium";
  verbosity: "terse" | "normal" | "verbose";
  anxiety_trait: "calm" | "normal" | "anxious";
  patience: "low" | "normal" | "high";
}

export interface QuizFormData {
  title: string;
  questions: QuizQuestion[];
}

export interface QuizQuestion {
  id: string;
  stem: string;
  options: QuizOption[];
  answer: string;
  explanation: string;
}

export interface QuizOption {
  key: string;
  text: string;
}

export interface PhaseConfig {
  id: string;
  name: string;
  order: number;
  operations: string[];
  prompt_profile: string;
  transition: PhaseTransition;
}

export interface PhaseTransition {
  auto: boolean;
  manual_label: string;
  min_messages: number;
  min_operations: number;
  auto_after_messages: number;
}

export interface DialogPair {
  question: string;
  answer: string;
}
```

### 3.2 `buildCaseData` — 持久化序列化

```typescript
export function buildCaseData(form: CaseFormData): Record<string, unknown> {
  return {
    name: form.name,
    difficulty: form.difficulty,
    time_limit: form.time_limit,
    description: form.description,
    patient_info: form.patient_info,
    chief_complaint: form.chief_complaint,
    opening_line: form.opening_line,
    personality: form.personality,
    communication_style: form.communication_style,
    present_illness: form.present_illness,
    past_history: form.past_history,
    medication_history: form.medication_history,
    allergy_history: form.allergy_history,
    family_history: form.family_history,
    social_history: form.social_history,
    voice_type: form.voice_type,
    capabilities: form.capabilities,
    exam_anchors: form.exam_anchors,
    quiz: form.quiz,
    phases: form.phases,
    deep_background: form.deep_background,
    example_dialogues: form.example_dialogues,
    hidden_info: form.hidden_info,
    required_inquiries: form.required_inquiries,
    scoring_criteria: form.scoring_criteria,
  };
}
```

### 3.3 `parseCaseData` — 反序列化

```typescript
export function parseCaseData(data: Record<string, unknown>): CaseFormData {
  return {
    name: String(data.name ?? ""),
    difficulty: Number(data.difficulty ?? 1),
    time_limit: Number(data.time_limit ?? 20),
    description: String(data.description ?? ""),
    patient_info: { ...DEFAULT_PATIENT, ...(data.patient_info as object ?? {}) },
    chief_complaint: String(data.chief_complaint ?? ""),
    opening_line: String(data.opening_line ?? ""),
    personality: { ...DEFAULT_PERSONALITY, ...(data.personality as object ?? {}) },
    communication_style: String(data.communication_style ?? ""),
    present_illness: String(data.present_illness ?? ""),
    past_history: String(data.past_history ?? ""),
    medication_history: String(data.medication_history ?? ""),
    allergy_history: String(data.allergy_history ?? ""),
    family_history: String(data.family_history ?? ""),
    social_history: String(data.social_history ?? ""),
    voice_type: String(data.voice_type ?? ""),
    capabilities: (data.capabilities as Record<string, boolean>) ?? {},
    exam_anchors: (data.exam_anchors as Record<string, string>) ?? {},
    quiz: (data.quiz as QuizFormData) ?? { title: "", questions: [] },
    phases: (data.phases as PhaseConfig[]) ?? [],
    deep_background: (data.deep_background as Record<string, string>) ?? {},
    example_dialogues: (data.example_dialogues as DialogPair[]) ?? [],
    hidden_info: (data.hidden_info as string[]) ?? [],
    required_inquiries: (data.required_inquiries as string[]) ?? [],
    scoring_criteria: (data.scoring_criteria as Record<string, unknown>) ?? {},
  };
}
```

---

## 4. 后端改动

### 4.1 `backend/schemas/case_schema.py`

```python
class CaseDataSchema(JsonbModel):
    # ... existing fields ...

    voice_type: str = ""                          # 新增
    scoring_criteria: dict[str, Any] = {}          # 新增（标注：仅供参考，实际评分由中央 rubric 管理）
```

### 4.2 `backend/profiles/triage/case_schema.py`

```python
class TriageCaseData(JsonbModel):
    # ... existing fields ...
    quiz: QuizConfig | None = None                 # 新增（quiz 能力已注册给 triage）
```

---

## 5. Section 组件设计

### 5.1 通用模式

每个 section 组件接口：
```typescript
interface SectionProps<T> {
  value: T;
  onChange: (value: T) => void;
  trainingType: string;     // "history_taking" | "triage" | undefined
  disabled?: boolean;
}
```

父级 `CaseForm` 持有完整的 `CaseFormData` state，通过 `onChange` 回调向上传递局部更新：
```typescript
const [form, setForm] = useState<CaseFormData>(initialData);
// ...
<PersonalitySection
  value={form.personality}
  onChange={(p) => setForm(prev => ({ ...prev, personality: p }))}
  trainingType={trainingType}
/>
```

### 5.2 结构化编辑器

**ExamAnchorsEditor**: key-value 对列表。每行有 anchor_id 输入框 + value 输入框，删除按钮，底部 "Add" 按钮。

**QuizEditor**: 标题输入 + questions 列表。每个 question 有 stem、options 子列表（key+text 对）、answer 下拉选择、explanation 文本区。可折叠。

**PhasesEditor**: phases 列表。每个 phase 有 id/name/order/prompt_profile 输入、operations tag 编辑器、transition 子表单。可折叠。

**DialoguesEditor**: QA 对列表。每行有 question 和 answer 两个文本区。

**BackgroundEditor**: key-value 对列表。每行有 key 输入框和 value 输入框。

**AiFieldsSection**: tag input 组件（支持回车/Tab 添加、点击 × 删除）。含 "AI 生成" 按钮（保留现有 `handleAiGenerate` 逻辑）。

---

## 6. 删除项

| 文件 | 说明 |
|------|------|
| `frontend/src/schemas/case.ts` | 死 zod schema，15 行，无引用 |

---

## 7. 文件清单

```
新建:
  frontend/src/components/admin/cases/caseFormTypes.ts
  frontend/src/components/admin/cases/PatientSection.tsx
  frontend/src/components/admin/cases/PersonalitySection.tsx
  frontend/src/components/admin/cases/ClinicalSection.tsx
  frontend/src/components/admin/cases/CapabilitiesSection.tsx
  frontend/src/components/admin/cases/ExamAnchorsEditor.tsx
  frontend/src/components/admin/cases/QuizEditor.tsx
  frontend/src/components/admin/cases/PhasesEditor.tsx
  frontend/src/components/admin/cases/DialoguesEditor.tsx
  frontend/src/components/admin/cases/BackgroundEditor.tsx
  frontend/src/components/admin/cases/AiFieldsSection.tsx

重写:
  frontend/src/components/admin/cases/CaseForm.tsx
  frontend/src/components/admin/cases/types.ts (→ 保留 AI gen hooks，删旧类型)

删除:
  frontend/src/schemas/case.ts

改动:
  backend/schemas/case_schema.py
  backend/profiles/triage/case_schema.py
```

---

## 8. 验收

1. `CaseFormData` 类型包含 `CaseDataSchema` 的所有字段
2. personality 四维度可通过下拉编辑并持久化
3. quiz 题目可通过列表编辑器增删改，最多支持 10 题 × 6 选项
4. exam_anchors 可通过 key-value 编辑器编辑
5. phases、example_dialogues、deep_background 各有编辑器
6. capabilities 在 HT 和 triage 下均可编辑
7. `voice_type` 选择后不会被丢弃
8. AI 生成可填充 hidden_info、required_inquiries、example_dialogues、scoring_criteria
9. 现有表单提交逻辑不回归（edit+create 正常工作）
10. tsc + biome + ruff + ty + pytest 全绿
