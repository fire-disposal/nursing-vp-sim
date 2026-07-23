# Tool Protocol Unification — Design Spec

**Date**: 2026-07-23
**Status**: Draft
**Scope**: 本次执行 — 工具协议统一 + 清理 + 命名整理；阶段编排仅文档设计。

---

## 1. 问题现状

训练系统中"工具"（查体、护理记录、quiz、MEWS）各自走不同的通信通道，没有统一契约：

| 工具 | 当前通道 | 后端复杂度 |
|------|---------|-----------|
| physical_exam | WS `type: "exam"` → `PhysicalExamService` → `handle_operation()` | WS 中有专用 if 分支 |
| nursing_record | REST CRUD 端点 | 独立路由 |
| quiz | 无后端 — 纯前端显示 case_data | 后端不感知学生作答 |
| mews | 蹭 physical_exam 能力旗标，无独立后端 | 评分时不感知 MEWS 答案 |

此外：
- `physical_exam` 能力声明覆盖 triage，但 `TriageCaseData` 无 `exam_anchors`，结构断裂
- 前端 `PhysicalAssessmentCard` 的 `NORMALS` 表定义 15 种操作，后端 `exam.py` 只处理 7 种
- 前端同时存在 `features`（TrainingContext）和 `capabilities`（capabilities.gen.ts）两套名字
- 目录命名混乱：`scene-cards/`、`panels/`、`scoring-display/` 三级分裂

---

## 2. 目标架构

### 2.1 三层分离

```
A ─ Scenario (场景)         — 训练类型页面布局 (history_taking / triage)
B ─ Tool (工具)             — 学生主动操作的功能模块，统一 WS 协议
C ─ Engine Behavior (引擎)  — 后台自动运行，无 UI，影响 LLM 上下文
```

### 2.2 统一工具协议

所有 Tool 走同一条 WS 管道：

```
Tool 组件 → bus.emit("tool:invoke", {tool, action, params, phase?})
              → useToolBridge (唯一的前端桥)
                → WS send { type: "tool", tool, action, params, phase? }
                  → ToolRegistry.dispatch(tool, action, params, ctx)
                    → XxxToolHandler.handle(action, params, ctx)
                ← WS send { type: "tool:result", tool, action, ok, data, scene? }
              → bus.emit("tool:result", {tool, action, data, scene?})
```

#### WS 消息格式

**请求：**
```json
{ "type": "tool", "tool": "physical_exam", "action": "measure", "params": { "op_type": "hr" }, "phase": null }
{ "type": "tool", "tool": "nursing_record", "action": "save", "params": { "sheet_data": {...} } }
{ "type": "tool", "tool": "quiz", "action": "submit", "params": { "question_id": "q1", "answer": "B" } }
{ "type": "tool", "tool": "mews", "action": "submit", "params": { "scores": {...} } }
```

**响应：**
```json
{
  "type": "tool:result",
  "tool": "physical_exam",
  "action": "measure",
  "ok": true,
  "data": { "op_type": "hr", "label": "心率", "value": "72", "unit": "次/分" },
  "scene": { "vitals": { "hr": 72 } }
}
```

`scene` 可选 — 有值时自动 merge 入 `runtime_state.scene` + 推送 `scene:state` 事件。
`phase` 预留 — 本次不使用，为阶段编排预留校验点。

#### 后端 ToolHandler 接口

```python
# backend/contexts/training/tools/base.py

from dataclasses import dataclass, field
from typing import Any

@dataclass
class ToolContext:
    record: Any          # TrainingRecord
    case_data: dict
    current_user: Any    # User
    db: Any              # Session

@dataclass
class ToolResult:
    ok: bool
    data: dict[str, Any] = field(default_factory=dict)
    scene: dict[str, Any] | None = None
    error: str = ""


class ToolHandler:
    """Base for training tool handlers. One handler per tool."""
    tool_name: str

    async def handle(self, action: str, params: dict, ctx: ToolContext) -> ToolResult:
        raise NotImplementedError
```

#### ToolRegistry

```python
# backend/contexts/training/tools/registry.py

_registry: dict[str, ToolHandler] = {}

def register(handler: ToolHandler) -> None:
    _registry[handler.tool_name] = handler

def dispatch(tool_name: str, action: str, params: dict, ctx: ToolContext) -> ToolResult:
    handler = _registry.get(tool_name)
    if not handler:
        raise ValueError(f"Unknown tool: {tool_name}")
    return await handler.handle(action, params, ctx)
```

---

## 3. 能力重新归类

### 3.1 Engine Behavior（引擎行为）

无工具 UI，后台自动运行，通过 SSE 影响前端展示。

| Key | Label | Tier | Scenarios |
|-----|-------|------|-----------|
| `emotion` | 患者情绪状态机 | builtin | all |
| `patient_initiative` | 患者主动追问 | toggleable | history_taking |

### 3.2 Tool Capability（工具能力）

有对应 ToolHandler + Tool 组件，通过 WS 协议通信。

| Key | Label | Handler | UI Component | Scenarios | Default |
|-----|-------|---------|-------------|-----------|---------|
| `physical_exam` | 护理查体 | PhysicalExamHandler | PhysicalExamTool | history_taking | off |
| `nursing_record` | 护理评估记录 | NursingRecordHandler | NursingRecordTool | history_taking | off |
| `quiz` | 引导题目 | QuizHandler | QuizTool | history_taking, triage | off |
| `mews` | MEWS 评分 | MewsHandler | MewsTool | triage | on |

> MEWS 是 triage 的核心评分环节，不作为可开关的能力。Triage 场景始终启用。

---

## 4. 每个工具的 Handler 行为

### 4.1 PhysicalExamHandler

| Action | Params | 行为 | 副作用 |
|--------|--------|------|--------|
| `measure` | `{ op_type }` | 读 case_data.exam_anchors，解析值 | 更新 runtime_state.exam_results, scene.vitals |

**删除**：`NORMALS` 表中 8 种无后端操作（lung, heart, bowel, gcs, strength, edema, glucose, ecg）。仅保留 temp, hr, bp, rr, spo2, skin, pain, vitals。

### 4.2 NursingRecordHandler

| Action | Params | 行为 | 副作用 |
|--------|--------|------|--------|
| `save` | `{ sheet_data }` | 创建或更新 NursingRecord | 写入 DB |
| `load` | `{}` | 返回已有记录 | 无 |

从 REST CRUD 迁移到此 Handler，删除独立的 REST 端点。

### 4.3 QuizHandler

| Action | Params | 行为 | 副作用 |
|--------|--------|------|--------|
| `submit` | `{ question_id, answer }` | 验证答案（比对 case_data.quiz 中的 answer），记录结果 | 写入 runtime_state 或 NursingRecord 关联 |
| `load` | `{}` | 返回 quiz 配置（题目列表，不含答案） | 无 |

**新增后端处理** — 之前 quiz 纯前端渲染，后端不感知学生作答。

### 4.4 MewsHandler

| Action | Params | 行为 | 副作用 |
|--------|--------|------|--------|
| `submit` | `{ scores: { consciousness, rr, hr, bp_sys, temp, spo2, urine } }` | 接收 MEWS 各维度评分，与 case_data.mews_score 比较 | 写入 runtime_state |
| `load` | `{}` | 返回 vitals 数据（供前端计算用） | 无 |

---

## 5. 前端重组

### 5.1 目录结构

```
frontend/src/components/training/
├── tools/                          ← 原 scene-cards/ + panels/MewsPanel.tsx
│   ├── registry.ts
│   ├── PatientInfoTool.tsx         ← 原 PatientInfoCard.tsx
│   ├── InquiryTool.tsx             ← 原 InquiryCard.tsx
│   ├── PhysicalExamTool.tsx        ← 原 PhysicalAssessmentCard.tsx
│   ├── NursingRecordTool.tsx       ← 原 NursingRecordCard.tsx
│   ├── QuizTool.tsx                ← 原 QuizCard.tsx
│   └── MewsTool.tsx                ← 原 panels/MewsPanel.tsx
├── scenes/                         ← 保留
│   ├── scene-registry.ts
│   ├── HistoryTakingScene.tsx
│   └── TriageScene.tsx
├── scoring/                        ← 原 panels/scoring-display/
├── ChatArea.tsx                    ← 保留
├── ChatBubble.tsx                  ← 保留
├── ChatDisplay.tsx                 ← 保留
├── ChatInput.tsx                   ← 保留
├── EmotionIndicator.tsx            ← 保留
├── ExamResultCard.tsx              ← 原 ExamCard.tsx (改名——这是结果显示组件而非工具)
├── PatientMonitor.tsx              ← 保留
├── SceneRenderer.tsx               ← 调用 getTools()
├── SceneToolbar.tsx                ← 调用 getTools()
├── TrainingHeader.tsx              ← 保留
└── WelcomeScreen.tsx               ← 保留
```

### 5.2 接口定义

```typescript
// engine/TrainingTool.ts

export interface TrainingToolProps {
  bus: MessageBus;
  recordId: string;
  recordDetail: TrainingRecordDetail | null;
}

export interface ToolDef {
  id: string;
  component: ComponentType<TrainingToolProps>;
  capability?: string;    // 能力门控键 (undefined = 始终可用)
  priority: number;
}
```

### 5.3 工具注册表

```typescript
// tools/registry.ts

export function getTools(
  trainingType: string,
  capabilities: Record<string, boolean>
): ToolDef[] { ... }
```

### 5.4 工具桥

```typescript
// engine/hooks/useToolBridge.ts
// 替代 useExamBridge。监听 bus.on("tool:invoke")，发送 WS tool 消息。
// 监听 WS onmessage tool:result，emit bus.emit("tool:result") + bus.emit("scene:state")。
```

---

## 6. 删除清单

### 6.1 死代码

| 文件/片段 | 原因 |
|-----------|------|
| `profiles/history_taking/exam.py:get_exam_config()` | 无调用方 |
| `profiles/history_taking/exam.py:_build_legacy_config()` | 同上 |
| `profiles/registry.py:PromptCollection.scoring_feedback` | 无使用 |
| `profiles/registry.py:PromptCollection.scoring_feedback_user` | 无使用 |

### 6.2 设计错误

| 操作 | 原因 |
|------|------|
| triage 从 `physical_exam` capability 的 training_types 移除 | TriageCaseData 无 exam_anchors |
| triage 卡片注册列表移除 `physical-exam` 条目 | 同上 |
| MewsPanel 从 `physical_exam` 能力门控解除 | MEWS 与查体无关 |
| PhysicalExamTool.NORMALS 删除 8 个无后端操作 | 前端按钮调用返回 "不支持的操作" |

### 6.3 命名混乱消除

| 旧名 | 新名 | 范围 |
|------|------|------|
| `scene-cards/` 目录 | `tools/` | frontend |
| `panels/` 目录 | 拆分并入 `tools/` + `scoring/` | frontend |
| `panels/scoring-display/` | `scoring/` | frontend |
| `SceneCard` 接口 | `TrainingTool` | frontend |
| `SceneCardProps` | `TrainingToolProps` | frontend |
| `getSceneCards()` | `getTools()` | frontend |
| `CARD_META` | `TOOL_META` | frontend |
| `useExamBridge` hook | `useToolBridge` | frontend |
| `PhysicalAssessmentCard` | `PhysicalExamTool` | frontend |
| `NursingRecordCard` | `NursingRecordTool` | frontend |
| `QuizCard` | `QuizTool` | frontend |
| `InquiryCard` | `InquiryTool` | frontend |
| `PatientInfoCard` | `PatientInfoTool` | frontend |
| `MewsPanel` | `MewsTool` | frontend |
| `ExamCard` | `ExamResultCard` | frontend |
| `ScoreCard` (in scoring-display/) | `ScoreCard`（不变，已在 scoring/ 下） | frontend |
| features (TrainingContext 中) | capabilities（统一） | frontend |
| `scene-card.ts` | `TrainingTool.ts` | frontend |

### 6.4 废弃端点

| 端点 | 原因 |
|------|------|
| REST nursing record CRUD 端点 | 迁移至 WS ToolHandler |

---

## 7. 阶段编排（Phase Orchestration）设计 — 文档阶段，不执行

### 7.1 概念

训练 Session 不再以 LLM 聊天为唯一主线，而是定义为 **Phase 序列**：

```
Session = [Phase1, Phase2, Phase3, ...]
```

### 7.2 Phase 类型

| PhaseType | 说明 | UI 形态 |
|-----------|------|---------|
| `chat` | LLM 对话 | 聊天界面（当前主 UI） |
| `tool` | 工具操作 | 全屏工具（查体 / MEWS / 护理记录） |
| `quiz` | 选择题考核 | 题目列表 + 提交 |
| `scene_3d` | Three.js 场景 | 3D 渲染画面 |
| `form` | 表单填写 | 表单 UI |
| `video` | 视频播放 | 视频播放器 |

### 7.3 编排定义

硬编码在 scenario 定义中：

```python
# profiles/history_taking/phases.py
HISTORY_TAKING_PHASES = [
    PhaseDef(type="chat", config={"title": "病史采集", "end_condition": "student_ends"}),
    PhaseDef(type="tool", config={"tool": "nursing_record", "title": "护理记录"}),
    PhaseDef(type="chat", config={"title": "报告结果", "end_condition": "student_ends"}),
    PhaseDef(type="quiz", config={"tool": "quiz", "title": "考核"}),
]
```

### 7.4 Phase 与 Tool 关系

- Phase 类型为 `tool` 时，激活对应 Tool 为全屏模式（非 sidebar）
- Phase 切换由后端控制（评分引擎已可检测 phase 变化）
- WS 消息中的 `phase` 字段用于校验：非当前 phase 的 tool action 被拒绝

### 7.5 对本次设计的影响

- 工具协议中的 `phase` 字段：预留，本次总是 `null`
- ToolHandler 接口不依赖 phase（phase 校验在 dispatch 层，不在 handler 内）
- 文件组织以 tool 为第一优先级，phase 编排后续直接加 phases/ 文件即可

---

## 8. 不变部分

| 组件 | 状态 |
|------|------|
| LLM pipeline (prompt_builder, llm_caller, side_effects, persister) | 不变 |
| 评分系统 (score_engine, rubric_builder) | 不变 |
| SSE 推送 (emotion:changed, initiative:triggered, scene:state) | 不变 |
| capabilities.gen.ts 自动生成 | 不变（capabilities.py 更新后重新生成） |
| WS 认证、连接管理 | 不变 |
| SceneState 模型 | 不变 |
| ChatArea, ChatInput, ChatBubble, EmotionIndicator, PatientMonitor | 不变 |
