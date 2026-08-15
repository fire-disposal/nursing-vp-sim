# 训练管道与生理引擎重构指南（Phase 2 + Phase 4）

> 基线：9410d921（`modules/training/pipeline|patient_ai|context|session`、`modules/simulations` 零改动，行号有效）
> 缺陷映射：defect-list.md T1-T10（Phase 2）、P1-P6（Phase 4）。已定决策：D5 硬截止（附录 A）、D6 simulation 实验位（附录 B）。

---

## Phase 2 训练管道

### 1. 问题映射（T1-T10 → 目标行为）

| # | 缺陷 | 目标行为 |
|---|------|------|
| T1 | 流式泄漏修正不送达客户端（`llm_caller.py:174-190` + 死代码 `_emit_chunks`） | 前端显示 == DB 落库（同一文本） |
| T2 | SSE 重试从头重放（`client.py:353-370`） | 重试不产生重复内容 |
| T3 | 情绪引擎 60 轮冻结（`chat.py:58-65` + `emotion_analysis.py:83-99`） | 任意轮数情绪持续更新 |
| T4 | 结算忽略 paused_seconds（`settlement.py:66-73`） | 与 D5 附录 A 一并解决（execution=墙钟） |
| T5 | runtime_state JSONB 无锁覆盖（`physical_exam.py:67-87`、`persister.py:97-99`） | 原子合并，无双写丢失 |
| T6 | 查体读数注入"患者自知" + 无配合门控（`note_source.py:79-96`） | 读数"待告知"；拒绝/抵触有工具层表现 |
| T7 | leak_guard 子串双向失效（`leak_guard.py:24-47`） | 语义判定；披露门控前移 |
| T8 | 情绪 v2/v3 双存储 + 清理不一致 | 单一存储 + 统一清理 |
| T9 | FATIGUE 假文档 + 跨轮失误不可检测 | 实现注入或删除文档；分析器见上下文 |
| T10 | 身份守卫误伤自然语（`guards.py:33-35`） | 黑名单只含 AI/系统术语 |

### 2. 文件级步骤

#### 2.1 流式双通道重构（T1/T2，P0）
1. **决策：泄漏纠正改"先全量生成→守卫→再推送"**（放弃首轮实时推送）。理由：实时推送+事后纠正的双通道在架构上必然产生"学生看到 A、DB 存 B"的两套事实；全量生成仅增加首字延迟（患者回复 1-3 句，可接受），换来决定性一致。
   - `llm_caller.py`：`_call_stream` 改为全量收集 `full_reply` → `_collect_leak_corrections` → 通过后才 `stream_queue.put(full_reply)`（整体入队）+ `STATE_STREAM_CHUNKS=[full_reply]`；
   - `runner.py`：删除 `_emit_chunks`（死代码）；`stream_pipeline` 消费顺序改为"等 task 完成 → 读最终文本 → 推送"；同时**删除泄漏重试路径的 `stream_queue` 双推**。
2. **重试不重放（T2）**：`client.py:353-370` 流式重试改为——失败后**不重新 yield**，而是给调用方抛"需重试"信号或静默降级为 `call()`（一次性完整响应）替换已发部分；`llm_caller` 侧相应处理（前端已显示的部分由最终文本覆盖，见 2.1 决策）。
3. **前端**：`trainingStore.ts:304-313` `finalizeMessage` 改为**用服务端返回的最终文本覆盖 placeholder 内容**（`done` 事件带 `content` 字段——后端 `STATE_DONE_PAYLOAD` 需补充最终文本）。
4. **测试**：`test_stream_leak_correction_reaches_client`（mock LLM 首轮泄漏+重试干净，断言 SSE 只推最终文本）；`test_stream_retry_no_duplicate`（断言重试后无重复前缀）。

#### 2.2 泄漏判定语义化（T7）
1. `leak_guard.py`：子串匹配 → **语义判定**（复用 `patient_ai` 的 LLM 分析器或 `repeated_question` 的相似度路径），输入 = 整段最近历史（≥5 轮）+ 本轮；键匹配降级为"疑似线索"而非判定依据。
2. 披露门控前移：`prompts/patient.py:49` 的"除非学生已经推断出来"改为结构化指令——`deep_background` 每条附"触发主题词"，仅当学生本轮或历史明确问及该主题才可答（仍由 LLM 执行，但 prompt 给出明确条件 + 示例）。
3. `llm_caller.py`：重试上限 2 次后仍泄漏 → 不再静默入库：标记 `ctx.record.runtime_state.leak_occurred=true` + 响应带 `leak: true` 事件给前端（UI 显示"该回复由系统修正"）；评分输入对 leak_occurred 记录显式标注（防"错误被证据化"）。

#### 2.3 情绪 turn_id 与时钟（T3）
1. `emotion_analysis.py:83-85`：`turn_id` 从 `message_count+1` 改为 `max(m.id for m in messages)`（单调、与截断无关）；DB 兜底用 `record` 侧自增计数器。
2. `chat.py:58-65`：120 条截断保留（上下文预算），但情绪/initiative 判定所需的历史独立于 LLM 上下文获取（情绪用最近 20 条即可，与截断解耦）。
3. **测试**：`test_emotion_updates_beyond_120_messages`（构造 130 条消息，断言第 61+ 轮仍产生 emotion 事件）。

#### 2.4 结算口径（T4）→ 由 D5 附录 A 统一执行（execution_deadline=墙钟），此处不再单列。

#### 2.5 JSONB 原子化（T5）
1. `physical_exam.py:67-87`、`persister.py:97-99`：`record.runtime_state` 读改写 → `UPDATE training_records SET runtime_state = runtime_state || :patch WHERE id=:id`（JSONB `||` 合并，`patch` 为单层键）；写冲突由行锁+版本号兜底。
2. `chat.py:196-199` 批式消息：加 `with_for_update` 行锁包住"读历史→持久化"（或接受双消息交错的风险并文档化——不建议）。
3. **测试**：并发 2 个查体 + 1 个修正请求，断言 exam_results 与 message_correction 并存。

#### 2.6 查体门控与读数注入（T6）
1. `physical_exam.py`：`handle_operation` 前置配合度检查（读 `EmotionRepository` 的 cooperation 轴）：cooperation < 阈值（建议 0.35）→ 返回"患者犹豫/拒绝"结果 + 触发 `RESPECTS_REFUSAL` 情绪事件（不硬失败，给学生"尊重拒绝"的练习机会）。
2. `note_source.py:79-96`：读数从"护士对你进行了以下操作…测得 37.5°C"改为"护士为你测量了体温（尚未告知结果）"；数值只在学生主动"告知结果"动作后进入患者认知（新增告知动作或并入对话语义）。
3. `session/state.py:68-82`：`format_scene_for_prompt` 的"生命体征: T 37.5"从患者 prompt 移除，改放护士侧信息。
4. **测试**：`test_patient_refuses_exam_when_uncooperative`、`test_patient_does_not_know_measurement_until_told`。

#### 2.7 情绪 v2/v3 清理（T8）
1. 删除：`patient_ai/emotion/_legacy.py`、`emotion_profile.py`、`session/cache.py` 的 `EmotionCache`（`bootstrap.py:103`）、`side_effects.py:18-34` 死读取、`prompts/emotion.py`（若仅 `template_variables.py:131` 引用则一并清理）。
2. `emotion/__init__.py:19-33`：裸名 `EmotionState` 指向 v3（删除 v2 import），`EmoState` 别名删除或翻转。
3. 统一清理：`settlement.py:146-148`、`finalize.py:59`、`mark_discarded` 全部调用 `EmotionRepository().cleanup(record_id)`。
4. **测试**：`test_no_v2_tables_written`、`test_abandoned_record_cleans_emotion_rows`。

#### 2.8 FATIGUE 与分析器上下文（T9）
1. 实现或删除：若保留"对话疲劳"教学点 → `pipeline` 加"轮数 > 8 自动注入 FATIGUE 事件"（真实系统注入，兑现 `analyzer.py:100` 的承诺）；否则删除 `analyzer.py:100` 声明 + `rules.py:93-96` + `events.py:63`。
2. `analyzer.py:105-111`：输入从"两段文本"扩为最近 N 轮（≤10 轮）结构化消息列表（role/content 序列），使 repeated_question/interruption 可判定；对 repeated_question 加确定性复核（与历史消息文本相似度 > 阈值才算）。
3. `emotion_analysis.py:125-126`：LLM 分析失败时**不再静默**——降级为上次状态 + `runtime_state.emotion_degraded=true` + 前端显示"情绪分析暂不可用"（P4 失败可见）。

#### 2.9 身份守卫收敛（T10）
1. `guards.py:33-35`：黑名单只保留 AI/系统术语（"我是AI""语言模型""训练模式""角色扮演"），删除自然口语（"继续问""你还想知道""你做得很好""非常好的问题"）；判定改为"命中 ≥2 个特征词才判泄漏"。
2. **测试**：`test_natural_patient_phrases_not_leak`（"你继续问吧，我都告诉你""你还想知道什么"不触发）。

#### 2.10 历史预算摘要（T10 相关，P2）
1. `budget.py:42-51` 首超即断 → 保留被裁轮次的"问题清单"（每轮 student 消息 15 字摘要），注入 SESSION 静态域（`prompt_context_builder.py`），让患者保有"学生问过什么"的记忆。
2. `assembler.py:71-81`：总 token 护栏（static+examples+history+state ≤ 窗口 - 输出余量）；超限按优先级降级（先裁 examples → 再裁 history → 最后压缩 SESSION）。
3. **测试**：`test_history_summary_injected_when_budget_cut`。

#### 2.11 主动追问惩罚与快照（P2）
1. `initiative.py:294`：30s 静默惩罚（trust-0.08）→ 改为"连续 2 次触发仍无回应"才惩罚，且惩罚减半；前端加"正在输入"心跳（typing indicator）暂停计时（D5 附录 A 的展示口径配合）。
2. `progress.py:63` 活病例 → `record.case_snapshot`（与 `chat.py:54` 一致），消除分叉。

#### 2.12 拒绝硬门控（P3，教学价值核心）
1. `behavior.py:130-147` 拒绝风格从"文字建议"升级为**结构化策略**：`PatientBehaviorPolicy` 输出 `{refusal: {scope: 'exam'|'topic'|'all', probability, reply_template}}`；工具层（查体/护理记录）与患者回复生成层共同消费。
2. 部分病例启用"可拒绝模式"：`case_data.personality` 增加 `cooperation_profile`（如"敏感话题列表"），评分 rubric 增加"应对拒绝/敏感话题"维度（与 refactor-scoring.md D3 条目裁剪联动——删不可观察项，补可观察项）。

## Phase 4 生理引擎校准（simulations）

### 3. 校准清单（P1/P2 实测缺陷）

| # | 缺陷（实测） | 目标 |
|---|------|------|
| P1 | CHF 容量钳死：`case.py:544` vol≤1.05；`vol_axis_rate=-0.30` 负耦合；crackles 开局即异常；恶化叙事"低氧血症"但 SpO2=98；空手 4 分钟满分通关 | 容量超载 → SpO2↓/RR↑/BP↑ 可观测耦合；crackles 按严重度梯度；结局判定绑定可观测证据（异常体征+趋势） |
| P2 | 乳酸积分器：`case.py:432` lac_clear=0.03 放大 33 倍；DKA sev0.79 → pH 6.68；pH 无下限线性外推（`case.py:362`）；DKA 无酮体/AG | 生产项设上限；pH 生理下限映射；DKA 加酮体/AG；新病例过临床数值区间测试 |
| P3 | 训练模块查体 = 静态中点（`physical_exam_rules.py:406-423`），`_compute_link_offsets` 零生效 | 命名降级（"病例体征配置"）或会话级演化（Phase 5 之后，非本轮） |
| P4 | 查体三副本 + 评分数据源静默切换 + 护理诊断/quiz 评分零消费 | 单一事实源 TrainingAction；fallback 显式告警（详见 refactor-scoring.md §3.9 契约） |
| P5 | simulations 无评分闭环；`/simulation` 免登录 | 按 D6 附录 B 收编实验位 |
| P6 | `asyncio.run` 跨事件循环复用主循环 httpx/Semaphore（`simulations/router.py:44-112`） | sync 端点改 async（FastAPI 原生支持）或 `run_coroutine_threadsafe`；补集成测试（当前全部 mock LLM） |

### 4. 校准步骤

1. **CHF**（`case.py:816-996` CHF 段 + `case.py:538-544` vol 方程）：移除 vol 上限钳制对 CHF 的适用（或按病例放开至 1.2）；新增 congestion 轴表现：`spo2 = f(vol, 给氧)`、`rr = g(vol)`、`bp = h(vol)`；`breath_crackle_vol` 改梯度（0.95/1.05/1.15 三档啰音程度）；结局判定 `_has_abnormal_evidence` 之外增加"恶化趋势"证据（连续两次读数恶化）。
2. **乳酸/pH**（`case.py:555-557,362`）：`lac_prod` 设上限（如 2.0 mmol/L/min 峰值）；pH 用 `7.42 - 0.08*min(lactate-lac_base, 3.0)`（线性段 + 下限钳制在 7.0 附近）或 sigmoid；DKA 病例 ABG 增加 `ketones`/`anion_gap` 字段（`mat_abg` 或新 materializer）。
3. **临床数值区间 CI**：`tests/simulations/test_clinical_guidelines.py` 扩展——全病例、全严重度采样（sev ∈ {0.3,0.5,0.75,0.95}）：`ph ∈ [7.0,7.5]`、`lactate ≤ 12`、SpO2/RR/BP 与严重度单调（方向由耦合表声明）；新增"空手通关"回归测试（CHF 不 assess/report 不得 SUCCESS）。
4. **P6 异步修复**：`simulations/router.py` 三端点改 `async def`，直接 `await llm_client.call(...)`（去掉 `asyncio.run`）；`state_from_dict`/DB 操作保持同步（`run_in_threadpool` 或保持小事务）；新增 `tests/simulations/test_llm_integration.py`（真 client + 真 provider 占位，至少覆盖 consult/talk 路径不跨循环）。
5. **P3 命名诚实**：`physical_exam_rules.py` docstring 与 README 表述改为"病例体征配置（静态基线）+ 解读"，训练模块体征演化列为 Phase 5.5 候选（与 D6 实验轨同评审）。

### 5. 回归测试（克制：只保 3 个结构性不变量）

- `test_chf_requires_evidence_for_success`（P1：空手通关回归——引擎校准后此测试必须绿）
- `test_abg_clinical_bounds_all_cases`（P2：全病例 sev<失败阈值时 pH∈[7.0,7.5]）
- `test_stream_leak_correction_reaches_client`（T1：SSE 只推最终文本，前端显示 == DB）

其余（情绪冻结、结算口径、JSONB 并发、查体门控、v2/v3 清理、FATIGUE、守卫误伤、拒绝门控）通过**代码结构重设计本身** + staging 冒烟验证（长会话情绪曲线、暂停训练不被提前结算、拒绝型患者查体被拒），不逐项建测试。

### 6. 验收（摘自主指南 §6 Phase 2/4）

- 泄漏重试后前端显示 == DB 落库（抽检 20 次）；会话 >120 条情绪仍更新；CHF 病程 SpO2/RR 随严重度变化且与叙事一致；全病例 pH ∈ [7.0,7.5]；空手通关测试存在且必须红→绿。
