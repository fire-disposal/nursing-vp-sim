# 15 — 训练实现契约

> 更新：2026-09-27。本文保留当前训练的身份、状态、提交与装配边界，不维护产品路线。
> 下一批次见 [19](19-training-experience-next-generation-plan.md)；临床推理去向见 [18](18-clinical-reasoning-disposition.md)；架构约束见 [16](16-v2-maintainable-monolith-objectives.md)；命名见 [17](17-training-identity-and-state-contract.md)。
> 原插件接口伪代码、未来 catalog/authoring 平台、迁移待办、发布切片和临床学生端路线已删除。历史设计可从 Git 回溯，不能作为当前实现依据。

## 一、当前正式训练边界

正式可开始的 workflow 为 `history_taking`：患者对话、病例配置的床旁活动、护理评估提交、异步评分、学生复盘与教师复核。历史 W0–W6 已交付；当前 [19](19-training-experience-next-generation-plan.md) 先收敛上下文运行时，再打磨患者自然度、任务理解与 U0 固定候选。

`clinical_reasoning` 仅作者面就绪、`runtime_ready=False`。独立 `/api/simulations` 实验模块不是这条正式训练的运行时。二者均不因代码存在而获得自动产品化承诺。

## 二、Workflow 判别的唯一来源

| 事实 | owner |
|---|---|
| 病例声明哪条 workflow | `CaseRevision.content["workflow"]`，由病例发布与校验管理 |
| 已开始训练所属 workflow | `training_records.workflow_id`，创建时从钉住的 revision 解析并冻结 |
| 注册与解析、可开始判定 | `backend/modules/training/workflows.py` |
| 运行时读取 | `workflow_for_record(record)`，不得由当前可编辑病例或客户端推定 |
| 前端工作区 | `TrainingEntry` 从记录 manifest 的 workflow 选择已注册 scene；无对应 renderer 不能静默回落 |

开始请求不能选择 workflow。未知声明拒绝；不可开始的 workflow 不能创建空训练记录。只有一条可开始 workflow 时，旧病例缺省声明可按现行解析规则处理；不可开始的 `clinical_reasoning` 必须显式声明。将来若正式增加可开始类型，必须另行处理缺省声明的歧义，不能修改旧不可变 revision 伪造历史。

## 三、Activity 与正式产物

- 病例配置的活动受 workflow 白名单与运行状态约束，由服务端统一解析，不由前端按钮自行决定能力。
- `physical_exam` 的结果通过工具命令产生；`nursing_record` 的正式提交由既有护理评估 owner 管理。
- `quiz`、`nursing_diagnosis` 有存量实现，但不得因为有面板/工具就宣称已经成为完整可评产物。护理诊断尚有运行态旁路；C0/U0 不触及该边界，未来只有真实任务需要时才收敛。
- 正式评分使用对话、已记录动作及已提交评估等可回溯证据。运行态中的草稿不能冒充已提交正式产物。

## 四、Manifest 与前端投影

服务端 `backend/modules/training/manifest.py` 汇总 workflow、病例声明与会话状态，向记录详情提供：

- `workflow`：身份与标签；
- `activities[].availability`：活动可用性及原因；
- `artifacts`：正式产物要求与状态；
- `completion`：能否完成、条件与阻塞原因；
- `actions`：可执行操作及其可用状态。

前端 `engine/manifest.ts` 及工作区组件消费该结果；前端可以显示或组织信息，不能自行建立另一套“完成条件”和活动开关。恢复、刷新和新进入工作区都应以服务端记录为准。

本文不再要求建设没有实际消费者的通用 catalog/authoring 投影接口；新增字段须由 19 中的真实学生路径、上下文收敛或 U0 后受控实验路径驱动。

## 五、动作、草稿、提交与完成

1. 工具写操作走 HTTP 命令面 `POST /api/training/{id}/tools`；对话走 SSE；WS 只负责服务端推送，不是第二条写入通道。
2. 工具动作通过 `expected_revision` 与幂等请求标识处理并发；动作与结果由 `TrainingAction` 留痕，不以客户端定时器宣布保存成功。
3. 护理评估区分草稿与已提交状态。正常交卷路径提交评估与完成训练保持事务一致，门禁由服务端完成政策决定。
4. 评分异步执行，成功/失败/待处理状态必须可查。刷新状态不等于重新评分，进度未知不能造百分比；现行轮询、重试和终态展示已按历史 W1 收敛。
5. 超时等系统终局与正常交卷必须区分。终态持久化与草稿证据边界已有回归；新增终局分支仍必须按同一契约验证。
6. 终态写入顺序：`runtime_state` 的写入会重读整行（`autoflush=False`），因此 `finalize_training` 必须先写 `runtime_state`、再写 `status`/`end_time`；`patch_runtime_state` 自身也已改为先 flush（见 [17](17-training-identity-and-state-contract.md) §2.4）。终态持久化有回归用例（`tests/training/test_finalize_terminal_persisted.py`）。

## 六、病例修订与训练快照

- `CaseRevision` 为已发布病例内容的不可变修订；改变已发布内容产生新 revision，不在原行改写。
- 训练记录钉住 `case_revision_id`，冻结病例、rubric 与患者 prompt。当前病例后续修改不能改变既有训练的含义。
- `practice_snapshot` 是创建期配置；`runtime_state` 是运行态，不因名字中有 snapshot 就混淆用途。
- 快照补写只能补缺失字段，不能覆盖已有值。补写不证明缺失的历史内容已被真实还原。
- 历史评分规则身份与量尺不一致见 [05](05-llm-design.md) 与 [校准工作区](calibration/README.md)；患者 prompt 快照不是评分 prompt 的完整身份。

## 七、班级、成员、作业与受众

`ClassMembership` 表达成员关系；作业复用 `Assignment` 与受众快照 `AssignmentRecipient`，训练读取作业钉住的病例 revision。不得为新练习方式复制班级、作业或受众体系。

开始训练继续遵守权限、受众、次数、病例状态与可开始门禁。同例重练与迁移变式已实现并保留来源留痕；自由练习不计入作业成绩，也不能借新入口绕过次数限制。

## 八、上下文装配与事实归属

患者消息由唯一纯入口 `backend/modules/training/context/compiler.py::compile_patient_prompt` 编译：
槽位校验 / 选择 / 排序 / 裁剪 / 预算 / 落位都在那里，本中间件只取料。策略数值（历史与患者状态预算、
保底轮、钉轮）的唯一 owner 是 `context/budget.py::ContextPolicy`。

身份归属要分清：**模板原文**变化（如改写患者契约）自动体现为 `prompt_id`（由冻结原文派生）；
**装配算法/布局**变化不属于任何字段，必须在同一提交里升 `compiler.COMPILER_SCHEMA`，否则
`prompt_identity.compute_context_policy_version` 不会变化。

活动提供其拥有的事实，不直接拼第二份 system prompt，不创建通用 Context God Object。病例事实、学生可见信息、
患者应知信息和评分依据的消费范围不同。现有病例蓝图已沿这些边界接入；参考答案与评分锚点不能进入学生可见的
患者对话。

## 九、评分、复核与展示

- 原始分、展示分、教师复核、降级与等第不是同一个事实。当前机制见 [05](05-llm-design.md)，字段语义见 [17](17-training-identity-and-state-contract.md)。
- 当前 `grade_scope` 统一复核分优先与排除降级分；颜色或百分制不会自动证明能力等第有效。
- 锚点、原始量尺与证据引用已在历史 W4 落地：评分输入逐条送达行为锚点与本次任务边界；逐项原始分/上限/状态/证据引用写入 `scores.raw_detail_scores`（`detail_scores` 只作展示投影）；反馈允许为空并说明原因；`scores.score_meta` 记录适用分母与规则身份。
- 等第只由服务端版本化政策给出（`scoring/grade_policy.py`）：数值分层是描述，能力等第在教师校准完成前**恒为空**；学生页、教师页、导出与统计共同消费。
- 教师复核编辑**原始条目**（不再从取整后的展示项反推）；不改条目提交时总分不变（回归用例 `tests/scoring/test_score_contract.py`）。历史记录无原始层时按展示层反推并标注基准来源。
- 教师意见已在学生结果页显示并区分 AI 初评/教师复核来源；后续修改不得只改变数字而丢失复核意见。

## 十、维护边界

只为真实消费路径修改现有 owner。未知或不支持的能力显式拒绝，不静默回退成问诊；不引入动态插件、通用 DSL 或第二套状态/评分系统。生成 API 类型通过仓库命令更新，不手改生成文件。

## 十六、`clinical_reasoning` 作者面契约

保留本节编号供既有代码注释引用；它不是临床推理的“下一步”。

- 登记位置为 `training/profile.py` 与 `training/workflows.py`；当前不挂活动、不声明患者 prompt、无可运行评分 rubric，`runtime_ready=False`。
- 病例作者面六类内容为 `scenario`、`findings`、`initial`、`progression`、`objectives`、`rubric`；结构由 `schemas/case_schema.py` 的 `Clinical*` 模型定义，语义由 `modules/cases/validator.py` 校验。
- 发布门禁检查证据可达性、引用完整性与目标/评分锚点覆盖等。这只证明声明通过校验，不证明患者、状态机、评分已消费这些声明。
- 教师病例库可管理这类病例；学生目录由服务端过滤不可开始的 workflow，不存在临床病例禁用卡。作业仍可能引用它，此时直接开始被可开始门禁拒绝；盲盒池排除该类病例。
- 不迁移独立模拟器病例，不翻转 runtime_ready，不新增学生工作区。资产保留、引用处置及重启门槛统一见 [18](18-clinical-reasoning-disposition.md)。
