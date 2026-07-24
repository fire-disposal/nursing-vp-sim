# 病例编辑器双态重构设计

> 2026-07-24 | Canonical JSON + Projected Form 架构

## 架构

```
CaseEditorState (useReducer, 单一 JSON 对象)
    │
    ├── FormView        — 纯投影，读取 JSON path 渲染表单
    │   ├── CoreSection   — 基本信息 + 患者人口 + 人格
    │   ├── ClinicalSection — 病史/主诉/语音
    │   ├── TriageSection  — 分诊（type=分诊时显示）
    │   └── ExtendedSection — folding 区：capabilities/quiz/phases/dialogues/exam/required
    │
    └── JsonView        — Monaco Editor，直接编辑 JSON
          └── onChange → dispatch SET_JSON → FormView 自动刷新
```

**核心原则**：CaseEditorState 是唯一真相源。FormView 只是它的投影，JsonView 只是它的另一种表示。切换模式仅交换可见视图，state 零丢失。

## 删除项

| 文件 | 原因 |
|------|------|
| `types.ts` | 遗留双类型系统，7 个月未维护 |
| `CapabilitiesSection.tsx` | 未接线独立组件，将在 ExtendedSection 内重建 |
| `caseFormTypes.ts` 中的 `parseCaseData`/`buildCaseData` | 替换为直接 JSON path 读写 |

## 新增项

| 文件 | 用途 |
|------|------|
| `CaseEditorState.tsx` | useReducer + dispatch actions + JSON path 工具 |
| `FormView.tsx` | 表单模式容器，组装各 Section |
| `JsonView.tsx` | Monaco Editor + Schema 验证 + 格式化 |
| `CapabilitiesEditor.tsx` | 覆盖于 ExtendedSection 内的能力开关网格 |
| `@monaco-editor/react` | JSON 编辑器依赖 |

## 模式切换

- Tab 按钮组 "表单" / "JSON"，或 footer 处 SegmentedControl
- 切换时：延迟 0ms，因为两个 view 都从同一 state 读取
- JSON 模式：Monaco 全屏，顶栏保留 save/close 操作
- 表单模式：现有垂直布局，分组卡片

## Zod 校验

- 保存前：Zod 校验整个 CaseEditorState
- JSON 模式实时 Monaco diagnostics（基于 Zod schema 转 JSON Schema）
- 表单模式字段级 errorStates

## 扩展字段分类

| 区域 | 字段 | 编辑方式 |
|------|------|---------|
| 核心 | name, difficulty, time_limit, description, patient_info, personality, communication_style, chief_complaint, opening_line, 病史6项 | 表单始终可见 |
| 核心 | voice_override | 表单内一行 input（与 voice_type 并列） |
| 扩展 | capabilities, required_inquiries, exam_anchors, quiz, phases, example_dialogues | folding 区，默认折叠 |
| 自由 | deep_background, 任何未来 JSON 顶层键 | 仅 JSON 模式可见/可编辑 |

## 保留文件

`PatientSection`, `ClinicalSection`, `PersonalitySection`, `TriageSection`, `PhasesEditor`, `DialoguesEditor`, `ExamAnchorsEditor`, `QuizEditor`, `BackgroundEditor`, `AiFieldsSection` — 重构为从 JSON path 读写的受控组件，移除内部 `onFieldChange` 回调层，改为直接操作 state。
