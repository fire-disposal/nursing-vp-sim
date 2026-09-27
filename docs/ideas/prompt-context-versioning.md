> 状态：V1 只读归因已实施；2026-09-27 复议后，在线编辑/A/B 从“永久不做”改为“U0 后按真实实验需求受控实施”，当前边界见 [19](../19-training-experience-next-generation-plan.md#七u0-后的-e1受控上下文发布与对照实验)。

# 提示词与上下文版本管理设计

决定「哪些东西有版本身份、身份怎么算、在哪里冻结、如何产品化」。核心结论仍是：**身份在产物粒度（artifact），冻结在记录粒度（record），明细在回合粒度（turn）**；现有管理面保持只读，未来写面只能发布新的不可变 revision。

## 复议结论（2026-09-27）

原设计拒绝在线编辑与 A/B，是为了避免把代码模板、运行中会话和数据库当前值变成三份真相；这个风险判断仍成立。
调整的是实现边界，不是放弃冻结：

1. 先执行 19-C0，删除当前上下文运行时的无消费者抽象；不得直接在旧链路上叠加数据库模板；
2. U0 仍使用代码模板、记录快照和单批次，不依赖在线编辑；
3. 出现重复实验需求后，可新增“草稿 → 校验/预览 → 发布不可变 revision → 新任务钉住 revision”；
4. A/B 的 arm 在作业发布时按学生固化，重试不重新分配；训练开始时冻结 revision 与精确模板快照；
5. “热发布”只影响尚未开始的训练，不修改进行中的记录，也不提供请求级任意 prompt override；
6. 槽位权限、泄漏守卫、历史压缩算法等结构性策略首期仍随代码发布；在线写面只开放有明确契约的内容字段。

因此，未来不是恢复旧 `prompt_templates` 表或全局可变“当前提示词”，而是把 `CaseRevision` 已验证的不可变发布语义
复用于上下文产物，并由 `Assignment` / `AssignmentRecipient` 承担任务与分流冻结。

## 一、事实基线（当前代码）

| 事实 | 证据 |
|---|---|
| 提示词仍是**代码常量**：`prompts=PromptCollection(system=PATIENT_SYSTEM, dynamic=PATIENT_DYNAMIC)` | `modules/training/profile.py` |
| 旧 DB 提示词表已删除；U0 前没有在线写面 | 迁移 `ddl/2bf76d5c1796_batch_b_drop_prompt_rubric_tables.py` |
| 记录创建时冻结 `case_snapshot` / `rubric_snapshot` / `prompt_snapshot` | `modules/training/router/session.py::_create_record` |
| `prompt_snapshot` v2 形状为 `{schema_version:2, segments:{system,dynamic}}`；v1 扁平由 compat 读取 | `modules/training/pipeline/snapshot_compat.py` |
| 上下文装配当前经过 `ContextAssembler` + `ContextFragment(slot/source/priority/max_tokens)`，每轮产出 `ledger` | `modules/training/context/assembler.py`、`.../fragment.py` |
| 装配策略仍是模块常量：历史/患者状态预算、首尾保护轮次、token scale 上限 | `modules/training/context/budget.py` |
| 提示词契约校验已存在（启动时按 TypedDict 校验占位符，非致命告警） | `main.py::_validate_prompt_templates` → `core.template_variables.validate_all_templates` |
| `scores.prompt_schema_version` 已明确表示快照形状；rubric / mapping 身份语义分开 | `models/training.py`、`modules/training/scoring/engine.py` |
| 患者 prompt 身份从冻结原文按需派生；`context_policy_version` 在记录创建时冻结，版本归因页已有真实消费者 | `modules/training/prompt_identity.py`、`modules/admin/versions.py` |
| `LLMCallLog` 仍无提示词或上下文身份；回合 `ledger` 也未持久化 | `models/llm.py`、`pipeline/middleware/prompt_builder.py` |

`ledger` 当前只写 debug 日志；其上一轮估算/实际 token 的自适应入口没有生产接线，属于 19-C0 必须接入真实消费者或删除的接口。

## 二、剩余问题（按危害排序）

1. **上下文运行时名义与行为不符**：单命名空间注册器、每回合重建的“跨轮缓存”、只写不读的 assembler 状态和无消费者的 `context_profile` 增加修改成本。
2. **策略身份仍有算法盲区**：`context_policy_version` 覆盖预算常量与结构标记，但只改装配算法可能身份不变。
3. **回合级上下文不可归因**：`ledger` 有各段 token 与取舍计数，但不进库；版本页只能比较记录级策略身份。
4. **调用日志无法按版本聚合**：`llm_call_logs` 存全文，却不能直接按 prompt/context 身份聚合成功率与延迟；全文同时有 PII 与存储成本。
5. **缺少受控发布面**：代码修改能形成新身份，但尚不能在不部署的情况下发布不可变上下文 revision，也不能让任务固定选择实验 arm。

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
| `context_policy_version` | 上下文编译策略 | 当前按预算/结构常量派生；19-C0 改为“显式策略配置 + 编译器 schema”内容身份 | 记录创建 |
| `mapping_version` | 分数映射曲线 | **保持现状**（整数，语义明确） | 评分时（已有） |

派生而非人工递增是刻意的：人工版本号会「忘了改」，hash 不会。文件自带 `version` 的 rubric 例外保留——它已是团队既有约定且被 `rubric_version` 消费。

## 四、身份不落库：派生优先，物化需消费者

**已撤回的形态（2026-09-26）**：最早的 S1 曾把 `prompt_id` 写进 `prompt_snapshot`。撤回理由是两条硬违规：

1. **生产者无消费者**：`prompt_id` 写入后仓内零读取方 —— 与本次会话删除 `TrainingSessionData`、`RecordExtended`、死端点同一标准，属死重。
2. **同行的派生副本**：`prompt_snapshot` 本身已含模板原文（`segments.system/dynamic`），身份 = hash(原文)。把 hash 与原文存在同一行意味着两者可互相漂移，是"同一事实两份真相"。

**修正原则**：身份**按需派生**，不预先存储。

* 记录行里已有模板原文 ⇒ 任意时刻都能重算 `prompt_id`，代价是 O(1) 次 sha256（约 4KB 文本）。
* 只有出现**真实消费者**（跨版本聚合查询、索引需求）时，才把身份**物化**为列；物化是为索引服务的缓存，不是事实来源，并且必须带一条「物化值 == 派生值」的一致性测试。
* 当前已有按需派生消费者；没有索引/性能需求就不建物化列，避免把 hash 与原文存成两份事实。

```text
V1 前（无消费者）：
  prompt_snapshot  ──(按需 derive)──▶  prompt_id

若未来查询成本证明需要物化：
  prompt_snapshot  ──(写入时物化)──▶  training_records.prompt_id  + 一致性测试
```

### 历史上已批准、且不需要新存储的改动

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

## 五、产品化：只读归因与后续受控写面

### 5.1 定位

现有产品面继续是**只读目录 + 归因视图**。U0 前不提供在线编辑：提示词与装配策略仍同代码、守卫和槽位契约耦合。
U0 后若进入 19-E1，写面必须是独立的草稿/校验/发布流程，只能新增不可变 revision；版本页继续读取训练记录的
冻结事实，不编辑历史快照，不把“当前 revision”反向覆盖到已开始训练。

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

### 5.5 原只读 API 设想

```text
GET /admin/versions/prompts            → 产物目录（含使用量）
GET /admin/versions/prompts/{id}       → 单产物详情（原文 + 使用记录）
GET /admin/versions/context            → 策略版本 + 常量表 + 使用量
GET /admin/versions/attribution        → 按身份分组的聚合指标（分组维度可选）
GET /admin/training-records/{id}/context → 单记录逐轮 ledger（供调试页）
```

当前只实施 `/admin/versions/attribution`；其余端点随原 P5/P6 取消为独立路线。现有版本管理面无写端点；
19-E1 若启动，写面属于不可变 revision 发布，不复用只读归因端点做 CRUD。

## 六、原落地切片状态

以下表格记录本设计的历史交付。P0–P2 与 V1 已实施；原 P3–P6 已被 19-C0/E1 取代，不再是当前待办。

| 切片 | 内容 | 状态 |
|---|---|---|
| P0 | 修复 SCR-7：存量记录补写快照时只补缺失字段，不覆盖冻结 `prompt_snapshot` | 已实施 |
| P1 | `scores.prompt_version` → `prompt_schema_version`，同步模型/API/快照/测试 | 已实施 |
| P2 | 对话管线五阶段收敛为显式函数，删除单实现中间件包装 | 已实施 |
| V1 | 按需派生身份 + `/admin/versions/attribution` + 管理页版本归因 | 已实施 |
| 原 P3/P4 | ledger 持久化、调用日志身份列、`prompt_id` 物化 | 取消为独立路线；19-C0 按真实消费者决定接入或删除 |
| 原 P5/P6 | 产物目录、逐轮 ledger 与记录调试页 | 取消为独立路线；没有真实消费需求不建设 |

**V1 的关键取舍**：归因产品先用既有冻结快照与分数行字段现算身份，零新存储、零新写入者。
`unknown` 桶如实表示历史记录不可追溯，不回填。记录级 `context_policy_version` 已进入版本归因；
回合级 ledger 仍无持久消费者，按 19-C0 二选一处理，不再预设必须落库。

## 七、C0 / U0 明确不做

- 不在现有上下文层次上直接重建可变 `prompt_templates`；
- 不做请求级提示词覆盖、进行中会话换版或全局当前值热改；
- 不做每次开始重新随机、多臂老虎机、自动胜者与在线调参；
- 不对**渲染结果**求 hash 作为 `prompt_id`（病例数据会污染身份）；
- **不把身份预先写进 `prompt_snapshot`**（已撤回，见 §四）；
- 不在 `llm_call_logs` 里再存一份 ledger 或原文（避免双份 PII / 体积）；
- 不人工维护版本递增号；内容身份仍按已发布原文派生；
- 不因版本差异改变评分或展示行为（身份仅用于观测与归因）。

19-E1 若启动，只增加不可变 revision、作业钉住、固定 arm 与可审计导出；不推翻以上运行期边界。

## 八、风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| 身份漂移 | 有人改了提示词却绕过计算点 | 派生点唯一（消费处一处）；物化后加「物化 == 派生」一致性测试 |
| 历史不可知 | 存量记录无身份可派生（快照缺失） | 明确不回填；UI 显示「未知（历史记录）」 |
| 聚合查询成本 | 全表 `GROUP BY` | 物化列 + 索引；聚合限定时间窗（默认 90 天） |
| ledger 体积 | 每轮一条审计行 | ledger 是有界计数与短枚举，非全文 |
| 改名破坏契约 | `prompt_schema_version` 影响 API/前端/强制重评快照 | 一次迁移内完成 + `api:update` + 前端类型再生 |

## 九、已裁决与仍开放

已裁决（2026-09-27）：

1. **`Score.prompt_version` 改名** 为 `prompt_schema_version`（语义干净优先，已实施）。
2. **页面权限复用 `api_manage`**，不新增 `version_view`。
3. **U0 不做实验性提示词覆盖**；后续实验只能引用已发布的不可变上下文 revision。
4. **身份不预先落库**：派生优先；只有真实消费者出现才物化，且物化必须可被派生值验证。
5. **进行中记录永不热更新**：热发布只改变新任务/新训练可选的 revision。

仍开放：

1. **回合级 metrics 是否值得持久化**：19-C0 先确认真实实验/运维消费者；没有消费者就删除 ledger 的未接线接口，有消费者才选择不可变审计存储。
2. **`prompt_id` 是否需要物化**：先量版本归因查询成本；当前按需派生足够时不加列、不加索引。

## 十、当前验收分流

1. C0：患者上下文只有一个显式编译入口；无单命名空间注册器、伪跨轮缓存、只写不读状态和身份盲区。
2. C0：新训练继续冻结患者 prompt 原文和上下文策略身份；旧记录缺失身份时显示未知，不伪造回填。
3. E1：草稿必须通过变量契约与预览才能发布；发布产生不可变 revision。
4. E1：作业发布时固定受众与 arm；重试沿用同一 arm，进行中训练永不换版。
5. E1：导出能按 batch/arm 关联训练、问卷、技术失败与可比评分来源，应用内不自动判胜。
6. LLM 调用身份与逐轮 metrics 只有出现真实消费者后才成为验收项，不预先建设。
