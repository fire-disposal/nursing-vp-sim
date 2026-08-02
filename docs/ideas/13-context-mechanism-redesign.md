---
# 13 — 患者上下文机制重构（四域组装）

> 状态：已转正（实施中于 `refactor/context-mechanism` 分支，合并后移入正式编号文档）。
> 日期：2026-08-02。基于当前主干（`backend/modules/training/`）盘点。
> 范围：患者扮演管线的 LLM context 组装机制；不涉及评分/QA 管线的独立提示词。

---

## 一、现状问题（基于代码事实）

当前组装链路：`prompt_builder`（PROMPT 阶段）→ 渲染 system/dynamic 模板 → `build_patient_chat_messages`。

| # | 问题 | 代码证据 |
|---|------|----------|
| 1 | **四域混装**：静态（人设卡）、会话（病例）、每轮（情绪/场景/操作）、历史全部挤在两个 system 消息 + 一个散文注记里 | `chat_messages.py` 仅 4 种元素：`[system, system, history, user, system(note)]` |
| 2 | **会话消息不缓存**：`scene_state` 每轮插进 messages[1]（`prompt_builder._resolve_scene_text`），情绪/操作进 trailing author_note——messages[1] 随轮次变化，prefix cache 失效 | `prompt_builder.py:60-70` 渲染 dynamic 模板含 `{#scene_state#}` |
| 3 | **历史截断按轮次**：`history_messages[-max_rounds*2:]`，不看 token；长回答轮次会挤爆预算 | `chat_messages.py:37` |
| 4 | **每轮状态是散文 blob**：`NoteCollector` 把情绪行为策略 + 身份守卫 + 操作注记拼成 `【...】` 挂在 user 输入之后，来源不可区分 | `note_collector.py:_budget_join` |
| 5 | **示例对话是声明不是示范**：`example_dialogues` 渲染成「护士问：X / 你回答：Y」散文塞在病例块里，不是对话通道 | `prompt_context_builder.py:_format_example_dialogues` |
| 6 | **泄漏只守身份，不守病情**：`guards.py` 只查 AI 身份模式；`hidden_info`/`deep_background` 无出站检查，泄诊断只能靠模型自觉 | `guards.py` / `llm_caller.py` |

另有已归档分支（`archive/prompt-optimization-20260802`）验证过的方向：三区段 XML、token 预算截断、few-shot 消息对。本设计取其可转移部分（预算、few-shot），弃其已被 master 取代的部分（规则情绪、Exam LLM、Author's Note 删除——后者位置本身合理，问题在来源混装）。

## 二、目标

1. 消息布局 = 纯函数，四个生命周期域，每域一个明确消息（组）。
2. 静态前缀（人设卡 + 病例）跨轮逐字节不变 → prefix cache 命中。
3. 每轮状态只出现在一个 system 消息、一个位置。
4. 历史按 token 预算选择，带保护集（最近 N 轮保底）。
5. 示例对话作为 user/assistant 消息对（输出通道示范）。
6. 隐藏主题泄漏出站守卫（与既有身份守卫同模式）。

## 三、消息布局

```
messages[0]  system  人设卡     (STATIC)     身份/场景/性格/语气/规则   — 会话不变
messages[1]  system  病例       (SESSION)    主诉/病史/深背景          — 会话不变，逐字节稳定
messages[2]  system  示例标记   (EXAMPLES)   一行说明，非本次对话      — 会话不变
messages[3..] user/assistant   示例对 (≤3 对) 护士问/患者答            — 会话不变
messages[..]  user/assistant   真实历史                              — 预算选择
messages[-2] system  患者当前状态 (PER-TURN)  情绪策略/操作注记/场景状态 — 每轮变化
messages[-1] user    学生本轮输入
```

每轮状态放 user 输入之前：语义上是"患者此刻的事实 → 学生的话 → 患者的回应"，且与静态前缀隔离，状态变化不触碰缓存区。

## 四、组装不变量

1. `assemble_patient_messages(...)` 是纯函数：`(case, session_state, turn) → (messages, ledger)`。
2. 模板无逻辑：`render_template` 缺失变量即 RuntimeError（既有行为，保留）。
3. 任何输入有界：除 history 外全部静态；history 上界 = 预算 + 保护集。
4. 组装账本（ledger）随消息产出：各段 token 数、历史取舍计数 → 可观测。

## 五、历史预算算法

```
HISTORY_BUDGET_TOKENS = 2000   # 预算大方时几乎不截断
MIN_HISTORY_ROUNDS    = 4      # 保护集：最近 4 轮（8 条消息）无条件保留
```

1. 丢弃 system 消息，按轮成对。
2. 保护集 = 最后 `MIN_HISTORY_ROUNDS` 轮，必选。
3. 从保护集往前，按 token 预算（`infra.llm.token_counter.estimate_tokens`，官方 0.6/0.3 比例）从新到旧纳入。
4. 输出保持时间顺序；被裁轮次计入 ledger。

后续可扩展：带工具结果/评分事件的轮次标记 protected（当前 `Message` 无类型字段，依赖内容标记不可靠，留待 Message 加 `kind` 后补）。

## 六、每轮状态消息

`【患者当前状态】` system 消息，内容 = 三部分，均来自既有生产者：

- **情绪行为策略**：`emotion_analysis` 中间件产出 → `render_behavior_note`（既有 `EmotionNoteSource`）
- **操作注记**：`OperationNoteSource`（重复测量/不耐烦信号）
- **场景状态**：`SceneState` 序列化（从病例消息移出，成为每轮状态）

预算沿用 `MAX_AUTHOR_NOTE_TOKENS = 300` 的收集器机制；身份守卫注记（防复发）同在此消息。

## 七、示例段（few-shot）

- 从 `case_data.example_dialogues` 取前 ≤3 对，`user(护士问)/assistant(你回答)` 消息对。
- 前置一行 system 标记，防止模型把示例 user 轮误当学生输入。
- Token 计入组装账本；预算紧张时先裁示例（优先级最低）。

## 八、泄漏守卫

**语义依据**（`modules/cases/prompts.py` 字段说明）：
- `hidden_info`：学生问到了才可发现 → **不可硬拦**（会破坏教学场景），只做提示词侧约束。
- `deep_background`：患者不会主动透露 → **可拦**。其 dict 的**键**（如"吸烟史"、"职业"）是短、特异的理想守卫词。

**守卫规则**（出站，LLM 返回后、落库前）：
```
泄漏 = reply 含 deep_background 键 且 学生本轮输入不含该键（asked 豁免）
命中 → 追加修正 system 消息重试一次（与身份守卫同模式，次数上限 2）
```

## 九、落地切片

**本分支（refactor/context-mechanism）**：

- [x] `backend/modules/training/context/`：`assembler.py` / `budget.py` / `examples.py` / `patient_state.py` / `leak_guard.py`
- [x] `prompt_builder` 接入四域组装；`chat_messages.py` 删除
- [x] `patient.py` 模板移除 scene/示例变量；`prompt_context_builder` 精简
- [x] `llm_caller` 双路径（batch/stream）接入隐藏主题守卫
- [x] 单测：布局/预算/示例/守卫/账本

**后续（同分支或独立提交）**：

- [ ] `CaseContext` 规范化：扮演/查体/评分/QA 共享一个 typed case 上下文视图
- [ ] 快照测试（golden 组装文件）+ 行为评测套件
- [ ] `Message.kind` 标记工具/评分事件轮 → 保护集细化
- [ ] 反馈 Bot 评分分布 A/B（few-shot 效果验证）

## 十、明确不做

- 模板语言不加条件逻辑（DSL 不处理"怎么变"）。
- 不搞插件系统；不引入 DB 存储提示词（代码即版本）。
- 情绪/评分不走每轮 LLM 分析（既有规则/事件驱动已定，不回归）。
