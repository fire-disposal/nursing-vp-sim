# 18 — 临床推理（`clinical_reasoning` / `/api/simulations`）去向与冻结裁定

> 状态：**裁定文档**（2026-09-27）。本文只做**文档裁定**：不删代码、不迁数据、不改路由/鉴权/配置，不提交、不发布。
> 权威关系：
> - 正式训练体验的**唯一当前计划**是 [`docs/19`](19-training-experience-next-generation-plan.md)；
> - 持久架构约束（可维护单体的「不做什么」）见 [`docs/16`](16-v2-maintainable-monolith-objectives.md)；
> - 已落地的 Workflow/Activity 与 `clinical_reasoning` 作者面契约见 [`docs/15`](15-workflow-activity-contract.md) §二、§十六；
> - 身份/形状/并发/快照命名见 [`docs/17`](17-training-identity-and-state-contract.md)。
> 本文与 15/16 冲突时，以 16 的架构约束与本文的临床裁定为准。

---

## 一、结论：留什么 / 冻结什么 / 当前可用什么

**一句话**：`clinical_reasoning` 与 `/api/simulations` **整体退出正式训练交付承诺**——不产品化、
不排期、不接入学生训练闭环；现有代码与已保护的后端接口**保留不动**（不是删除，也不是迁移），
仅**冻结功能扩展**。

| 资产 | 去向 | 冻结/保留的确切含义 |
|---|---|---|
| **A. 独立实验面**：`backend/modules/simulations/**`、`frontend/src/simulations/**`、路由 `/simulation` + `/api/simulations` | **保留**（内部实验台） | 不新增功能、不接训练出口（目录/作业/产物/评分/复盘）；继续作为可运行代码存在，可被内部实验使用 |
| **B. 作者面注册与病例契约**：`clinical_reasoning` 在 workflow 注册表 + `Clinical*` 病例 schema + 发布门禁 + 编辑器模板 | **保留但冻结**（`runtime_ready=False`） | 不翻转 `runtime_ready`、不加 Activity/renderer、不加评分/复盘；教师仍可编写/发布/归档这类病例 |
| **C. 病例与作业数据引用**（若某环境存在 `case_revisions.content.workflow == "clinical_reasoning"` 的病例，或被作业引用的 revision） | **只读保留** | 不迁移、不删除、不改不可变 revision；终止使用只由作者显式 `archive`（归档只阻止新使用，不删历史） |

**当前实际可用性（读者结论）**：

- **学生**：正式训练**不能开始**临床推理；学生病例目录在服务端过滤不可开始的 workflow。
  直接或作业开始由产品状态门拒绝；盲盒池排除该类病例，不存在临床病例禁用卡。
- **教师**：可在教师病例库编写、校验、发布、归档 `clinical_reasoning` 病例（带发布门禁与编辑器模板），
  但它**不产出任何学生可用训练**。
- **实验面**：`/simulation` 控制台与 `/api/simulations` 仍可运行；后端接口**已受共享鉴权保护**（见 §2.4）。

**这是文档层面的退役，不是代码层面的删除**：不删模块、不删路由、不迁数据、不改鉴权。

---

## 二、代码资产清单（可对照现有代码核验）

### 2.1 独立实验内核 —— `backend/modules/simulations/**`

| 文件 | 作用 |
|---|---|
| `engine.py` | 确定性回合推进：时间/事件调度（`_schedule`/`_advance`/`_handle_event`）、`_end_case` 终局、`_settlement_verdict` |
| `state.py` | 会话状态形状（`case_status`：`ACTIVE` / `SUCCESS` / `FAILURE`）与序列化 |
| `actions.py` | 学生动作执行与领域副作用（`_do_status`/`_do_assess` 等） |
| `case.py` | **4 个硬编码病例**：`mvpb-1` 腹部术后隐匿性出血、`mvpi-1` 腹部术后腹腔感染、`mvpd-1` 糖尿病酮症酸中毒、`mvph-1` 急性失代偿性心力衰竭（`CASES` 字典） |
| `prompts.py` | 自有患者对话/会诊/诊断点评 prompt（**不共享** `history_taking` 的 prompt 装配） |
| `service.py` / `router.py` | 服务层与 HTTP 入口（`APIRouter(prefix="/api/simulations")`） |
| `backend/models/simulation.py` | 会话持久化（`simulation_sessions` 表） |

特征：这是**独立运行的实验内核**，有自己的阶段/回合模型与结局判定；它**不产出** `Artifact`/`Evidence`，
不进入 completion、正式评分、复盘与教师查询框架。

### 2.2 实验面前端 —— `frontend/src/simulations/**`

`SimulationConsole.tsx`（控制台）、`console.css`、`parser.ts`/`commands.ts`/`completions.ts`（命令与补齐）、
`timeline.ts`（时间线）、`aliases.ts`，以及各自的测试文件。

路由注册（`frontend/src/App.tsx`）：`/simulation` **挂在 `ProtectedRoute` 之外**，即前端页面壳可被匿名加载。

### 2.3 作者面注册与病例契约（冻结保留）

| 资产 | 位置 |
|---|---|
| workflow 登记项 | `backend/modules/training/profile.py::CLINICAL_REASONING`（`runtime_ready=False`：`activities=()`、`prompts=PromptCollection()`、`rubric={}`） |
| 唯一注册表/解析器 | `backend/modules/training/workflows.py`（`REGISTRY`、`require_startable`、`case_is_startable`） |
| 病例 schema | `backend/schemas/case_schema.py` 的 `Clinical*` 模型（`extra="forbid"`） |
| 发布门禁 | `backend/modules/cases/validator.py::_check_clinical_reasoning` |
| 编辑器作者面 | `frontend/src/components/admin/cases/clinicalReasoningTemplate.ts`、`CaseForm.tsx` 的 JSON 视图、`CaseValidationReportView` |

结果：`clinical_reasoning` 病例**可编写/可发布/可归档**，但**不可开始**。自主/作业直接启动受 `workflow_not_startable` 门禁限制，不落地空训练记录；盲盒随机池先排除该类病例，无可用病例时按空池处理。契约见 [15](15-workflow-activity-contract.md) §十六。

### 2.4 已知不一致（记录在案，本次不改）

- `frontend/src/App.tsx` 中 `/simulation` 的注释写「后端 `/api/simulations` 无鉴权」，**与代码不符**：
  后端 `modules/simulations/router.py` 全部端点使用 `CurrentUser`（`core/deps.py` → `core/security.py::get_current_user`），
  接口要求有效 JWT，且会话按 `user.id` 归属（`SimulationService.get_owned`）；这不是匿名实验 API。
- 前端页面壳不在 `ProtectedRoute` 内，`SimulationConsole` 也未处理 401（无登录跳转）——
  匿名访问会加载页面但接口报 401。这属于入口/鉴权暴露面的不一致，**本次只记录**；
  是否收口（把路由移入保护、或改为显式开发环境入口）见 §六。

---

## 三、裁定

1. **冻结扩展**。不再为 `clinical_reasoning` / `/api/simulations` 新增功能、切片或接入口：
   不翻转 `runtime_ready`、不新增 Activity/renderer、不新建学生路由/菜单、不做会诊/阶段链的任何增强。
2. **禁止嵌入 `history_taking`，禁止混分**。
   - 明确禁止：把临床推理当作 `history_taking` 的 Activity/旁路塞进现有工作区；
     用 `runtime_state` 承载临床结论并顺手进入护理评估证据；让两套 rubric 共享维度或互相给分；
     把 `simulations` 的会话状态写进 `TrainingRecord`/`Artifact`。
   - 正式评分使用对话、已记录动作与已提交产物等证据，不把模拟器运行态当成护理评估产物（[15](15-workflow-activity-contract.md) §五）。
3. **允许复用经过验证的思路，不搬引擎**。可以从实验面提炼已被验证的**概念**
   （例如「病例是数据 + 发布前门禁」「确定性判定优先于 LLM 判定」「并发用 `expected_revision` + 幂等键」），
   在 `history_taking` 与 [`docs/19`](19-training-experience-next-generation-plan.md) 的工作包里以**既有契约**实现；
   但**不搬运** `simulations` 的引擎、状态机、prompt 或病例数据。
4. **保留现有实验代码与必要维护，不扩张功能**。本次文档收敛不删除接口或路由；未来删除需明确数据与调用方处置，不由“不再提及”隐含执行。

---

## 四、现存临床病例与作业引用的检查与处置要求

本次**不做任何数据变更**。若在某环境要确认现状，按下列清单只读核查（不修改数据）：

| 检查 | 位置/条件 | 应得结论 |
|---|---|---|
| 是否存在 `clinical_reasoning` 病例 | `cases.status` 与 `case_revisions.content->>'workflow'` | 存在与否都不影响裁定；**禁止**按「没在用」直接删 |
| 是否被作业引用 | `assignments.case_revision_id` → 该 revision 的 `content->>'workflow'` | 有引用即保留该 revision；学生点击得到 409 |
| 是否已发布/开放 | `cases.status='published'` 且 `cases.is_open=true` | 学生目录仍会过滤掉它（`case_is_startable=false`），**不是**可见禁用卡 |
| 是否存在旧作业指向它 | `assignments` + `assignment_recipients` | 受众快照与历史不动 |

处置规则（必须在任何一次清理中遵守）：

1. **禁止盲删数据**。不得因为「功能冻结」就删除病例行、revision、作业或受众快照。
2. **禁止改 immutable revision**。`case_revisions` 是冻结载荷；编辑已发布病例 = 产生新 revision，
   旧训练永远按旧版复盘与评分（[`docs/15`](15-workflow-activity-contract.md) §六）。
3. **退出使用只走 `archive`**。`archived` 只阻止新使用，不删除历史 revision；由病例作者显式执行。
4. **降级/回滚不得创建第二来源**。任何数据回填都必须是单向、显式、可审计的迁移，
   不得让 `case_data` 与 revision 内容再次出现两份真相。

> 注：本仓库 `backend/data/cases/` 的 11 个内置病例**没有**声明 `clinical_reasoning`；
> 生产/其它环境的数据库现状须按上表只读核查，本文不代为断言。

---

## 五、重启门槛与异构成本预算

重启（即真正交付第二条可用的训练闭包）**不是**「把作者面接上运行期」这么小的一步。以下条件**全部**满足才允许重新评估，
缺任何一项都维持冻结：

1. **独立教学目标**：重要能力必须通过“行动及其后果”训练，现有护理评估会话不能充分承载；不是追求“多一条 workflow”，也不要求两类能力毫无重叠。
2. **病例维护者**：有人对临床准确性长期负责（编写、评审、随指南更新），而不是一次性把病例写进去。
3. **评分验证**：该闭包的评分/判据在投入前经过教师校准与效度检查——
   **不得预设现有评分机制有效**，也不得把「提高优秀率」当作目标；
   评分机制的有效性属于独立研究范围（见 [`docs/19`](19-training-experience-next-generation-plan.md) 的评分/反馈工作包）。
4. **教师校准闭环**：复核队列、判例与评分依据能让教师解释「为什么这么给分」。
5. **异构成本预算**（六项都要有人/时间预算，且不能靠复制现有外围来抵账）：

| 成本项 | 内容 | 基础设施复用仍不能消除的工作 |
|---|---|---|
| 作者 | 病例编写 + 门禁 + 模板维护 | 临床判断的内容面与问诊病例不同 |
| 学生 | 阶段链工作区 + 证据获取 + 结构化产物 | 与「对话 + 床旁检查 + 护理评估」不同的交互面 |
| 评分 | 独立 rubric、证据判定与复核 | 独立任务需要独立校准，不能直接搬用护理评估量尺 |
| 教师 | 证据时间线 + 病例管理 + 复核下钻 | 需要按「行动 → 证据 → 判断 → 评分依据」下钻 |
| 校准 | 判例、评分校准、验收阈值登记（单人判定即可） | 一次性评审不等于校准 |
| 维护 | 单人长期维护**第二条闭包**的全部以上内容 | 这是最终决定项：成本落在同一个人身上 |

6. **不复制外围**：不新增第二套发布/受众/评分/复核体系；第三个 workflow 出现时不应再复制一遍外围。

---

## 六、不做什么，以及「可能但未开始」的工作

**本次明确不做**（写下来以便将来对照）：

- 不加学生路由/菜单/renderer，不建训练记录，不接入模拟引擎、证据获取、completion、评分、复盘；
- 不迁移 4 个硬编码病例到 `CaseRevision`，不搬运引擎；
- 不改 `/simulation` 与 `/api/simulations` 的鉴权、路由或配置，不删任何代码/数据；
- 不把本文当成解除 [`docs/16`](16-v2-maintainable-monolith-objectives.md) 架构约束的理由。

**未来可做但当前未开始**（**不声称已开发、也不声称已限定**）：

- 若确认实验面需要与生产用户隔离，可评估「把 `/simulation` 移入受保护路由 / 改为显式开发环境入口 /
  统一 401 处理」——这是一项独立的小工作，需要单独决策与验收，本文不预先限定其做法。
- 若本文 §五 的门槛被真实满足，重启需要一份**独立的教学设计与评分验证计划**，而不是沿用旧切片表。

---

## 七、与其它文档的关系

| 文档 | 关系 |
|---|---|
| [`docs/15`](15-workflow-activity-contract.md) §十六 | 保留 Workflow 判别契约与作者面的**实现事实**；其 Slice 2/3/4 计划已作废，裁定以本文为准 |
| [16](16-v2-maintainable-monolith-objectives.md) §三/§七 | 正式训练边界与变更准入，不再维护临床产品化路线 |
| [`docs/19`](19-training-experience-next-generation-plan.md) | 唯一当前训练实施计划；本文不复述其工作包 |
| [`docs/17`](17-training-identity-and-state-contract.md) | 命名权威；本文不引入新命名 |
