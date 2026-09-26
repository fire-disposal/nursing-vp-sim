> 状态：待评审（设计已收敛，未实施）

# 提示词与上下文版本管理设计

决定「哪些东西有版本身份、身份怎么算、在哪里冻结、如何产品化」。核心结论：**身份在产物粒度（artifact），冻结在记录粒度（record），明细在回合粒度（turn）**；管理面是只读目录 + 归因视图，不做在线编辑。

## 一、事实基线（代码事实，非推测）

| 事实 | 证据 |
|---|---|
| 提示词是**代码常量**：`prompts=PromptCollection(system=PATIENT_SYSTEM, dynamic=PATIENT_DYNAMIC)` | `modules/training/profile.py` |
| DB 提示词表**已被主动删除**；`docs/ideas/context-mechanism-redesign.md §十` 明确「不引入 DB 存储提示词（代码即版本）」 | 迁移 `ddl/2bf76d5c1796_batch_b_drop_prompt_rubric_tables.py` |
| 记录创建时冻结三份快照：`case_snapshot` / `rubric_snapshot` / `prompt_snapshot` | `modules/training/router/session.py:238-253` |
| `prompt_snapshot` 只有**形状版本**：v2 `{schema_version:2, purpose, segments:{system,dynamic}}`；v1 扁平由 compat 读取 | `modules/training/pipeline/snapshot_compat.py` |
| 上下文装配唯一入口：`ContextAssembler` + `ContextFragment(slot/source/priority/max_tokens)`，每轮产出 `ledger`（各段 token、取舍计数、token scale） | `modules/training/context/assembler.py`、`.../fragment.py` |
| 装配策略是**模块常量**：`HISTORY_BUDGET_TOKENS=2000`、`PATIENT_STATE_BUDGET_TOKENS=300`、`MIN_HISTORY_ROUNDS=4`、`HEAD_PINNED_ROUNDS=2`、`MAX_TOKEN_SCALE=4.0` | `modules/training/context/budget.py` |
| 提示词契约校验已存在（启动时按 TypedDict 校验占位符，非致命告警） | `main.py::_validate_prompt_templates` → `core.template_variables.validate_all_templates` |
| 评分侧身份字段：`rubric_version = "{rubric.id}@{rubric.version}"`（**内容身份，正确**）；`prompt_version = snapshot.schema_version or 1`（**形状版本**）；`mapping_version`（映射曲线 0/1） | `modules/training/scoring/engine.py:628-630`、`models/training.py:124-136` |
| `LLMCallLog` 记录 purpose/record/case/model/usage/latency/status + `request_text`/`response_text` 全文，**无任何提示词或上下文身份** | `models/llm.py:45-75` |
| 回合审计表已存在：`TrainingAction(kind, input, result, unique(record_id, request_id))`，按 `(record_id, kind)` 索引 | `models/training.py:186-208` |
| 评分标准管理面先例：`GET /rubrics/current` 只读投影 + `RubricPage.tsx` 只读渲染，**无 DB 表、无 CRUD** | `modules/admin/rubrics.py`、`frontend/src/pages/admin/RubricPage.tsx` |

`ledger` 目前只 `log.debug("context ledger: %s", ...)`，不进库（`pipeline/middleware/prompt_builder.py`）。

## 二、问题（按危害排序）

1. **同名异义**：`Score.prompt_version` 存的是快照**形状**版本（1 或 2），工程直觉读作「提示词第几版」。这是当前最容易被误读的字段，且已经出现在 API 投影里（`schemas/training/records.py:56`）。
2. **内容变更无身份**：改 `PATIENT_SYSTEM` 一个字，历史与未来的 `prompt_version` 都不变（仍 1/2），无法回答「这次评分用的哪版提示词」。
3. **上下文不可归因**：ledger 里有全部证据（各段 token、裁掉几轮、token scale），但不落库；同一段对话在「预算 2000 / 钉 2 轮」与「预算 3000 / 钉 4 轮」下装配出的 prompt 无法区分，出问题只能靠复现猜。
4. **调用日志无法按版本聚合**：`llm_call_logs` 存了全文，却答不出「v3 提示词的成功率/延迟 vs v4」；同时全文是 PII 与存储双负担。
5. **改动无预警**：提示词与装配常量变更不经过任何身份计算，没有「本次发布改了哪个产物」的清单。

## 三、粒度决策

候选粒度与取舍：

| 粒度 | 判定 | 理由 |
|---|---|---|
| 每次发布（release） | ✗ 太粗 | 一个 tag 含多处改动，无法归因到具体产物 |
| **每个产物（artifact）** | ✓ **采用** | system 段 / dynamic 段 / 评分提示词 / rubric / 上下文策略各自独立身份；改动可归因，聚合有意义 |
| 每个 workflow | ✗ 太粗 | 无法区分同一 workflow 的 system 与 dynamic 谁变了；跨 workflow 复用被切断 |
| 渲染后的完整 prompt | ✗ 太细且**语义错误** | 渲染结果随病例数据变化（每个病例都不同），那是上下文，不是提示词身份 |
| 每个 fragment 来源 | ✗ 暂不 | 身份爆炸；v1 用「策略版本 + ledger」已能定位到段与取舍 |

**决策**：产物粒度五元组。

| 身份 | 覆盖内容 | 计算方式 | 冻结点 |
|---|---|---|---|
| `prompt_id` | workflow 的 `system` + `dynamic` 模板原文 | `"{workflow.id}@{sha256(system \x00 dynamic)[:12]}"` | 记录创建 |
| `scoring_prompt_id` | `SCORING_SYSTEM` + `SCORING_FEEDBACK_SYSTEM` + JSON schema 生成器版本 | `"score@{sha256(...)[:12]}"` | 记录创建 |
| `rubric_version` | 评分标准 | **保持现状** `"{id}@{version}"`（文件自带 version，已是内容身份） | 记录创建（已有） |
| `context_policy_version` | 预算/钉轮/压缩/token-scale 策略常量集合 | `"ctx@{sha256(规范化常量表)[:8]}"`（**派生**，不人工维护） | 记录创建 |
| `mapping_version` | 分数映射曲线 | **保持现状**（整数，语义明确） | 评分时（已有） |

派生而非人工递增是刻意的：人工版本号会「忘了改」，hash 不会。文件自带 `version` 的 rubric 例外保留——它已是团队既有约定且被 `rubric_version` 消费。

## 四、身份不落库：派生优先，物化需消费者

**已撤回的形态（2026-09-26）**：最早的 S1 曾把 `prompt_id` 写进 `prompt_snapshot`。撤回理由是两条硬违规：

1. **生产者无消费者**：`prompt_id` 写入后仓内零读取方 —— 与本次会话删除 `TrainingSessionData`、`RecordExtended`、死端点同一标准，属死重。
2. **同行的派生副本**：`prompt_snapshot` 本身已含模板原文（`segments.system/dynamic`），身份 = hash(原文)。把 hash 与原文存在同一行意味着两者可互相漂移，是"同一事实两份真相"。

**修正原则**：身份**按需派生**，不预先存储。

* 记录行里已有模板原文 ⇒ 任意时刻都能重算 `prompt_id`，代价是 O(1) 次 sha256（约 4KB 文本）。
* 只有出现**真实消费者**（跨版本聚合查询、索引需求）时，才把身份**物化**为列；物化是为索引服务的缓存，不是事实来源，并且必须带一条「物化值 == 派生值」的一致性测试。
* 在消费者落地之前不建列、不写键、不引入身份模块。

```text
现在（无消费者）：
  prompt_snapshot  ──(按需 derive)──▶  prompt_id        # 不落库

消费者落地后（S4/S5 聚合与 UI）：
  prompt_snapshot  ──(写入时物化)──▶  training_records.prompt_id  + 一致性测试
```

### 已批准、且不需要新存储的唯一改动

`Score.prompt_version` → `prompt_schema_version`（你已裁决改名）。它修的是**会说谎的字段**：现在存的 `snapshot.schema_version`（1/2）被读成"提示词第几版"。改名用既有数据把语义摆正，不新增列、不新增概念。同批修复 SCR-7（存量记录补写快照时会覆盖已有 `prompt_snapshot`，见"风险"一节）。

### 身份与管线阶段：同一阶段落地

管线收敛与身份捕获是同一批工作，因为**捕获点就是阶段边界**（`pipeline/__init__.py` 已固定五阶段）：

| 阶段 | 现有 owner | 身份/账本捕获点 |
|---|---|---|
| 1 ANALYSIS | `emotion_analysis` | — |
| 2 PROMPT | `prompt_builder` + `ContextAssembler` | 产出 `ledger`（各段 token/取舍）与策略身份；**这里是 `context_policy_version` + 指纹的唯一产生点** |
| 3 LLM | `llm_caller` | 把「本次调用用的提示词身份 + 上下文指纹」写进 `llm_call_logs`；**这里是调用归属的唯一产生点** |
| 4 PERSIST | `persister` | —（记录创建时的冻结在 `_create_record`，属训练开始，不在回合管线内） |
| 5 SIDE_EFFECTS | `side_effects` | 回合账本落审计表（best-effort）；**这里是回合级明细的唯一落点** |

因此：**先收敛五阶段为显式函数、再在阶段内挂身份捕获**，顺序不能反——否则身份会被塞进中间件包装里，随收敛再次搬迁。

### 不变式

1. 身份与事实同源：能从冻结数据派生的，不额外存储；存储的必须可被派生值验证。
2. 同一 `record_id` 的提示词身份恒定（记录创建时冻结模板原文即已保证）。
3. 历史记录不伪造身份：派生不出来的（快照缺失）就是"不可知"，不回填。
4. `rubric_version` / `mapping_version` 语义与取值规则不变。
5. 身份只用于观测与归因，不参与任何业务判定。

## 五、产品化：配套管理 UI

### 5.1 定位

**只读目录 + 归因视图**。不提供在线编辑：提示词与装配策略同代码、守卫、槽位契约耦合（启动即校验占位符契约），在线编辑会重新引入被刻意删除的 `prompt_templates` 那套 draft/publish/rollback/审计，形成第二个真相。改动路径仍是「改代码 → 提 PR → `pnpm run tag` → 发布」，UI 负责让**改动效果可见**。这与评分标准管理的既有先例一致（只读 `GET /rubrics/current` + 只读页面）。

### 5.2 新增页面：管理端「提示词与上下文版本」

路由 `/admin/versions`（`permission: stats_view` 或新 `version_view`，见开放决策 4）。

**A. 版本目录（列表）**

| 列 | 说明 |
|---|---|
| 产物 | 例如 `history_taking.system+dynamic`、`scoring.prompt`、`context.policy`、`rubric` |
| 身份 | `prompt_id` / `ctx@…` / `{id}@{version}`（可点击进详情） |
| 首次出现 / 最后使用 | 由记录聚合得出（不是 git 时间——UI 只反映运行时事实） |
| 使用记录数 | `COUNT(records)`，按 `prompt_id` |
| 平均分 / 评分成功率 | 见 5.3 |

**B. 版本详情**

- 产物原文（只读代码块；`prompt_id` 可从 hash 反查当前代码常量）。
- 该版本的使用记录列表（分页，跳记录调试）。
- 与**当前代码版本**的差异提示：`diff(prompt_id)` ≠ 当前 hash ⇒ 标注「历史版本，代码已变更」。

**C. 上下文策略**

- 当前 `context_policy_version` 及其常量表（预算、钉轮、保底轮、token scale 上限）逐项渲染，供评审。
- 按策略版本分组的使用量。

### 5.3 归因视图（本设计的实际产品价值）

按 `prompt_id` / `context_policy_version` / `rubric_version` 分组聚合：

```text
平均分、评分成功率、平均延迟、回退（fallback）率、平均轮数、token 消耗
```

回答的问题：
- 「上周改的那版患者人格提示词，分数是升了还是降了？」
- 「这套上下文预算下，历史截断是否变多（ledger 里 dropped rounds）？」
- 「哪版评分提示词的兜底率偏高？」

聚合放在后端一次查询（`GROUP BY prompt_id`），不在前端拼。

### 5.4 与记录调试工作台的关系

当前唯一能看到提示词原文的界面是管理端 LLM 调用日志详情抽屉（`components/admin/monitor/CallLogDetail.tsx`，展示 `request_text` 全文）——**只能看到文本，看不到身份**，这正是本设计要补的洞。

单记录归因（该记录的三个身份 + 逐轮 ledger 时间线）落在**记录调试工作台**上；该工作台目前尚未落地（`/admin/training-debug/:recordId` 仍是规划，仓内尚无文档化决策）。在它落地前，单记录身份可先附着在现有记录详情与调用日志详情上；落地后两者共用同一套身份字段，不各自定义第二份。

版本页是**跨记录聚合**，与单记录归因互补：同一事实（身份），两种读法（列表 vs 明细）。

### 5.5 新增 API（全部只读）

```text
GET /admin/versions/prompts            → 产物目录（含使用量）
GET /admin/versions/prompts/{id}       → 单产物详情（原文 + 使用记录）
GET /admin/versions/context            → 策略版本 + 常量表 + 使用量
GET /admin/versions/attribution        → 按身份分组的聚合指标（分组维度可选）
GET /admin/training-records/{id}/context → 单记录逐轮 ledger（供调试页）
```

无写端点。管理权限复用 `api_manage`/`stats_view`。

## 六、落地切片（每片可独立发布与回滚）

前置：**管线收敛（五阶段显式化）先做**，因为身份捕获点就是阶段边界（§四）。收敛完成后再挂捕获，避免身份随中间件包装二次搬迁。

| 切片 | 内容 | 依赖 | 回归 |
|---|---|---|---|
| P0（未阻塞） | 修复 SCR-7：存量记录补写快照时**只补缺失字段**，绝不覆盖已冻结的 `prompt_snapshot`；抽成可单测的纯函数 | 无 | 单测：仅有 rubric 缺失时 prompt 快照不变 |
| P1（未阻塞） | `scores.prompt_version` → `prompt_schema_version` 迁移 + 模型/API/`SCORE_SNAPSHOT_FIELDS`/测试同步。**不新增任何身份列** | 无 | `db:check` + 迁移链 + 评分测试 + `api:update` |
| P2（原阻塞项，现已解除） | 对话管线五阶段收敛为显式函数，删除单实现中间件包装；`ANALYSIS/PROMPT/LLM/PERSIST/SIDE_EFFECTS` 各自单一 owner | P0/P1 可并行 | 对话回合测试 + SSE 冒烟 |
| P3 | PROMPT 阶段产出 `ledger` + 策略身份（派生，不落库）；SIDE_EFFECTS 与 LLM 阶段消费同一份产物 | P2 | 回合测试：账本形状与取舍计数 |
| P4 | 消费者落地才建列：`llm_call_logs` 身份列 + `training_records.prompt_id` 物化列（含「物化 == 派生」一致性测试） | P3 | 契约生成 + 一致性测试 |
| P5 | 后端只读端点（目录/详情/策略/归因） | P4 | 契约生成 + 端点测试 |
| P6 | 前端「提示词与上下文版本」页（`api_manage`）+ 记录调试页身份/ledger 区块 | P5 | 前端套件 + 手动冒烟 |

P0/P1 立即可以做；P2 起按顺序，P4 之前不建身份列（§四）。

## 七、明确不做

- 不做在线编辑提示词 / 不重建 `prompt_templates`（延续「代码即版本」）。
- 不做提示词 A/B 分流：无产品需求，且会引入第二套真相与分流状态。
- 不做「实验性提示词覆盖」（已裁决）。
- 不对**渲染结果**求 hash 作为 `prompt_id`（病例数据会污染身份）。
- **不把身份预先写进 `prompt_snapshot`**（已撤回，见 §四）。
- 不在 `llm_call_logs` 里再存一份 ledger 或原文（避免双份 PII / 体积）。
- 不人工维护版本递增号（一律内容派生）。
- 不因版本差异改变评分或展示行为（身份仅用于观测与归因）。

## 八、风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 身份漂移 | 有人改了提示词却绕过计算点 | 派生点唯一（消费处一处）；物化后加「物化 == 派生」一致性测试 |
| 历史不可知 | 存量记录无身份可派生（快照缺失） | 明确不回填；UI 显示「未知（历史记录）」 |
| 聚合查询成本 | 全表 `GROUP BY` | 物化列 + 索引；聚合限定时间窗（默认 90 天） |
| ledger 体积 | 每轮一条审计行 | ledger 是有界计数与短枚举，非全文 |
| 改名破坏契约 | `prompt_schema_version` 影响 API/前端/强制重评快照 | 一次迁移内完成 + `api:update` + 前端类型再生 |

## 九、已裁决与仍开放

已裁决（2026-09-26）：

1. **`Score.prompt_version` 改名** 为 `prompt_schema_version`（语义干净优先）。
2. **页面权限复用 `api_manage`**，不新增 `version_view`。
3. **不做实验性提示词覆盖**（延续「代码即版本」）。
4. **身份不预先落库**：派生优先；只有真实消费者出现才物化，且物化必须可被派生值验证。

仍开放：

1. **ledger 落 `TrainingAction` 还是 `runtime_state`**：倾向 `TrainingAction`（不可变审计语义 + 幂等唯一键，`runtime_state` 会被覆盖）。P3 落地前定。
2. **物化列是否真的必要**：先做 P5 的聚合查询，若 90 天窗口内全表扫描可接受（记录量级见 `sessions.active`），可以**永不物化**，连 P4 都省掉。倾向先量再定。

## 十、验收标准（若转正为实施文档）

1. 任意一条记录都能回答：用了哪版提示词、哪版评分提示词、哪版上下文策略、哪版 rubric。
2. 任意一次 LLM 调用可按身份聚合成功率与延迟。
3. 任意一轮对话可回放其 context ledger（各段 token、裁掉轮次、token scale）。
4. 版本页能对比两个身份的分数分布，且能识别「代码已变更的历史版本」。
5. 历史记录显示「未知」，且没有任何伪造身份。
6. 管线五阶段各自单一 owner，无单实现中间件包装残留。
