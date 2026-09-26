# 17 — 训练域身份与状态概念契约

> 目的：把「这是哪一份东西」「这能改吗」「这个数字是什么」三件事从**靠上下文猜**变成**看名字就知道**。
> 本文是训练域命名的唯一权威；新增字段前先在这里归类。相关：`docs/15`（Workflow/Activity 协约）、`docs/16`（2.0 架构约束）、`docs/ideas/prompt-context-versioning.md`（身份产品化设计）。

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
| 分数映射曲线 | `scores.mapping_version`（0=旧口径 / 1=现行线性） | 分数怎么换算成展示分 | `scoring/mapping.py` | 评分时 | 不可变 |
| 提示词原文 | `training_records.prompt_snapshot` | 本次训练的患者提示词原文（含形状键） | `_create_record` | 训练开始 | **不可变（冻结）** |
| 评分标准原文 | `training_records.rubric_snapshot` | 本次训练的评分标准 | `_create_record` | 训练开始 | **不可变（冻结）** |
| 病例内容原文 | `training_records.case_snapshot` | 本次训练的病例内容 | `_create_record` | 训练开始 | **不可变（冻结）** |
| 提示词内容身份 | **暂无**（设计见 ideas/prompt-context-versioning） | hash(模板原文) | — | — | 消费者出现才物化 |

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

### 2.5 分数口径

| 字段 | 含义 |
|---|---|
| `scores.raw_total` | Σ条目原始分（0..raw_max）；NULL = 旧口径历史分（不可逆） |
| `scores.total_score` | 映射后的展示分（0-100） |
| `scores.reviewed_total` | 教师复核写回分 |
| `scores.dim_total` | LLM 维度自评快照（展示用，不参与总分） |
| `scores.effective_total`（属性，非列） | 成绩口径 = `COALESCE(reviewed_total, total_score)` |
| `scores.fallback` | 兜底/降级标记（非 NULL 时必须 UI 呈现且不进排行榜） |
| `scores.mapping_version` | 见 §2.1 |

## 三、已发现的冲突与处置

| # | 冲突 | 处置 | 状态 |
|---|---|---|---|
| 1 | `prompt_version` 存形状版本（1/2）却读作内容版本（PIP-8） | 改名 `prompt_schema_version` | **已批准，待执行** |
| 2 | `revision` 二义（记录并发号 vs 病例内容修订） | **保留名字**：改动面覆盖 DB 列 + API + 前端 + 迁移，收益仅为可读性；改为在两处加显式注释 + 本文锚点，并**禁止**新代码引入第三种含义 | **决定：不改名** |
| 3 | `prompt_snapshot.purpose` 恒为 `"patient_chat"`，零信息（真正区分产物的是 `workflow_id`） | 删除写入键 + `read_prompt_snapshot` 的 `purpose` 字段 + 相关测试断言 | **待执行** |
| 4 | `practice_snapshot` 名为 snapshot 却在创建期被二次写 | 文档化契约（§2.4）；不改名（无功能收益，改动面大） | **决定：仅文档化** |
| 5 | `runtime_state` 混装 6 个 owner 的键，含评分关注点 `force_rescore_snapshot` | 按 §2.4 登记 owner；不迁移存储；新增键必须先登记 | **决定：登记制** |
| 6 | 身份与「版本」混用，导致 `Score.prompt_version` 这类误名 | 命名规则见 §二各表的"规则"行 | **生效** |
| 7 | 存量记录补写快照时会覆盖已冻结的 `prompt_snapshot`（SCR-7：`if not A or not B` 但块内无条件写两者） | 拆成"只补缺失字段"的独立判定 | **待执行** |
| 8 | 已撤回：把 `prompt_id` 写进 `prompt_snapshot`（生产者无消费者 + 同行派生副本） | 见 `docs/ideas/prompt-context-versioning.md §四`：身份**派生优先**，消费者出现才物化 | **已撤回** |

## 四、命名规则（今后强制）

1. **内容身份**：`<artifact>_id`（hash 或 `{id}@{version}`）；只有存在人工版本号时才用 `<artifact>_version`（rubric 是唯一现例）。
2. **形状版本**：`schema_version` / `<payload>_schema_version`。形状不是内容。
3. **并发号**：`revision`，仅此一义。
4. **病例内容修订**：`case_revision` / `revision_no`（在 `CaseRevision` 语境内）。
5. **部署版本**：`APP_VERSION`。
6. **禁止**：用 `*_version` 指代"内容第几版"（除非真的是人工维护的版本号）；同一概念造第二个近义名。
7. **冻结 vs 运行态**：名字里带 `snapshot` 的列＝写入一次永不改；运行态一律叫 `runtime_state` 或 `*_state`，其键必须在 `session/state.py` 登记 owner。

## 五、执行清单

| 项 | 内容 | 依赖 |
|---|---|---|
| C1 | `scores.prompt_version` → `prompt_schema_version`（迁移 + 模型 + schema + `SCORE_SNAPSHOT_FIELDS` + 测试 + `api:update`） | 无 |
| C2 | 删除 `prompt_snapshot.purpose`（写入端 2 处 + `snapshot_compat` 字段 + 测试） | 无 |
| C3 | 修 SCR-7：快照补写只补缺失字段；抽成可单测的纯函数 | 无 |
| C4 | 在 `training_records.revision` 与 `CaseRevision.revision_no` 两处加注释指向本文 §2.2/§三#2 | 无 |
| C5 | 身份物化（`prompt_id` 等）**暂缓**：先落地 `docs/ideas/prompt-context-versioning.md` 的 P5 聚合查询，量出是否需要物化列 | 管线收敛 P2 |
