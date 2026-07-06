# 训练核心大规模收束/归一化重构（扶正系统）设计文档

> 状态：设计已批准，待转 writing-plans
> 日期：2026-07-07
> 目标分支：`refactor/prompt-engineering-clarity`（领先 master 192 提交，承载全部场景系统）
> 审查基线 worktree：`/tmp/opencode/vp-review`（只读）
> 决策授权：作者授予 AI 完全决断权，以系统健康为最高目标，可删除不良设计。

---

## 1. 背景与问题

系统处于**快速原型 + 无专职测试**阶段的技术债集中爆发点。根因不是"功能没做"，而是**多次半途迁移各自留下新旧两条路径且旧路径未删**，叠加**同一职责在前后端各写一遍导致漂移**。五路系统审查（传输 / 场景 / 死代码 / LLM 核心 / 能力开关+时间）交叉验证一致，结论如下。

三次未完成迁移：

| 半途迁移 | 新路径（活） | 旧路径（死但仍挂载） |
|---------|------------|-------------------|
| 实时通道 | WS `/api/training/ws` | REST 查体 `physical_exam.py` + SSE `/notifications/stream` |
| 训练入口 | `TrainingEntry`→场景注册表 | `ChatTraining.tsx`（零引用） |
| 护理文书 | `routers/notes.py`（自由速记） | `contexts/.../nursing.py` + `NursingRecord`（结构化） |
| 后端组织 | `contexts/`（DDD） | `routers/`（扁平）——两套并存 |

三套并行的"能力真相来源"互相打架（详见 §5.B）。

---

## 2. 目标 / 非目标

### 目标
1. **单一真相**：每个横切概念（实时通道、能力开关、时间、场景状态）只有一个权威来源。
2. **结构性防漂移**：前端能力表/类型从后端**自动生成**（比照 `api-types.gen.ts`），使前后端不一致在结构上不可能。
3. **闭合场景运行时回路**：让"空壳"的场景状态（生命体征/环境）真正端到端联动。
4. **扶正能力系统**：分层（builtin/toggleable）、后端真正门控、联动前端 UI + 教师布置作业。
5. **清除全部死代码/死残余**，删除小程序。
6. **加固 LLM 核心**：修复高危 bug（circuit breaker 双报、triage UnboundLocalError 等），收敛重复的重试/流式/进度逻辑。
7. **为关键路径补 characterization 测试**（当前实时/评分/场景/能力链路零覆盖）。

### 非目标（本轮不做，明确推迟）
- `routers/`↔`contexts/` 的完整 DDD 迁移（churn 高、收益低）——仅写边界文档。
- 把 3D 从 sandbox 移植进 production（依赖与功能保留，独立立项）。
- LLM 多 provider 真正启用（抽象保留，不启用）。
- 中途改开关能力（决策删除，见 §4）。

---

## 3. 术语
- **能力 / Capability**：一个训练期功能开关（如 `physical_exam`）。
- **builtin**：内置、恒开、UI 不显示开关、教师不可关。
- **toggleable**：可开关，有默认值，教师/配置可设。
- **冻结**：训练记录创建时把解析后的 features/time 写入 `practice_snapshot`，此后不可变。
- **两车道实时**：SSE=请求作用域的流式响应；WS=会话作用域的服务端推送+客户端命令。

---

## 4. 已锁定决策

| # | 决策 | 理由 |
|---|------|------|
| D1 | **不全归 WS**，采用三层：HTTP（请求/响应）、SSE（请求流：LLM 聊天/QA）、WS（会话推送：查体/评分/scene:state/未来计时） | SSE 是"一次请求流式响应"的最优解；WS 是服务端主动推送的最优解；混用是错配 |
| D2 | **执行顺序** Phase 0 清障 → 1 传输归一 → 2 场景闭环(带测试) → 3 能力系统+时间 → 4 LLM 核心加固 | 先清误判源，让后续在干净地基上进行 |
| D3 | **删除小程序** `miniprogram/`，并从 `api:update:all` 摘除 miniapp 类型生成 | 完全跟不上时代 |
| D4 | **保留 3D 依赖与相关功能**（`three`/`@react-three/*`），不删 | 后续独立立项移植 |
| D5 | **护理记录保留为可评分场景**（不并入 notes） | `NursingRecord.sheet_data` 结构化文书是评分地基；notes 是自由速记，二者不同功能 |
| D6 | **能力系统单一真相** = 后端 `resolve_features()`；删除 `has_emotion`/`has_initiative`/`profile.capabilities`/`supported_plugins` 作为门控输入 | 消灭三套打架的真相来源 |
| D7 | **前端能力表 + 每类型适用能力从后端自动生成** | 结构性防漂移 |
| D8 | **能力分层** builtin/toggleable，加 `requires` 声明式耦合 | `emotion`=builtin；`patient_initiative requires emotion` |
| D9 | **emotion 为通用内置**：全部训练类型（含 triage）恒开，无开关 | 情绪是虚拟病人的第一性质；triage 带情绪是合理需求（有意行为变更） |
| D10 | **开关训练开始即冻结、中途不可变**，删除中途切换管道 | 避免评分歧义与状态机复杂度；该管道现已 100% 死 |
| D11 | **时间优先级**：显式（free-config `req` / 教师 practice）> case 默认 > 全局 20；服务端结算用解析值 | 谁配置这局谁说了算，case 值仅为种子 |
| D12 | **关键路径补测试**为硬性要求，不接受省略 | 实时/评分/场景/能力链路当前零覆盖，是最大隐藏风险 |

---

## 5. 各领域设计

### A. 传输层归一（两车道）

**目标形态：**
```
HTTP ── 请求/响应：CRUD、登录、拉数据、导出              （不动）
SSE ─── 请求作用域流式响应：LLM 聊天、QA/RAG            （保留，最优解）
WS ──── 会话作用域：查体、评分、scene:state、未来计时      （归一目标）
        ↑ SSEManager 已是通道无关扇出中枢，重命名为 RealtimeHub
```

**动作：**
- A1. 删除死的 REST 查体端点 `contexts/training/router/physical_exam.py` + 其挂载 `router/__init__.py:6,18` + 孤儿 producer `physical_exam.py:33`（`exam:done` publish，从不触发）。**保留** `services/physical_exam.py`（WS 共用）。
- A2. 删除死的 SSE `/notifications/stream`（`scoring.py:477-498`）+ 其 subscriber S2（`scoring.py:483`）。删除后 WS 成为 hub 唯一消费者。
- A3. 重命名消除误导：`SSEManager`→`RealtimeHub`；`notifySSEProgress`/`onSSEProgress`→`notifyProgress`/`onProgress`（实为 WS，非 SSE）；前端 `api/client.ts`（axios 实例）与 `api/api-client.ts`（barrel）消歧命名。
- A4. 文档化两车道模型 + `ws.py:13` 中 `exam:done` 经 hub 的 vestigial 说明（实际走直接回复 `ws.py:104-109`）。
- A5. 评分进度 **WS 推送 + HTTP 轮询** 双活（`useScoringNotifications` vs `ScoreManager.startPolling`）：确立"WS=快路径，轮询=多 worker 兜底"，代码注释与文档写明，**保留但去重命名**。
- A6. 患者主动回复 **SSE inline + HTTP trigger** 双活：随 §5.B 能力修复一并厘清（见 B）。

**前端死导出删除（传输相关）：** `sendMessage`(chat.ts:11)、`askInQASession`(qa.ts:22)、`getUnreadCount`(notifications.ts:18，且指向不存在的后端路由)、`getTrainingState`(training-state.ts:7)、`updateTrainingFeatures`(training-state.ts:15)。

**LLM 流式 fallback 语义**（`stream()` 全失败回退 `call()` 变单块）：保留但在 docstring 标注。

---

### B. 能力/功能开关系统（单一真相 + 分层 + 自动生成）

#### B.1 现状三套打架的真相来源（全部收敛/删除）

| 来源 | 位置 | 处置 |
|------|------|------|
| ① `resolve_features()` + `practice_snapshot["features"]` | `core/capabilities.py:50` | **升为唯一真相** |
| ② `profile.has_emotion`/`has_initiative` | `profiles/*/profile.py` | **删除**（改由①） |
| ③ `profile.capabilities[]` + `case_schema.supported_plugins` | `registry.py:43`, `case_schema.py:79` | **删除**（纯死代码 / 仅作者向建议） |

#### B.2 新能力模型

```python
Capability {
  key: str
  label: str
  description: str
  tier: "builtin" | "toggleable"          # 新增分层
  training_types: list[str] | "all"        # 收编每类型适用性（替代死②③与前端 TRAINING_CAPABILITIES）
  default: bool                            # 仅 toggleable 有意义
  requires: list[str] = []                 # 声明式耦合
}
```

**能力清单（目标）：**

| key | tier | training_types | default | requires | 后端门控点 |
|-----|------|----------------|---------|----------|-----------|
| `emotion` | **builtin** | **all（含 triage）** | 恒开 | — | side_effects 情绪分析恒开 |
| `patient_initiative` | toggleable | history_taking | false | `emotion` | 自动触发 SSE + 计时器 + 手动 trigger 统一 gate |
| `physical_exam` | toggleable | history_taking, triage | false | — | `PhysicalExamService.perform` 必须校验 |
| `nursing_record` | toggleable | history_taking（可扩展） | false | — | 场景卡显示 + 评分注入（见 §5.E） |
| `exam_scene` | toggleable | triage | false | — | MEWS/查体场景 gate（后端需补） |
| `questionnaire` | toggleable | all | false | — | 与 `case_questionnaires` 触发对齐（见 B.5） |

#### B.3 四条硬规则
1. **运行时只读 `resolve_features(record)`**：所有 pipeline/middleware/service 门控统一从解析后的 features 读取。
   - 修 `side_effects.py:183` 情绪门控（当前用 `profile.has_emotion` 架空开关）→ emotion 为 builtin 恒开，但改由能力系统表达。
   - 修 `patient_initiative` 端到端断裂（`side_effects.py:216` 用 `has_initiative=False` 禁掉自动 SSE，而手动/计时器看 feature）→ 统一 gate 于 feature。
   - 补 `physical_exam` 后端门控（`services/physical_exam.py:51` 当前完全不检查）。
   - 补 `exam_scene` 后端门控。
2. **前端能力表从后端生成**：新增后端能力 schema 导出端点 → 生成 `frontend/src/engine/capabilities.gen.ts`（比照 `api-types.gen.ts`，纳入 `api:update`）。**删除**手维护的 `engine/capabilities.ts`（`ALL_CAPABILITIES`/`TRAINING_CAPABILITIES`/死 `resolveFeatures`）。
3. **`resolve_features` 强制 `requires` 与 builtin**：builtin 恒 True；toggleable 按 snapshot 覆盖 default；对每个开启项递归置其 `requires` 为 True（替代硬编码的 `if initiative: emotion=True`）。
4. **开关训练开始即冻结、不可变**（D10）。

#### B.4 教师布置作业联动
- 保留现有模型：features 存于 `Practice.features`，Assignment 指向 Practice，学生从作业开始时 `start_training_from_assignment` 把 `practice.features` 冻结进 `practice_snapshot`（`session.py:325-330`）。
- `PracticesPage` 特性编辑器改用**生成的能力表**渲染：builtin 显示为锁定常开、toggleable 可勾；default 作为初值。
- **删除非法开关** `allow_pause`、`exam_emotion_bridge`（`PracticesPage.tsx:53-54`，后端 `ALL_CAPABILITIES` 无此键 → 勾选即保存失败）。
- 连带删除死 UI：`TrainingHeader.tsx:108` 的 `features.allow_pause` 暂停按钮（永不可达）。
- `behavior.max_rounds`（教师设但后端用 `profile.max_rounds` 忽略，`PracticesPage.tsx:110,126` vs `prompt_builder.py:83`）：**FIX** 让教师值生效，或 **DELETE** 该字段——本轮选 FIX（让 practice.max_rounds 覆盖 profile 默认），保持"谁配置谁说了算"。

#### B.5 questionnaire 能力对齐
当前 `questionnaire` 能力**无后端消费者**；问卷由 `case_questionnaires` 驱动（`questionnaire_response.py:114`）。处置：让 `questionnaire` 能力真正门控问卷触发（能力关则不弹问卷），对齐单一真相。

#### B.6 能力系统死残余删除清单
- `updateTrainingFeatures`(FE) + `PUT /training/{id}/features`(`_config.py` 整文件)
- `getTrainingState`(FE) + `GET /training/{id}/state`(`progress.py:83-143`) + `schemas/training.py:160,165` 非空 latent bug
- 前端 `resolveFeatures()`(`capabilities.ts:49-58`，且缺耦合)
- `TrainingProfile.capabilities` 字段 + 各 profile 填充
- `core/case_schema.py:79-84` `supported_plugins`
- 孤儿 `toggleFeature`/`featuresLocked` context 管道（`TrainingEngine.tsx:40,274`；`TrainingHeader.tsx:29,33`）
- 情绪状态集不一致：前端 6 态含 `anxious`（`EmotionIndicator.tsx:19`）vs 后端 5 态（`capabilities.py:23`）→ 统一为单一定义（随生成机制解决）
- vestigial DB 列 `practices.mode/school_id/assessment`（`0001_initial.py:197-201` 有列、模型无映射）→ 迁移删除（确认未用后）

---

### C. 训练时间设置修复

- **现状 bug**：`session.py:178` `time_limit = case.time_limit_minutes or config.behavior.time_limit_minutes or 20`，case 值非空默认 20 → 学生/教师所设**被静默覆盖**。服务端结算 `settlement_loop`（`infrastructure/settlement.py`，每 30s，`main.py:269-276`）**确实 enforced**，但用的是被覆盖后的值。
- **修复（D11）**：优先级改为 `req.time_limit_minutes`（free start）/ `practice.behavior.time_limit_minutes`（assignment）> `case.time_limit_minutes` > 20。
- **补漏**：`chat.py` 不按 elapsed 拦截消息，仅查 `status`；两次结算 tick（30s）之间超时仍可发消息。处置：`chat.py` 发送前增加 `is_overdue` 校验（`models/training.py:66` 已有 `is_overdue`），超时即拒并触发结算。
- 前端倒计时（`useTrainingTimer.ts`）保持为展示+便捷自动结束；暂停功能随 `allow_pause` 删除而移除。
- 作业级时间：暂不新增 assignment 独立时间字段（教师经 practice 设置即可），文档标注为可选扩展。

---

### D. 场景运行时回路闭合（"扶正空壳"）

**断点（精确）：**
1. 后端训练开始**从不播种** `runtime_state["scene"]`（`session.py:183` 建记录不含它，列默认 `{}`）。
2. 后端**从不广播** `scene:state`（`state.py:5-6` docstring 撒谎，无该代码）。
3. WS `exam:done` 载荷**不含 vitals**（`ws.py:104-109`）。
4. 前端 `useSceneState`（`useSceneBus.ts:22`）监听 `scene:state`，但唯一发射者是 `ExamBodyScene.tsx:115`（本地、孤儿）。
5. `SceneRenderer` **一次只挂一张卡**（`SceneRenderer.tsx:58,80-108`）→ 打开查体时 MonitorCard 卸载 → 漏发射 → 切回 reset 成 `DEFAULT_SCENE` → 监护仪恒显"正常病人"。
6. `scene:state` 未进类型化 `BusEvents`（仅在独立 `SceneBusProtocol`，`scene-state.ts:34-38`）；`onSceneEvent` 导出零使用。

**修复动作：**
- D-1. 后端训练开始时**播种** `runtime_state["scene"]`（从 case/profile 取 environment/patient/vitals 初值）。
- D-2. WS 查体后**推送 scene:state 补丁**（vitals）——`physical_exam.py:85` 已写 DB，补一步经 RealtimeHub/WS 推送对应补丁。
- D-3. 前端新增 **WS→MessageBus 桥**：把 WS 的 scene 消息 `bus.emit("scene:state", patch)`。
- D-4. **提升 `useSceneState` 到 SceneRenderer 级 Provider**（或 TrainingEngine 级），使场景状态跨卡挂载/卸载持续，修复单卡 reset bug。
- D-5. 把 `scene:state` 并入类型化 `BusEvents`，合并 `SceneBusProtocol` 进 `MessageBus` 类型；删死 `onSceneEvent`。
- D-6. **配套 characterization 测试**（WS + 桥 + 场景 bus + 播种）——硬性（D12）。
- 完成后按"只传状态、前端表现"原则：vitals→颜色占位即可（MonitorCard 真正跳动）。

**情绪回路澄清**：情绪回路本就端到端 LIVE（`sse.ts:70`→`emotion:changed`→`EmotionIndicator`+`ChatBubble` 头像色环），**不是空壳**。真正空壳是 vitals/scene。`PatientPortrait.tsx` 从不渲染（死代码，删——见 §5.G）。

**场景入口去重**：删死 `ChatTraining.tsx`（零引用，`TrainingEntry` 才是活入口）。两个同名 `registry.ts`（页面级 `TRAINING_SCENES` vs 卡片级 `getSceneCards`）改名消歧。

---

### E. 护理记录可评分场景 + 预留评分钩子

**机制复用（零新评分引擎代码）：** 评分是 rubric 驱动 + LLM 打分；学生产物经 `PromptContext` 的 `actions` 命名空间注入（triage MEWS 已如此，`score_engine.py:397`）。

- E-1. **持久化**：保留 `NursingRecord.sheet_data`（结构化 JSONB）作为学生护理文书。
- E-2. **场景卡**：新增 `nursing-record` toggleable 能力 + 结构化表单场景卡，读写 `sheet_data`（重建已死的 `api/nursing-records.ts` 为新结构化端点）。
- E-3. **评分预留钩子**：`nursing_record` 开启时——(a) profile rubric 增加"护理记录"维度（含 items）；(b) `evaluate_training` 把 `sheet_data` 注入现有 `actions` 块；(c) LLM 按维度打分，`_scoring_validation` + `_convert_to_100_scale` 自动聚合（`raw_max` 随维度增长，归一自动）。
- E-4. 与自由 `notes`（`routers/notes.py` + `NoteEditor`/`NotesCard`）明确区分：notes=速记，nursing_record=结构化文书+评分。**不合并**。

---

### F. LLM 核心加固

**必修（高危）：**
- F-1. `client.py` `stream()` **双报 circuit breaker**：`_do_stream:732` 与 `stream():448,453` 各 `report_result(success=False)` → 一次失败 +2，阈值 5 时 3 次即熔断。修：仅在一层报（比照 `call()`/`_do_call()`）。
- F-2. `score_engine.py:408-409,419,437` **triage `exam_results_text` UnboundLocalError**：feedback 块在 if/else 外无条件引用，triage 分支未定义 → 被 `gather(return_exceptions=True)` 吞掉 → triage 有评分无反馈。修：if/else 前 `exam_results_text = ""`。

**收敛（中）：**
- F-3. `stream()` 重实现了与 `circuit.async_retry()` 相同的重试循环 → 抽 `_stream_attempt` 复用。
- F-4. `call_with_tools()` 不调 `_record_metrics()`（QA 工具调用漏计）→ 补。
- F-5. `score_engine._stream_attempt`+`_stage_with_retry`（第三层重试 + 心跳/进度 76 行）→ 抽公共进度/心跳工具，client 扩展通用 progress 回调。
- F-6. QA `_inject_search_context` 与 `ask_stream` 内联 RAG 注入逻辑分叉（1500 字截断 vs snippet）→ 合并（加 `snippets_only`）。
- F-7. 定价三处硬编码（`token_counter.py:19-20`、`config.py:78-79`、`router.py:64-65`）→ 收敛到 `token_counter` 单一来源。
- F-8. `provider_name` 恒硬编码 `"deepseek"`（`client.py:567-568`、`logging.py:217`）→ 由 `ApiSecret.label`/base_url 推导。

**并发/安全（中，文档化为主）：**
- F-9. 后台事件循环 + `asyncio.Semaphore`/`asyncio.Queue` 跨 loop 风险（`main.py:249`、`session.py:83-108`、`client.py:85`；`_schedule_background` 等定义但未调用）→ 文档警告勿在后台 loop 调 LLM；核实后台 loop 是否仍需。
- F-10. LLM circuit breaker 无 half-open（弱于 TTS 版）→ 保留，标注。

**低/清理：**
- F-11. `stream()` 日志 enqueue 缺 `cache_hit/miss_tokens`（`client.py:435`）→ 补。
- F-12. `LLMConcurrencyExceeded` 定义但从不 raise（`exceptions.py:57`）→ 实现信号量超时或删除。
- F-13. `AUTHOR_NOTE_TEMPLATE` 单变量过模板（`patient/prompt.py:9,43`）→ 改普通字符串。
- F-14. 双超时 `asyncio.timeout(t+10)`+`httpx.Timeout(t)`（`client.py:606,696`）→ 加注释说明。
- F-15. `llm_caller` 身份纠正重试叠加 client 重试（乘性调用数）→ 保留，注释累计上限。
- F-16. 训练流式"缓冲后回放"非真实时（`chat.py:65`、`llm_caller:179`、`runner:67`）→ 保留（支持身份纠正），docstring 标注命名误导。
- F-17. 删除陈旧 `backend/services/llm/__pycache__/`（源已迁 `infrastructure/llm/`）。
- F-18. `build_scoring_rubric()`（`static.py:132-147`，superseded 仅测试用）→ 测试迁移后删。

---

### G. 死代码 / 重复清理清单（全量，勿漏）

**前端删除文件：**
- `pages/ChatTraining.tsx`（死入口）
- `components/training/PatientPortrait.tsx`（从不渲染）
- `components/training/PanelErrorBoundary.tsx`（零引用）
- `components/training/panels/scoring-display/ScoringDisplayOverlay.tsx`（+ barrel 导出，重复 `ScoringOverlay`）
- `api/nursing-records.ts`（死，将由 §5.E 结构化端点替代）
- `showcase/components/VirtualMaskText.tsx`（死重复，活的是 `VirtualPatientMaskText`）
- `engine/tts/index.ts`（死 barrel，直接 import 已用）

**前端死导出/死类型：** `scene-state.ts` 的 `onSceneEvent/SceneMeta/QuickAction/SizePref`；`capabilities.ts` 整文件（改生成）；§5.A 与 §5.B 所列死 API 导出。

**前端结构去重：** 合并 `src/training/**` 与 `src/components/training/**` 两个 training 根；两 `registry.ts` 改名；`api/client.ts`↔`api/api-client.ts` 消歧。

**后端删除：** REST 查体端点、SSE notifications 端点、`_config.py`、`progress.py` 死 `/state`、`TrainingProfile.capabilities`、`supported_plugins`、`services/llm/__pycache__/`、vestigial `practices` 列（迁移）。护理旧系统 `contexts/.../nursing.py` + `NursingRecord`：**注意——`NursingRecord` 模型保留**（§5.E 地基），仅清理其死 FE 客户端与未用路由（确认后）。

**小程序（D3）：** 删除整个 `miniprogram/`；从 `package.json` 的 `api:update:all`、`scripts/generate-miniapp-api.mjs`、`pnpm-workspace.yaml`、AGENTS.md 引用中摘除。

**sandbox：** 保留（3D 立项用），但加 README 说明其为隔离原型、协议副本会漂移；不纳入 production 构建。

---

## 6. 测试策略（硬性）

当前实时训练路径（WS + SSE + 查体 + 场景 bus + 语音 + 能力 + 评分）**前后端几乎零覆盖**。本轮为每个改动域补 characterization 测试：

| 域 | 必补测试 |
|----|---------|
| 传输 | WS 端点鉴权/查体/hub 转发/心跳；`readSSEStream` 解析器 |
| 能力 | `resolve_features` builtin/toggleable/requires/冻结；每类型适用性；生成物与后端一致性校验（CI gate） |
| 时间 | 优先级解析；`settlement_loop` 超时结算；`chat` 超时拒绝 |
| 场景 | 播种；WS→bus 桥；跨卡状态持续；MonitorCard 联动 |
| 护理评分 | `sheet_data` 注入 + rubric 维度聚合 |
| LLM | `stream()` 单报 circuit breaker；triage 评分+反馈不崩 |

生成物一致性纳入云端 CI gate（比照现有 `api:spec`+`api:generate` diff 检查）。

---

## 7. 分批执行计划（多批 PLAN，每批内并行子代理）

每批产出独立 writing-plans 计划文档；批内任务尽量拆为**无共享状态的并行子代理任务**（详见 dispatching-parallel-agents）。批间有依赖，顺序执行。

- **Batch 0 — 清障（低风险，纯删除+改名）**：§5.G 全部死代码删除、小程序删除、重命名（RealtimeHub/notifyProgress/client 消歧）、能力默认值漂移临时对齐。并行轴：前端删除 / 后端删除 / 小程序删除 / 重命名。产出后 `pnpm run check` 必须绿。
- **Batch 1 — 传输归一**：§5.A（删死端点、两车道文档、进度双路注释）。并行轴：后端端点删除 / 前端桥与命名 / 文档。`api:update:all` 重生成。
- **Batch 2 — 能力系统扶正**：§5.B（后端单一真相 + 分层 + requires + 生成器 + 各门控点修复 + 教师端）+ §5.C（时间）。并行轴：后端 capabilities 重构 / 生成器与 CI gate / pipeline 门控修复 / 教师端 UI / 时间修复。**依赖 Batch 0 命名**。
- **Batch 3 — 场景闭环**：§5.D（播种 + WS 推送 + 桥 + Provider 提升 + 类型合并 + 测试）。并行轴：后端播种+推送 / 前端桥+Provider / 测试。**依赖 Batch 1 传输、Batch 2 能力**。
- **Batch 4 — 护理记录可评分场景**：§5.E（能力 + 场景卡 + 结构化端点 + 评分钩子 + 测试）。**依赖 Batch 2 能力、Batch 3 场景**。
- **Batch 5 — LLM 核心加固**：§5.F（高危先行 F-1/F-2，再收敛 F-3~F-8，末清理）。相对独立，可与 Batch 3/4 部分并行，但 F-2 触及 score_engine 需与 Batch 4 评分协调。

每批完成 gate：`pnpm run check:full` 绿 + 该批 characterization 测试通过 + 生成物 diff 检查通过。

---

## 8. 风险与回滚
- **行为变更**：triage 获得情绪（D9，有意）；physical_exam 后端开始真正门控（此前无门控，可能影响既有病例默认）；时间优先级改变（此前 case 覆盖）。→ 均以测试固化 + 迁移期文档说明。
- **大规模删除**：每批独立可回滚（分批提交）；删除前以 grep/生成物 diff 双重确认零引用。
- **分支 192 提交领先 master**：需先决定重构落于该分支还是先合 master（见 §9）。
- **零测试地基**：Batch 内"先补 characterization 测试锁定现状，再改"以防回归。

## 9. 待决/推迟
- **分支落地策略**：本重构在 `refactor/prompt-engineering-clarity` 上继续，还是先将其合入 master 再重构？（影响所有 Batch 的基线）——需作者决定。
- 作业级独立时间字段（当前经 practice）：可选扩展。
- `routers/`↔`contexts/` 完整 DDD 迁移：推迟，仅写边界文档。
- 3D 从 sandbox 移植：独立立项。
- LLM 多 provider 启用、circuit breaker half-open 化：推迟。

---

## 附：设计自审
- 占位符：无 TBD（§9 待决项为显式决策点，非占位）。
- 一致性：情绪在 D9/§5.B/§5.D 表述一致（builtin 全类型恒开）；护理记录在 D5/§5.E/§5.G 一致（保留模型、删死 FE 客户端）。
- 范围：单文档覆盖五域，但通过分批 PLAN（§7）拆为可独立执行单元。
- 歧义：时间优先级、能力门控点、删除项均给出精确 file:line 依据（见各审查节）。
