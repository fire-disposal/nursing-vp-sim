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

## 四、冻结与记录模型

身份只在**冻结时刻**算一次，之后只读；历史行一律可空，**不回填伪造**。

```text
记录创建（_create_record）
  prompt_snapshot / rubric_snapshot / case_snapshot  ← 已有
  + prompt_id / scoring_prompt_id / context_policy_version  ← 新增，随记录冻结

回合（每轮对话）
  TrainingAction(kind=chat_turn).result["context"] = {policy, ledger, fingerprint}
  ← best-effort，失败不阻断对话（与 side_effects 同级）

评分
  Score.prompt_id / scoring_prompt_id  ← 复制记录冻结值（不重算）
  Score.rubric_version / mapping_version  ← 现状

LLM 调用
  LLMCallLog.prompt_id / context_fingerprint  ← 新增列，按版本可聚合
```

数据变更（唯一迁移）：

| 对象 | 变更 |
|---|---|
| `training_records` | `+prompt_id str(64) NULL`、`+scoring_prompt_id str(64) NULL`、`+context_policy_version str(32) NULL` |
| `scores` | `+prompt_id`、`+scoring_prompt_id`；`prompt_version` → `prompt_schema_version`（改名，语义不变） |
| `llm_call_logs` | `+prompt_id str(64) NULL`、`+context_fingerprint str(40) NULL` |
| `training_actions` | 无 DDL（复用 `result` JSONB） |

`context_fingerprint` = `sha256(context_policy_version + 规范化 ledger 计数)[:12]`，用于「同策略同取舍」的快速等值判断；完整 ledger 存审计表，不进日志表（避免双份 PII 与体积）。

### 不变式

1. 同一 `record_id` 内 `prompt_id` / `scoring_prompt_id` / `context_policy_version` 恒定；评分、复盘、日志**不得重算**。
2. 历史记录这些列为 `NULL` = 不可知；只允许「用当时快照重算 hash」这一种回填，且必须标记来源；其余不得编造。
3. `prompt_id` 只随**代码模板或 workflow 归属**变化，不随病例数据渲染变化。
4. `rubric_version` / `mapping_version` 语义与取值规则不变。
5. 身份字段只读、可空、不参与任何业务判定（不因版本不同而拒绝评分或展示）。

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

| 切片 | 内容 | 回归 |
|---|---|---|
| S1 ✅ 已实施（2026-09-26） | `prompt_identity.py`：`compute_prompt_id` / `prompt_id_from_snapshot` / `compute_scoring_prompt_id` / `compute_context_policy_version` / `context_fingerprint`（全部内容派生，无人工版本号）；`_create_record` 把 `prompt_id` 与模板原文一起冻结进 `prompt_snapshot`（形状不变，读取方忽略新键） | 24 条单测（稳定性/单字符敏感/字段拼接无歧义/形状无关/常量派生/指纹只取数值）+ 全量后端套件 1424 passed |
| S2 | 迁移：三个记录列 + `Score` 两列 + 改名 `prompt_version→prompt_schema_version`；评分写入复制记录值 | `db:check` + 迁移链 + 评分测试 |
| S3 | `LLMCallLog` 两列 + 写入（调用点已持有 record 上下文） | LLM 调用日志测试 |
| S4 | 每轮 `ledger` 落 `TrainingAction(kind=chat_turn).result["context"]`（best-effort） | 对话回合测试 + 失败不阻断 |
| S5 | 后端五个只读端点 + 聚合查询 | API 契约生成 + 端点测试 |
| S6 | 前端「提示词与上下文版本」页 + 记录调试页身份/ledger 区块 | 前端套件 + 手动冒烟 |

S1→S2 之间必须一次发布内完成（S1 只写 JSONB 键，S2 才建列），避免半状态。

## 七、明确不做

- 不做在线编辑提示词 / 不重建 `prompt_templates`（延续「代码即版本」）。
- 不做提示词 A/B 分流：无产品需求，且会引入第二套真相与分流状态。
- 不对**渲染结果**求 hash 作为 `prompt_id`（病例数据会污染身份）。
- 不在 `llm_call_logs` 里再存一份 ledger 或原文（避免双份 PII / 体积）。
- 不人工维护版本递增号（一律内容派生）。
- 不因版本差异改变评分或展示行为（身份仅用于观测与归因）。

## 八、风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 身份漂移 | 有人改了提示词却绕过计算点 | 计算点唯一（冻结处一处）+ 单测钉住；启动校验扩展为「记录写入必带身份」的断言 |
| 历史不可知 | 存量记录三个新列为 NULL | 明确不改写；只允许用快照重算并标注来源，UI 显示「未知（历史记录）」 |
| 聚合查询成本 | `GROUP BY prompt_id` 全表 | 记录列加索引；聚合限定时间窗（默认 90 天） |
| ledger 体积 | 每轮一条审计行 | ledger 是计数与短枚举（有界），非全文；必要时按记录数分页清理 |
| 改名破坏契约 | `prompt_version → prompt_schema_version` 影响 API/前端 | 见开放决策 3：可用「加新列 + 旧字段保留并标注」替代改名 |

## 九、开放决策（需产品/架构裁决）

1. **身份落列还是落 JSONB**：建议独立列（可索引、可聚合）；若想零 DDL 可先只写 `prompt_snapshot` 键，聚合退化为应用层。
2. **ledger 落 `TrainingAction` 还是 `runtime_state`**：建议 `TrainingAction`（已有不可变审计语义与幂等唯一键）；`runtime_state` 是运行态，会被覆盖。
3. **是否改名 `Score.prompt_version`**：改名语义最干净但动 API 与前端展示；保守方案是**保留旧字段**并在 API 文档标注「形状版本」+ 新增 `prompt_id`。倾向前者（同名异义比一次性改动更贵）。
4. **权限**：新页面复用 `api_manage` 还是新增细粒度 `version_view`（教师只读、管理员可见）→ 取决于是否要让教师自查提示词版本。
5. **是否需要「实验性覆盖」**：允许在受控范围内用 DB 覆盖某个 workflow 的提示词做验证。默认**不做**；若未来要做，必须带 draft/publish/rollback 与审计，且身份仍是 hash。

## 十、验收标准（若转正为实施文档）

1. 任意一条新记录都能回答：用了哪版提示词、哪版评分提示词、哪版上下文策略、哪版 rubric。
2. 任意一次 LLM 调用可按 `prompt_id` 聚合成功率与延迟。
3. 任意一轮对话可回放其 context ledger（各段 token、裁掉轮次、token scale）。
4. 版本页能对比两个版本的分数分布，且能识别「代码已变更的历史版本」。
5. 历史记录显示「未知」，且没有任何伪造身份。
