# 17 — 训练域身份与状态概念契约

> 目的：把「这是哪一份东西」「这能改吗」「这个数字是什么」三件事从**靠上下文猜**变成**看名字就知道**。
> 本文是训练域命名权威；新增字段前先在这里归类。当前实现边界见 [15](15-workflow-activity-contract.md)，架构约束见 [16](16-v2-maintainable-monolith-objectives.md)，训练与评分校准实施计划见 [19](19-training-experience-next-generation-plan.md)。旧 C1–C5 实施清单已删除，不再维护平行路线。

## 一、为什么要这份文档

实测到的三类症状（均有代码证据）：

| 症状 | 证据 |
|---|---|
| **一个词五种含义**：`version` 同时指形状、内容标识、映射曲线、病例修订、并发号，外加部署版本与迁移链 | `schema_version` 18 处、`mapping_version` 17 处、`rubric_version` 9 处、`prompt_version` 6 处、`CaseRevision` 16 处、`APP_VERSION` 7 处、`expected_revision` 5 处 |
| **同一个词两个维度**：`revision` 在 `router/session.py` 指**病例内容修订**，在 `router/tools.py` / `session_views.py` 指**乐观并发号** | `session.py:361 require_current_revision` ↔ `tools.py:44 revision: int \| None = Field(... "上次已知 revision")` |
| **名叫 snapshot 却可变 / 运行态混装** | `practice_snapshot` 创建后被二次补写 `resolved_features`；`runtime_state` 同时承载 `exam_results`、`message_correction`、`nursing_diagnoses`、`paused_seconds`、`scene`、以及**评分关注点** `force_rescore_snapshot` |

代价：读代码必须回查写入点才能判断可变性；改名/迁移时无法判断影响面；新增字段时倾向再造一个近义名字（`prompt_id`/`prompt_hash`/`prompt_rev` 三选一），把混浊度继续抬高。

## 二、概念清单（权威表）

### 2.1 身份：这是哪一份东西

| 概念 | 名字（当前） | 含义 | owner | 何时定 | 可变 |
|---|---|---|---|---|---|
| 病例内容修订 | `CaseRevision`（`revision_no`、`case_revisions.case_revision_no`） | 病例内容第几版 | `modules/cases/revisions.py` | 发布时递增 | 不可变（只追加） |
| 记录钉住的病例修订 | `training_records.case_revision_id` | 本次训练用哪一版病例 | `_create_record` | 训练开始 | 不可变 |
| 评分标准内容标识 | `scores.rubric_version` = `"{id}@{version}"` | 哪个 rubric（文件自带 `version`） | `rubric_loader.get_rubric_version_id` | 评分时 | 不可变 |
| 展示映射口径 | `scores.mapping_version`（0=旧口径 / 1=现行线性） | 展示分换算标记，不是能力等第政策或量尺可比性证明 | `scoring/mapping.py` | 评分时 | 不可变 |
| 提示词原文 | `training_records.prompt_snapshot` | 本次训练的患者提示词原文（含形状键） | `_create_record` | 训练开始 | **不可变（冻结）** |
| 评分标准原文 | `training_records.rubric_snapshot` | 本次训练的评分标准 | `_create_record` | 训练开始 | **不可变（冻结）** |
| 病例内容原文 | `training_records.case_snapshot` | 本次训练的病例内容 | `_create_record` | 训练开始 | **不可变（冻结）** |
| 提示词内容身份 | 由 `modules/training/prompt_identity.py` 按需派生 | 内容身份与快照形状分开；患者 prompt 身份不等于评分 prompt 身份 | 训练域 | 查询/使用时 | 消费者需要历史关联时再持久化 |

**规则**：内容身份一律 `<artifact>_id` 或 `<artifact>_version`（当且仅当它有**人工维护的版本号**，如 rubric 的 `version`）。身份字段只读、可空、不参与业务判定。

### 2.2 并发与序列：这不是「版本」

| 概念 | 名字 | 含义 | owner | 可变 |
|---|---|---|---|---|
| 乐观并发号 | `training_records.revision`；API 字段 `revision`；manifest `session.revision` | 工具/变更操作原子自增；旧值请求 409 | `tools/service.py`（行锁 + CAS） | 每次写操作 +1 |
| 幂等键 | `TrainingAction.request_id`（唯一键 `(record_id, request_id)`） | 同一动作重放不重复落地 | `tools/service.py`、`chat.py` | 不可变 |
| 部署产物版本 | `APP_VERSION`；`feedback.version`（用户提交时的 APP 版本） | 哪次发布 | 构建期注入 | 不可变 |
| 迁移链 | alembic `revision` / `down_revision` | 迁移顺序 | 迁移文件 | 不可变 |

**规则**：`revision` **只**表示乐观并发号（见 §四 决策 2）。描述病例内容时一律写 `case_revision`。

### 2.3 形状：payload 长什么样

| 概念 | 名字 | 含义 |
|---|---|---|
| 快照形状版本 | `prompt_snapshot.schema_version`（1=扁平 `/system`+`/dynamic`，2=`segments.system`+`segments.dynamic`） | 读者据此选解析分支 |
| 分数行的形状版本 | `scores.prompt_schema_version`（**原 `prompt_version`，已改名**） | 该分数对应的快照形状，**不是**提示词内容版本 |
| 迁移链版本 | alembic `revision` | 与业务无关 |

**规则**：形状版本一律命名 `schema_version`（或 `<payload>_schema_version`）。**形状不是内容**：形状升级不意味着提示词变了，内容变化也不一定改形状。

### 2.4 冻结快照 vs 运行态

| 列 | 类别 | 写入时机 | 可变性 | owner |
|---|---|---|---|---|
| `case_snapshot` | **冻结** | 训练开始 | 永不改 | 训练域 |
| `rubric_snapshot` | **冻结** | 训练开始 | 永不改 | 训练域 |
| `prompt_snapshot` | **冻结** | 训练开始 | 永不改 | 训练域 |
| `practice_snapshot` | **创建期配置**（名字有误导） | 训练开始，且创建流程内二次补写 `features` | 创建期可写，之后只读 | 训练域 |
| `runtime_state` | **运行态草稿箱** | 会话中进行 | 随时可改 | 见下 |

`runtime_state` 的**键 owner 表的权威在 `modules/training/session/state.py`**（含 `exam_results`、`quiz_answers`、`nursing_diagnoses`、`scene`、`message_correction`、`patient_walkout`/`terminal`、`force_rescore_snapshot`、`paused_*`），本文**不复制**该表——复制会立刻产生第二份真相。

本文只记录该表暴露出的**跨域摩擦点**：`force_rescore_snapshot` 的 owner 是**评分**（`scoring/runner.py`），却存放在记录的运行态里；写入走 `patch_runtime_state` 的唯一写契约，因此没有并发覆盖风险，但"评分的暂存区在训练运行态"是概念上的借用，新增类似跨域暂存需在本文登记理由。

**规则**：冻结快照永不回写（SCR-7 曾是反例，见 §三 决策 7）。运行态每个键必须有且仅有一个 owner，新增键先在 `state.py` 登记。

**写入顺序（2026-09-27 补）**：`patch_runtime_state` 用 `populate_existing` 重读整行，而生产
`SessionLocal` 是 `autoflush=False` —— 它会把调用方在同一事务里**尚未 flush 的列改动**按库中旧值
覆盖。因此该函数现在**先 `db.flush()` 再重读**，写入顺序不再决定成败（此前 `finalize_training`
先设 `status` 再写 `territory… runtime_state`，导致「训练完成」只存在于响应体里，记录永远卡在
`in_progress`）。新增同类"重读后合并"的写入器必须遵守同一契约。

### 2.5 分数口径

| 字段 | 含义 |
|---|---|
| `scores.raw_total` | Σ条目原始分（0..raw_max）；NULL = 旧口径历史分（不可逆） |
| `scores.detail_scores` | **展示投影**（0-100 刻度；维度上限之和 ≈ 100），既有消费方沿用 |
| `scores.raw_detail_scores` | **原始刻度**的逐项评分（0-`raw_scale`，含条目状态与证据引用）；NULL = 本批次之前的历史分，无原始精度 |
| `scores.score_meta` | 评分溯源快照：适用原始满分、`not_applicable_items`、rubric 内容身份、评分/反馈提示词内容身份、等第政策身份、辅助条件、空反馈说明；NULL = 身份不明 |
| `scores.total_score` | 映射后的展示分（0-100） |
| `scores.reviewed_total` | 教师复核写回分 |
| `scores.dim_total` | LLM 维度自评快照（展示用，不参与总分） |
| `scores.effective_total`（属性，非列） | 成绩口径 = `COALESCE(reviewed_total, total_score)`；来源由 `grade_policy.score_source()` 给出（`ai`/`review`/`fallback`） |
| `scores.fallback` | 兜底/降级标记（非 NULL 时必须 UI 呈现且不进排行榜） |
| `scores.mapping_version` | 见 §2.1 |

**校准边界**：部署历史中相同 `rubric_version` 对应多种原始满分和单项刻度，不能把该字符串当作可比性证明。原始条目、展示换算、能力等第政策必须分开；未来等第政策身份不得复用 `mapping_version` 或 `prompt_schema_version`。新增字段与历史解释按 [19 第四节](19-training-experience-next-generation-plan.md#四评分重构方向先定义证据意义再定义等第)，本次没有新增模型或修改旧成绩。

## 三、已发现的冲突与处置

| # | 冲突 | 处置 | 状态 |
|---|---|---|---|
| 1 | `prompt_version` 存形状版本却读作内容版本（PIP-8） | 当前模型与评分快照字段已使用 `prompt_schema_version` | **已落地，不再列待办** |
| 2 | `revision` 二义（记录并发号 vs 病例内容修订） | **保留名字**：改动面覆盖 DB 列 + API + 前端 + 迁移，收益仅为可读性；改为在两处加显式注释 + 本文锚点，并**禁止**新代码引入第三种含义 | **决定：不改名** |
| 3 | `prompt_snapshot.purpose` 曾是恒定冗余键 | 当前 `PromptSnapshot` 读取器只保留形状版本与 system/dynamic；现行补写结构不含 purpose | **不再列旧删除清单** |
| 4 | `practice_snapshot` 名为 snapshot 却在创建期被二次写 | 文档化契约（§2.4）；不改名（无功能收益，改动面大） | **决定：仅文档化** |
| 5 | `runtime_state` 混装 6 个 owner 的键，含评分关注点 `force_rescore_snapshot` | 按 §2.4 登记 owner；不迁移存储；新增键必须先登记 | **决定：登记制** |
| 6 | 身份与「版本」混用，导致 `Score.prompt_version` 这类误名 | 命名规则见 §二各表的"规则"行 | **生效** |
| 7 | 补写时覆盖已冻结快照（SCR-7） | `runner.missing_snapshot_updates` 已逐字段仅补缺失；补写不代表真实历史已恢复 | **已落地，不再列待办** |
| 8 | 已撤回：把 `prompt_id` 写进 `prompt_snapshot`（生产者无消费者 + 同行派生副本） | 见 `docs/ideas/prompt-context-versioning.md §四`：身份**派生优先**，消费者出现才物化 | **已撤回** |

## 四、命名规则（今后强制）

1. **内容身份**：`<artifact>_id`（hash 或 `{id}@{version}`）；只有存在人工版本号时才用 `<artifact>_version`（rubric 是唯一现例）。
2. **形状版本**：`schema_version` / `<payload>_schema_version`。形状不是内容。
3. **并发号**：`revision`，仅此一义。
4. **病例内容修订**：`case_revision` / `revision_no`（在 `CaseRevision` 语境内）。
5. **部署版本**：`APP_VERSION`。
6. **禁止**：用 `*_version` 指代"内容第几版"（除非真的是人工维护的版本号）；同一概念造第二个近义名。
7. **冻结 vs 运行态**：名字里带 `snapshot` 的列＝写入一次永不改；运行态一律叫 `runtime_state` 或 `*_state`，其键必须在 `session/state.py` 登记 owner。

## 五、变更准入

新增事实先区分：内容身份、形状、并发、显示投影，还是正式业务结果；复用既有 owner，不造同义字段。

需要持久化时说明真实消费方、冻结时机、缺失历史如何解释及所有 API/统计/导出消费方的切换。没有原始证据的历史记录保持明确缺失，不用新规则补成“当时就是如此”。

下一批次只按 [19](19-training-experience-next-generation-plan.md) 推进；本文件不再安排字段迁移或独立发布切片。
