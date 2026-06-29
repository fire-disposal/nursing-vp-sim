# 护理查体系统 — 提示词构筑链分析与 Remaster 方案

## 目录

1. [三层缓存架构概述](#1-三层缓存架构概述)
2. [消息数组结构](#2-消息数组结构)
3. [NoteCollector — Author's Note 注入系统](#3-notecollector--authors-note-注入系统)
4. [四大 NoteSource 逐项分析](#4-四大-notesource-逐项分析)
5. [查体系统集成点分析](#5-查体系统集成点分析)
6. [揭露式注入 — 问题定位](#6-揭露式注入--问题定位)
7. [Emotion Bridge 分析](#7-emotion-bridge-分析)
8. [系统 Prompt 第五条的真相](#8-系统-prompt-第五条的真相)
9. [管线全流程追踪](#9-管线全流程追踪)
10. [Remaster 方案：Experience Injection](#10-remaster-方案experience-injection)
11. [改动清单](#11-改动清单)
12. [附录：完整文件引用](#12-附录完整文件引用)

---

## 1. 三层缓存架构概述

系统采用 **AI 酒馆风格的三层缓存架构**，将 LLM 上下文分为三个层级以优化 KV 缓存成本：

```
Layer 1: Character Card (static)      — 患者身份、性格、沟通风格（整个会话不变）
Layer 2: Dynamic Info (per-session)   — 主诉、现病史、隐藏背景（会话级）
Layer 3: Author's Note (per-round)    — 每轮动态注入（情绪、查体、身份守卫）
```

渲染位置：`backend/contexts/training/pipeline/middleware/prompt_builder.py:17-57`

```python
# prompt_builder.py:27-31 — 静态数据缓存 + 每轮替换 author_note
cached = ctx.state.get(STATE_PATIENT_CONTEXT_KWARGS)
if cached is None:
    cached = build_patient_context_kwargs(ctx.case_data)  # 10个模板变量
    ctx.state[STATE_PATIENT_CONTEXT_KWARGS] = cached
kwargs = {**cached, "author_note": author_note if author_note.strip() else ""}
```

**所有模板变量**（`backend/contexts/patient/prompt.py:79-90`）：

| 变量 | 来源 | 层级 |
|------|------|------|
| `patient_info` | `case_data.patient_info` → 姓名/年龄/性别 | Layer 1 |
| `scenario` | `case_data.opening_line` + 固定模板 | Layer 1 |
| `personality` | 四维人格格式化 | Layer 1 |
| `communication_style` | `case_data.communication_style` | Layer 1 |
| `chief_complaint` | `case_data.chief_complaint` | Layer 2 |
| `present_illness` | `case_data.present_illness` | Layer 2 |
| `allergy_history` | `case_data.allergy_history` | Layer 2 |
| `deep_background` | `case_data.deep_background` 格式化 | Layer 2 |
| `example_dialogues` | `case_data.example_dialogues` 格式化 | Layer 2 |
| `author_note` | NoteCollector 每轮动态收集 | Layer 3 |

---

## 2. 消息数组结构

`build_patient_chat_messages()` (`backend/contexts/patient/prompt.py:93-125`) 组装后的数组结构：

```
messages[0]     = system: Character Card (Layer 1 — 前缀缓存可达)
messages[1]     = system: 病情资料 (Layer 2 — 会话级缓存)
messages[2..N-2] = 聊天历史（最近 max_rounds=8 轮 = 16 条）
messages[N-1]  = user: 学生当前输入
messages[N]    = system: Author's Note (Layer 3 — 最后放置提升 KV 缓存命中率)
```

> Author's Note 放在**学生输入之后**是因为：前缀缓存（Prefix Cache）从开头匹配，将变动的 Note 放最后可使 Layer 1+2+历史全部命中前缀缓存。

**历史裁剪**：`history_messages[-max_rounds * 2:]` — 纯轮数裁剪（8 轮 = 16 条），不依赖 token 计数。

---

## 3. NoteCollector — Author's Note 注入系统

`NoteCollector` (`backend/contexts/patient/note_collector.py:26-56`) 是注入系统的核心汇编器。

### 3.1 装配流程

```python
async def collect(self, ctx: PipelineContext) -> str:
    notes = []
    for src in self._sources:        # 遍历所有 NoteSource
        text = await src.collect(ctx)  # 每个源收集自己的文本
        if text and text.strip():
            notes.append((src.priority, src.name, text))
    notes.sort(key=lambda x: x[0])   # 按优先级排序（低优先先入）
    return self._budget_join(notes)  # 预算合并
```

### 3.2 Token 预算管理

```
MAX_AUTHOR_NOTE_TOKENS = 300   # 硬上限
```

预算按优先级**贪心分配**：低优先级源先拿预算，高优先级源可能被截断或丢弃。

输出格式：`【src1_text | src2_text | src3_text】`

### 3.3 注册顺序（Pipeline Builder）

`backend/contexts/training/pipeline/builder.py:39-56`:

```python
collector = NoteCollector()
for src_cls in [
    EmotionNoteSource,     # priority=10, max_tokens=100
    IdentityGuardSource,   # priority=20, max_tokens=50
    ExamResultsSource,     # priority=30, max_tokens=200
    ExamImpactSource,      # priority=40, max_tokens=100
]:
    collector.add(src_cls())
```

---

## 4. 四大 NoteSource 逐项分析

### 4.1 EmotionNoteSource (priority=10)

文件：`backend/contexts/patient/note_source.py:26-38`

从 `EmotionCache` 获取当前情绪状态，输出格式：

```
【信赖: 45 | 舒适: 30 | 患者基本配合但保留 | 情绪紧张不安，回答简短回避 | 患者情绪焦虑...】
```

生成逻辑：`backend/contexts/patient/emotion.py:117-145`

- 信赖/舒适值 → 描述（trust<30/trust<60/trust>=60）
- 状态标签 → extra 提示（withdrawn/defensive/anxious/neutral/relaxed/open）

**评价**：这是合理的——LLM 需要知道当前情绪才能自然扮演。情绪是体验不是数据。

### 4.2 IdentityGuardSource (priority=20)

文件：`backend/contexts/patient/note_source.py:41-54`

检测上一条病人回复是否有身份泄露（"我是AI"等 31 个模式），若有则注入修正指令。

检测模式：`backend/contexts/patient/guards.py:7-32`

修正指令：
```
【注意：你在扮演真实患者，你是人不是AI。用患者的语气自然回应，
  不要提及任何关于训练、评分、系统的内容。】
```

**评价**：这是一道安全防线，必要且合理。但模式中包含了"模拟训练""评分标准"等可能与正常剧情冲突的词——需要确认不误判。

### 4.3 ExamResultsSource (priority=30) — **问题核心**

文件：`backend/contexts/patient/note_source.py:57-73`

```python
async def collect(self, ctx: PipelineContext) -> str | None:
    rs = ctx.record.runtime_state or {}
    exam_results = rs.get("exam_results", [])
    if not isinstance(exam_results, list) or not exam_results:
        return None
    lines = []
    for r in exam_results[-5:]:
        label = r.get("label", "")
        value = r.get("value", "")
        unit = r.get("unit", "")
        lines.append(f"{label}: {value}{unit}")
    return "已查体征: " + " | ".join(lines)
```

**这是最核心的揭露式注入点。** 它将临床数据直接塞给扮演病人的 LLM：

```
# 实际注入到 prompt 的内容：
已查体征: 体温: 36.8°C | 血压: 128/82mmHg | NRS疼痛评分: 7/10
```

病人 LLM 获得这些信息后，会被迫在对话中使用它们，导致：

- "我的体温是 36.8 度" — 真实病人不可能知道
- "血压 128/82 应该正常吧" — 病人不应该知道数值
- 角色一致性瓦解

### 4.4 ExamImpactSource (priority=40) — **半成品**

文件：`backend/contexts/patient/note_source.py:76-86`

```python
async def collect(self, ctx: PipelineContext) -> str | None:
    rs = ctx.record.runtime_state or {}
    note = rs.get("exam_impact_note")
    if note and isinstance(note, str) and note.strip():
        return note
    return None
```

`exam_impact_note` 在 `physical_exam.py:_build_impact_note()` 中生成，例如：

```
# 没有解释的情况：
患者刚接受了血压测量 | 护士没有解释原因，患者感到些许不适 |
频繁的检查让患者有些不耐烦 | 信赖+0，舒适-1

# 解释了的情况：
患者刚接受了血压测量 | 护士解释了原因，患者基本接受
```

**问题**：这个源是**有条件写入**的——仅当 `exam_emotion_bridge` 和 `emotion` 功能同时启用时才生成。默认练习可能没有开启这两个 feature flag。而且它生成的文案中仍然混合着感受预设（"患者感到些许不适"）和元数据（"信赖+0，舒适-1"）。

---

## 5. 查体系统集成点分析

### 5.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 学生点击 ExamPanel 按钮 ("测体温")                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ POST /api/training/{record_id}/exam/temp                        │
│                                                                  │
│ 2. physical_exam.py:155-227                                     │
│    ├─ handle_operation() → 解析 case_data.exam_anchors          │
│    │  └─ _resolve_value() → 从范围随机取值                      │
│    ├─ 写入 runtime_state.exam_results[]                          │
│    ├─ 创建 system Message: "体温: 36.8°C"                       │
│    ├─ (可选) exam_emotion_bridge → 情绪影响                     │
│    │  └─ _build_impact_note() → 写入 exam_impact_note           │
│    ├─ phase_op_count++                                          │
│    └─ db.commit()                                               │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 3. 下次学生发消息时，pipeline 触发                               │
│                                                                  │
│ prompt_builder → NoteCollector.collect():                       │
│    ├─ EmotionNoteSource   → "信赖: 45 | 舒适: 30 | ..."         │
│    ├─ IdentityGuardSource → (无泄露则跳过)                       │
│    ├─ ExamResultsSource   → "已查体征: 体温: 36.8°C | ..."     │
│    └─ ExamImpactSource    → "患者刚接受了血压测量 | ..."         │
│                                                                  │
│ → Author's Note 注入 LLM prompt (Layer 3)                       │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ 4. LLM 扮演病人回复时，已经"知道"自己的体温和血压               │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 RuntimeState 结构

`TrainingRecord.runtime_state` (JSONB) 中与查体相关的字段：

```json
{
  "exam_results": [
    {"type": "temp", "label": "体温", "value": "36.8", "unit": "°C"},
    {"type": "bp", "label": "血压", "value": "128/82", "unit": "mmHg"}
  ],
  "exam_impact_note": "患者刚接受了血压测量 | 护士没有解释原因，患者感到些许不适 | 信赖+0，舒适-1",
  "phase_op_count": 3
}
```

### 5.3 System Message 的双重角色

每次查体操作还会创建一条 `role="system"` 的 Message 记录：

```python
# physical_exam.py:191-195
msg = Message(
    record_id=record_id,
    role="system",
    content=f"{result.get('label', '')}: {result.get('value', '')}{result.get('unit', '')}",
)
```

这些消息在 ChatDisplay 中被渲染为 `ExamCard` 组件。**但这些 system message 也被加载到 `build_patient_chat_messages()` 的历史消息数组中**（通过 `ctx.messages`），以 `role="system"` 身份传给 LLM——LLM 看到它们但理论上不会直接引用（因为系统 prompt 没有教它使用 system role 的历史）。

---

## 6. 揭露式注入 — 问题定位

### 6.1 四个泄露层级

| 层级 | 位置 | 内容 | 严重度 |
|------|------|------|--------|
| **L1** | `ExamResultsSource.collect()` | 临床数值直接注入 prompt | **致命** |
| **L2** | System Message 历史 | `"体温: 36.8°C"` 出现在消息历史中 | **高** |
| **L3** | `ExamImpactSource` 中的感受预设 | "患者感到些许不适" 替 LLM 决定了感受 | 中 |
| **L4** | 系统 prompt 第五条 | "配合检查但要真实" 暗示病人"知道"自己在被检查 | 低 |

### 6.2 L1 致命问题详解

`ExamResultsSource` 注入的内容：

```
已查体征: 体温: 36.8°C | 血压: 128/82mmHg | NRS疼痛评分: 7/10
```

这条信息以 `system` role 出现在用户输入之后。LLM 处理 messages 数组时会看到它。由于当前系统 prompt 的规则 3 说"只回答你知道的"，加上 Author's Note 的 system role 指令性质，LLM 倾向于"知道"这些数据并可能在回答中使用。

实际上 LLM 的行为更糟糕：它不仅"知道"，还会基于这些数字进行推理：
- "我的体温是 36.8 度，应该还算正常"
- "血压 128/82，好像有点高？"
- "评分 7 分，确实很疼"

**真实病人不知道血压数值**。真实病人只知道"绑在手臂上的东西越勒越紧然后慢慢松开"。

### 6.3 L2 历史消息泄露

查体产生的 system messages（如 `"体温: 36.8°C"`）被加载到 `ctx.messages` 中传给 LLM。虽然在 `build_patient_chat_messages()` 中这些 system role 消息被映射为 `role` 映射：

```python
# prompt.py:115-117
for msg in history_messages[-max_rounds * 2 :]:
    role = "user" if msg.role == "student" else "assistant"
    llm_messages.append({"role": role, "content": msg.content})
```

system role 的消息被映射为 `"assistant"` role——这实际上更糟糕，因为 LLM 会认为这些内容是**它自己（病人）说的**，而不是系统记录的。也就是说，"体温: 36.8°C" 在 LLM 看来就像是"我（病人）刚才说的某句话"。

> **这是一个隐蔽的 bug：system role 消息被映射为 assistant role，导致 LLM 以为病人自己说出了这些数据。**

### 6.4 L3 感受预设

`ExamImpactSource` 的文案（由 `_build_impact_note()` 生成）：

```
患者刚接受了血压测量 | 护士没有解释原因，患者感到些许不适 | 频繁的检查让患者有些不耐烦
```

"患者感到些许不适" 和 "有些不耐烦" 是替 LLM 做的判断。这违反了"只描述做了什么，不描述病人如何感受"的原则。但比 L1/L2 危害小，因为 LLM 可以选择忽略或覆盖这些预设。

### 6.5 System Prompt 第五条

```
5. **配合检查但要真实** — 护士给你做检查（量血压、测体温等）时自然配合。
如果你对检查感到不适、不理解为什么做、或认为检查与病情无关，按你的性格表达。
频繁的检查会让你不耐烦，特别是没解释原因的检查。
```

这条写在 Character Card（Layer 1，静态不可变）里。它在提示词层级"承认"有检查在发生。方向是对的（病人应该知道自己被检查），但问题是：

- 病人"知道"检查发生了（合理）
- 但结合 ExamResultsSource 的数据，病人还"知道"检查结果（不合理）
- 规则 3 "只回答你知道的" + Author's Note 的数据 = LLM 推断"我应该知道这些数据"

---

## 7. Emotion Bridge 分析

### 7.1 数据结构

`backend/contexts/training/router/physical_exam.py:42-57` 定义了查体类型的情绪影响矩阵：

| 操作 | 分类 | 未解释 trust/comfort | 解释后 trust/comfort |
|------|------|---------------------|---------------------|
| temp/bp/hr/rr/spo2 | routine | 0 / -1 | 0 / 0 |
| vitals (全套) | bundle | 0 / -3 | 0 / -1 |
| skin | moderate | -2 / -5 | -1 / -2 |
| pain | moderate | -1 / -3 | 0 / -1 |

累积惩罚（`_CUMULATIVE_THRESHOLDS`）：
| 累计次数 | trust | comfort |
|----------|-------|---------|
| 4+ | 0 | -2 |
| 7+ | -1 | -4 |
| 10+ | -2 | -6 |

### 7.2 触发条件

```python
# physical_exam.py:198-199
features = resolve_features(record.practice_snapshot)
if features.get("exam_emotion_bridge") and features.get("emotion"):
```

即同时需要 `exam_emotion_bridge` + `emotion` feature flags 开启。这是一个**可选路径**，默认练习很可能不开启。

### 7.3 解释检测

```python
def _has_explanation(text: str) -> bool:
    keywords = ["因为", "所以", "检查一下", "评估", "需要了解", "测量一下"]
    return any(kw in text for kw in keywords)
```

极简的关键词匹配，"因为"在正常对话中频繁出现，误判率很高。"所以"同理。这个检测过于粗糙。

---

## 8. 系统 Prompt 第五条的真相

系统 prompt (`backend/prompts/patient_chat.py:35`) 第 5 条：

```
5. **配合检查但要真实** — 护士给你做检查（量血压、测体温等）时自然配合。
如果你对检查感到不适、不理解为什么做、或认为检查与病情无关，按你的性格表达。
频繁的检查会让你不耐烦，特别是没解释原因的检查。
```

这条设计意图是好的——让病人对被检查有感知。但结合 `ExamResultsSource` 的数据注入，它变成了"泄露的帮凶"：LLM 被要求配合检查（知道检查发生了），又被喂了检查数据（知道检查结果），自然就在回复中使用这些数据。

**正确的做法是**：

- 保留"对检查有感知"（病人知道自己被量了体温）
- 删除"对结果有感知"（病人不"知道"自己 36.8°C）
- 系统 prompt 第 5 条可以保留，但只描述"过程"不描述"结果"

---

## 9. 管线全流程追踪

### 9.1 批处理路径

```
POST /api/chat/{record_id}/message
  → chat.py:_build_context()        — 加载 record, case, messages, phases
      → NoteCollector 附加到 context
      → run_pipeline(ctx, middlewares)
          ├─ phase_guard            — 阶段守卫
          ├─ phase_transition       — 阶段自动推进检查
          ├─ prompt_builder         — 组装 LLM 消息
          │    ├─ NoteCollector.collect() → Author's Note
          │    │    ├─ EmotionNoteSource    → 情绪状态
          │    │    ├─ IdentityGuardSource  → 身份修正
          │    │    ├─ ExamResultsSource    → 🔴 查体数据泄露
          │    │    └─ ExamImpactSource     → 🟡 查体体验
          │    ├─ build_patient_context_kwargs() → 10变量
          │    ├─ tmpl.render(kwargs)        → Layer1+3 渲染
          │    └─ build_patient_chat_messages() → 消息数组
          ├─ llm_caller              — LLM API 调用
          │    ├─ llm_client.call()  — 批处理
          │    └─ 身份泄露检测 → 重试
          ├─ persister              — 保存消息
          └─ side_effects            — 情绪分析 + 主动状态
```

### 9.2 流式路径

```
POST /api/chat/{record_id}/message/stream
  → 同上，但 llm_caller 使用 llm_client.stream()
  → stream_pipeline() yield SSE events
```

两者的 `prompt_builder` 和 `NoteCollector` 逻辑完全一致。

### 9.3 查体操作路径（不经过 pipeline）

```
POST /api/training/{record_id}/exam/{op_type}
  → physical_exam.py:perform_exam()
    └─ 独立的胖路由，不经过 pipeline/service/repo/UoW
    └─ 直接 db.commit()
```

查体操作**不经过** LLM pipeline，是在学生按按钮时立即执行的独立 REST 调用。它的结果（exam_results, exam_impact_note）在下一次 student message 的 pipeline 运行时被 NoteCollector 采集并注入。

---

## 10. Remaster 方案：Experience Injection

### 10.1 核心原则

```
查体执行（学生视角）                  病人体验（LLM 视角）
┌──────────────────────┐      ┌──────────────────────┐
│ ExamPanel 按钮操作     │      │ "体温计在你腋下      │
│ → 体温: 38.5°C        │  NOT │  停留了几分钟"       │
│ → 血压: 140/90mmHg    │ ───→ │ "袖带在你左臂上      │
│ → NRS: 7/10           │      │  被充气又放气"       │
│ → (写入 Nursing Record)│     └──────────────────────┘
└──────────────────────┘
         │ 学生提问："你感觉怎么样？"
         ▼
LLM 病人回复："嗯，刚才量体温是有点凉……
            不过这个倒还好。但最近总觉得
            没力气，走几步就喘。"
```

### 10.2 三管齐下的修复

#### 修复 1：删除 ExamResultsSource（L1 修复）

移除 `note_source.py` 中的 `ExamResultsSource` 类和 `builder.py` 中的注册。查体结果**不再以任何形式注入 prompt**。

#### 修复 2：修复 system message 的 role 映射（L2 修复）

在 `prompt.py:build_patient_chat_messages()` 中增加处理：

```python
# 当前（有 bug）：system role 被映射为 assistant
for msg in history_messages[-max_rounds * 2 :]:
    role = "user" if msg.role == "student" else "assistant"

# 修复后：system role 应映射为 system role 或跳过
for msg in history_messages[-max_rounds * 2 :]:
    if msg.role == "system":
        continue   # 跳过系统消息，不暴露给 LLM
    role = "user" if msg.role == "student" else "assistant"
```

#### 修复 3：创建 ExamExperienceSource（替代 ExamImpactSource + ExamResultsSource）

新建 `ExamExperienceSource` 替代两者，只描述**客观动作**，不预设感受，不泄露数据：

```
# 注入内容（纯动作描述）：
【护士对你进行了以下操作：
  - 体温测量（体温计置于腋下）
  - 血压测量（袖带绑在左上臂）
  - NRS 疼痛评估（询问疼痛程度）】
```

生成逻辑：

```python
def _build_experience_note(op_type: str) -> str:
    descriptions = {
        "temp": "体温测量（体温计置于腋下）",
        "bp": "血压测量（袖带绑在左上臂）",
        "hr": "心率测量（手指佩戴血氧夹）",
        "rr": "呼吸频率测量（观察胸廓起伏）",
        "spo2": "血氧测量（手指佩戴血氧夹）",
        "vitals": "全套生命体征测量",
        "skin": "皮肤检查（视诊观察）",
        "pain": "NRS 疼痛评估（询问疼痛程度）",
    }
    label = descriptions.get(op_type, f"{op_type}检查")
    return label
```

### 10.3 新旧对比

| 维度 | 当前 | Remaster |
|------|------|----------|
| LLM 知道什么 | 知道操作 + 知道数值 | 知道操作（过程描述） |
| LLM 不知道什么 | — | 不知道数值、不知感受 |
| 输出格式 | `已查体征: 体温: 36.8°C` | `护士对你进行了以下操作：...` |
| 感受预设 | "患者感到不适" | 无 |
| 情绪关联 | 分离的 emotion bridge | 全由 LLM 从体验自然产生 |
| 历史消息泄露 | system→assistant role 映射 | 跳过 system role |

### 10.4 Emotion Bridge 的去留

当前的 `exam_emotion_bridge` 机制（基于操作类型的固定 trust/comfort 调整）与"让 LLM 自然产生情绪"的体验注入方案是矛盾的。

**建议**：保留 emotion bridge 的框架，但：
1. 删除固定 trust/comfort delta 的硬编码矩阵
2. 改为通过体验描述让 LLM 自然表达情绪
3. side_effects 中间件的情绪关键词分析（`_analyze_response_emotion` + `_apply_action_emotion`）仍然有效——它可以自动捕捉 LLM 回应中的情绪

换言之，emotion 系统继续运作，但不再依赖查体操作的硬编码预设。

### 10.5 ExamImpactSource 的处理

当前的 `ExamImpactSource` 与 emotion bridge 紧密耦合（它输出的文案包含情绪 delta）。在体验注入方案下：

- ExamImpactSource → 删除（被 ExamExperienceSource 替代）
- `exam_impact_note` 字段 → 废弃
- `_build_impact_note()` 函数 → 删除
- `_apply_exam_emotion_effect()` 函数 → 删除（或全部移至 ExamExperienceSource）

---

## 11. 改动清单

### 11.1 删除

| 文件 | 改动 |
|------|------|
| `note_source.py:57-73` | 删除 `ExamResultsSource` 类 |
| `note_source.py:76-86` | 删除 `ExamImpactSource` 类 |
| `builder.py:43-44,52-53` | 删除 `ExamResultsSource` 和 `ExamImpactSource` 注册 |
| `physical_exam.py:42-57` | 删除 `EXAM_EMOTION_IMPACT` 矩阵 |
| `physical_exam.py:53-57` | 删除 `_CUMULATIVE_THRESHOLDS` |
| `physical_exam.py:59-68` | 删除 `_EXAM_EMOTION_IMPACT_LABELS` |
| `physical_exam.py:71-117` | 删除 `_apply_exam_emotion_effect()` |
| `physical_exam.py:120-152` | 删除 `_build_impact_note()` |
| `physical_exam.py:230-232` | 删除 `_has_explanation()` |
| `physical_exam.py:198-221` | 删除 emotion bridge 调用块 |

### 11.2 修改

| 文件 | 改动 |
|------|------|
| `note_source.py` | 新增 `ExamExperienceSource` (priority=30, max_tokens=150) |
| `prompt.py:115-117` | 修复 system→assistant role 映射，跳过 system role |
| `physical_exam.py` | 简化 `perform_exam()`，移除 emotion bridge 相关逻辑，改为存储 experiences |
| `patient_chat.py:34-35` | 可选：更新第 5 条措辞，去掉"配合检查"的暗示性 |

### 11.3 新增

| 文件 | 内容 |
|------|------|
| `note_source.py` | `ExamExperienceSource` 类 |
| 同前 | `_EXAM_EXPERIENCE_DESCRIPTIONS` 映射字典 |
| `physical_exam.py` | `_build_experience_record()` 轻量辅助函数 |

### 11.4 不动

| 组件 | 理由 |
|------|------|
| `EmotionNoteSource` | 合理，保留 |
| `IdentityGuardSource` | 安全防线，保留 |
| `side_effects.py` 情绪分析 | 关键词分析自然有效，保留 |
| `ExamPanel.tsx` 前端 | 查体 UI 不变，结果只进护理记录不注 LLM |
| `exam.py` 值解析 | 后端逻辑不变，只影响学生视角的显示 |
| `cases.case_data.exam_anchors` | 配置格式不变 |

### 11.5 优雅弃用策略

为了避免一次性大改动导致回归，建议分两步：

**Step 1**: 在 `builder.py` 中先将 `ExamResultsSource` 替换为 `ExamExperienceSource`，`ExamImpactSource` 逻辑暂留但静默（不注入数值）。
**Step 2**: 确认 EmotionStep 分析正常工作后，再删除 `ExamImpactSource` 和相关 emotion bridge 代码。

---

## 12. 附录：完整文件引用

### 提示词构筑链核心文件

| 文件 | 行数 | 功能 |
|------|------|------|
| `backend/contexts/training/pipeline/middleware/prompt_builder.py` | 57 | 提示词组装中间件 |
| `backend/contexts/training/pipeline/builder.py` | 57 | Pipeline 构建 + NoteCollector 注册 |
| `backend/contexts/training/pipeline/runner.py` | 88 | Pipeline 执行器（批/流） |
| `backend/contexts/training/pipeline/context.py` | 80 | PipelineContext 共享状态 |
| `backend/contexts/patient/prompt.py` | 148 | 消息数组构建 + 变量格式化 |
| `backend/contexts/patient/note_collector.py` | 56 | Author's Note 汇编器 |
| `backend/contexts/patient/note_source.py` | 86 | 四个 NoteSource 实现 |
| `backend/contexts/patient/emotion.py` | 174 | 情绪状态机 |
| `backend/contexts/patient/guards.py` | 47 | 身份泄露检测 |

### 查体系统文件

| 文件 | 行数 | 功能 |
|------|------|------|
| `backend/contexts/training/router/physical_exam.py` | 232 | 查体路由 + emotion bridge |
| `backend/contexts/patient/exam.py` | 239 | 查体引擎（配置解析/值解析） |
| `backend/contexts/training/pipeline/middleware/side_effects.py` | 239 | 情绪后处理 + 主动状态 |
| `frontend/src/components/training/panels/physical-exam/ExamPanel.tsx` | 246 | 前端查体面板 |

### 提示词模板

| 文件 | 行数 | 用途 |
|------|------|------|
| `backend/prompts/patient_chat.py` | 36 | Character Card 系统提示词 |
| `backend/prompts/patient_dynamic.py` | 14 | 病情数据块 |
| `backend/prompts/scoring.py` | — | 评分双阶段模板 |
| `backend/prompts/qa.py` | — | 护理问答模板 |
| `backend/prompts/case_generation.py` | — | 病例生成模板 |

### 基础设施

| 文件 | 行数 | 功能 |
|------|------|------|
| `backend/infrastructure/prompt/manager.py` | 295 | 模板管理器（DB + 硬编码回退） |
| `backend/infrastructure/prompt/registry.py` | — | 模板变量注册 |
| `backend/infrastructure/llm/client.py` | 749 | LLM 客户端（call/stream） |
| `backend/infrastructure/llm/router.py` | — | API 密钥路由 + 熔断 |
| `backend/core/llm_profile.py` | — | LLM 参数配置 |

---

> 撰写日期：2026-06-29
> 涉及后端文件数：~25 个
> 核心修复文件数：5 个（note_source.py, prompt.py, physical_exam.py, builder.py, patient_chat.py）
