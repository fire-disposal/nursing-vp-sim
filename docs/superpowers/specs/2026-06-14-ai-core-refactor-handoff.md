# AI Core Refactor — Handoff Document

> 输出日期: 2026-06-14 | 当前分支: master @ 8057b35
> 
> **注意：此重构不在此次插件系统重写的范围内。** 本文件用于移交到独立的"AI 核心机制重构"任务。

---

## 一、当前架构：三层提示词系统（AI酒馆风格）

### 1.1 三层模型

```
messages[0]  system: Character Card    ← prefix-cached by LLM API (static)
messages[1]  system: Patient Data      ← per-session (loaded once per training)
messages[2..]         Chat History     ← last 8 rounds
messages[-2] system: Author's Note     ← per-round (injected before user input)
messages[-1] user:   Student Input     ← current turn
```

这是从 SillyTavern/角色扮演前端借鉴的模式：
- **Layer 1 (Character Card)** = 角色人设，LLM API 可做 prefix cache
- **Layer 2 (World Info / Lorebook)** = 单次会话的上下文资料
- **Layer 3 (Author's Note)** = 每轮动态注入的额外指令

### 1.2 提示词模板系统

```
存储层:
  prompts/patient_chat.py       ← Character Card 模板（硬编码 Python 常量）
  prompts/patient_dynamic.py    ← 病情数据块模板
  prompts/case_generation.py    ← 病例生成模板
  prompts/scoring.py            ← 二阶段评分模板
  prompts/qa.py                 ← 护理问答模板
  DB: prompt_templates 表       ← 管理员可在运行时编辑覆盖

渲染引擎:
  infrastructure/prompt/manager.py
    - render_template(template, **kwargs)  → {#变量名#} 替换（非 Jinja2，自研轻量引擎）
    - PromptTemplateObj(render, render_pair) — 包装单/双提示词
    - PromptManager(load_from_db, reload, get) — 缓存 + 热加载

变量管理:
  infrastructure/prompt/registry.py → VariableRegistry，声明每个 purpose 的合法变量及默认值
```

**当前 6 个 prompt purpose：**
| Purpose | 用途 | 调用位置 |
|---------|------|----------|
| `patient_chat` | Character Card（身份/场景/性格/说话风格/规则） | prompt_builder middleware (每轮) |
| `patient_dynamic` | 病情数据块（主诉/现病史/过敏史/隐藏背景/对话参考） | prompt_builder middleware (每轮) |
| `case_generation` | 病例生成 JSON 模板 | routers/cases.py (病例创建时) |
| `scoring` | 第一轮评分（打分 + 证据） | score_engine.py |
| `scoring_feedback` | 第二轮评分（强项/弱项/遗漏/建议） | score_engine.py |
| `qa` | 护理问答导师 | contexts/qa/api.py |

---

## 二、消息组装管线（per-round flow）

### 2.1 prompt_builder 中间件的完整流程

```
prompt_builder(ctx, next_mw):
  │
  ├─ 1. _collect_author_note(ctx)
  │      ├─ ctx.state["emotion_note"]          ← 情绪插件 middle 注入
  │      ├─ Identity leak guard 检查             ← has_identity_leak(上次患者回复)
  │      ├─ practice_snapshot._exam_results     ← 查体结果（最近 5 条）
  │      └─ practice_snapshot._exam_impact_note ← 查体情绪影响说明
  │      └─ return 【... | ... | ...】
  │
  ├─ 2. build_patient_context_kwargs(case_data, author_note)
  │      提取 10 个变量：
  │        patient_info, scenario, chief_complaint, present_illness,
  │        allergy_history, communication_style, personality (4维格式化),
  │        deep_background (bullet list), example_dialogues (最多3组), author_note
  │
  ├─ 3. 渲染 Character Card
  │      pm.get("patient_chat").render(patient_info, scenario, personality, communication_style)
  │
  ├─ 4. 渲染 Patient Data
  │      pm.get("patient_dynamic").render(chief_complaint, present_illness, allergy_history,
  │                                        deep_background, example_dialogues)
  │
  └─ 5. build_patient_chat_messages(system, dynamic, history, student_text, author_note)
         → 组装成 5 段 messages 数组
```

### 2.2 身份泄漏守卫

```
contexts/patient/guard.py:
  IDENTITY_LEAK_PATTERNS = ["我是AI", "我是虚拟患者", "评分标准", "你应该继续问", ...] (共 11 个模式)
  
  has_identity_leak(reply: str) → bool     # 子串匹配（大小写不敏感）
  get_identity_correction_note() → str     # 返回更正提示
  
  触发后：更正提示注入到 author_note 中，以系统消息形式插入 LLM 对话
```

守卫是简单的模式匹配，没有语义理解。被触发后只记录 warning 日志，计分系统不知道。

### 2.3 评分提示词管线（独立于聊天管线）

```
score_engine.py:
  Stage 1 (并行): pm.get("scoring").render_pair(scoring_criteria, required_inquiries, 
                                                  scoring_json_schema, conversation_text)
                  → LLM → total_score + detail_scores (per-item evidence/reason/score 1-3)
  
  Stage 2 (并行): pm.get("scoring_feedback").render_pair(scoring_criteria, required_inquiries,
                                                          conversation_text)
                  → LLM → strengths, weaknesses, missed_content, suggestions
  
  评分标准 source: data/rubrics/nursing_history_v1.json → build_scoring_criteria() 动态构建
  JSON schema: build_scoring_json_schema() 动态构建
```

---

## 三、可抽离/可插拔的点

### 3.1 Author's Note 收集策略

当前是硬编码在 `_collect_author_note()` 中的 4 个来源拼接。可抽离为：

```python
class AuthorNoteContributor:
    """每个 contributor 返回一行或多行 author note 文本（或 None 表示无贡献）"""
    def contribute(self, ctx: PipelineContext) -> str | None: ...

# 内置 contributors:
#   EmotionNoteContributor    ← ctx.state["emotion_note"]
#   IdentityGuardContributor   ← has_identity_leak() → 更正提示
#   ExamResultsContributor     ← practice_snapshot._exam_results
#   ExamImpactContributor      ← practice_snapshot._exam_impact_note
```

**A/B 测试价值**：开/关 IdentityGuardContributor，对比身份脱角色率。

### 3.2 消息数组组装策略

当前 `build_patient_chat_messages()` 固定 5 段结构。可抽离为：

```python
class MessageAssembler:
    def assemble(self, system_prompt, dynamic_prompt, history, student_text, author_note) -> list[dict]: ...

# 内置 assemblers:
#   SillyTavernAssembler    ← 当前实现（author_note 作为 system message 在 user 之前）
#   InlineAssembler         ← author_note 注入到 user message 前缀 "[Author's note: ...] \n 学生: ..."
#   NoAuthorNoteAssembler   ← 无 author note（用于对照组）
```

**A/B 测试价值**：比较 Author's Note 作为独立 system message vs 内联到 user message 的效果。

### 3.3 角色守卫策略

当前是简单模式匹配。可抽离为：

```python
class IdentityGuard:
    def check(self, reply: str) -> str | None:  # 返回修正提示或 None
    def get_patterns(self) -> list[str]:         # 用于调试/日志

# 实现：
#   PatternGuard     ← 当前（硬编码 11 个模式）
#   LLMGuard         ← 用第二个小模型判断（更精准但增加延迟+成本）
#   NoGuard          ← 不检查（对照组）
```

**A/B 测试价值**：模式匹配 vs LLM 判断 vs 无守卫，对比角色崩溃率、脱靶率、token 开销。

### 3.4 个性格式化

当前 `_format_personality()` 硬编码 4 维到中文的映射。可抽离为：

```python
class PersonalityFormatter:
    def format(self, personality: dict) -> str: ...

# 实现：
#   ProseFormatter     ← 当前（自然语言段落）
#   TraitListFormatter ← 属性列表形式
#   NarrativeFormatter  ← 叙事化（"陈阿姨是个..." 故事开头）
```

### 3.5 隐藏信息注入方式

当前 `deep_background` 以 bullet list (`- value`) 注入。可选：
- 融入对话示例（作为 example_dialogues 的一部分）
- 融入性格描述中
- 作为独立的"你应该知道但不要主动说出" 块

### 3.6 Prompt 模板选择

当前 `patient_chat` 和 `patient_dynamic` 是两个固定模板。如果不同疾病或不同训练目标需要不同 Character Card，可以是 `pm.get(phase.prompt_profile)` 的扩展。

---

## 四、硬编码的注入点汇总

以下都是当前硬编码、未来可能需要变成可配置/可插拔的位置：

| 位置 | 文件 | 行号 | 描述 |
|------|------|------|------|
| author_note 收集 | `pipeline/middleware/prompt_builder.py` | 18-47 | 4 个来源固定拼接 |
| 身份泄露模式 | `patient/guard.py` | 7-19 | 11 个硬编码子串 |
| 个性 4 维映射 | `patient/prompt.py` | 26-41 | health_literacy/verbosity/anxiety_trait/patience → 中文描述 |
| 对话示例格式化 | `patient/prompt.py` | 51-61 | Q&A 格式，最多 3 组 |
| 消息数组结构 | `patient/prompt.py` | 88-119 | 5 段固定顺序，max_rounds=8 |
| 评分标准构建 | `score_engine.py` | 动态 | 从 rubrics JSON 构建 JSON Schema |
| prompt 模板路径 | `prompt_builder.py` | 59 | phase.prompt_profile 或 fallback "patient_chat" |
| conversation_text 格式 | `score_engine.py` | — | 评分时将所有消息拼接为对话文本 |

---

## 五、潜在 A/B 测试问题方向

这些问题可以直接转化为可插拔组件的对照实验：

### 实验 1：有无身份守卫
```
实验组: IdentityGuard 开启（PatternGuard 或 LLMGuard）
对照组: NoGuard（无任何身份矫正）
指标: AI 回复中出现 "AI" / "虚拟" / "训练" / "你问得很好" 等词的频率
数据来源: LLM call log（已有基础设施）
```

### 实验 2：Author's Note 位置
```
实验组: 作为独立 system message 插入（当前方式）
对照组: 内联到 user message 前缀
指标: 患者回复的"角色一致性"（需定义评判方式），token 消耗差异
```

### 实验 3：个性格式化风格
```
实验组: 自然段落描述（当前）
对照组: 结构化 trait list
指标: 患者回复中个性一致性的体现（由 LLM-as-judge 评判）
```

### 实验 4：隐藏信息注入深度
```
实验组: 藏在对话示例中（更隐蔽）
对照组: bullet list（当前，更显式）
指标: 学生问出"隐藏信息"相关问题的平均轮次
```

### 实验 5：Character Card 粒度
```
实验组: 完整 Character Card（当前 5 节）
对照组: 精简 Card（只保留身份+场景+规则，去掉性格和说话风格独立描述）
指标: LLM token 消耗、角色一致性、学生满意度
```

---

## 六、重构目标建议

### Short-term（可独立完成）
- 将 `_collect_author_note()` 改为 contributor 列表模式
- 将 `IDENTITY_LEAK_PATTERNS` 移入 DB 可编辑（已有 PromptManager 支持）
- 添加 `llm_call_log` 中的身份脱靶标记字段（方便 A/B 统计）

### Medium-term（需和插件系统配合）
- AuthorNoteContributor / MessageAssembler / IdentityGuard 作为可注册组件
- 按 feature flag 切换策略
- 收集 A/B 指标（身份脱靶率、token 用量、学生满意度评分）

### Long-term（需整体架构支持）
- Prompt 策略版本管理（每个训练记录记录用了哪个配置版本）
- 评分维度增加"角色一致性"评分
- 多策略并行运行（shadow mode：主策略生成回复，对照组只做指标对比不展示）

---

## 七、关键文件速查

| 文件 | 内容 |
|------|------|
| `backend/prompts/patient_chat.py` | Character Card 模板 + Author Note 模板 |
| `backend/prompts/patient_dynamic.py` | 病情数据块模板 |
| `backend/infrastructure/prompt/manager.py` | PromptManager + render_template 引擎 |
| `backend/infrastructure/prompt/registry.py` | 变量注册表 |
| `backend/contexts/patient/prompt.py` | build_patient_context_kwargs + build_patient_chat_messages |
| `backend/contexts/patient/guard.py` | 身份泄漏守卫 |
| `backend/contexts/training/pipeline/middleware/prompt_builder.py` | 每轮组装的总入口 |
| `backend/contexts/training/score_engine.py` | 二阶段评分管线 |
| `backend/prompts/scoring.py` | 评分提示词模板 |
| `backend/data/rubrics/nursing_history_v1.json` | 评分标准数据 |
| `backend/routers/admin_prompts.py` | 管理员 CRUD 提示词模板 |
| `backend/models.py:490` | PromptTemplate SQLAlchemy 模型 |
