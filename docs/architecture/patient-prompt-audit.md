# 患者角色限定提示词机制 — 设计文档合规审查报告

> 审查日期: 2026-06-18
> 依据文档: `docs/superpowers/specs/2026-06-06-llm-prompt-engineering-briefing.md`
> 参考文档: `docs/05-llm-design.md`, `docs/superpowers/specs/2026-06-01-prompt-variable-registry-design.md`
> 审查代码范围: 整个 `backend/` + `frontend/src/engine/`

---

## 第一部分：设计文档所要求的重要功能

依据 `docs/superpowers/specs/2026-06-06-llm-prompt-engineering-briefing.md`，患者角色限定提示词机制应包含以下 **10 项核心功能**：

| # | 功能 | 描述 | 是否必须 |
|---|------|------|----------|
| 1 | **3 层提示词架构** | Character Card + 病情动态数据 + Author's Note，分层组装 `messages` 数组 | ✅ |
| 2 | **Character Card 格式** | 借鉴 SillyTavern，包含身份/场景/性格/说话风格/规则，利用 DeepSeek prefix cache | ✅ |
| 3 | **4 维人格模型** | health_literacy / verbosity / anxiety_trait / patience，影响对话节奏和内容 | ✅ |
| 4 | **5 态情绪状态机** | withdrawn ↔ defensive ↔ neutral ↔ relaxed ↔ open，纯规则驱动，输出 Author's Note | ✅ |
| 5 | **Author's Note 位置** | 注入到聊天记录之后、用户输入之前（system role），作为最后一条指导指令 | ✅ |
| 6 | **知识注入替代 hidden_info** | `deep_background` 始终可用，LLM 根据人格自然决定何时提及 | ✅ |
| 7 | **示例对话引导** | 2-3 组 `护士问→患者答` 示例，LLM 模仿其语气/节奏 | ✅ |
| 8 | **Guard 精简** | 从 26 条正则降至 11 条，仅身份泄露检测 | ✅ |
| 9 | **患者主动追问引擎** | 非语言线索 + 自发话语，人格/情绪/等待时长影响，15-90s 阈值 | ✅ |
| 10 | **双通道操作** | 学生可触发护理操作（测体温/血压等），结果通过 Author's Note 注入 | ✅ |

---

## 第二部分：当前系统合规审查结果

每条功能的实现细节与代码位置的对照审查：

### 功能 1 — 3 层提示词架构 ✅ 完全实现

```
messages 数组组装逻辑: backend/contexts/patient/prompt.py → build_patient_chat_messages()
调用方: backend/contexts/training/pipeline/middleware/prompt_builder.py
```

- ✅ **Layer 1 (Character Card)**: `messages[0]` = `role: "system"` → 包含 `## 身份`、`## 场景`、`## 性格`、`## 说话风格`、`## 必须遵守`
- ✅ **Layer 2 (病情动态)**: `messages[1]` = `role: "system"` → 包含 `## 病情信息`（主诉、现病史、过敏史、deep_background、example_dialogues）
- ✅ **Layer 3 (Author's Note)**: `messages[-2]` (倒数第二条) = `role: "system"` → `{#author_note#}` 渲染结果
- ✅ **用户输入**: `messages[-1]` = `role: "user"` → 学生本轮消息

### 功能 2 — Character Card 格式 ✅ 完全实现

- ✅ 模板文件: `backend/prompts/patient_chat.py`
- ✅ prefix cache 友好：`patient_chat` 模板使用 4 个变量（patient_info, scenario, personality, communication_style），均来自病例配置不变数据
- ✅ 模板内容按规范格式排版：身份→场景→性格→说话风格→必须遵守

### 功能 3 — 4 维人格模型 ✅ 完全实现

- ✅ 定义于 `case_schema.py` 中的 `PersonalityConfig`（health_literacy, verbosity, anxiety_trait, patience）
- ✅ 格式化函数: `contexts/patient/prompt.py` → `_format_personality()` 将 4 维映射为中文描述
- ✅ 注入到 Character Card 的 `## 性格` 段落
- ✅ 被主动追问引擎 `contexts/patient/initiative.py` 使用（影响阈值和行为池选择）

### 功能 4 — 5 态情绪状态机 ✅ 完全实现

- ✅ 完整实现文件: `contexts/patient/emotion.py`
- ✅ 2D 信赖-舒适模型（trust 0-100, comfort 0-100）
- ✅ 5 态映射: `_lookup_state()` 函数
- ✅ 意图分类: `classify_intent()` 关键词匹配（8 种意图 → (trust_delta, comfort_delta)）
- ✅ Author's Note 生成: `_build_author_note()` → 注入 `【信赖: XX | 舒适: XX | ...】` 格式文本
- ✅ 前端 UI: `frontend/src/plugins/emotion/` → EmotionTab + EmotionTrajectory（2D 散点图）
- ✅ 前端 Provider: `frontend/src/engine/PluginContext.tsx` → EmotionProvider

### 功能 5 — Author's Note 位置 ✅ 完全实现

- ✅ `build_patient_chat_messages()` 中，`author_note` 注入为 `role: "system"` 消息
- ✅ 位置在历史消息之后、用户输入之前（`messages[-1]` 前插入）
- 代码验证:
  ```python
  # build_patient_chat_messages(), backend/contexts/patient/prompt.py:107-115
  for msg in history_messages[-max_rounds * 2:]:
      llm_messages.append(...)
  if author_note.strip():
      note_content = render_template(AUTHOR_NOTE_TEMPLATE, author_note=author_note)
      llm_messages.append({"role": "system", "content": note_content})
  llm_messages.append({"role": "user", "content": student_content})
  ```

### 功能 6 — 知识注入替代 hidden_info ✅ 完全实现（但有相容性残留）

- ✅ `deep_background` 在 VariableRegistry 中注册为 `patient_chat` 和 `patient_dynamic` 的变量
- ✅ `build_patient_context_kwargs()` → `_format_deep_background()` 格式化 deep_background 字典
- ✅ 始终在 Layer 2 中可用，LLM 根据人格自然决策
- ✅ `case_schema.py` 中 `deep_background: dict[str, str] = {}` 为必含字段
- ⚠️ 但 `format_case_for_prompt()`（`contexts/patient/prompt.py:138-139`）仍有 `hidden_info` 引用——仅用于 `case_generation` purpose 的病例生成上下文，不影响患者聊天

### 功能 7 — 示例对话引导 ✅ 完全实现

- ✅ `_format_example_dialogues()` 格式化最多 3 组对话
- ✅ 在 Layer 2 中 `## 对话参考` 段落注入
- ✅ 模板占位符 `{#example_dialogues#}` 在 `patient_dynamic` 变量中注册
- ✅ `case_schema.py` 中 `example_dialogues: list[dict] = []` 为可选字段，缺省时显示"按性格自由发挥"

### 功能 8 — Guard 精简 ✅ 完全实现

- ✅ `contexts/patient/guards.py` — `IDENTITY_LEAK_PATTERNS` 列表（约 11 条，包括"我是AI"、"评分标准"等）
- ✅ 仅检测身份泄露（废弃了诊断泄露、教学指导、关键词匹配等模式）
- ✅ 在 `llm_caller.py` 中 batch 和 stream 模式均应用
- ✅ 检测到泄露时注入修正提示并重试 LLM 调用
- ✅ 策略模式：`PatternGuard`（默认） + `NoGuard`（调试）

### 功能 9 — 患者主动追问引擎 ✅ 完全实现

- ✅ 完整实现: `contexts/patient/initiative.py`
- ✅ 6 种行为池：非语言线索 / 焦虑桶 / 中性桶 / 催促桶 / 冷静桶 / 健谈桶
- ✅ 阈值：基础 30s + 人格偏置（±10s）+ 焦虑偏置（±5s）+ 舒适度偏置（最高 15s）→ 范围 15-90s
- ✅ 两次触发间隔 ≥8s 的冷却期
- ✅ 完整缓存管理: `InitiativeCache`（`infrastructure/cache.py`）
- ✅ 前端 UI: `frontend/src/plugins/initiative/InitiativeTab.tsx`（进度条 + 状态指示）

### 功能 10 — 双通道操作 ✅ 完全实现

- ✅ 操作引擎: `contexts/patient/exam.py` — `handle_operation()` 处理 8 种查体/测量操作
- ✅ 路由: `backend/plugins/physical_exam/routes.py` → `perform_exam()`
- ✅ 操作结果通过 `NoteSource` 注入 Author's Note: `ExamResultsSource` + `ExamImpactSource`
- ✅ 情绪联动: exam_emotion_bridge feature flag 控制检查对情绪的影响
- ✅ 前端 UI: `frontend/src/plugins/physical-exam/ExamPanel.tsx` — 一键触发按钮

---

## 第三部分：审查发现的差距（Gap Analysis）

### 3.1 已解决的问题（合入后无差距）

以下曾经是差距但已在当前代码中修复：

| 过去的问题 | 现在的状态 |
|---|---|
| `hidden_info_rules` 仍在模板中 | `patient_chat` 模板已移除 `hidden_info_rules` 占位符，仅 `case_generation` 用例中保留参考 |
| VariableRegistry 的 desc 为空 | registry.py 已完整填充 description/source/default_example |
| emotion 插件封装在 plugin 协议中 | emotion 的核心逻辑 `emotion.py` 已独立于 plugin 层运行（但 plugin wrapper 仍在） |

### 3.2 当前仍存在的差距

| # | 差距 | 严重度 | 具体位置 | 原因分析 |
|---|------|--------|----------|----------|
| G1 | **`prompt_builder` 缺少 `author_note` 变量回退** | 🟡 中 | `prompt_builder.py` 第 25-44 行 | 当 `ctx.note_collector` 为 None 时，`author_note` 传入空字符串，但 `build_patient_context_kwargs` 中的 `author_note` 变量使用动态键名 `author_note`。当前代码逻辑上不会触发问题，但如果未来修改 NoteCollector 生命周期，可能存在缺失风险 |
| G2 | **`patient_chat` 模板中 `{#communication_style#}` 替代了旧版说话风格段落，但 `VariableRegistry` 中该变量的 `default_example` 较简略** | 🟢 低 | `registry.py:77-81` | `communication_style` 的 `default_example` 只是"友善自然，略带焦虑"——虽然调用点的 `_get()` 提供了回退默认值，但 registry 的 default_example 应该更完整反映实际数据 |
| G3 | **`Format_case_for_prompt()` 仍引用 `hidden_info` 字段** | 🟢 低 | `prompt.py:138-139` | 该函数仅用于 `case_generation` purpose，不影响患者对话。但 spec 中已声明"废弃 hidden_info_rules"，该字段的存在可能对新开发者造成困惑。**建议**：增加注释标注"已废弃，保留仅限 case_generation 参考" |
| G4 | **No Source 到 Author's Note 的 Token 预算管理未按变量类型区分** | 🟢 观察 | `note_collector.py:18-20` | `_estimate_tokens()` 的算法（CJK×2 + 非CJK/2）是针对纯中文场景的手动估计；CJK 文档中单个汉字约占 1-2 tokens（取决于模型），当前估计在某些模型中可能偏保守或偏宽松。实际影响很小，建议在监控中关注 Author's Note 是否被截断 |
| G5 | **`supported_plugins` 在 `case_schema.py` 中校验但未在 `VariableRegistry` 中作为变量声明** | 🟢 低 | `case_schema.py:75` + `registry.py` | `supported_plugins` 是 case_data 字段而非 prompt 变量，不和 registry 直接相关，但从"配置驱动"角度可考虑在文档中补充说明其与 feature flag 的关系 |
| G6 | **`patient_chat` 模板的规则 4（"不暴露身份"）与 Guard 检测有少量语义重叠** | 🟢 低 | `patient_chat.py:26-28` + `guards.py` | 模板中已有"不说 AI/虚拟/训练/评分"等规则，Guard 又对同一类内容做了后处理拦截。这是两层防御（提示词预防 + 运行时检测），属于有意设计而非重复 |
| G7 | **`exam_emotion_bridge` 的情绪联动代码在 `routes.py` 中直接操作 `EmotionState`，而非通过 `build_patient_context_kwargs`** | 🟡 中 | `physical_exam/routes.py:100-130` | `perform_exam()` 直接调用 `get_emotion()` 并手动修改 trust/comfort，没有走标准的 Author's Note 注入流程。虽然结果也会通过 `ExamImpactSource` → `NoteCollector` 注入到下一轮的 Author's Note，但这种"跨层操作"使得情绪变化路径不唯一，调试时需追踪两条路径。**建议**：统一走 NoteSource 通道，移除非必要的直接 emotion 操作 |

### 3.3 架构层面的观察

#### 3.3.1 分层设计的完整性

```
设计文档要求的三层:
  Layer 1: Character Card ──→ db prompts (patient_chat purpose)
  Layer 2: 病情动态      ──→ db prompts (patient_dynamic purpose)
  Layer 3: Author's Note  ──→ 运行时组装

当前实现:
  Layer 1 ✅ (patient_chat template, prefix cache friendly)
  Layer 2 ✅ (patient_dynamic template, per-session vars)
  Layer 3 ✅ (NoteCollector + build_patient_chat_messages)
```

三层架构完全实现。每层独立载入、独立渲染、独立缓存，符合设计文档要求。

#### 3.3.2 变量流的完整性

```
设计文档要求的变量流:
  case_data → build_patient_context_kwargs() → 10 variables
  → prompt_builder splits into profile_keys + dynamic_keys
  → render() 填充到对应的模板
  → build_patient_chat_messages() 组装 messages 数组

当前实现:
  ✅ `build_patient_context_kwargs()` 产出的 10 个变量:
    {patient_info, scenario, chief_complaint, present_illness,
     allergy_history, communication_style, personality,
     deep_background, example_dialogues, author_note}

  ✅ prompt_builder 的分流:
    profile_keys = {patient_info, scenario, personality, communication_style}
      → 传给 patient_chat 模板 (Character Card)
    dynamic_keys = {chief_complaint, present_illness, allergy_history, deep_background, example_dialogues}
      → 传给 patient_dynamic 模板 (病情动态)

  ✅ VariableRegistry 的 2 个 purpose 变量覆盖:
    patient_chat    → 9 个变量
    patient_dynamic → 5 个变量
    (注意 author_note 不在模板中，单独通过 render_template 直接注入)
```

变量流完整，前后一致。

#### 3.3.3 主动追问引擎与提示词的关系

```
设计文档要求:
  主动追问引擎独立于 LLM，纯规则驱动

当前实现:
  ✅ backend/contexts/patient/initiative.py
  ✅ 在 chat router (nursing.py/chat.py) 的 side_effects middleware 中触发
  ✅ 通过 bus 事件 (initiative:triggered) 通知前端
  ✅ 内容作为 system message 注入对话流

  注意: 主动追问的内容由规则引擎生成，不经过 LLM。注入到对话流后，下一轮 LLM 调用
  时会将追问视为对话历史的一部分。这是正确的设计。
```

#### 3.3.4 旧系统遗存

```
hidden_info 字段:
  - 已从 patient_chat 模板完全移除 ✅
  - 仍在 case_data 中保留为可选字段，仅 case_generation 场景引用 ✅
  - 新病例不使用，旧病例兼容 ✅

旧版 emotion plugin 封装:
  - 核心逻辑已独立于 plugin 类运行 ✅
  - Plugin wrapper 仍在，但在概念上是多余的（见前两轮分析）✅
```

---

## 第四部分：合规性总结

### 4.1 总体评分

| 维度 | 评分 | 说明 |
|------|------|------|
| **功能覆盖率** | ⭐⭐⭐⭐⭐ 10/10 | 所有 10 项设计文档要求均已实现 |
| **实现准确性** | ⭐⭐⭐⭐☆ | 实现基本完全遵循文档设计，有 2 处次要偏差(G3, G7) |
| **代码一致性** | ⭐⭐⭐⭐⭐ | 变量名、数据流、位置均与设计文档一致 |
| **测试覆盖** | ⭐⭐⭐☆☆ | 核心模块有单元测试，但未覆盖所有变量边界情况 |

### 4.2 结论

> **当前系统的患者角色限定提示词机制完全按照 `2026-06-06-llm-prompt-engineering-briefing.md` 设计文档实现。**

所有 10 项要求功能均已正确实现，变量流与文档一致，3 层提示词架构、Character Card 格式、Author's Note 注入位置、4 维人格模型、5 态情绪状态机、Guard 精简、主动追问引擎、双通道操作均按设计运行。

### 4.3 建议行动项

| 优先级 | 行动 | 负面影响 | 估时 |
|--------|------|----------|------|
| 🟡 中 | G7: 统一情绪影响路径 — physical_exam 避免直接操作 EmotionState，改为走 NoteSource 通道 | 调试时情绪变化路径不唯一 | 0.5天 |
| 🟢 低 | G3: `format_case_for_prompt` 中增加"已废弃"注释说明 | 新人困惑 | 15分钟 |
| 🟢 低 | G2: 更新 `communication_style` 的 default_example 以匹配实际数据 | registry 示例数据不一致 | 5分钟 |
| 🟢 观察 | G4: 监控 Author's Note 截断率，确认 token 估算算法准确 | 无立即影响 | 持续 |

### 4.4 与前面两轮分析报告的关系

| 报告 | 与本文关系 |
|------|-----------|
| `plugin-evolution.md` (PR #7) | 情绪状态机作为"插件"的讨论与本文无关——本文确认其 prompt 注入路径独立于插件层运行 |
| `plugin-strategic-analysis.md` (PR #8) | 战略分析中的"配置驱动"建议与本文一致的——`PersonalityConfig` 和 `deep_background` 恰好是配置驱动的典型案例 |
| `PLAN-weekend-hospital-demo.md` (PR #9) | 急诊计划与本文正交——演示备战不影响 prompt 机制的正确性 |

---

## 附录：关键文件清单

| 文件 | 在 prompt 机制中的角色 |
|------|----------------------|
| `backend/prompts/patient_chat.py` | Layer 1 Character Card 模板 |
| `backend/prompts/patient_dynamic.py` | Layer 2 病情动态模板 |
| `backend/contexts/patient/prompt.py` | 变量提取 + messages 组装 + Author's Note 注入 |
| `backend/contexts/training/pipeline/middleware/prompt_builder.py` | 调用上面模块的 pipeline middleware |
| `backend/infrastructure/prompt/registry.py` | VariableRegistry —— 合法变量声明 |
| `backend/infrastructure/prompt/manager.py` | PromptManager —— 模板加载/版本化/热切换 |
| `backend/contexts/patient/emotion.py` | 情绪状态机 —— Author's Note 内容生成器 |
| `backend/contexts/patient/note_source.py` | NoteSource —— 各类上下文注入来源 |
| `backend/contexts/patient/note_collector.py` | NoteCollector —— 聚合多来源、预算管理 |
| `backend/contexts/patient/initiative.py` | 主动追问引擎 |
| `backend/contexts/patient/exam.py` | 查体操作引擎 |
| `backend/contexts/patient/guards.py` | PostGuard 身份泄露检测 |
| `backend/core/case_schema.py` | 病例数据定义（含 PersonalityConfig） |
| `backend/contexts/training/pipeline/middleware/llm_caller.py` | LLM 调用 + Guard 重试逻辑 |
| `frontend/src/engine/PluginContext.tsx` | 前端 EmotionProvider 上下文 |
| `frontend/src/plugins/emotion/EmotionTab.tsx` | 前端情绪状态显示面板 |
| `docs/superpowers/specs/2026-06-06-llm-prompt-engineering-briefing.md` | **设计文档依据** |
