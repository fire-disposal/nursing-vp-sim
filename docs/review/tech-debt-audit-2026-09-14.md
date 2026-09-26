# 技术债合并清单（2026-09-14）

> 本文把 9 份分散的只读审计报告（7 份分域 + 上下文装配 + LLM 调用层）合并为一份仓库内自洽的技术债清单。
> 只做搬运 / 压缩 / 去重：每条判断都能回溯到源报告的 `path:line` 锚点；源报告之间的分歧原样保留并标注。
> **不含「修复状态」列**（哪些已修由维护者后续追加，写死在本文会过期）。
> 编号规则：`CAS-` 病例 · `ASG-` 作业问卷 · `SCR-` 评分 · `PIP-` 训练管线与情绪 · `CTX-` 上下文预算 · `QA-` QA/语音/工具 · `OPS-` 鉴权运维成本 · `FE-` 前端 · `ARCH-` 架构与 CI。`R1–R7` 为上下文核心专项编号。

---

## 方法与范围

**审计基线**：`HEAD = 5eb5e3a0`（2026-09-08）。源报告各自的基线：`mess-training-pipeline` 与 `mess-qa-voice-tools` 显式声明 `5eb5e3a0`；`mess-domain-crud` 对照 2026-08 的 `defect-list.md`；`mess-arch-layering` 声明 master 且工作区干净；`mess-scoring` 标注最近改动 `6f7d6eb0` / `986135b9`；`Agent` 两份 LLM/上下文审计只给 `path:line`（按 `5eb5e3a0` 树行号）。
**合并时工作区不干净**：合并当时 `git status` 有大量未提交修改（并行修复产物，含未跟踪的 `backend/modules/training/patient_ai/emotion/hostility.py`、`scripts/score-health.sql`、`scripts/cost-health.sql`、`docs/review/release-checklist.md`）。本文只描述审计基线时的代码事实，并把这几个未跟踪文件作为「代码事实」记在对应条目里，不推断修复进度。

**覆盖范围**：`backend/{core,models,schemas,modules,infra,migrations,data,scripts,tests}`、`frontend/src`、仓库结构（`backend/` 顶层、`scripts/`、`docs/`、根脚本与 CI/hook）。
**明确未覆盖**：内存/连接生命周期与部署观测加固（源报告标注为「另任务」；存在独立审计 `OpsHardeningAudit`、`BackendLifecycleAudit`、`FrontendLifecycleAudit`、`BackendStateAudit`，本文不合并）；旧版重构计划中的 **Phase 4 生理引擎临床校准**（P1/P2，2026-08-15 决策跳过）与 **defect-list P5/P6**（simulations 产品边界、`asyncio.run` 跨事件循环）本轮无源报告复审，仅在此列出不展开；旧计划文档已在 2.0 收敛时删除，相关文件名只作为历史审计标签保留；运行期/生产数据类问题统一收敛到末节。

**报告来源清单**

| 来源 | 类型 | 说明 |
|---|---|---|
| `local://mess-domain-crud.md` | 分域审计 | 病例/作业/问卷/反馈/simulations + 迁移结构性 |
| `local://mess-scoring.md` | 分域审计 | 评分域（含 scoreboard） |
| `local://mess-training-pipeline.md` | 分域审计 | pipeline / chat / ws / session_views / patient_ai / context / session |
| `local://mess-qa-voice-tools.md` | 分域审计 | QA / voice / infra{asr,tts,volc,llm} / training tools |
| `local://mess-auth-admin-infra.md` | 分域审计 | core/admin/auth/middleware/infra/bootstrap |
| `local://mess-frontend.md` | 分域审计 | frontend/src（含 3 个子扫描的结论） |
| `local://mess-arch-layering.md` | 分域审计 | 目录结构与引用层（CI/hook/docs 对齐） |
| `agent://ContextAssemblyAudit` | LLM/上下文审计 | 上下文装配链、预算、前缀缓存 |
| `agent://LlmClientAudit` | LLM/上下文审计 | 调用层成本/预算/缓存/工具循环 |
| `agent://PatientAbusePath` | 补充来源 | 「辱骂过度容忍」链路缺口（R3 的唯一出处） |
| `agent://NextStepsInventory` | 补充来源 | 旧文档声明 vs 代码实况（用于「旧文档是否已登记」对照） |
| `docs/review/defect-list.md`（S/T/C/P/I/U 系列）、已删除的旧重构计划与 `TODO.md` | 旧文档 | 仅作「已登记」标记的历史判据，不是当前实施入口；当前目标以 `docs/16-v2-maintainable-monolith-objectives.md` 为准 |

**合并规则**
1. 同一问题被多份报告提到 → 合并为一条并标「跨域」。
2. 源报告之间结论相反 / 与本次只读核实不一致 → **两条都写**并标「评审分歧」，同时给出核实到的代码事实。
3. 严重度口径：源报告已标 P0–P3 的沿用；未标的（评分/管线/QA/前端/鉴权/架构域全部未标）按统一口径归级并在条目里注明「本文归级」——**P0** 数据丢失/越权/功能整体失效；**P1** 明确功能性错误或口径不一致；**P2** 一致性脆弱、可观测缺失、双维护；**P3** 死代码与清理。
4. 闭环成本 S（≤半天，单文件级）/ M（1–3 天，跨文件或需迁移/契约决策）/ L（>3 天或需产品决策）。
5. 每条保留源报告的 `path:line`；措辞压缩但不删证据。「闭环步骤」保留可执行动作，删去原报告里的代码块与验收断言细节（需要时回源报告）。

**来源内部瑕疵（供后续读源报告时注意）**：`mess-training-pipeline.md` 的 T4 行引用「见下方 pause/resume 空壳」，但该报告中不存在此小节；`mess-arch-layering.md` 表 1 有一行被截断（不影响其判定）。

---

## 优先级总表（Top 20）

> 选摘规则：按「源报告自身排序 × 严重度 × 闭环成本」取前 20，不新增判断；详细字段见分域清单对应编号。

| # | 域 | 问题 | 严重度 | 闭环成本 | 证据锚点 |
|---|----|------|:---:|:---:|---|
| 1 | 病例 | CAS-1 病例保存静默删除 `tools`（查体/护理记录配置整块丢） | P0 | S | `schemas/case_schema.py:73-113,117-127`；`modules/cases/service.py:143-146,167-170` |
| 2 | 病例 | CAS-2 病例三真相（repo JSON / DB / 校验器）无收敛机制 | P0 | M | `backend/seed.py:150-196`；`modules/cases/service.py:167-178`；`scripts/case-audit.py:19` |
| 3 | 鉴权运维 | OPS-1 LLM 错误计数查永不存在的 `status=="error"`，告警恒 0 | P0 | S | `infra/ops_queries.py:24,41,215-216`；`core/statuses.py:41-46` |
| 4 | 鉴权运维 | OPS-3 登录/注册限流可被 `X-Forwarded-For` 伪造绕过 | P0 | S | `core/rate_limits.py:69-72,79`；`deploy/nginx/iomt.205716.xyz.conf:47-48,64` |
| 5 | 鉴权运维 | OPS-4 有 `user_manage` 的普通管理员可把任意用户提为 `super_admin` | P0 | S | `modules/admin/users.py:160-170,561`；`modules/admin/roles.py:99-102` |
| 6 | 管线情绪 | PIP-1 SSE 断线分支是死代码，`_run` 任务不取消、DB session 先关 | P0 | S | `pipeline/runner.py:63-66,78-88`；`router/chat.py:240-246` |
| 7 | QA工具 | QA-1 引用链路三处断裂（预检索恒空 → 原文 404 → 含 `/` 小节注入错话术） | P0 | M | `modules/qa/router/tools.py:104-121,137`；`router/endpoints.py:264-277`；`knowledge_base/chapter_index.py:130-133` |
| 8 | 管线情绪 | PIP-2 `/end` 会话清理从不落库，且与轨迹图对同一表下相反契约 | P1 | S | `router/scoring.py:464-465`；`session/finalize.py:118-137`；`patient_ai/emotion/repository.py:182-185`；`router/session_views.py:189-233` |
| 9 | 管线情绪 | PIP-12 患者对辱骂/人身攻击过度容忍（无语义事件、无升级行为、评分无维度） | P1 | M | `emotion/events.py:67-83`；`emotion/rules.py:59-64`；`emotion/behavior.py:75-76`；`emotion/renderer.py:26-38` |
| 10 | 评分 | SCR-1 fallback 结果被 postprocess 反杀：兜底分退化成「无分 failed」 | P1 | S | `scoring/engine.py:731-741,516`；`scoring/validation.py:82-93` |
| 11 | 评分 | SCR-2 force 重评失败恢复不闭合（分恢复但 `scoring_status` 仍 failed） | P1 | S | `router/scoring.py:163-165,171-209`；`session/settlement.py:184-197` |
| 12 | 评分 | SCR-3 成绩口径 SQL 手抄 6 处，`fallback` 过滤只落 1 处 | P1 | M | `scoreboard/service.py:159,249,334,368`；`modules/admin/stats.py:72,175-176,183,230,285`；`models/training.py:132-137` |
| 13 | 上下文 | CTX-2 历史裁剪打断前缀缓存（预算饱和后每轮整段 miss） | P1 | M | `modules/training/context/budget.py:22-54` |
| 14 | 上下文 | CTX-1 历史预算硬编 2000 token，与模型窗口无关 | P1 | S | `context/budget.py:12-14` |
| 15 | 上下文 | CTX-16 情绪分析器绕过 `emotion_analysis` profile（超时/JSON mode/重试全失效） | P1 | S | `patient_ai/emotion/analyzer.py:153-154,158-159,165`；`infra/llm/profile.py:86-94` |
| 16 | 鉴权运维 | OPS-2 env 兜底命中即永久粘住，且 `degraded_until` 熔断不可达 | P1 | S | `infra/llm/router.py:128-130,172-187,217-235` |
| 17 | 作业问卷 | ASG-1 作业进度三套推导 + `total_score` 口径漏改（同页两数字） | P1 | M | `assignments/service.py:200-236`；`assignments/router.py:75,86-107`；`training/router/session.py:455-466` |
| 18 | 作业问卷 | ASG-5 问卷提交无幂等/唯一约束 → 重复 completed 行 | P1 | M | `models/questionnaire.py:57-62`；`questionnaires/response_service.py:222-263` |
| 19 | 前端 | FE-1 情绪轨迹图请求路径少一段 `records/` → 整图 404 静默不渲染 | P1 | S | `frontend/src/api/training.ts:104-106`；`training/router/session_views.py:189` |
| 20 | 前端 | FE-3 学生结果页 3 个死按钮（含「重新评分」），U3「已修」结论不成立 | P1 | S | `pages/RecordDetail.tsx:100,121-123`；`pages/record-detail/ScoreResultSection.tsx:120-129`；`ScoringPendingBanner.tsx:66-76` |

---

## 分域清单

### 病例

**CAS-1 · 病例 CRUD 保存时静默删除 `tools`** ｜ P0 ｜ S ｜ 旧文档：未登记 —— **结论**：写路径的校验器是「白名单 dump」而真相字段 `tools` 不在白名单里，验证函数带丢数据的副作用。机制：`CaseDataSchema` 无 `tools` 且 `extra="ignore"`，`strict=True` 时返回 `model_dump()` 被直接落库。影响：教师打开任一内置病例改错别字保存 → 查体工具与护理记录工具从学生端消失（`detect_capabilities` 变 False），体征退回年龄默认值，评分注入的护理记录维度随之变化；`case-audit`/CI 无感。
- 证据：`backend/schemas/case_schema.py:73-113,74,117-127`；`modules/cases/service.py:143-146,167-170`；`frontend/src/components/admin/cases/CaseForm.tsx:93,148`；读取侧 `training/tools/base.py:37-43`、`training/capabilities.py:44-64`、`router/session.py:125-128`、`tools/physical_exam_rules.py:187-189,269-272`；源报告含本机实测（`case1.json` 走 strict 往返后 key 集合无 `tools`）。 ｜ **闭环**：`CaseDataSchema` 增 `tools`；`service.py:143/167` 改 `{**case_data, **validate_case_data(...)}`；补 strict 往返断言测试。 ｜ 旧文档补充：未登记（`defect-list` 无对应项）。

**CAS-2 · 病例三真相无任何收敛机制** ｜ P0 ｜ M ｜ 旧文档：未登记（C1/C2/C4 只覆盖内容与 schema，不覆盖收敛机制） —— **结论**：仓库 JSON、DB `cases.case_data`、校验器/CI 三者各有唯一权威却无版本绑定。机制：`seed._seed_cases` 以 `name` 去重「已存在即永不更新」且不过校验器；data 迁移不触碰 `cases` 内容；update 不回写 JSON；审计只读目录。影响：`defect-list` C1/C2 的补丁到不了已初始化的库，教师一次 UI 保存又让 DB 与 JSON 分叉；AI 生成病例走另一套字段进一步拉大分叉。
- 证据：`backend/seed.py:150-196`；`migrations/versions/data/mrac4bzvuq7d_batch_a_backfill_data.py:25-27`；`modules/cases/service.py:167-178`；`scripts/case-audit.py:19`；`tests/cases/test_seeded_cases_pass_validator.py:8-14`；`modules/cases/prompts.py:87-131`。 ｜ **闭环**：内容指纹（`_source_hash` 或新列）+ `_seed_cases` 改 upsert + 一条 data 迁移拉回老库 + `case-audit --from-db`。

**CAS-3 · 「能力」有两个定义，管理端显示的是永不写入的存储字段** ｜ P1 ｜ S ｜ 旧文档：未登记 —— **结论**：同一响应字段名 `capabilities` 在两端点指向不同真相。机制：学生端由 `tools.*` 派生，教师端读 `cd.get("capabilities", {})`（存储字段），而 `data/cases/*.json` 11 个文件均无该字段、schema 默认 `{}`。影响：教师病例列表能力列恒「—」，学生端卡片却按派生值展示「护理查体/护理记录」。
- 证据：`modules/cases/router.py:52-55` vs `modules/cases/service.py:80`；`schemas/case.py:71`；`frontend/src/components/admin/cases/CaseList.tsx:122,34`；`schemas/case_schema.py:77`；`validator.py:57`（又把该字段列进 LEGACY_FIELDS）。 ｜ **闭环**：`_manage_view` 改 `detect_capabilities(cd)`；`CaseDataSchema` 删 `capabilities`。

**CAS-4 · `validator` 的 legacy 清单与 schema 首类字段互相打脸（`exam_anchors` / `voice_override` 误标）** ｜ P2 ｜ S–M ｜ 旧文档：未登记（跨域：病例 + QA/工具） —— **结论**：校验器声称「已无消费端」的两个字段都有活消费端，而写路径每次 dump 又注入 5 个 legacy 默认值，把审计信号稀释掉。机制：`LEGACY_FIELDS` 漏登记活消费端 + strict dump 注入。影响：照警告删除 `exam_anchors` 会静默关掉查体工具或让异常体征「正常化」（评分与患者 AI 同步失真）；真丢字段（CAS-1）反而查不出来。
- 证据：`modules/cases/validator.py:54,57,281-296`；`schemas/case_schema.py:96-110`；活消费端 `training/capabilities.py:34-41,46-47`、`router/session.py:126-128`、`tools/physical_exam_rules.py:188-192,270-274`、`modules/voice/service.py:127,316-322`；强制产出 `modules/cases/generation.py:94-95`、`prompts.py:94-118,131`；前端 `CaseForm.tsx:40`；`tests/cases/test_case_validator.py:101-104`（把误标行为固定为断言）。 ｜ **闭环**：二选一定契约（推荐生成侧改产出 `tools.physical_exam.vital_signs` + 存量迁移），把 `exam_anchors`/`voice_override` 移入 `CONSUMED_FIELDS`，`capabilities` 从 schema 删除。

**CAS-5 · 迁移链与模型的反向漂移 / 残留列** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：业务域无「模型改了迁移没补」，但有一列残留与一处 server_default 反向漂移。机制：`scores.score_scale` 建表后再无 drop 也不在任何模型；`simulation_sessions.state` 模型声明 `server_default` 而建表迁移没有 → `alembic autogenerate/check` 会反复生成幻影修订。影响：CI 迁移检查噪声；绕过 ORM 的插入若省略 `state` 违反 NOT NULL。
- 证据：`migrations/versions/ddl/0001_initial.py:493`；`models/simulation.py:26` vs `migrations/versions/ddl/9d4e2f6a8b0c_add_simulation_sessions.py:27`；范围表全部模型列可回溯、单 root（`c23e1bfb8824`）单 head（`d4f6a8b0c2e4f6a8`）已核实。 ｜ **闭环**：加 `drop_column("scores","score_scale")`；迁移与模型二选一对齐 `state` 默认值。

**已核实无问题（病例域）**：`data/cases` 11 个 JSON 顶层 key 集合一致（19 key，全无 `training_type`/`capabilities`/`exam_anchors`/`phases`），`tools.physical_exam` + `tools.nursing_record` 全量存在；`patient_info` 均为 `{name,age,gender}`；`seed.py` 角色/权限/用户段幂等策略自洽且有权限重同步迁移兜底。详见末节。

---

### 作业与问卷

> 本域并入源报告中的 feedback 与 simulations 条目（源报告的「业务 CRUD 与流程域」）。

**ASG-1 · 作业进度三套推导 + `total_score` 口径漏改** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` S5；跨域：作业 + 评分 + 前端） —— **结论**：同一 `status` / `score_total` 字段承载两套状态机与两套分数口径；`abandoned` 在门控与展示里语义相反；同学生同作业两个页面给出不同记录/分数/状态。机制：attempt 计数（门控排除 `IN_PROGRESS|DISCARDED|ABANDONED`，展示只排除 `in_progress|discarded`）、代表记录（教师端挑最高 `effective_total`，学生端取最新一条含 abandoned/discarded）、状态词（作业级 `closed/pending/overdue` 与记录级 `in_progress/completed/abandoned/discarded` 混用）。影响：完成 88 分后再开一次并中止 → 学生端徽章「待完成」、分数不显示，教师端显示「已完成 88」。**跨域来源**：`mess-scoring` #1 与 `mess-domain-crud` #5 指向同一行 `assignments/router.py:107`（另一处 `service.py:229` 已用 `effective_total`）；评分报告已逐 hunk 核对其余消费方（exports/llm_monitor/stats/users/scoreboard/session_views）无遗漏。
- 证据：门控 `training/router/session.py:455-466`；展示 `assignments/service.py:236`、`assignments/router.py:75`；代表记录 `service.py:200-216` vs `router.py:93-94,107`；`router.py:86,95,97,121` vs `service.py:37`；前端 `TrainingSelect.tsx:711-716`、`admin/AssignmentDetailPage.tsx:14-25`；`6f7d6eb0` 的改动面不含 `assignments/router.py`。 ｜ **闭环**：`core/statuses.py` 增 `AssignmentProgressStatus` + `ATTEMPT_EXCLUDED_STATUSES`；抽 `count_attempts` / `pick_representative_record` 供三处复用；`router.py:107` 改 `effective_total`。

**ASG-2 · `max_attempts` 无法改回「不限」，0/None 语义与 UI 文案三方矛盾** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：一个字段的三种表示里两种被写成「不限」、一种被实现成「不修改」，UI 文案描述的是第四种规则。机制：`if max_attempts is not None` 把显式 null 当「不修改」；门控把 0 与 None 都当不限；前端清空即不发送且占位符写「留空为 1 次，0 为不限制」。影响：教师清空次数保存后接口 200，限制照旧生效。
- 证据：`schemas/assignment.py:57`；`modules/assignments/service.py:423-424`；`training/router/session.py:468`；`frontend/src/pages/admin/AssignmentsPage.tsx:187-189,480`。 ｜ **闭环**：`"max_attempts" in req.model_fields_set` 区分缺省与显式 null；前端按 dirty 字段发送；占位符改「留空或 0 为不限制」。

**ASG-3 · 「关闭/截止」四个生效点 + 一个死函数，教师列表与排行榜忽略 `is_closed`** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：教师手动关闭开关只在一半读侧生效。机制：教师列表与排行榜只比 `end_time`；学生列表与开始门控同时看 `is_closed`。影响：`is_closed=True` 且未到期的作业仍出现在教师 `?status=active` 列表与排行榜里；`service._is_auto_closed`（tz 双分支）已全仓无调用。
- 证据：`modules/assignments/service.py:123-126,158-167`；`modules/scoreboard/service.py:131-134`；`assignments/router.py:77-78`；`training/router/session.py:432,439,507,524`。 ｜ **闭环**：抽 `effective_status(assignment, now)` 供三处调用；删 `_is_auto_closed`。

**ASG-4 · 作业完成率可能 > 100%（记录不按目标学生过滤）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：分子分母不同源。机制：`get_records_for_assignment` 不限目标学生，`completed_count` 对全部 `records_by_user` 计数，分母却是 `_get_target_students`；`update()` 允许在记录存在时改 `student_ids`。影响：移出已提交学生即得 `completed_count > student_count`、`completion_rate > 1.0`。
- 证据：`modules/assignments/service.py:139-147,180-186,240-242,255,415-416`。 ｜ **闭环**：`_build_detail_view` 内按目标学生集合统计 `completed_count`/`scored_count`。

**ASG-5 · 问卷提交无幂等、无唯一约束 → 重复 completed 行** ｜ P1 ｜ M ｜ 旧文档：未登记 —— **结论**：同一 `(user, template, case)` 可累积多条 completed。机制：只有非唯一索引 `ix_qr_user_template`，`submit()` 仅查 pending，命中不到就新建置 completed，`_find_completed` 用 `.first()` 任取。影响：跨标签/超时重试/双向并发穿透前端内存去重，统计与导出按重复行放大。
- 证据：`models/questionnaire.py:57-62`；`modules/questionnaires/response_service.py:71-80,222-263,294-300`；`frontend/src/hooks/useQuestionnaire.ts:63-66`。 ｜ **闭环**：加 `UniqueConstraint(user_id,template_id,case_id)` + 去重 data 迁移；`submit()` 改 upsert。

**ASG-6 · 问卷必答校验只在前端；服务端不校验问题归属** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：`required` 是只在客户端存在的契约。机制：`submit()` 直接按 `answers_data` 落库，不比对模板 `required`、不校验 `question_id` 属于该 template。影响：任意客户端可提交空答案得 completed 污染 stats/导出；越模板答案在回显时变成空内容。
- 证据：`frontend/src/components/QuestionnaireModal.tsx:72`；`response_service.py:222-263,142-180`；`models/questionnaire.py:50`（`required` 后端零读取）。 ｜ **闭环**：`submit()` 内做 required 差集与 template 归属校验，缺失抛 4xx。

**ASG-7 · `trigger_event` 两套词表：后台可选值永不触发、运行期用的值后台选不出来** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：语义漂移靠四个字符串各自记账，后端无枚举校验。机制：后台只给 `after_training|before_training`，但运行期实际用 `before_training` 与 `after_scoring`；`check()` 按 trigger 精确过滤。影响：用后台默认值挂上的问卷永久不弹且无报错；教师端 `after_scoring` 链路无法通过 UI 配置。
- 证据：`frontend/src/components/admin/questionnaires/types.ts:102-105`；`components/admin/QuestionnairesTab.tsx:51,199,205`；`pages/TrainingEntry.tsx:67`；`pages/admin/TeacherRecordDetail.tsx:104`；`modules/questionnaires/response_service.py:128-129`；`models/questionnaire.py:107`；`schemas/questionnaire.py:89`；`router.py:262`。 ｜ **闭环**：`core/statuses.py` 增 `QuestionnaireTrigger` 枚举并前后端同源；后端校验落库。

**ASG-8 · `pending_questionnaires` 一词两义（training 侧不查作答）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：同名字段在两模块语义不同（「病例挂了几份必做问卷」 vs 「该学生还没答的问卷」）。机制：`_count_pending_questionnaires` 不带 `user_id`、不查 `QuestionnaireResponse`、不校验模板 `is_active`。影响：学生答完后横幅永驻，与弹窗行为自相矛盾；模板停用后横幅与 `check()` 结论相反。
- 证据：`training/router/session.py:64-70,347,407,521,613`；`router/session_views.py:285,369`；`schemas/training/session.py:42,50`；真判定 `questionnaires/response_service.py:183-219`；前端 `TrainingEntry.tsx:97,111`。 ｜ **闭环**：`_count_pending_questionnaires` 收 `user_id` 并复用 `check()` 判定，过滤 `is_active`。

**ASG-9 · 问卷管理后台整条链路不可达（后端 10 个端点无消费者 + 前端死路由与假承诺）** ｜ P2 ｜ S ｜ 旧文档：已登记（`docs/10` 剩余项「问卷系统精简 ~800 行、P1 后评估」，NextStepsInventory 判 NOT STARTED） —— **结论**：教师端问卷功能是「后端齐备 + 前端孤儿」。机制：`AdminQuestionnaires` 全仓无 import，`APP_ROUTES` 无问卷条目，`QuestionnairesTab` 仅被该不可达页引用；另有指向不存在后端路由的 `getTrainingQuestionnaire` 与「我的问卷」文案承诺。
- 证据：`frontend/src/pages/admin/AdminQuestionnaires.tsx`；`components/shell/navigation.tsx:106-282`；`App.tsx:99`；`modules/questionnaires/router.py`（10 端点）；`frontend/src/api/questionnaires.ts:55-73,87-100`；`TrainingEntry.tsx:120`。 ｜ **闭环**：先决策「恢复路由」或「判定废弃」，二者都必须清掉死契约与假承诺文案。

**ASG-10 · 问卷子端点忽略路径 `template_id`（可跨模板改/删题目）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：路径参数被忽略，属潜伏一致性/越权问题，UI 恢复即成立。机制：`update`/`delete` 只用 `db.get(QuestionnaireQuestion, question_id)`，模板从题目自身取。影响：`PUT /templates/1/questions/99` 会改到模板 2 的题目 99。
- 证据：`modules/questionnaires/router.py:220-241,243-251`；`service.py:360-382,384-400`。 ｜ **闭环**：两方法开头校验 `q.template_id != template_id` 即抛 NotFound。

**ASG-11 · feedback 两条写路径语义不对称（admin 可静默覆盖 bot 回复）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：同一「开发者回复」状态由两条规则不同的路径写。机制：`reply()`（admin）无前置校验直接覆盖并**重置 `replied_at`**；`bot_reply()` 有 `ConflictError` 守卫；`bot_mark_fix_attempted()` 绕过 `unit_of_work` 直接 commit。影响：历史回复时间不可追溯、用户收到互相矛盾通知；admin 看不到 `auto_fix_attempted`（`FeedbackItem` 无该字段）而会重复排查。
- 证据：`modules/feedback/service.py:194-215,365-369,403-411,413-422`；`router.py:105`；`schemas/feedback.py:24-37`。 ｜ **闭环**：抽 `_write_reply(..., allow_overwrite=False)` 共用守卫、覆盖不重置首条时间；`FeedbackItem` 补 `auto_fix_*`；`bot_mark_fix_attempted` 回到 `unit_of_work`。

**ASG-12 · simulations 状态双真值（DB `status` 列 vs `state.case_status`），列只写不读** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：同一状态两份副本，DB 约束管不到 JSONB，API 永远返回 JSONB 侧，列值成为误导（半迁移残留）。机制：双写 + 快照只读 JSONB + 全仓读取列仅出现在测试；枚举在三处硬编码未接入 `core/statuses.py`。
- 证据：`models/simulation.py:19,25-26`；`modules/simulations/state.py:82`；`service.py:41,113-117,149-150`；`engine.py:29-31`；`schemas/simulation.py:104`；`tests/simulations/test_talk.py:173,177`。 ｜ **闭环**：定唯一真值（推荐以 JSONB 为准则删列 + 表达式索引），`core/statuses.py` 增 `SimulationStatus` 并改引用。

**ASG-13 · 同一实体三层类型拷贝（dataclass view → 手写映射 → pydantic），漂移已发生** ｜ P3 ｜ M ｜ 旧文档：未登记（跨域：与 FE-9 同类但不同对象） —— **结论**：加一个字段要改三处，漏一处静默丢字段，OpenAPI 契约与实现之间无静态保障。机制：dataclass 逐字段复制 schema，router 再逐字段手抄（无类型注解，mypy 抓不到）。漂移实证：`AssignmentListItem` 缺 `max_attempts`；`FeedbackItem` 缺 `auto_fix_*`；`CaseManageItem.capabilities` 与 `CaseBrief.capabilities` 语义不同。另 `questionnaires/router.py:135,166` 传 `model_dump()` dict、`service.py:210-214,249-263` 以 `q_data["content"]` 取键 → 改字段名是 500 而非 422。
- 证据：`modules/assignments/service.py:16-70`、`schemas/assignment.py:65-134`、`assignments/router.py:137-190`；`questionnaires/service.py:39-48,56-88,94-103`、`router.py:43-52,69-92,95,135,166`；`schemas/assignment.py:65-78`；`schemas/feedback.py:24-37`。 ｜ **闭环**：删中间 dataclass，service 直接产出 `schemas/*` 模型并交给 `response_model`。

**已核实无问题（作业/问卷/反馈/simulations）**：`simulations` 三端点都有前端封装与调用，非法状态推进被显式拦截（`engine.py:272-275,326-328`），快照对未揭示记录白名单隔离；`scoreboard` 的 fallback 排除四处一致、复核分读侧已用 `COALESCE(reviewed_total,total_score)`；`admin/grades.py` 只用 `class_id` 做删除守卫；病例内嵌 `tools.quiz` 与问卷 DB 表是两个功能（字段与消费链均不同）；`assign_cases` 用 `delete_case_links` + 重插于 `unit_of_work` 内，配合 `uq_cq_case_template` 无重复；`trigger_event` 之外的问卷 CRUD 幂等成立；`feedback` 与遥测/诊断/运维域无重复建模（`Feedback` 零引用）。

---

### 评分

**SCR-1 · fallback 结果被 postprocess 反杀：「带标记的兜底分」退化成「无分 failed」** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` S3；本条是 S3 的残余） —— **结论**：首次成功率意外反了——LLM 完全空走 `llm_empty` 早返回并带标记落库，LLM 只差一个字段反而整场失败且不留分。机制：`_fallback_scoring` 把首试 partial 原样返回、**不补 `total_score`**，随后 `_validate_scoring_result` 在缺 `total_score` 时 `raise ValueError` → 路由器重试整轮 → 仍失败 → `_handle_scoring_failure` 不写 Score、无 fallback 标记。影响：`score-health` 的失败率统计与学生端「评分失败无分」；比 0 分更难发现（没有 0 分反而更「干净」）。
- 证据：`modules/training/scoring/engine.py:731-741,516,470-473`；`scoring/validation.py:82-93`。 ｜ **闭环**：`_fallback_scoring` 的 partial 分支 `setdefault("total_score", 0)` 并保留标记；或在 `_postprocess_scoring_result` 对 `_scoring_fallback` 结果降级校验。

**SCR-2 · force 重评的失败恢复不闭合：分恢复了，`scoring_status` 仍是 failed** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` S6；只修了「先删后算」） —— **结论**：同一不变量（有 Score ⇒ completed）在本文件实现了三次，恢复分支漏一次，且恢复出来的正是它声称要避免的「孤儿 Score + failed」。机制：先算终态并 commit（旧分已删 → 必然 failed），再从 `force_rescore_snapshot` 重建 Score 但不回写状态，随后照发「评分失败」通知；快照另缺 `dim_total`/`reviewed_at`。影响：恢复出的旧分在成绩管理与作业详情永久不可见（sweep 只扫 pending/processing），但导出与记录详情可见 → 同一学生分数三处三样，且学生收到失败通知却能看到分。
- 证据：`router/scoring.py:163-165,171-209,189-190,212-221,347`；`retry_scoring:534-550,564-565`；`_resolve_terminal_status:44-52`；`session/settlement.py:184-197`；`scoreboard/service.py:120-124`；`assignments/service.py:229`；`admin/exports.py:83`。 ｜ **闭环**：恢复分支补状态纠正 + 清 `force_rescore_snapshot` 后提前返回（不再发失败通知）；快照补 `dim_total`/`reviewed_at`。

**SCR-3 · 成绩口径 SQL 抄了 6 处，`fallback` 过滤只落在 1 处** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` INV-3；跨域：评分 + 运维统计 + 作业） —— **结论**：INV-3（fallback 不进排行榜/平均分）只在一个模块生效，「同一个平均分」在成绩管理页与管理端统计/用户列表/作业算出来不同；口径没有单一出口，每加一个统计页再抄一次。机制：`COALESCE(reviewed_total,total_score)` 手写在 11 处，`Score.fallback.is_(None)` 只在 `scoreboard` 的 4 处；模型层的 `Score.effective_total` 只被 Python 侧使用。影响：15.8% 量级的历史故障记录（staging 74/467）把故障 0 分算进管理端均分/排名。
- 证据：`scoreboard/service.py:159,249,334,368`；`admin/stats.py:72,175-176,183,230,285`；`admin/users.py:272,511,531`；`assignments/service.py:229`；`admin/exports.py:83`；`admin/llm_monitor.py:417`；`session_views.py:146`；`models/training.py:132-137`；`grep -c "Score.fallback"` = 0（除 scoreboard）。 ｜ **闭环**：在 `infra/` 或 `models/training.py` 落单一口径（`grade_expr()` + `grade_conditions()`），11 处替换为同一调用。

**SCR-4 · rubric 三份真相：base(JSON) / 有效(+护理记录维度) / 教师页导出方言** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` S10 覆盖 19 vs 24 叙事；三源并立未登记；跨域：评分 + 前端 FE-11） —— **结论**：三处都把「评分标准」当唯一真相，但只有一处参与评分；热更承诺与评分路径矛盾（运行时改 `rubric.json`，教师页立刻变、评分永不变）；`load_rubric(version)` 的参数只做缓存键、不选文件。机制：`rubric_data.py` 在 import 时固化进程内副本；`rubric_loader` 是 mtime 热更；实际口径是 `build_final_rubric()`（nursing_record 开启则 raw_max 38→48/24 项）并固化进 `record.rubric_snapshot`；`/api/rubrics/current` 返回 base；教师页导出第三种方言。影响：教师看到的评分标准与真实口径不一致；rubric 编辑走「导出→替换文件」可静默把 0-2 制换成 0-1 制（`validate_dimensions` 不校验 `raw_scale/raw_max/维度 max` 自洽）。
- 证据：`scoring/rubric_data.py:7-12`；`rubric_loader.py:11-24,31-63`；`profile.py:28,34`；`scoring/rubric.py:73-79`；`session.py:245`；`engine.py:328-336`；`admin/rubrics.py:12-16`；`frontend/src/pages/admin/RubricPage.tsx:33-56,220`；`scoring/validation.py:236-247,301-307`；`scoring/prompt_builder.py:23-26`。 ｜ **闭环**：立 SSOT（保 `rubric_loader`、删 `rubric_data.py`、`raw_max` 由 `Σ(items)×raw_scale` 推导）；`/api/rubrics/current` 返回有效口径（或同时给 base/with-nursing 两个 raw_max）；`validate_dimensions` 增自洽校验并拒绝加载。

**SCR-5 · 映射策略「版本化」没接线：`mapping_version` 硬编码 1，复核/换算写死线性** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：版本字段写死等于宣布「永远不会有 v2」；曲率是策略的一部分却没有随策略传递。机制：`engine.py:563` 直接 `mapping_version=1 if raw_total is not None else 0`；复核路径无条件按线性换算。影响：未来任何映射调整都会静默产生两类错误（新分行标成 v1、复核分按线性还原越界/缩水）。
- 证据：`scoring/mapping.py:13-31`；`engine.py:563`；`validation.py:216,305,250,301`。 ｜ **闭环**：`mapping_version` 取 `CURRENT_POLICY.version`；`review_total_from_detail`/`display_to_raw` 接收 `policy` 并由策略统一产出换算因子。

**SCR-6 · 只提交评论的复核会清空 `ScoreReview.total_score`，而 `Score.reviewed_total` 保留旧值** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：一次「只写评语」的复核把复核记录总分清零，成绩口径仍用上一次 `reviewed_total`；`reviewed_at` 也不再刷新，无法分辨哪次复核最后生效。机制：`detail_scores is None` 时 `review_total = None`，更新分支无条件赋值。影响：教师「先写评语、再改分」两步操作会制造 `ScoreReview.total_score == None` 而 `Score.reviewed_total == 88` 的中间态，明细页与成绩页结论不同。
- 证据：`router/score_review.py:67,80,85-86,103-104`；`schemas/scoring.py:9`。 ｜ **闭环**：显式化互斥语义（`detail_scores=None` ⇒ 不改分），两次提交都保留旧总分。

**SCR-7 · 存量记录补写 snapshot：OR 条件 + 无条件写，会把已有 `prompt_snapshot` 覆盖成今天的提示词** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：只缺 rubric 快照的旧记录会被顺手改成今天的提示词版本 → 事后审计/回放/归因全部失真且无日志。机制：`if not prompt_snapshot or not rubric_snapshot` 但块内无条件重建 `prompt_snapshot`（`schema_version: 2` 写死），整体 `except AttributeError: pass` 静默。影响：`Score.prompt_version` 的溯源基线错误。
- 证据：`router/scoring.py:274,279-288`；`engine.py:557-560`。 ｜ **闭环**：拆成两个独立 if（缺哪个补哪个）；`schema_version` 用当时快照常量；`except` 改记日志。

**SCR-8 · 0-2 分制残留：同一概念两个默认分值（当前不可达，但是下一次事故的引信）** ｜ P3 ｜ S ｜ 旧文档：已登记（`defect-list` S2 相关；`986135b9` 只改了一处默认值） —— **结论**：同一模块「缺省 `raw_scale`」有两个答案（2 与 3），谁读哪一路取决于调用点；一旦某个 rubric 缺 `raw_scale`，同一份 LLM 输出会被钳到 ≤3 又按 raw_max=38 归一化，展示分被压到 100 封顶且不报错。当前生产不可达（所有 rubric 源都带 `raw_scale`），但 SCR-4 引入「可编辑 rubric」后立刻可达。
- 证据：`scoring/prompt_builder.py:22-23`；`validation.py:44,250,301,313`；`engine.py:480,488`；`prompts/scoring.py:24-27`（0-2 口径）。 ｜ **闭环**：删所有 `, 3` 回退，统一走 `rubric_scale(rubric)`；`build_scoring_criteria` 文案改 `0-{raw_scale}`。

**SCR-9 · `engine.py`/`validation.py` 的死分支与重复校验** ｜ P3 ｜ M ｜ 旧文档：未登记 —— **结论**：4 条真实不可达/冗余：① `_inject_rubric_max` 的 else 分支输出必被 `_filter_hallucinated_dimensions` 丢弃；② 评分阶段为 `missing_list` 算一遍反馈字段（恒等于 4 个字段名）而 `_fallback_scoring` 忽略该参数；③ `_check_feedback_empty` 的同一判定有三份实现（`validation.py:143-186` 两处 + `:16-24`）；④ `dim_total` 取 LLM 维度自评而后把同一 `detail_scores` 就地乘 factor 展示化 → API 里维度分与条目分之和对不上且无标注。影响：#4 已影响前端展示语义；#1/#2 白读白算；#3 改口径要改三处。
- 证据：`validation.py:16-24,54-55,143-186,214-224`；`engine.py:251-253,475,479,491-495,731`。 ｜ **闭环**：#1 删 else 分支或调序；#2 评分阶段不传 `missing_list`；#3 复用单一判定；#4 定契约（存 Σ条目分或改名 `llm_dim_self_score`）。

**已核实无问题（评分域）**：INV-2（总分 = Σ条目分）已真正落地（`validation.py:250-271`、`engine.py:488-489,502-514`，测试 `test_postprocess_raw_total_equals_item_sum` 有效守护）；INV-5 除 `assignments/router.py:107` 外所有 hunk 已核对（exports 2 / llm_monitor 1 / stats 6 / users 4 / assignments.service 3 / scoreboard 4 / session_views 3，`test_reviewed_total_is_effective_grade` 断言含 `reviewed_total=0` 不回退）；复核「不改分提交恒等」在 57/3 与 38/2 两代 rubric 下都成立（每项展示刻度恰好都是 5，`_resolve_rubric` 优先用记录快照）；`fallback` 不进排行榜四处齐全；S8 超时预算单一来源（`engine.py:646` + `router/scoring.py:314,333`，2 次尝试 + 30s 间隔 ≤180s < 210s 宽限，`test_timeout_budget_consistent`）；S7 重评竞态在当前结构下不可达（残余：`_persist_score` 无 upsert/版本号）；`retry_scoring` 的宽限窗口 + 10 分钟 sweep 自愈；`lifecycle.py` 三函数语义自洽；`retry_scoring` 回滚路径正确；`tests/scoring/**` 7 文件 + `tests/scoreboard/test_scoreboard.py` 覆盖不变量；`scoring/__init__.py` 无 eager import。

---

### 训练管线与情绪

**PIP-1 · SSE 断线分支是死代码：`_run` 任务不被取消，DB session 在任务仍在跑时被关闭** ｜ P0 ｜ S ｜ 旧文档：未登记 —— **结论**：作者以为断线被处理（有日志、有 cancel），实际 `GeneratorExit` 直接穿出生成器，`asyncio.create_task(_run())` 任务游离到后台跑完整条链路；两个「清理意图」顺序颠倒。机制：唯一承载流式内容的 `yield` 在轮询循环内，而 `except GeneratorExit` 块内部没有任何 `yield` 且进入时 `task.done()` 必为 True → `await task` 不挂起 → 该分支不可达；`chat.py` 的 `finally: await stack.aclose()` 先执行，`db_session()` 退出只 `session.close()`（= rollback + expunge）。影响：collect-then-push 后「整段生成期间零字节下发」是常态，前端 60s idle 超时是慢响应的常规路径 → ①重试后同一意图落两条 student + 两条 patient 消息；②`_persist_correction` 在已关闭 session 上操作会抛错且无人 await，只留一条 "Task exception was never retrieved"（该异常类型为源报告 `[INFERENCE]`，①②可静态证明）。
- 证据：`pipeline/runner.py:63-66,71-74,78-88,101-113`；`router/chat.py:240-246,278-284`；`core/database.py:61-66`；`pipeline/persister.py:79-80`；`frontend/src/api/sse.ts:36,48-52`。 ｜ **闭环**：用 `try/finally` 包住生成器主体，`finally` 内 `task.cancel()` + `await gather(...)`；删 81-88 行不可达分支；`stack.aclose()` 放在迭代器完全结束之后。

**PIP-2 · `/end` 的会话清理从不落库（rollback），且与结果页情绪轨迹图对同一张表下了相反契约** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` T8 的清理一处未落库；跨域：管线 + 前端 FE-1） —— **结论**：T8 的「统一清理」在唯一主路径上是**空操作**（写了但没生效），而一旦有人「顺手补 commit」，情绪轨迹图对全部已完成记录立刻变空；两个功能对同一张表持相反生命周期契约，代码里没有任何注释或测试指明哪一方有意为之。机制：`cleanup_session_runtime` 只有 `cleanup_initiative`（仅改字段）与 `EmotionRepository.cleanup`（两条 DELETE），无 commit，请求结束时 `session.close()` 全部回滚；`/emotion-events` 读的正是被删的那张表。影响：情绪状态/事件行在 completed 记录上永久留存（表随时间单调增长）；改动 commit 位置会静默打掉一个已上线展示功能（无测试覆盖数据存在性）。
- 证据：`router/scoring.py:464-465`；`session/finalize.py:118-137,62-64,133-135`；`patient_ai/emotion/repository.py:182-185`；`session/cache.py:76-81`；`router/session_views.py:189-233`；`frontend/src/pages/RecordDetail.tsx:130`；`session/settlement.py:139-156` vs `router/session.py:703-722`（两条 `in_progress→abandoned` 清算结果不同）。 ｜ **闭环**：定契约（情绪行是已完成训练的审计数据源）→ 删 emotion 清理分支，清理收敛到 `purge_session_runtime(record_id, db)` 供 `mark_discarded`/`abandon_record`/`_abandon_stale_records`/`delete_record` 共用。

**PIP-3 · 情绪向量第 4 条序列化路径仍是手写，契约与「统一入口」不一致（丢 `dominant_state`）** ｜ P2 ｜ S ｜ 旧文档：未登记（跨域：管线 + 前端 FE-1/FE-7） —— **结论**：同一文件内两处实现，一处复用统一入口一处裸写；`*100` 的坐标变换散落 3 处。机制：`session_views.get_emotion_events` 手写 `round(after.get("x", 0) * 100)` 且无 `dominant_state`；`initiative.py:216-217` 还在派生 4D 模型里不存在的 `comfort` 旧轴（被 `prompts/initiative.py:7` 消费），是全仓唯一的第 3 种刻度。影响：`after_state` 与 `onEmotionChange` 两个前端接口形状不同，按统一契约写的消费者静默拿到 `undefined`；无测试固定该端点形状。
- 证据：`router/session_views.py:214-233,306`；`patient_ai/emotion/renderer.py:105-116`；`initiative.py:216-217,302-304`；`pipeline/middleware/side_effects.py:45`；`models.py:100-107`；源报告指 `87ab9c60` 声称统一了三处、漏了第 4 处。 ｜ **闭环**：该端点改调 `serialize_emotion_vector(EmotionVector.from_dict(after))`；`comfort` 轴要么显式加进统一入口要么删 prompt 占位。

**PIP-4 · v2 情绪提示词仍在仓库且被启动模板校验引用；真正跑的提示词是内联字符串、不受校验** ｜ P2 ｜ S–M ｜ 旧文档：已登记（`defect-list` T8 相邻；半迁移残留未登记） —— **结论**：① 半迁移残留：v2 提示词（旧刻度、旧字段 `trust_delta`/`comfort_delta`）留成中性文件名，grep「情绪提示词」会先找到它；② 启动校验给了假保证——校验的是永不渲染的模板；③ 全仓唯一「把提示词写在业务代码里」的例外，破坏 `prompts/` 单一定义处约定。影响：改错文件、以为被校验；情绪调参面被拆成两处。
- 证据：`modules/training/prompts/emotion.py:3-14`（`trust_delta` 全仓仅此与测试命中）；`patient_ai/emotion/analyzer.py:23-108`（内联实际 prompt）；`core/template_variables.py:57-59,131,154`；`tests/core/test_render_template.py:101-109`。 ｜ **闭环**：把 `analyzer.py` 两段 prompt 搬到 `prompts/emotion.py` 并删除 v2 旧文案；`analyzer` 改为 import；同步测试断言。

**PIP-5 · `PipelineContext.state` 键：常量与裸字符串混用；4 个死键（其中 `source_traces` 永久为空）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：常量层存在但一半消费点绕过它 ⇒ 改常量的字面值不会报错，只会让**功能静默关闭**（如改名 `STATE_FEATURES` → 情绪/主动追问门控失效且无测试发现）。机制：裸字符串读 3 处（`"features"`、`"_emotion_change"/"_emotion_dominant"`、`"_emotion_note"`）；只写不读 2 个（`STATE_STREAM_CHUNKS`、`STATE_CONTEXT_LEDGER`）；只读不写 1 个（`STATE_POST_STREAM_EVENTS`）；永远为空 1 个（`STATE_SOURCE_TRACES`，无写点 → 审计字段 `log_meta={"source_traces": []}` 恒空）。
- 证据：`pipeline/context.py:13-14`；`middleware/emotion_analysis.py:33-35,44`；`middleware/side_effects.py:30-31`；`patient_ai/notes.py:24`；`middleware/llm_caller.py:66,133,203`；`middleware/prompt_builder.py:88`；`pipeline/runner.py:103-104`。 ｜ **闭环**：裸字符串改常量（把两个 `STATE_EMOTION_*` 提升到 `pipeline/context.py`）；删 4 个死键（或让 `source_traces` 真正写入）。

**PIP-6 · 修正学生发言后，情绪不再更新（turn_id 撞车导致整轮跳过）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：同一轮出现两套事实（评分看新文本、患者行为看旧文本），且无注释说明这是有意的。机制：修正路径的 ctx 用「排除被修正对之后」的历史 → 与原来那一轮的 `ctx.messages` 相同 → `turn_id` 与 `last_turn_id` 相等 → 命中 "already processed, skipping"。影响：学生说冒犯性话（触发 `judgmental_language` trust −0.08）后立刻修正为共情表述：DB 只剩共情句，患者后续语气仍「被冒犯过」，情绪轨迹图与最终对话自相矛盾。
- 证据：`patient_ai/emotion_analysis.py:83-89`；`router/chat.py:100-117,166,181,183-184`；`patient_ai/emotion/repository.py:88-95`。 ｜ **闭环**：修正路径额外打标，`turn_id` 追加 `-c{corr}` 后缀（乐观锁语义不变）。

**PIP-7 · 两个「病例 → 患者视角文本」渲染器，人格文案两套词汇表** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：同一份 `case_data.personality` 有两处独立解释器，人格语义改动必须双改；`health_literacy`/`mood`/`compliance` 在主动追问里整个丢失 → 「话痨/急躁」人设在主动追问时换腔调。机制：`_format_personality` 覆盖 6 个 trait 与全套模板变量；`describe_traits`/`build_patient_context` 只覆盖 3 个 trait 与 4 个字段；两者都被注入同一患者的 LLM 调用（前者进主回复、后者进主动追问）。
- 证据：`pipeline/prompt_context_builder.py:31-100` vs `patient_ai/initiative.py:147-186`；`prompt_builder.py:80-87`；`router/progress.py:81-88`。 ｜ **闭环**：收敛为 `context/patient_view.py` 两个纯函数（`format_personality`、`build_patient_view(..., include_deep_bg=False)`），两个入口都调用。

**PIP-8 · 快照兼容层只被消费 `schema_version`，且把它当 `prompt_version` 落库** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：① 兼容层 80% 代码无生产消费者（v1 写点已从仓库移除）；② 语义错位——`Score.prompt_version` 本意是「这份分数由哪版提示词产生」，实际落的是快照 schema 版本：文案变了但 schema 不变 → 版本不变；schema 升到 3 而提示词没变 → 所有新分数被标成 3。
- 证据：`pipeline/snapshot_compat.py:36-48`；`scoring/engine.py:547-560`；唯一生产消费点 `engine.py:560`；`session.py:246-252`、`scoring.py:279-285`（现写点均为 v2）；`tests/training/test_snapshot_compat.py` 是 `purpose/system/dynamic` 的唯一断言者。 ｜ **闭环**：`engine.py:560` 改写真 `PROMPT_VERSION`；`snapshot_compat` 收缩为 `read_prompt_schema_version(raw) -> int`。

**PIP-9 · pipeline 骨架的空壳与命名错位** ｜ P3 ｜ S ｜ 旧文档：未登记（跨域：与 `training_type` 伪扩展点 OPS-12 同源） —— **结论**：骨架层保留的抽象没有对应实现，属「看着像扩展点、其实没有」的假结构：① `PipelineStage.GUARD/TRANSITION` 与 `_STAGE_ORDER` 的 0/100 项无任何中间件（排序表里两条永不命中的规则）；② `build_pipeline(training_type=None)` 参数全函数未用而调用方仍在传；③ `PipelineMiddleware` 定义两次（`runner.py` 屏蔽 `stages.py`，`__init__.py` 又导出 stages 的那个）；④ `__init__.py` 的阶段说明漏掉实际最先运行的 ANALYSIS 且顺序与 `_STAGE_ORDER` 不符；⑤ `prompt_context_builder.py` 名字与内容不符，`format_case_for_prompt` 的唯一生产消费者在**另一个模块**。
- 证据：`pipeline/stages.py:8-14,16-22,25-33`；`builder.py:15,25-30`；`runner.py:19-24`；`__init__.py:1-13,30`；`prompt_context_builder.py:108-129`；`modules/cases/generation.py:32,54,166`；`modules/cases/prompts.py:149-154`；`router/chat.py:202,232,270`。 ｜ **闭环**：删空阶段/未用参数/重复别名，修正 `__init__` 说明，把 `format_case_for_prompt` 移到 `modules/cases/`。

**PIP-10 · `initiative._last_resort_fallback` 的键集与 `_MOOD_LABELS` 漂移** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：兜底表键与 9 标签枚举不一致（`焦虑不安` 永不可达、4 类缺失 → 落到默认 `"……"`），而这是 LLM 双次失败后最需要贴合情绪的话术。机制：两个字典同文件相隔 200 行，各自跟随 `resolve_dominant_state` 的枚举，改一处忘另一处无任何拦截。
- 证据：`patient_ai/initiative.py:53-64,66-69,253-259`；`emotion/renderer.py:44-63`。 ｜ **闭环**：以 `resolve_dominant_state` 输出为唯一键源补全 9 键并删 `焦虑不安`。

**PIP-11 · 迁移残留空目录 + 失效的测试过滤** ｜ P3 ｜ S ｜ 旧文档：未登记（跨域：与 ARCH-1 幽灵目录同源） —— **结论**：① `backend/contexts/**`、`backend/prompts/**` 等只剩 `__pycache__`（`git ls-files` 为空），会让 grep/IDE/任务书指向错误位置；② `test_pipeline_integration.py:66` 过滤 `"_llm_caller"`，而中间件函数名是 `llm_caller`（无下划线）→ 过滤是空操作，注释说「跳过 LLM 调用」实际执行了 LLM 中间件（靠 mock 才过），测试意图与行为不符。
- 证据：`git ls-files backend/contexts backend/prompts`；`tests/training/test_pipeline_integration.py:66`；`middleware/llm_caller.py:35`。 ｜ **闭环**：删空目录；测试改按阶段截断（或 `build_pipeline(..., upto=PipelineStage.PROMPT)`）。

**PIP-12 · 患者对辱骂/人身攻击过度容忍（无语义事件、无升级行为、评分无维度）** ｜ P1 ｜ M ｜ 旧文档：未登记 —— **结论**：情绪分析器是**封闭事件枚举**，唯一的负向沟通事件是 `judgmental_language`（指责/批评/贴标签），纯脏话在语义上不匹配且 prompt 规定「低于 0.5 不报告」→ 最可能本轮 0 事件、情绪完全不动；即使归为 `judgmental_language`，单轮上限 trust −0.08 / irritation +0.08，再经 confidence、人格敏感度、边界阻尼（0.25~1.0）与每轮自然恢复（irritation_recovery 0.06/轮）衰减，**结构上到不了 `resolve_dominant_state` 的 irritated 门槛 0.7**。回复侧还有两处显式抑制（tone 死锁「但不得辱骂或失控」、note 硬约束「情绪只能影响表达方式」），护栏只有身份泄漏与隐藏主题泄漏，**没有任何针对学生失礼的 moderation/guard 阶段**（`build_rule` 的 GUARD/TRANSITION 阶段为空）。评分侧 0-2 制 / raw_max=38，**没有职业素养/人文关怀维度**，辱骂最多经 `comm_04`/`comm_13` 间接扣 4 raw 分（≈10.5/100）。
- 证据：`patient_ai/emotion/events.py:67-83`；`emotion/analyzer.py:30,53-61,82-87`；`emotion/rules.py:59-64`；`emotion/engine.py:100-124,153-158`；`emotion/behavior.py:75-76,136-143`；`emotion/renderer.py:26-38,52-73`；`prompts/patient.py:28-30`；`pipeline/prompt_context_builder.py:120`；`pipeline/builder.py:19-31`；`scoring/rubric.json:2-8,44-50,125-131`；`scoring/engine.py:339-344`；`scoring/prompts.py`（评估重点无辱骂规则）。工作区已出现未跟踪的 `patient_ai/emotion/hostility.py`（确定性词表预闸，见 R3），属并行修复产物，本表不追踪其状态。
- 闭环（源报告 7 步，按最小改动排序）：① 新增 `VERBAL_ABUSE`/`THREAT` 事件类型；② 给出能跨阈值的 delta；③ analyzer prompt 增加辱骂/威胁条目并强制 confidence ≥0.9；④ 解除 tone「不得升级」死锁 + 增拒绝继续分支；⑤ 去掉 note「只影响表达方式」的封闭约束；⑥ 人设卡补「可拒绝」例外与 scenario 例外；⑦ 评分增职业素养条目（comm_15 / raw_max 38→40）。1–4 为必要条件，5–6 让状态可被患者 LLM 合法执行，7 只对齐教学评分。

**PIP-13 · `leak_guard` 子串匹配双向失效** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` T7，源报告核实仍成立） —— **结论**：`key in reply_lower` 子串匹配既误判（「咯血/咳血」）又漏判（换词），且豁免只看**本轮**学生输入（历史问过的话题不豁免）；披露完全靠 LLM 自判（`hidden_info` 运行时未使用）。机制同源的第二处：`patient_ai/notes.py` 的 `IdentityGuardSource` 同样只看最后一条 patient 消息。
- 证据：`context/leak_guard.py:24-47`；`patient_ai/notes.py:30-42`；`prompts/patient.py:49`；`pipeline/prompt_context_builder.py:124-125`。 ｜ **闭环**：改整段历史语义判定 + 生成层结构化门控。

**PIP-14 · FATIGUE 是假文档（已登记、有意保留）** ｜ P2 ｜ S ｜ 旧文档：已登记（`defect-list` T9） —— **结论**：`analyzer` 声称「系统在对话后期注入」，全仓无注入点；跨轮失误（重复问/打断）结构上检测不到，`rules.py`/`events.py` 只有枚举与规则。
- 证据：`patient_ai/emotion/analyzer.py:73,79,101`；`emotion/rules.py:102-105`；`emotion/events.py:65`。 ｜ **闭环**：实现注入或删文档（二选一）。

**PIP-15 · `runtime_state` JSONB 无锁读-改-写（chat/persister 侧）** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` T5，源报告核实未修） —— **结论**：工具侧已被 `tools/service.py` 的行锁 + revision 条件自增串行化，但 chat/persister 侧仍是整字段赋值的读-改-写（无 `|| :patch`、无行锁）。影响：双击/重试可产生交错消息对、查体与修正互相覆盖。
- 证据：`pipeline/persister.py:97-99`；`router/chat.py:196-199`；对照工具侧 `modules/training/tools/service.py:117-128`。 ｜ **闭环**：JSONB 原子合并或行锁（与工具侧同源方案）。

**PIP-16 · 查体读数以「患者自知」注入，配合门控缺失** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` T6，源报告核实未修） —— **结论**：`note_source.py` 仍渲染「{desc}，测得 {measured}」把读数直接告诉患者，与「感知检查但不自知结果」的人设矛盾；人设卡「不要主动往外掏」的约束在运行期无对应落地。
- 证据：`patient_ai/note_source.py:88-96`；`prompts/patient.py:27`；`defect-list` 记录的 `behavior.py:130-147` 无引用。 ｜ **闭环**：读数改「待告知」口径；工具层加 cooperation 门控。

**已核实无问题（管线/情绪）**：T1/T2/T3/T10 在基线时均已修复（`llm_caller.py:144-206` 全量收集→过守卫→推送；`max_retries=0` + 本层全新 stream；`emotion_analysis.py:86-88` 用 `max(m.id)`；`guards.py:16-44` STRONG 单条即判 / WEAK 需 ≥2 条）；T4 已按 D5 决策收口（暂停不延展截止时间，`test_timing.py:57-82` 三条测试钉住）；上下文组装只有唯一入口 `context/assembler.py:assemble_patient_messages`，`pipeline/prompt_context.py` 是模板变量命名空间、与 assembler 无重叠；session 状态机值集合收敛于 `core/statuses.py:9-15`、跃迁点闭合（无并发双开，`completed/discarded` 幂等，`TrainingStatus.FAILED` 无写入点属可删项）；时间口径单一（`timing.py` 三函数同源，准入/展示/扫频都调用）；`ws.py` 消费者分支闭合且心跳/锁/退订完整；SSE 帧类型（除 PIP-1）生产者/消费者对齐（后端 5 种，`sse.ts:72-95` 均有显式分支）；120 条截断与情绪判定已解耦。

---

### 上下文预算

**CTX-1 · 历史预算固定 2000 token、与模型/窗口无关（最大杠杆）** ｜ P1 ｜ S ｜ 旧文档：未登记 —— **结论**：`deepseek-v4-flash` 上下文远大于 2000 token，但历史被硬性截到 2000，约 30~50 轮后早期对话被丢 → 患者遗忘早期主诉/背景；2000 与 `LLMProfile.max_tokens`（512）同处一个 `profile.py` 却互不相干，读者易误判。
- 证据：`modules/training/context/budget.py:12-14`；`infra/llm/profile.py`。 ｜ **闭环**：把预算改为 `LLMProfile` 字段（默认 12000~24000），由模型 context window 减去 static/session/examples/state/输出上限动态推导。

**CTX-2 · 历史裁剪打断前缀缓存（R1）** ｜ P1 ｜ M ｜ 旧文档：未登记 —— **结论**：预算未满时不破坏缓存（新请求前缀含上一轮全部消息）；**一旦超过 2000 token，每轮丢最旧一条 → 消息 0 起就不同 → 整段（含 STATIC/SESSION/EXAMPLES）缓存全 miss**，DeepSeek 自动前缀缓存收益归零，成本与延迟上升。机制：`select_history_messages` 从最旧端逐条丢弃、首个超预算即停、**无轮次对齐**。
- 证据：`context/budget.py:22-54`；对照 `context/assembler.py:44-69`。 ｜ **闭环**：按整数轮对齐裁剪边界（始终保留最近 N 轮完整对），或把历史预算从 token 改为轮数窗口。

**CTX-3 · token 估算两套字符近似（R4，评审分歧）** ｜ P2 ｜ S–M ｜ 旧文档：未登记
- 【评审分歧】`ContextAssemblyAudit` R4：两套近似不一致（预算侧 0.6 token/char ≈1.67 char/token，note 侧用 1.5），对中英混排/emoji/代码误差 10~30%，建议**投入 M** 装真实 tokenizer（字符近似降级为 fallback）。`LlmClientAudit` R10：判为**低风险/可接受**，偏差 ±20–30% 放大的只是 CTX-2 的裁剪抖动，建议**投入 S**（按真实 usage 反推校准，或直接以轮数窗口替代 token 预算）。两条都保留。
- 证据：`infra/llm/token_counter.py:24-25,40-47`；`patient_ai/note_collector.py:24-28`。
- 闭环（两案）：真 tokenizer / usage 校准；无论选哪条，note 侧与预算侧必须复用同一函数。

**CTX-4 · 「120 条」DB 上限 vs 2000-token 实际上限：口径不一致且注释误导** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：120 条是 DB I/O 优化，真正约束 LLM 上下文的是 2000-token 预算；读者以为 LLM 能带 120 条。机制：两处「120」魔法数散落路由层，注释写「120 条上限足够」。
- 证据：`router/chat.py:62,68,184`。 ｜ **闭环**：改名 `CONTEXT_FETCH_MESSAGES` 常量并统一放 `context/budget.py`，注释改为「DB 读取上限，LLM 预算见 `select_history_messages`」。

**CTX-5 · 截断用 `break` 而非 `continue`，粗放丢弃可容纳的中间历史（R5）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：`break` 假设「新到旧单调成本」，但消息长度非单调——一条长 SOAP 记录会把其后所有短消息连带丢弃，预算利用率低。
- 证据：`context/budget.py:50-51`。 ｜ **闭环**：改 `continue`（跳过超预算单条、继续纳入更旧可容纳消息）。

**CTX-6 · 无摘要/压缩，长会话早期轮次硬丢（R6）** ｜ P2 ｜ L ｜ 旧文档：未登记 —— **结论**：全仓无任何 summary/compaction，超预算直接丢弃；患者遗忘早期关键信息，且丢弃不可观测（仅 `ledger["history_dropped"]` 计数）。
- 证据：`context/**`、`patient_ai/**` 无相关实现；`assembler.py:71-79` 的分段 token 账本。 ｜ **闭环**：新增 `context/compaction.py`：`dropped>0` 时用一次轻量 LLM 调用把被丢轮次压成会话摘要，写入 `record.runtime_state`，作为**半稳定段**插在 EXAMPLES 之后、HISTORY 之前（不破坏稳定前缀）。

**CTX-7 · 保底集 `is_floor` 无条件且无上限，可击穿预算（R7）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：最近 8 条即使总量巨大也全保留，极端长消息（附大段粘贴）会让 history 段远超预算，且预算不是硬上限。
- 证据：`context/budget.py:44-49`；`budget.py:47`（`if is_floor or cost <= budget`）。 ｜ **闭环**：给保底集设上限（如累计超 `budget*1.5` 时按同规则收敛）+ 单条消息硬截断。

**CTX-8 · 过滤 system 后可能产生连续同角色 / 历史以 assistant 开头（R8）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：DB 中夹有 `system` 事件消息时过滤后可能出现 `user,user`；奇偶长度决定后缀是否以 assistant 开头（预算 break 点可致奇偶漂移）。源报告标 `[INFERENCE]`：多数 OpenAI 兼容端点要求非 system 首条为 user。
- 证据：`context/budget.py`（过滤非 system 取后缀）；`assembler.py:60-62`。 ｜ **闭环**：返回前归一化（丢弃头部非 user 消息、合并相邻同角色消息）。

**CTX-9 · `note_collector._truncate_tokens` 按字符硬切（R9）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：仅在首个 note 超预算时触发，直接 `text[:max_chars] + "…"` → 截出半句，语义受损。
- 证据：`patient_ai/note_collector.py:24-27`。 ｜ **闭环**：改按句末标点（。；！？/\n）就近截断。

**CTX-10 · few-shot 示例对与真实对话同角色（R10）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：示例与真实历史在 role 上不可区分（仅靠一行 `EXAMPLES_MARKER` 区分），而真实历史可能被裁到很稀薄 → 极端情况下模型把示例当上下文续写。
- 证据：`context/examples.py:13,19-42`。 ｜ **闭环**：保留 marker，并考虑示例 content 前缀加统一标签或并入单条 system 块。

**CTX-11 · 两条连续 system（STATIC + SESSION）可合并（R11）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：无实际故障，仅消息条目开销与可读性；人设与病例同属「稳定设定」。
- 证据：`context/assembler.py:44-47`。 ｜ **闭环**：合并为单条 system（低优先）。

**CTX-12 · 「静态前缀只算一次」的缓存承诺不成立（跨请求无缓存，R1）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：`STATE_PATIENT_CONTEXT_KWARGS` 存在 `ctx.state`，而 `ctx` 每请求新建 → 每轮 `cached is None` 恒成立，`build_context_kwargs` + `render_template` 每轮重跑；不影响 LLM token（输出确定、缓存仍命中），但 docstring 误导且白跑 CPU/模板渲染。
- 证据：`pipeline/middleware/prompt_builder.py:48,51-55`；`router/chat.py:_build_context`；`pipeline/prompt_context_builder.py:8`。 ｜ **闭环**：对 `build_context_kwargs` 加 `lru_cache`（按 case_snapshot 稳定 hash/`case_id`），或会话初始化时写进 `runtime_state`。

**CTX-13 · 没有全局 prompt 上限** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：只对 history 段做预算，static/session/examples/state 无总封装，`assembler` 无全局 token 校验，也未按模型 context window 自适应 → 任何一段膨胀都不会被拦。
- 证据：`context/assembler.py`（无全局校验）；`context/budget.py:12`。 ｜ **闭环**：在 assembler 出口做一次全局预算校验与告警。

**CTX-14 · 工具循环无总量上限（R9）** ｜ P2 ｜ M ｜ 旧文档：未登记（跨域：与 QA-8 同属工具循环） —— **结论**：仅限 5 轮 + 1 次强制终答（最多 6 次调用），**无累计 token/字符预算**；每轮 append 工具结果（`search` ≤500 字、`read_section` ≤1500 字）→ 上下文单调膨胀，单次 QA 最坏 6×30s。
- 证据：`infra/llm/client.py:168-214,179,192,283-292,314-323`；`qa/router/endpoints.py:43-54`（不传 `max_tool_rounds`）；`qa/router/tools.py`；`infra/llm/profile.py:41-47`。 ｜ **闭环**：加累计 token/字符预算与提前收敛提示，或收紧 `max_tool_rounds` 并按用途配置。

**CTX-15 · 评分 thinking + `max_tokens=16384` 的截断耦合（R8）** ｜ P2 ｜ M ｜ 旧文档：已登记（`defect-list` S9 的相邻面）`[INFERENCE]` —— **结论**：推理模式下 reasoning token 计入输出预算；对话越长 → 推理越长 → JSON 越易在 16384 处被截断 → 依赖 `safe_parse_json` 修复或走 `_fallback_scoring`；prompt 变大而 `timeout=120` 固定 → 超时→重试→4 次大生成。
- 证据：`infra/llm/profile.py:60-65`；`scoring/engine.py:76,648-677,213-261`；`infra/llm/parsing.py`。 ｜ **闭环**：监控 thinking 占比与截断率；为评分单设 reasoning 预算或按维度压缩输入。

**CTX-16 · `emotion_analysis` profile 被整体绕过（R2）** ｜ P1 ｜ S ｜ 旧文档：未登记 —— **结论**：该用途不走 `get_llm_config("emotion_analysis")`，只命中 `call()` 默认值 → 每次情绪分析最坏 3 次尝试、单次可挂 30s（非设计的 10s）；**无 JSON mode**（模型加 markdown/说明即解析失败）；输出上限 256 与 profile 的 128 不符。
- 证据：`patient_ai/emotion/analyzer.py:153-154`；`infra/llm/profile.py:86-94`；`infra/llm/client.py:118-122`。 ｜ **闭环**：`analyzer.analyze` 改用 `get_llm_config("emotion_analysis")` 透传并移除硬编码参数。

**CTX-17 · 情绪分析解析失败静默吞** ｜ P1 ｜ S ｜ 旧文档：未登记 —— **结论**：不用 `safe_parse_json`、无 JSON mode、无解析级重试 → 模型任何格式偏差即 `return EmotionAnalysisResult(events=[])`，4D 情绪系统静默冻结（信任/焦虑永不更新），仅一条 warning。
- 证据：`patient_ai/emotion/analyzer.py:158-159,165`；对照 `infra/llm/parsing.py`。 ｜ **闭环**：复用 `safe_parse_json`；对「空 events 且非空回复」加计数指标与告警。

**CTX-18 · 无主动成本闸门（R6）** ｜ P1 ｜ M–L ｜ 旧文档：已登记（`defect-list` S9 已登记；跨域：与 OPS-14 双轨记账、OPS-2 env 兜底同属成本链） —— **结论**：`ApiSecret.monthly_cost_limit` 只在 `admin/costs.py` 被 `func.sum` 求和用于仪表盘展示，**从不与 `monthly_cost_used` 比较**；唯一拦截是「失败型」（402/429/5xx/连续失败）。影响：预算用尽不预警、不降级；突发高并发（评分 16384 × thinking、两阶段并行）可瞬间超额。限流（chat 6/60s、qa 5/60s）约束的是调用频次而非金额（最坏 6 轮/分钟 × ~5 次 = 30 次调用/分钟/用户）。
- 证据：`modules/admin/costs.py:242`；`infra/llm/router.py:29-56`；`core/rate_limits.py:124-146`；`infra/llm/profile.py:60-65`；`scoring/engine.py:648-677`。 ｜ **闭环**：`select()` 前比较 `monthly_cost_used >= monthly_cost_limit` → 降级/改低价模型；再加每会话调用数上限；记账口径先统一（见 OPS-14）。

**CTX-19 · 缓存命中率不可观测（R7）** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：`metrics.py` 的 LLM 指标只有 calls/tokens/cost/latency，无 cache 维度；cache token 仅落库、无聚合告警 → CTX-2 或静态前缀被改动导致的缓存回退不可见。
- 证据：`infra/metrics.py:83-96`；`infra/llm/client.py:573-574,682-684`。 ｜ **闭环**：metrics 增 `cache_hit/(hit+miss)` 比率（可按 purpose），显著下降时告警。

**CTX-20 · 价格/时间基准未落到调用时刻（R12）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：`estimate_cost_cny` 支持 `at` 参数但所有调用点都不传 → 峰谷判定用「记账时刻」而非「调用时刻」，历史重算与实时记账在峰谷边界可能不一致。
- 证据：`infra/llm/token_counter.py`（`at` 参数）；`infra/llm/call_recorder.py:76`。 ｜ **闭环**：把调用 UTC 时刻透传到成本计算。

**CTX-21 · 文档漂移：注释指向不存在的 `core/llm_profile.py`** ｜ P3 ｜ S ｜ 旧文档：未登记（跨域：与 ARCH-6 的失效路径注释同类） —— **结论**：`config.py` 与 `.env.example` 写「配置已迁移至 `core/llm_profile.py`」，实际是 `infra/llm/profile.py`。
- 证据：`backend/core/config.py:108`；`.env.example`。 ｜ **闭环**：修正两处注释。

**已核实无问题（上下文/LLM 层）**：四域前缀隔离布局正确（静态人设/病例/示例在头部、每轮状态放**尾部**，per-turn 状态不打断下一轮可复用前缀——两份审计一致判定为「缓存友好」，**不要**把情绪/场景改成插在 history 之前的 system 段）；泄漏重试复用 `ctx.llm_messages` 原样 + 末尾追加修正 system，前缀逐字节保留；few-shot 以 user/assistant 对置于稳定前缀；情绪分析是独立小调用、不把情绪历史灌进患者上下文；`cache_hit/miss` 取供应商 usage 真值而非自算；成本按模型价而非 key 价（有单测）；thinking 默认显式 disabled、评分链单独开启并 `reasoning_effort=high`（防非评分链静默漂移）；评分输出三层容错（`response_format` + `safe_parse_json` 含截断修复 + fallback 结构化落库）；熔断/降级分型（402 余额型长 TTL vs 429/5xx 容量型）；按 purpose 的 semaphore + `LLM_WORKER_COUNT` 分割 + 异步批量写日志 + 溢出落盘；流式路径客户端重试置 0、重试改由上层用全新 stream；`emotion_analysis` 用 `max(msg.id)` 作 `turn_id`（勿回退）；`user` 字段设为 `record_id` 提供会话级缓存分区；`assembler` 输出分段 token 账本。

---

### QA-语音-工具

**QA-1 · QA 引用链路三处断裂：预检索恒空 → 原文弹窗恒 404 → 含 `/` 小节注入错误话术** ｜ P0 ｜ M ｜ 旧文档：未登记 —— **结论**：三层边界（生产键格式 / 注入 / HTTP 原文接口）靠同一条字符串协议各自解释，没有结构化键；检索器又缺中文分词，三处各自「看起来正常」。机制：整句问题交给检索而切词只在 `[,，\s]+` 处 → 中文整句 = 单个 term = 整串子串匹配（实测 8 个典型问题全部 0 命中）→ citations 为空即 return、RAG 上下文从不注入而 prompt 仍承诺「引用时注明来源」→ 前端只在 citations 非空时渲染引用卡；引用键拼成 `f"{chapter}/{heading}"` 而消费侧做 `sec["heading"] == section` 精确匹配（274 heading ∩ 367 section 串 = 0）→ `/api/qa/section-text` 恒 404；同一串切割还用于 `c["section"].split("/")[1]`，教材确有含 `/` 的 heading（`外科护理学_41_…md:142`）→ 切出 `"第二节 断肢"`，错误串被当作教材正文注入 system prompt。影响：QA「有据可依」卖点整体失效；含 `/` 小节在 RAG 路径上线错误内容。
- 证据：`modules/qa/router/tools.py:104-121,108,137`；`modules/qa/knowledge_base/chapter_index.py:130-133,176-191`；`modules/qa/router/endpoints.py:264-277,275`；`modules/qa/prompts.py:18`；`frontend/src/pages/QA.tsx:542,668`；`frontend/src/components/citation/CitationCard.tsx:26-36`；`data/textbooks/外科护理学/外科护理学_41_…md:142`。 ｜ **闭环**：`Citation` 增结构化 `chapter`/`heading` 并删拼接；`chapter_index` 中文按 2-gram 展开 term、空 terms 直接 return [];`get_section_text` 改调 `chapter_index.read_section`，删私有 `_ensure_index` 重复实现；`inject_search_context` 删 `split("/")`。

**QA-2 · 查体 `pain` 的 range 串未归一化 → 场景体征与「查体→情绪」桥接静默失效** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` P3 相邻；本条精确定位到 pain 分支） —— **结论**：唯一未走归一化的字段恰是两个病例在用的格式；失败分支各自静默兜底，无日志无告警。机制：`pain_score` 分支 `return str(nrs)` 而其余体征走 `_resolve_range`（range → midpoint）→ `float("4-6")` 抛 ValueError → `_vitals_patch` 返回 `{}`，`runtime_state.scene.vitals.pain` 永不写入；`exam_emotion` 同样失败 → `num=0.0` → NRS 4–6（应命中 `PAINFUL_EXAM` conf 0.7）不产生情绪事件。影响：2/11 病例疼痛读数不可用、场景/情绪副作用丢失；前端按 `d.result.value` 直渲，学生看到「疼痛评分 4-6 /10」。
- 证据：`tools/physical_exam_rules.py:352-360`；`tools/physical_exam.py:25-43,106-109`；`tools/exam_emotion.py:40-57`；`frontend/src/components/training/ChatDisplay.tsx:47-57`；`tests/training/test_physical_exam_rules.py:126-130`（近乎恒真的断言固化了该行为）。实测：`case2.json` pain `"4-6"`、`diabetes_foot_quiz.json` `"3-5"`；同文件血压 `138/82-148/90` 正确归一到 `143/86`。 ｜ **闭环**：`physical_exam_rules.py:359` 改 `return _resolve_range(str(nrs))`；测试改断言数值并补 `derive_exam_emotion_events("pain", <归一化值>, 1)` 用例。

**QA-3 · 工具审计的幂等回放丢失 `scene` —— 回放响应 ≠ 首次响应** ｜ P2 ｜ M ｜ 旧文档：已登记（`refactor-tools.md` §5.5 要求「每个工具响应带完整 scene」） —— **结论**：客户端以同一 `idem_key` 重试时拿到 `ok=true` 但 `scene=null` → 监护卡体征不更新（服务端已落库），表现为「测量成功但数值不变」。机制：序列化含 scene，落库只存 `payload["data"]`，回放硬编码 `"scene": None`；前端仅在 `res.scene` 存在时更新。源报告注明：当前前端每次新 UUID，故线上暂未触发；实现返回的也是 vitals 增量 patch 而非计划中的快照。
- 证据：`modules/training/tools/service.py:36-43,63-69,181-188`；`router/tools.py:33`；`frontend/src/hooks/useToolBridge.ts:45-47`；`tools/physical_exam.py:133-135`。 ｜ **闭环**：落库时连 scene 一起持久化并在 `_cached_action` 原样还原；同时定案 scene 是快照还是 patch。

**QA-4 · 未知 `op_type` 以 `ok=true` 返回，并写进审计与评分时间线** ｜ P1 ｜ S ｜ 旧文档：未登记 —— **结论**：`handle_operation` 对未知 op 返回 `{"type":"error", ...}`，而 `PhysicalExamHandler` 不检查该 `type` 直接 append + 写 `runtime_state`，`service` 以 `kind="physical_exam"` 落库，评分引擎按该 kind 全量读取 → 任何拼错/幻觉的 op（`note_source.py` 描述表里恰好存在 `vitals` 这一 op 名）会在审计时间线与评分输入里留一条伪查体记录，并计入重复测量与患者 AI 的操作次数。
- 证据：`tools/physical_exam_rules.py:276-278`；`tools/physical_exam.py:65-110`；`tools/service.py:181-183`；`scoring/engine.py:384-390`；`tools/registry.py:19-30`；`router/tools.py:29-33`；`patient_ai/note_source.py:31,49-99`。 ｜ **闭环**：未知 op 抛 `ValidationError`（或返回 None），handler 显式白名单，`_authorize` 增 action 白名单与 registry 同源。

**QA-5 · 工具错误契约三通道并存（raise 4xx / 200 ok=false / ok=true 带 error 载荷）** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：客户端须同时处理 400/403/200+ok=false/200+ok=true；handler 内校验成死代码（`_authorize` 先抛使 `ok=False` 分支恒不可达），误导后续改动（新增工具会照抄错的那套）。机制：未启用工具一处抛 `ValidationError`、另三处返回 `ok=False`；未知 action 文案中英混用；docstring 仍称「契约由各 handler 自行保证」与集中校验相反。
- 证据：`tools/service.py:84-87`；`tools/nursing_record.py:38,40,55,61`；`tools/quiz.py:19,31`；`tools/nursing_diagnosis.py:77,86`；`tools/physical_exam.py:50-51,56-57`；`tools/physical_exam_rules.py:278`；`tools/__init__.py:6-14`。 ｜ **闭环**：定一条策略（推荐 handler 只做域逻辑并抛 `core.exceptions`，`service` 统一映射 HTTP 与 `ok` 字段），删死分支，统一中文文案 + 稳定 `error_code`。

**QA-6 · TTS 无 provider 缝（Volc 具体类型穿透 router/app.state/service）+ 失败计费双轨** ｜ P2 ｜ M ｜ 旧文档：已登记（`refactor-tools.md`/`refactor-infra.md` 相邻；provider 缝未登记） —— **结论**：后端为零 provider 抽象（前端已有 `TTSProvider`/`AsrProvider` 两个缝）；加/换供应商要同时改 router + service + `load_tts_state`。另非流式仅成功时写 `VoiceCallLog`、流式两条路径都写 → 失败调用在计费与运维视图中不可见。
- 证据：`modules/voice/service.py:53-87,154-160,176,219,288-300`；`modules/voice/router.py:14-15,66,117`；`frontend/src/engine/tts/types.ts`、`browser-tts.ts`、`VolcTTSProvider.ts`、`engine/asr/types.ts`。 ｜ **闭环**：定义 `TTSCapability` Protocol，`TTSService` 只依赖 Protocol、Volc 实现留 `infra/tts`、装配移入 `load_tts_state`；失败路径补 `_write_log(status="error")`。

**QA-7 · LLM 工具调用异常被静默吞掉 + 空 query 产出垃圾检索结果** ｜ P1 ｜ S ｜ 旧文档：未登记（跨域：与 OPS-9 同一处 `client.py:303-308`，两份报告分别上报） —— **结论**：工具 handler 崩溃既无日志也无指标（对照 `tools/registry.py:26-29` 会 `log.exception`）；参数 JSON 解析失败静默 `args = {}`，空 args 进检索后 `terms = [query]` 兜底叠加 `str.count("")` 语义（= len+1）→ 实测 `search("")` 返回 5 条最长段、`match_count≈40061`，被当作检索命中注入 → 把 5 段无关正文当参考资料喂回模型（浪费 token + 误导）。
- 证据：`infra/llm/client.py:299-300,303-310`；`modules/qa/knowledge_base/chapter_index.py:131-133`。 ｜ **闭环**：`except Exception` 改 `log.exception(...)`（保留降级载荷）；`if not terms: return []`；`count(t)` 前跳过空白 term。

**QA-8 · 三套 range 解析 / op→体征键映射重复，含 ~60 行死代码** ｜ P3 ｜ S ｜ 旧文档：已登记（`defect-list` P3/P4 相邻） —— **结论**：`session.py:119-180` 的三个函数全仓零调用者，且是 `_resolve_range` 的第二份实现**语义不同**（BP 取下界而规则取中点；pain 取 `split("-")[0]` 而规则返回原串）→ 谁把它接回 seed 会让同一病例血压静默变数。另 op→键映射两份（`_VITAL_KEYS_BY_EXAM` vs `_VITALS_MAP`），同文件内还有 `_VITAL_NORM_KEY` 与内联 dict 重复。
- 证据：`training/router/session.py:93-101,119-180`；`tools/physical_exam.py:17-22`；`tools/physical_exam_rules.py:90-95,385-397`。 ｜ **闭环**：删死代码（或先让 seed/`_public_scene` 走 `_resolve_range`）；映射合并为 `tools/base.py` 单常量。

**QA-9 · `infra/volc/auth.py` 死代码，且是第二套 header 契约** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：`tts_headers` 唯一引用者是 `infra/volc/__init__.py` 与一个测试；真实 header 内联在 `infra/tts/client.py:318-325`（含 WS 握手必需的 `X-Api-Connect-Id`，`tts_headers` 没有）；URL 常量也是两套且 `auth.py` 的均未被引用；其 docstring 自称「unidirectional」与实际的 bidirection 协议不符。影响：按 `auth.py` 改鉴权会漏 header 直接握手失败。
- 证据：`infra/volc/auth.py:8-9,12-19`；`infra/volc/__init__.py:3-13`；`infra/tts/client.py:28,318-325`；`tests/infra/test_volc_auth.py`。 ｜ **闭环**：二选一——删 `infra/volc/`（含 `__init__` 与测试），或让 `client.py` 复用并补齐 header/URL。

**QA-10 · `schemas/training/exam.py` 孤儿（WS 工具通道残留）** ｜ P3 ｜ S ｜ 旧文档：已登记（`refactor-tools.md` §5.1 计划迁入 `schemas/training/tool.py`，未落地） —— **结论**：`ExamOperationResult/Response` 仅在 `schemas/training/__init__.py` 导出，全仓无端点/前端/openapi 引用；现行契约是 `modules/training/router/tools.py` 内联的 `ToolCommandRequest/Response`。影响：契约读者会在 `schemas/` 找到已死的「查体响应」模型，新契约不落在惯例位置。
- 证据：`schemas/training/exam.py:1-14`；`schemas/training/__init__.py:8,35-36`；`modules/training/router/tools.py:30-41`。 ｜ **闭环**：删孤儿与导出；`ToolCommandRequest/Response` 移入 `schemas/training/tool.py`。

**QA-11 · TTS 连接池在持锁状态下等待空闲连接（已登记 §5，未修复）** ｜ P2 ｜ S ｜ 旧文档：已登记（`refactor-infra.md` §5；源报告另注明 `refactor-infra` Phase 6 明确「不做」池锁，属生命周期任务） —— **结论**：等锁的其它协程全部串行化，池无法并发服务（容量=1 等价）→ 高并发句级 TTS（每句 3-5 请求）排队放大延迟。
- 证据：`infra/tts/pool.py:83-91,104-107`。 ｜ **闭环**：把「取/建连接」与「等空闲」拆开：持锁内 `get_nowait()`，`QueueEmpty` 则在锁外 `await self._idle.get()`，取到后回锁内校验上限并补建。

**QA-12 · 学生辱骂不触发任何 guard（GUARD 阶段为空）** ｜ P1 ｜ 见 PIP-12 ｜ 旧文档：未登记
- 本条与 PIP-12 是同一缺口在本域的侧面（工具/护栏层）：`guards.py` 只判 AI 身份泄漏、`leak_guard.py` 只判隐藏主题键，二者都不读取学生输入是否失礼；`builder.py` 的 GUARD 阶段无中间件。结论/证据/闭环详见 PIP-12 与 R3。

**已核实无问题（QA/语音/工具）**：训练工具调用是单一路径（`dispatch` 仅被 `tools/service.py:114,167` 调用，`TrainingToolRequest` 表与迁移已随 `d7182267` 删除，`TrainingAction` 唯一写入点，无第二张工具表/旁路写库，`router/ws.py` 已无工具分支）；QA 检索只有一份实现（`chapter_index.search`；`citations.py` 只做 base64 marker 编解码）；后端 ASR 全栈已删、抽象落在前端 `engine/asr/{types,index,webSpeech}.ts` 单实现单切换点，migration `0a3b2c1d4e5f` 已 drop `asr_*` 列；`chapter_index` 索引/读取本身正确（274 heading / 367 section 可列举可读取，`_parse_filename`/`_split_sections`/`_build` 无异常）；工具失败审计落库策略一致（`kind="<tool>:error"` 与成功行分隔，评分只读成功行）；四类工具的 `load` 只读动作零审计、不 bump revision（与契约一致）；`modules/exam/**` 不存在（只有 `schemas/training/exam.py`，见 QA-10）。已登记未修并经源报告核实：`defect-list` P3（查体=范围串→固定中点、`_compute_link_offsets` 零生效：11 个病例 5 项体征全部已配置 → `_apply_offsets` 恒不进入）、P4（查体三副本 + 评分数据源静默切换：`physical_exam.py:92-109` + `scoring/engine.py:384-395` 保留 runtime_state 回落）、T5（工具侧已由行锁 + revision 串行化，chat/persister 侧未修，见 PIP-15）。

---

### 鉴权-运维-成本

**OPS-1 · LLM 错误计数查的是永远不存在的状态值 `"error"` —— 告警与运维页恒为 0** ｜ P0 ｜ S ｜ 旧文档：未登记 —— **结论**：三处「错误数」口径互不相同，运维页 LLM 错误字段与 LLM 监控页同一指标不相等；`error_count_24h > 50` 的告警**结构上不可能触发**，`recent_errors`（错误类型 TOP5）恒为空数组。机制：生产端只写 `success`/`failed`（唯一插入点 `infra/llm/logging.py:162`），`"error"` 只出现在内存指标；`ops_queries` 用 `status == "error"`。影响：`/api/diagnose`（运维脚本/每日报告依赖）、`/admin/ops/dashboard`、`compute_alerts` 的 LLM 错误告警全部失明，provider 侧 402/429/5xx 恶化只能靠成功率间接发现。
- 证据：`infra/ops_queries.py:24,41,139,188,190,215-216`；`core/statuses.py:41-46`；`infra/llm/logging.py:162`；`infra/llm/call_recorder.py:94,103`；`infra/diagnostics.py:191`；`modules/admin/ops.py:154,156`；`frontend/src/pages/admin/SystemOpsPage.tsx:71,78`；对照正确口径 `modules/admin/llm_monitor.py:75,103`、`modules/admin/costs.py:175`。 ｜ **闭环**：统一为 `!= "success"`（或引用 `LLMCallStatus.FAILED`）；补单测（插入 1 条 failed 行断言 `error_count_24h == 1` 且 `query_llm_errors()` 非空）。

**OPS-2 · env 兜底一旦命中即永久粘住（进程级），且 `degraded_until` 熔断不可达** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` I3「env 兜底零记账零熔断」；跨域：与 CTX-18/OPS-5/OPS-14 同属成本链，另含 `LlmClientAudit` R6 与 §6.3） —— **结论**：DB 密钥全部降级时 select 回落 env 并把该 purpose 的 binding 覆盖为 env 单例，此后快路径永远返回它（它自己 `status="active"`），DB 侧永不重探，只有重启进程才能恢复 → 该 purpose 的调用全部走 env key，`ApiSecret.monthly_cost_used/total_cost_used/call_count_today` 不再增长、`_persist_stats` 不写，月度预算视图与 per-key 降级/优先级全部失效。同时 env 分支只写 `degraded_until/degraded_reason`、**从不设 `status="degraded"`**，而快路径只判 `status == "active"` → Phase 3 的 `degraded_until` 检查被绕过，「内存熔断」名存实亡。此外 env 记账是每进程单例（`LLM_WORKER_COUNT` 默认 2）且重启清零。影响：成本账、密钥优先级、`degraded_*` 指标全部失真，且无日志/指标提示「当前 purpose 在走 env 兜底」。
- 证据：`infra/llm/router.py:57,59,73,118-130,172-187,214-236,326`；`infra/llm/data.py:52-84`；`core/config.py:103`。 ｜ **闭环**：env 分支不进 `_bindings`，或缓存但加全局 `degraded_until` 并在 Phase 1 过期后重走 Phase 3；同时把「env 兜底中」打进 `degraded_by_reason()`。

**OPS-3 · 登录/注册限流可被客户端头直接绕过（已登记 I6，未修复）** ｜ P0 ｜ S ｜ 旧文档：已登记（`defect-list` I6；`refactor-guide.md:121` 记录诊断 token 移 header 已放缓、「真实 IP 取反代层」未做） —— **结论**：`X-Forwarded-For` 第一段由客户端伪造 → 每次更换该头即得新桶，10 次/5 分钟形同虚设（`register` 5 次/60s、`/api/telemetry` 5 次/60s 同样可绕，`infra/telemetry.py:160-162`）；反向后果是学校 NAT 下同 IP 全体共享 10 次/5 分钟被误伤（文案还写「请 15 分钟后再试」而窗口是 300s）。
- 证据：`core/rate_limits.py:69-72,79,84-86`；`deploy/nginx/iomt.205716.xyz.conf:47-48,64`；`infra/telemetry.py:160-162`。 ｜ **闭环**：反代 `real_ip` 模块或应用侧优先 `X-Real-IP`、否则取 XFF **最后一段**；`login_rate_limit` 改 IP + username 双维度；三处 `_get_client_ip`/`_client_ip` 收敛为一个函数。

**OPS-4 · 有 `user_manage` 的普通管理员可把任意用户提为 `super_admin`（且能顺手改其密码）** ｜ P0 ｜ S ｜ 旧文档：未登记 —— **结论**：`admin` 角色有 `user_manage` 但没有 `role_manage`/`api_manage`，却能给任意已存在用户设 `super_admin` 并在同一请求重设密码 → 随后用该账号登录即取得全部权限。系统在别的入口都做了越权防线（权限授予有 `_grantable` 守卫、register 限死 student/teacher、批量导入限死 student），唯独这里漏了 → 属无意遗漏。影响：权限体系被绕过；审计只记录「用户 A 更新了用户 B」。
- 证据：`modules/admin/users.py:160-170,369-372,561`；`modules/admin/roles.py:99-102`；`modules/auth/service.py:70-71`；`core/roles.py:25-38`。 ｜ **闭环**：改 `role_id` 前调用与 `roles.py` 同一套 `_grantable` 对比（越权抛 403）；禁止「重置他人密码 + 提权」同请求。

**OPS-5 · env 兜底的「记账/熔断」只写状态：无任何出口可观测** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` I3；与 OPS-2 同模块不同缺陷） —— **结论**：计数器（`call_count_today`/`consecutive_failures`/`degraded_reason`）全仓只有自增与定义，无读取方；`get_env_fallback_state()` 只返回 available/label/key_suffix/base_url/model 名，不含任何计数；`/api/metrics`、`/api/diagnose`、admin 密钥页都看不见 → 「钱花在 env key 上」只能靠刷屏 warning 猜。
- 证据：`infra/llm/router.py:76-88,216-235`；`modules/admin/secrets.py:241-242`；`infra/metrics.py`（`degraded_*_supplier` 只读 `_profiles`）；`infra/bootstrap.py:113-115`。 ｜ **闭环**：`get_env_fallback_state()` 补 `in_use`/`call_count_today`/`consecutive_failures`/`degraded_reason`/`degraded_until`；metrics 增 `env_fallback_supplier` 并注入；`/api/diagnose` 的 `llm` 段带上该字段。

**OPS-6 · 运维查询三层平行实现：内联 repository 复制 + ops_queries 第三套口径** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：同一张表的「总数/成功数/成本/延迟」在 5 个地方各写一遍 SQL；本轮发现的 3 个口径 bug（error 状态、时区桶、区间边界）全部是「复制时漏改一处」的产物；改一个指标要改 4 个文件。机制：`admin/costs.py` 与 `admin/llm_monitor.py` 是逐字重复的四个方法（注释自证 `# --- inlined from LLMCallLogRepository ---`，该类已随 `repositories/` 删除），`admin/costs.py` 再重复一整套 `VoiceCallLog` 助手，`infra/ops_queries.py` 用聚合写法实现第三份。
- 证据：`modules/admin/costs.py:42-70,81-124`；`modules/admin/llm_monitor.py:30-58`；`infra/ops_queries.py:20-127`。 ｜ **闭环**：在 `ops_queries` 落 `llm_window(db, since, until)`/`voice_window(...)` 返回全字段 dict，四个消费方改为调用并删私有助手。

**OPS-7 · 时间分桶基准不统一：同一份数据在 UTC 日与北京日之间摇摆** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：作者已在 `_local_date` 修了「日序列/分组」，但没修「今日/本月总量」→ **同一响应的两块数字基于不同日界**：北京 00:00–07:59 产生的成本出现在 30 日序列的「今天」柱里却被「今日成本」排除；每月 1 日 08:00 前（北京）的成本记进上月却出现在本月日柱里。影响：以中国学校为客户的成本/用量汇报跨零点/跨月错位，「本月已用 vs 预算」与序列自相矛盾。
- 证据：`modules/admin/costs.py:33-35,148-149,200,235-236,401`；`modules/admin/llm_monitor.py:85,214-215`；`infra/ops_queries.py:53-54`。 ｜ **闭环**：统一改用 `_local_date`/`_local_ts` 同族表达式（`ZoneInfo("Asia/Shanghai")`），并把两函数从 `costs.py` 提到 `ops_queries.py` 供两处复用。

**OPS-8 · `date_to` 半开区间 vs `end_date` 闭区间：同一个日期控件两种语义** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：同一个「截止日期」在 LLM 监控筛选/导出里是「不含当天」，在成本导出里是「含当天」→ 用户按 UI 选「到 9 月 14 日」在 LLM 监控里看不到当天任何记录（不是报错，是空结果）。
- 证据：`modules/admin/llm_monitor.py:149,182,195`；`modules/admin/costs.py:395`；`frontend/src/components/admin/monitor/MonitorTab.tsx:108,124-126`；`frontend/src/api/admin/llm.ts:22-30`。 ｜ **闭环**：统一为闭区间（`< date_to + 1 day`）或显式改名 `date_to_exclusive` 并在前端 `+1`；两处共用 `day_range()` 助手。

**OPS-9 · 成本/降级状态落库失败只记 DEBUG：账本静默丢写** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` I5 相邻；跨域：与 OPS-14 记账） —— **结论**：`_persist_stats` 是 DB 侧成本账唯一写手，一旦持续失败（连接抖动、行被删、长事务锁）内存计数与 DB 永久分叉，而现场连一行日志都没有（内部 `log.exception` 被 router 吞成 debug，root logger 级别 INFO → debug 不输出）。
- 证据：`infra/llm/router.py:284-286,346-348`；`infra/llm/data.py:52-84`；`infra/logging_setup.py:53`。 ｜ **闭环**：改 `log.warning(..., exc_info=True)` + 暴露 `persist_failures` 计数到 metrics。

**OPS-10 · 运维端点三套鉴权模型 + 4 个 admin ops 端点里 3 个无消费者** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` I6 覆盖 query token；端点冗余未登记） —— **结论**：同一个「运维事实」有三条通道三种准入（无鉴权 / 共享 query token / 权限），数据不一致时无法判断以谁为准；`/api/metrics` **完全无鉴权**却返回路由形状/延迟分位/LLM token 与成本/DB 池/内存；`/admin/ops/report` 与 `/ops/dashboard` 双出口且前者直接调用后者路由函数（改签名即断）；`/admin/ops/diagnose|errors|report` 全仓无消费者。
- 证据：`infra/diagnostics.py:22-62,65-70,90-95,103,115`；`modules/admin/ops.py:28,37,43,48,113,137,142`；`frontend/src/api/admin/ops.ts:66`。 ｜ **闭环**：(a) `/api/metrics` 加 `api_manage` 或裁剪到 health 级白名单；(b) `/api/diagnose` 接受 `Authorization: Bearer`（header 优先）；(c) 删未消费端点或补集成测试与前端入口；(d) `admin_ops_report` 改调 service 层。

**OPS-11 · 幽灵分层残骸：9 个顶层目录 + 368 个 `.pyc`（0 源码）** ｜ P2 ｜ S ｜ 旧文档：已登记（`docs/11` Phase 0/3/5「已消除」在代码层面成立；残骸清扫未登记；跨域：与 ARCH-1、PIP-11 同源） —— **结论**：四代目录演化每代只删源码不删 `__pycache__`，agent 列目录会看到两套并行分层的同名概念（`infra/` vs `infrastructure/`、`routers/` vs `modules/*/router/`、`services/`+`repositories/` vs `modules/*/service.py`），`.pyc` 名会暗示一份并不存在的 API 面（如 `services/llm_config.py`）→ 本轮任务书本身已被误导一次（`infra/cache`、`infra/realtime_hub` 实际不存在）。影响：仅本机开发/agent 导航与全文搜索；不影响克隆、CI、镜像与运行期（Python 3 不从无源码的 `__pycache__` 导入）。另有 3-4 处注释指向已消失路径（`core/config.py:108`、`infra/__init__.py:6,17`、`frontend/src/hooks/useTrainingWS.ts:9`、`infra/llm/client.py:3-4`）。
- 证据：`mess-arch-layering` 表 1（9 个死目录 + `__pycache__` 平铺残骸 + 4 个空测试目录）；`mess-auth-admin-infra` #12 的 pyc 计数（routers 60/services 46/repositories 22/contexts 117/middleware 2/bootstrap 5/infrastructure 43）；`git ls-files` 对这 7 目录零跟踪。 ｜ **闭环**：`rm -rf backend/{services,repositories,routers,infrastructure,profiles,contexts,bootstrap,middleware,prompts} backend/__pycache__ backend/tests/{admin,infrastructure,profiles,qa}/__pycache__ deploy/monitor/__pycache__`；顺手改 4 处失效路径注释；`docs/11` Phase 0 补一句「本机残留清扫」。

**OPS-12 · 「伪扩展点」残留：`training_type` 一路传参但完全无效** ｜ P2 ｜ S ｜ 旧文档：已登记（`docs/11:364-368` 已声明删除伪扩展点，参数与字典外壳留下了；跨域：与 PIP-9 的 `build_pipeline` 未用参数同源） —— **结论**：读者会以为按 type 分派 pipeline，实际任何 type 都走同一条链；新增第二种训练类型（导师方向 ASR）时不会报错、静默复用病史采集链路与评分 rubric，属「接错线也不响」的坑。机制：`build_pipeline` 与 `detect_capabilities` 的 `training_type` 形参未被使用而 39 处调用仍传；`admin/profiles.py` 为单元素列表写 4 个 `_TYPE_*` 字典（`_TYPE_HINTS` 无读取方）；`TrainingMode` 三值与 `training_type` 并存。
- 证据：`modules/training/pipeline/builder.py:15`；`modules/training/capabilities.py:75-77`；`modules/training/router/chat.py:82-86,203-207`；`modules/training/profile.py:30-35`；`modules/admin/profiles.py:27-59`；`core/statuses.py:47-63`。 ｜ **闭环**：二选一——删形参与 39 处实参、`_TYPE_*` 改字面量；或保留参数但显式 `raise NotImplementedError`。

**OPS-13 · 死代码/死状态面（逐条可删，均为「无读取方」）** ｜ P3 ｜ S ｜ 旧文档：部分已登记（`refactor-infra` 的队列 drain 已登记 I4 并明确不做） —— **结论**：这些「半截抽象/别名/错注释」是重构尾款，名字承诺的能力不存在，下一个人会照着名字用。逐条：`infra/scoring_progress.py:39-40` `get_progress` 无调用方且 `_store` 被外部读（`infra/diagnostics.py:137`、`modules/admin/ops.py:48`）；`modules/admin/secrets.py:43-44` `list_all()` 无调用方；`pipeline/prompt_context.py:47-53` 的 `namespaces`/`__bool__` 无调用方；`core/login_strategies.py:13-53` 的 ABC + registry 只有 1 个实现且键硬编码取用（微信模块已删，仅剩 `models/auth.py:49` 的 `wechat_openid` 列与迁移）；`infra/realtime.py:292` 旧名别名；`infra/queue.py:31-33` 文档的 semaphore 数字（10/10）与实际（`semaphore=200` 再按 `LLM_WORKER_COUNT` 均分）严重不符 → 按注释估并发会低估 20 倍；`infra/queue.py:45-46` docstring 称 drain 实际只 `cancel()`；`infra/llm/circuit.py` 文件名与内容（retry/backoff）不符，与 `infra/tts/circuit.py` 同名不同义。
- 证据：见上列各 `path:line`；另 `infra/llm/profile.py:57-76`、`infra/llm/client.py:92-96`、`infra/bootstrap.py:32`、`infra/__init__.py:21`。 ｜ **闭环**：删无读取方成员；`scoring_progress` 加 `count` property；`queue.py` 注释改实际值；`infra/llm/circuit.py` 改名 `retry.py`；删 `realtime` 别名并改调用点。

**OPS-14 · 成本记账双轨仍未合流（已登记 I5，未修复）** ｜ P1 ｜ M ｜ 旧文档：已登记（`defect-list` I5；`refactor-infra.md` 的处方是「统一为 DB key 价优先」，实际代码走了反向；跨域：与 CTX-18/OPS-2/OPS-5） —— **结论**：同一个「成本」两个数字，dashboard 的 `monthly_used` 与 LLMCallLog 明细/日序列来自不同公式，缓存命中越多的用途（patient_chat）分叉越大。机制：`token_counter` 按 **model 价 + 缓存折扣** 落 `LLMCallLog.estimated_cost`；`router.report_result` 只用 **key 价、不识别 cache 命中** 落 `ApiSecret.monthly_cost_used/total_cost_today`（key 未配价时密钥侧恒 0）。源报告实测：`seed.py:231-246` 把 flash key 价设成 1.0/2.0 与官方一致 → 差异被「恰好相等」掩盖，一旦按 pro 定价或缓存命中就分叉。
- 证据：`infra/llm/token_counter.py:104-112,121-129`；`infra/llm/router.py:276-279`；`infra/llm/logging.py:56`；`infra/llm/call_recorder.py:76`；`backend/seed.py:231-246`。 ｜ **闭环**：`report_result` 复用 `estimate_cost_cny(..., cache_hit_tokens=..., at=now)` 并删本地公式（或反向统一为 key 价优先），二者只留一个并同步更新 `refactor-infra.md` 的处方。

**已核实无问题（鉴权/运维/基建）**：`infra/` 与 `infrastructure/` 不是双实现分叉（后者无 `.py`、无 import）；旧分层未被真实导入，全仓唯一 `Repository` 类是训练域内部实现细节；权限模型无双轨（统一 `require_permission`/`has_permission`，未发现按角色名硬编码绕过；`"student"` 的 4 处硬编码查询只是取学生角色 id 做过滤）；登录策略无双轨（只有 password 一条，注册/登录与批量导入的角色白名单齐备）；`PgRateLimiter` 在 DB 异常时 fail-closed（rollback + raise，不静默放行），问题只在 IP 取值；`ErrorArchive` 轮转与查询边界（按 since 倒序、跨备份文件）自洽；`LogWorker._flush` 的逐条隔离真实（`begin_nested()` 退出 flush，单条失败只回滚该 SAVEPOINT）；`core/statuses.py` 与写入端一致——`VoiceCallLog.status` 确实会写 `"error"` → ops_queries 对 voice 的 `== "error"` 是对的，**错的只有 LLM 那两处**；诊断/运维的数据源主路径统一（`build_dashboard` 由两个页面共用）；XLSX/CSV 导出引擎单一实现且防注入（`=+-@` 前缀转义 + `MAX_EXPORT_ROWS`）；全局异常处理链路闭合（6 个领域 handler + 兜底 `Exception` handler 带 `exc_info`）。

---

### 前端

**FE-1 · 情绪轨迹图请求路径少一段 `records/`：整张图 404 后静默不渲染** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` U6 的兑现件；跨域：与本条同时存在 PIP-3 的端点缺字段问题，两者各自独立地让该功能失效） —— **结论**：错路径被 `as ApiPath` 强转掩盖（模板字面量不做校验，见 FE-13），编译期与运行期都无声 → 整块功能（刚为 U6 补的轨迹图）上线即死且死法不可观测。机制：前端请求 `/training/{id}/emotion-events`（同文件同类接口都写作 `/training/records/{id}/...`，仅此一处漏段），后端路由是 `/records/{record_id}/emotion-events`；`EmotionTrajectory` 在失败时 `events` 为 undefined → `chartData` 空 → `return null`，无 `isError` 分支。影响：学生结果页「情绪轨迹」卡片永远不出现，教师端同组件同样失效。
- 证据：`frontend/src/api/training.ts:46,49,52,104-106`；`backend/modules/training/router/session_views.py:189`；`router/__init__.py:3`；`frontend/src/pages/record-detail/EmotionTrajectory.tsx:50-60,76`；`pages/RecordDetail.tsx:130`。 ｜ **闭环**：`training.ts:106` 改为 `` `/training/records/${recordId}/emotion-events` ``（并把 FE-13 的模板串类型保护补上）。

**FE-2 · 续训情绪种子恒为 null：前端门控字段后端从不发送** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` U6/情绪 v2 相邻；跨域：与 PIP-3/FE-8） —— **结论**：v2 字段名（`comfort`/`state`）门控 v3 payload，恒假 → seed 分支永不执行。影响：任何「继续未完成训练 / 从记录进入训练页」都从 neutral + 50/50 起步，覆盖后端已持久化的 4D 状态与 `dominant_state` 标签，患者表情、情绪微条、initiative 基线全部错位。机制：前端要求 `typeof em.trust === "number" && typeof em.comfort === "number"`，而后端 payload 是 `trust/anxiety/irritation/cooperation/dominant_state`；仓内唯一还带 `comfort` 的 schema `schemas/training/emotion.py:4-9` 全仓零引用（v2 死结构）。
- 证据：`frontend/src/engine/TrainingDataContext.tsx:94-102`；`engine/TrainingEngine.tsx:248-256,279-284`；`stores/trainingStore.ts:133,199-208`；`backend/modules/training/patient_ai/emotion/renderer.py:105-117`；`router/session_views.py:301-306,373`；`backend/schemas/training/emotion.py:4-9`。 ｜ **闭环**：门控改用 4D 字段并返回 5 键；`trainingStore` 的 seed 入参删 `comfort/state`；随 v2 结构一并删除 `EmotionState` 相关回退。

**FE-3 · 学生结果页 3 个死按钮（含「重新评分」）：U3「已修」结论不成立** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` U3 判「已修」，源报告核实不成立；NextStepsInventory 亦记为 DONE-BUT-NOT-CLOSED） —— **结论**：U3 用「全前端已无 `onClick={() => {}}`」的文本断言判为已修，而这些空实现换成了 prop 透传形式 → 断言失配，死按钮回归且被记为已修。影响：学生结果页「重新评分/请求评分/刷新状态」「查看详细评分」「导出记录」；教师详情页「查看详细评分」。评分失败在实测里占 15.8%，学生点「重新评分」得到零反馈。
- 证据：`frontend/src/pages/RecordDetail.tsx:100,121-123`；`pages/record-detail/ScoreResultSection.tsx:120-129`；`ScoringPendingBanner.tsx:66-76`；`pages/admin/TeacherRecordDetail.tsx:331`；现有可复用实现 `api/training.ts`、`engine/ScoreManager.ts:280+`、`TeacherRecordDetail.tsx` 的 `handleExport`。 ｜ **闭环**：接真实实现（`onRetry`→`records/{id}/retry-scoring`；`onExport`→抽公共 export；`onDetailedScoreClick`→打开已有明细弹层），或删除按钮与 prop；删 `onReviewClick`（学生页恒 no-op）。

**FE-4 · 通知中心未读徽标：列表查询 `enabled: open` + 徽标只数已加载页** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：面板没打开过 → `items = []` → 徽标恒不显示（用户完全看不到有未读通知）；打开过之后最多只数到已加载的 N 页（每页 20 条封顶）；`markAllRead`/`markOneRead` 的乐观写只作用于本地 `items`，与 RQ 缓存是两份数据。另 `NotificationInboxPage.tsx` 有另一套列表/分页（同接口同 mutation、query key 参数形状不同），两处状态互不感知。
- 证据：`frontend/src/components/NotificationBell.tsx:24,31-38,42-51,55,141-162`；`backend/modules/training/router/scoring.py:591-620`（无未读总数）。 ｜ **闭环**：后端在 `PaginatedResponse` 补 `unread_total`（推荐，两处通知 UI 同时受益），或前端加一条轻量 `unread_only` 查询。

**FE-5 · 场景种子只发一次且无重连重同步：`scene:state` 事件可永久丢失** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：一次性 emit + 无回放 + 晚挂载订阅者 = 种子落在无人监听的时间窗内即永久丢失；重新握手也没有任何重新拉取/重放路径，注释宣称的「重连后可据此同步场景」从未实现（`training-ws:reconnected` 全仓无监听者）。影响：查体工具/场景卡片读到 `DEFAULT_SCENE`（clinic/day/supine）而非记录里的真实场景。
- 证据：`frontend/src/engine/TrainingEngine.tsx:279-284`；`engine/useSceneBus.tsx:11-19`；`components/training/SceneRenderer.tsx:121`（条件渲染）；`engine/MessageBus.ts:66+`（无回放）；`hooks/useTrainingWS.ts:116`；`stores/sceneStore.ts:5-14`。 ｜ **闭环**：给 `MessageBus` 加最小 sticky 语义（订阅时重放最后一条），或让 `useSceneBus` 直接接 RQ（`record.scene`）；给 `training-ws:reconnected` 挂真实处理器或删除该 dispatch 与注释。

**FE-6 · 语音对答：错误提示不可见 + `awaiting` 状态永不可达** ｜ P1 ｜ S ｜ 旧文档：已登记（`defect-list` U2 的同类抱怨以新形式回归） —— **结论**：半双工状态机的类型/文档与实现不一致；ASR 失败、「没听清」两类提示写进了永远不渲染的分支 → 学生松开麦克风后没有任何反馈，只看到一个「没反应的麦克风」。机制：`setPhase` 从不赋 `"awaiting"`；错误路径总是 `setPhase("idle")` + `setNotice(...)`，而 `showVoiceStatus = mode === "voice" && phase !== "idle"` → 只要 `notice` 非空就必然隐藏红字提示。
- 证据：`frontend/src/hooks/useVoiceDialogue.ts:19-20,24,106,112,163,171,177,193,206`；`components/training/ConversationComposer.tsx:59,221-231`。 ｜ **闭环**：`ConversationComposer.tsx:59` 改为 `mode === "voice" && (voice.notice != null || voice.phase !== "idle")`；删 `"awaiting"` 或真的进入该态并修注释。

**FE-7 · 情绪刻度双源 + `v <= 1 ? v*100 : v` 补丁** ｜ P2 ｜ M ｜ 旧文档：未登记（跨域：与 PIP-3/FE-8） —— **结论**：同一 bus 事件两种量纲，前端用启发式猜；0-100 刻度下合法值 `1` 会被乘成 100（该维条反向跳变），下一个读该字段的人无法判断该不该归一化。注：`EmotionTrajectory.tsx:76` 的 `YAxis domain={[0,100]}` 说明 0-100 已是既定契约（与 ContextAssemblyAudit 的「0-100 只是展示/SSE 契约」一致）。机制：SSE 与记录详情 seed 用 `round(x*100)`（0-100），而 `tools/exam_emotion.py` 用 `round(x, 2)`（0-1）→ `useToolBridge` 原样转发 → store 的 `norm` 启发式补丁。
- 证据：`backend/modules/training/patient_ai/emotion/renderer.py:105-117`；`tools/exam_emotion.py:118-123`；`frontend/src/hooks/useToolBridge.ts:48-54`；`stores/trainingStore.ts:356,361`；`components/training/EmotionIndicator.tsx:226`。 ｜ **闭环**：`exam_emotion.py` 改复用 `serialize_emotion_vector(saved.vector)` 并补量纲断言；前端 `norm` 改为纯整数化。

**FE-8 · 情绪 v2/v3 两套表示与两套配色映射并存** ｜ P2 ｜ M ｜ 旧文档：已登记（`defect-list` T8 已登记后端侧；前端双表示未登记；跨域：与 FE-2/FE-7） —— **结论**：同一条情绪有两个字段、两种标签空间、两套颜色表、一个启发式选择器，任何新增状态必须同步改 4 处；`use4D` 的判据在「4D 中性但 v2 非中性」时会显示 v2 标签，语义不可解释。机制：store 同时持有 v2 `emotion`（6 标签）与 v3 `emotion4D`（9 标签），显示层 `use4D = emotion4D !== "neutral" || emotion === "neutral"` 再逐字段 `??` 回退；`EmotionIndicator` 自带两套图标/颜色表与 store 的并行；`getEmotionColor` 生产代码零调用。
- 证据：`frontend/src/stores/trainingStore.ts:12-17,19-30,32-38,41-51,70-79,86-88`；`components/training/EmotionIndicator.tsx:60-84,221-225,245-272`；`ChatDisplay.tsx:37`；`FaceLabPage.tsx:224,299`。 ｜ **闭环**：store 只留 4D（删 `emotion/comfort` 与 `setEmotion/setTrustComfort`）；配色表合并为单一定义并删 `getEmotionColor`。

**FE-9 · 同一评分载荷三份手写类型，靠 `as` 强转互转** ｜ P2 ｜ M ｜ 旧文档：已登记（`docs/13` Phase 2「`ScoreData` 单源」未执行；跨域：与 ASG-13 同类） —— **结论**：服务端同一 payload 有 3 个不兼容视图（必填/可选、`ScoreDimension` vs `DetailScoreCategory`），类型系统不再保护调用点——`as` 让「后端少发 detail_scores」只在运行时暴露；生成类型里根本没有评分响应 schema（`api-types.gen.ts` 只有 `ScoreItem/ScoreReview*`）。后端 schema 里 `score` 是 `dict|None`，所以正确方向不是再手写第 4 份。
- 证据：`frontend/src/types/score.ts:23-36`；`engine/types.ts:48-55`；`components/training/scoring/ScoreCard.tsx:6,125`；`pages/RecordDetail.tsx:51`；`pages/admin/TeacherRecordDetail.tsx:60,199,242,355`；`engine/ScoreManager.ts:143-151`；`backend/schemas/training/records.py:93,106`。 ｜ **闭环**：以 `types/score.ts` 为唯一来源（`total_score` 改可选），删 `engine/types.ts` 的那份并把导入改指，清理 5 处 `as ScoreData`。

**FE-10 · `api/admin/api-management-types.ts`：迁移 shim 已成死代码** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：shim 的前提条件早已满足却没人删（生成类型已含 `priority`/`model_override` 与新字段，被 `Omit` 掉的 `config_count` 全仓已不存在 → `Omit` 是 no-op，该文件与生成类型完全等价）；4 个消费点继续引它，读者以为后端还没迁移。
- 证据：`frontend/src/api/admin/api-management-types.ts`；`api/api-types.gen.ts:2356-2382,2384-2453,2458-2473`；`api/admin/api-management.ts:11`；`components/admin/monitor/ApiManagementTab.tsx:11`；`SecretList.tsx:2`；`SecretModal.tsx:6`。 ｜ **闭环**：删该文件，4 处改为 `components["schemas"]["ApiSecretResponse"]`。

**FE-11 · 评分标准页「编辑→导出」会用错误的评分刻度覆盖 rubric** ｜ P1 ｜ M ｜ 旧文档：未登记（跨域：与 SCR-4 同源，前端是第三种方言的产地） —— **结论**：老师按 UI 指示改一处锚点再导出、替换 `rubric.json`，`raw_max` 从 38 变成 `total_max`(=100)、`raw_scale` 从 2 变成 1 → 之后所有评分的归一化分母与每项上限都变，历史分与新分不可比（38 分满分的原始分会被按 100 归一化，全班分数坍塌到 ≤38）；编辑器对这三字段完全无感，无提示无校验。机制：`draftToExport` 把 `scale/raw_max/raw_scale` 写死为 `1 / draft.total_max / 1`，而 `rawToDraft` 根本没读这三个字段；手写类型是同类第三份手写结构。
- 证据：`frontend/src/pages/admin/RubricPage.tsx:20-25,30-56,220,227`；`backend/modules/training/scoring/rubric.json`（`total_max:100, scale:100, raw_max:38, raw_scale:2`）；`scoring/validation.py:236-247,301-307`；`scoring/prompt_builder.py:23-26`；`router/score_review.py:72-76`。 ｜ **闭环**：`RubricData` 携带并从 raw 透传三字段（UI 只读展示），`draftToExport` 原样写回；或在导出前做一致性断言并明示。

**FE-12 · `scoreMax`（分数字母）在三个文件各算一遍，且含魔法兜底 `+30`** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：同一份 `detail_scores` 的「满分是多少」有三种口径，`+30`（无来源常量）会在条目缺少 `max` 时静默给出错误分母；学生页与教师页虽同公式但分母仍是两份。展示层还把它与 `recordScore.reviewed_total`、`scoreReview.total_score` 混用。
- 证据：`frontend/src/pages/RecordDetail.tsx:53-60`；`pages/admin/TeacherRecordDetail.tsx:230-238`；`components/training/scoring/ScoreCard.tsx:136-142`；`components/record-review/ScoreResultSection.tsx:84-88`。 ｜ **闭环**：抽 `getScoreDenominator(score)` 到 `types/score.ts` 或 `utils/score.ts`，三处调用同一实现；删除 `sum + 30`。

**FE-13 · `as ApiPath` 用在模板字面量上（30 处）：路径与类型的绑定形同虚设** ｜ P2 ｜ M ｜ 旧文档：未登记 —— **结论**：`ApiPath` 只能保护裸字面量（34 处 `satisfies ApiPath` 有效），模板字面量退化为 `string` → `string as ApiPath` 一定通过，**FE-1 的 404 就是这样漏过去的**；30 处占多数，读者无法判断哪些路径被真正校验过。
- 证据：`frontend/src/api/api-path.ts:1-13`；模板串清单 `api/training.ts:13,106`、`api/admin/roles.ts:21,26`、`api/qa.ts:15,18,26`、`api/stats.ts:8,11` 等 30 处。 ｜ **闭环**：模板串路径改为经生成类型的辅助函数或补 `satisfies` 检查，先修 FE-1，其余按改动频率分批。

**FE-14 · 大组件：6 个文件确实多职责，其余是「长但单一」** ｜ P3 ｜ L ｜ 旧文档：已登记（`docs/13` Phase 4「巨型页面拆分」未执行） —— **结论**：拆分收益只在「一个文件里有两个以上独立生命周期/数据源」时成立。需拆：`pages/TrainingSelect.tsx` 808 行/8 `useQuery`+3 mutation（三个 tab 一个文件）、`components/admin/monitor/MonitorTab.tsx` 588（统计概览 vs 日志表）、`components/admin/FeedbackTab.tsx` 683/11 `useState`/两套近重复统计图、`components/admin/UsersTab.tsx` 544/16 `useState`（另有 `_handleDeleteUser`+`deleteMutation` 死代码）、`pages/admin/AssignmentsPage.tsx` 526（内联 ~150 行 CRUD Modal）、`components/admin/cases/CaseForm.tsx` 493（AI 生成面板 8 个 `useState`）。判定 **keep**（长但单一职责）：`pages/QA.tsx` 706、`simulations/SimulationConsole.tsx` 538、`pages/admin/ScoreboardPage.tsx` 536、`pages/admin/TeacherRecordsPage.tsx` 490、`pages/face-lab/FaceLabPage.tsx` 485、`face/PremiumFaceArtwork.tsx` 483。
- 证据：源报告逐文件指标（行数 / `useState` / props / JSX 分支 / 内联子组件）。 ｜ **闭环**：按项抽命名文件，保持 `pages/*` 只做路由壳（目标 <300 行）。

**FE-15 · 跨文件重复实现：`updateParam` ×3、裸 `Table` vs `ResponsiveTable` 两套约定** ｜ P3 ｜ M ｜ 旧文档：未登记 —— **结论**：筛选状态（URL 同步、翻页复位）这一条产品规则有 3 份实现（前两者逐字相同，第三处仅多 `setOffset(0)`），改规则要改 3 处且必漏；表格约定二分——`components/ui/responsive-table` 封装分页/空态，另有 15 处直接裸用 `@mantine/core` 的 `Table` 手写 `thead/tbody`+空态。
- 证据：`frontend/src/pages/admin/ScoreboardPage.tsx:194-204`、`pages/admin/AssignmentsPage.tsx:99-107`、`components/admin/monitor/MonitorTab.tsx:95-105`；`pages/admin/TeacherRecordsPage.tsx` 等 15 处裸 Table。 ｜ **闭环**：抽 `hooks/useUrlFilterParams.ts` 三处改调用；裸 `Table` 逐页迁到 `responsive-table` 或用 lint 禁止直引入。

**FE-16 · 36MB 情绪变体头像被「已停用」的功能 eager 打进构建图** ｜ P3 ｜ S ｜ 旧文档：已登记（`defect-list` U6 的「情绪头像因论文截图停用」） —— **结论**：一个停用功能的资源目录无条件进入构建产物与构建耗时（`eager: true` 让每个文件都成为构建设备需求），死代码保留让「论文截图用稳定头像」这个临时决定变成永久负债。`frontend/src` 总量 43MB 中 40MB 是 PNG。不影响首屏网络（大 PNG 不被内联）。
- 证据：`frontend/src/utils/patient-portrait.ts:4-7`；`engine/TrainingEngine.tsx:120-125,240-247`（注释停用）；`__tests__/utils/patient-portrait.test.ts`；`utils/avatar.ts:32-35`（3.5MB 同样 eager）。 ｜ **闭环**：确认不再上线则删 `patient-portrait.ts` + 测试 + `assets/avatars/simple/*-{a,h,s,n}.png` 并删注释块；要保留则改 `{ eager: false }` 或移出 `src`。

**已核实无问题（前端）**：评分刻度 S1/S2/S5（已登记）的复核链路已自洽（`score_review.py:70-77` → `validation.py:273-299` 的 `display_to_raw` 与前端 `ReviewEditor.tsx:56-70` 契约一致，`_recalc_total_from_dimensions` 钳制后 `apply_score_mapping` 保 `[0,100]`）；SSE/WS 事件名与分发无静默丢弃（后端 WS 只 publish `scoring_progress`/`scoring_complete`/`scoring_failed`，前端 `useScoringNotifications.ts:15-58` 三分支全覆盖；SSE 侧 `api/sse.ts:88-96` 与 `side_effects.py:43-47` 一致）；通知类型枚举（后端 5 种）前端两处跳转分支全覆盖（`reminder` 为未使用预留项，非缺陷）；`Emotion4DLabel` 9 态与 `resolve_dominant_state` 输出对齐、`capabilities.gen.ts` 与后端 features 键一致；34 处 `satisfies ApiPath` 的字面量路径有编译期保护；`engine/training-record-types.ts` 以生成类型为准、属合理精化；U1（通知面板横向滚动）已修；长但单一职责的 6 个文件无需拆分。`defect-list` 残余（源报告与 NextStepsInventory 的一致结论）：U4 流式中断仍无「重试本消息」入口（PARTIAL）、U5 计时器硬截止已实施、U7 ScoreItem 展开仍是 `Group`+`onClick` 无 `aria-expanded`（PARTIAL）。

---

### 架构与 CI

**ARCH-1 · 幽灵分层残骸（9 目录 + 368 `.pyc`）** ｜ P2 ｜ S ｜ 旧文档：已登记（`docs/11` 声明已消除在代码层成立；清扫未登记）—— 详见 OPS-11（跨域，同一事实，`mess-arch-layering` M1 与 `mess-auth-admin-infra` #12 双报）。

**ARCH-2 · 前端 41 个测试文件没有任何自动执行入口** ｜ P1 ｜ S ｜ 旧文档：未登记 —— **结论**：`refactor-frontend.md:14` 把 vitest 明确当作 U 类修复的回归网（「测试即规格」），但这套网从未被门禁触发；根 `check:full` 的名称承诺「full」却漏掉整条前端测试面。机制：`check`/`check:full` 只含 `check:backend`(ruff+ty) / `check:frontend`(biome+tsc) / `test:backend`(仅 pytest)；CI 前端 job 只有 biome/tsc/openapi 同步；pre-commit 只有 lint-staged + tsc；`git grep -n vitest -- .github .husky package.json` = 0 命中（仅文档提及）。影响：前端回归静默腐烂，改 `engine/`、`components/training/` 时破坏既有测试不会被任何自动化发现。
- 证据：`frontend/package.json:12`；`frontend/src/__tests__/`（41 文件）+ `**/*.test.tsx`（7）；`package.json:11-17`；`.github/workflows/commit-format.yml`；`.husky/pre-commit`。 ｜ **闭环**：根 `package.json` 增 `test:frontend` 并把它并入 `check:full`；CI 前端 job 追加 `pnpm test`。

**ARCH-3 · 重构总纲承诺的三份验收脚本/清单（评审分歧 + 核实事实）** ｜ P2 ｜ M ｜ 旧文档：已登记（`refactor-guide.md:66` 的 `score-health.sql`、`refactor-infra.md:25,41,58` 的 `cost-health.sql` 与 `release-checklist.md`）
- 【评审分歧 / 核实事实】`mess-arch-layering` M3 与 `NextStepsInventory` #48/#49 均判定：审计基线 `5eb5e3a0` 下 `git ls-files | grep -E "score-health|cost-health|release-checklist"` 为空、仓库内不存在这三份交付物（`NextStepsInventory` 的 glob `scripts/*.sql` 也是 none）。**本次只读核实（2026-09-14 10:01–10:02）**：磁盘上三者**均已存在**但**未被 git 跟踪**（`git status --porcelain` 显示 `?? scripts/cost-health.sql`、`?? scripts/score-health.sql`、`?? docs/review/release-checklist.md`）；另有工作区改动把 `.github/workflows/deploy-*.yml`、`piops-*.yml`、`rollback-*.yml` 移动进 `.github/workflows/archive/`。
- 影响：`refactor-guide §6` 的验收表把「评分故障率 < 3%」等指标绑定在 `score-health` 上，脚本缺失则无法执行、Phase 1 的完成标准不可测量；文档自称「单一事实源」却与仓库实际交付物不符；任何按文档找文件的维护者会扑空（或找到未跟踪副本而误判已落地）。
- 证据：`docs/review/refactor-guide.md:66,76,190`；`docs/review/refactor-infra.md:25,41,58`；`docs/review/refactor-cases.md:95`；`.github/workflows/**`（`case-audit` 0 命中）；`git status --porcelain scripts docs/review`。 ｜ **闭环**：三份交付物要么入库并在根 `package.json` 暴露只读命令、要么从 `refactor-guide`/`refactor-infra`/`refactor-cases` 删除对应承诺（二选一，不许两存）。

**ARCH-4 · CI/hook 的文件循环未加引号 + 带空格的迁移文件名 = 触碰该文件即门禁误红** ｜ P2 ｜ S ｜ 旧文档：未登记 —— **结论**：未加引号的展开把 `backend/migrations/versions/data/mryjghn2d3as_clean invalid gender in users.py`（**已跟踪，文件名含 3 个空格**）切成 5 个 token，每个都落进 `case` 的 `*)` 兜底分支 → 输出「必须位于 versions/ddl/ 或 data/」的**错误结论**，而文件其实位置正确、内容合规（pre-commit 的 ruff/ty 同样会收到伪参数而报错）。触发条件 = 任何一次修改该迁移文件的提交/PR。
- 证据：`.github/workflows/commit-format.yml:92-98`；`.husky/pre-commit:19-21`；`backend/migrations/versions/data/mryjghn2d3as_clean invalid gender in users.py`。 ｜ **闭环**：`git mv` 该文件为无空格名（revision id 写在文件内，不影响 alembic 链）；CI 用 `while IFS= read -r f`，pre-commit 用 `xargs -0`。

**ARCH-5 · `docs/01-architecture.md` 与技术栈实况脱节（第一入口文档指向已删除的文件与方案）** ｜ P2 ｜ S–M ｜ 旧文档：未登记 —— **结论**：01 是新人 + agent 的第一入口，读到不存在的模块名会直接产生错误改动（去 `infra/llm/crypto_utils.py` 找加密、往 `phase_guard.py` 加逻辑），而 01 在「项目结构」段已声明「目录细节不再在本总览重复维护」——表内仍在重复且已过期。
- 证据：`docs/01-architecture.md:14,21,24,25,27,29,58,97,100` vs 实况 `frontend/package.json:17-22`（Mantine v9，无 tailwind/shadcn）、`@tabler/icons-react`、Fernet 相关文件不存在（有移除迁移 `137329b7b43c`）、`models/` 无 rubric 模块、实际路径 `modules/training/patient_ai/guards.py`、实际中间件为 `prompt_builder/llm_caller/persister/side_effects/emotion_analysis`、实际评分文件 `scoring/{engine,validation}.py`。 ｜ **闭环**：技术栈表按两个包清单逐行校对（加密行删除或改写为「API Key 明文存储，加密与轮换明确不做」）；患者保护/管道/评分段改为指向 `docs/11` 与代码目录，删硬编码文件名清单。

**ARCH-6 · 工作区仍声明已删除的 `sandbox` 包** ｜ P3 ｜ S ｜ 旧文档：未登记（跨域：与 CTX-21 的失效路径注释同类） —— **结论**：`pnpm run dev:sandbox` 必然失败（`--filter` 无匹配包）；`packages` 列表里放着不存在的成员，任何遍历 workspace 的工具链（缓存键、过滤安装）都会多出无效项。属「删目录没删引用」的典型半迁移残留（`sandbox/` 已由 `ee794dc9` 整树删除）。
- 证据：`pnpm-workspace.yaml:3`；`package.json:12`；`.gitignore:95`；`git ls-files sandbox` = 0。 ｜ **闭环**：删 workspace 的 `sandbox` 行与 `dev:sandbox`；`.gitignore` 注释改通用表述。

**ARCH-7 · 空测试包与失效命令名（同类引用漂移）** ｜ P3 ｜ S ｜ 旧文档：未登记 —— **结论**：每条都让人照抄一个不存在的东西：① `backend/tests/scene/__init__.py` 是该目录唯一跟踪文件（唯一测试已由 `286b5e91` 删除）→ `pytest tests/scene` 静默通过；② CI 提示「run `pnpm run api:update:all`」而 `package.json` 只有 `api:update`；③ `scripts/create-data-migration.js` 四处自述为 `.mjs`；④ 三个迁移的 slug 为 `--`（文件名不描述内容，docstring 里有描述）→ 迁移列表无法按名检索。
- 证据：`.github/workflows/commit-format.yml:199,245`；`package.json:20`；`scripts/create-data-migration.js:5,6,14,15`；`backend/migrations/versions/data/{mqo27fafw5eq,mrlze6snkjy4,mqwitf9lk76h}_--.py`；`backend/tests/scene/`。 ｜ **闭环**：`git rm` 空测试包；两处提示改 `api:update`；脚本 usage 改 `.js`；三个迁移 `git mv` 为描述性 slug（revision id 不变）。

**ARCH-8 · `case-audit` 未接入 CI** ｜ P2 ｜ S ｜ 旧文档：已登记（`refactor-cases.md:95` 声称 `case-audit --json` 是「独立门禁命令」；NextStepsInventory #29 判 PARTIAL） —— **结论**：`scripts/case-audit.py:9` 为 CI 返回 exit 1，但 `.github/workflows/**` 中 `case-audit` 0 命中——CI 只通过 `tests/cases/test_seeded_cases_pass_validator.py` 间接覆盖校验器；文档自称的独立门禁不成立。
- 证据：`scripts/case-audit.py:9`；`backend/tests/cases/test_seeded_cases_pass_validator.py:11`；`.github/workflows/**`（0 命中）。 ｜ **闭环**：CI backend job 追加 `uv run python ../scripts/case-audit.py --json`（或从 `refactor-cases.md` 删除该承诺）。

**已核实无问题（架构/CI）**：旧分层零代码引用（`git grep` 含未跟踪文件 0 命中，`main.py` 全部路由来自 `modules/` + `infra/`，`docs/11` Phase 0/3/5 的「已消除」在代码层成立）；`infra/` 与 `infrastructure/`、`modules/*/router` 与 `routers/`、`modules/*/service.py` 与 `services/+repositories/` 都只需删残骸、不需「选边」；CI/部署引用的文件全部存在（逐个 `test -e` 无 MISSING；`.husky/_/{auto-tag.mjs,check-migration-autogen.js}` 已 `git add -f` 跟踪）；`scripts/deploy-banner.sh` 不是死脚本（其调用的三个端点真实存在）；`scripts/push-retry.sh` 属手工工具；`case-audit`/病例校验器本身可用（`variant_of` 字段确实落地，与 `refactor-cases.md` 的「已落地」部分一致，不一致的只有「CI 门禁命令」这一句）；`check:api` 的三条 `.gen.ts` 路径均存在；迁移目录契约三方一致（`.husky/_/check-migration-autogen.js`、`.husky/pre-commit`、两个 workflow 措辞与判定一致，`alembic.ini:9` 与实际目录相符）；`docs/superpowers/specs/**` 的 47 处旧路径属带日期的历史快照；`modules/qa/knowledge_base/` 与 `modules/training/patient_ai/` 缺 `__init__.py` 属隐式命名空间包、无真实成本；根目录本地产物已 gitignore；`.env` 未被跟踪。

---

## 上下文核心专项（R1–R7）

### R0 装配全景（每次患者回复的固定 7 段）

| # | role | 段 | 来源锚点 | 跨轮稳定性 | 参与预算裁剪 |
|---|------|----|---------|-----------|:---:|
| 0 | system | STATIC 人设卡 | `prompts/patient.py:3` + `prompt_context_builder.build_context_kwargs` | 稳定前缀（同会话逐字节不变） | 否 |
| 1 | system | SESSION 病例 | `prompts/patient.py:35`（`PATIENT_DYNAMIC`） | 稳定前缀 | 否 |
| 2 | system | 示例标记 | `context/examples.py:13` | 稳定前缀 | 否 |
| 3 | user/assistant | few-shot 示例对 | `context/examples.py:19-42`（≤3 对、≤400 tok） | 稳定前缀 | 否 |
| 4 | user/assistant | HISTORY 真实对话 | `ctx.messages`（DB 最近 120 条）经 `context/budget.py:22-54` | 半稳定（append-only 增长） | 是 |
| 5 | system | PER-TURN 患者状态 | `context/patient_state.py:10-13` + `NoteCollector`（emotion 10 / identity_guard 20 / operation 30） | 每轮变（尾部） | 否 |
| 6 | user | 学生本轮输入 | `pipeline/middleware/prompt_builder.py:83` | 每轮变 | 否 |

入口 `prompt_builder.py:48` → `context/assembler.py:44-69`；`student`→`user`、`patient`→`assistant`（`assembler.py:61-62`）。主动追问**不在** `messages` 内：独立端点 `patient_ai/initiative.py:generate_initiative_llm` 自建单条 system 调用，不触碰聊天前缀。另两套独立消息序：情绪分析（`analyzer.py:139-143`）、评分（`scoring/engine.py` 的 `_build_history_messages`，内含整段对话 + rubric + schema，一次性）、QA（`qa/router/endpoints.py:117-121`）。

### 缓存与成本事实

- 供应商为 DeepSeek（OpenAI 兼容，`infra/llm/client.py:556`）；全仓库无 `cache_control`/`ephemeral`，依赖**自动前缀缓存**。
- 公共前缀 = 段 0–4；每轮只有段 5/6 分叉。段 5 被放在 HISTORY **之后**是关键正确设计（不是缺陷）；history append-only 天然命中 → 布局本身缓存友好。
- 唯一系统性破坏点：**history 裁剪**（CTX-2）——预算饱和后每轮丢最旧一条，从消息 0 起就不同 → 整段（含 STATIC/SESSION/EXAMPLES）miss。
- `cache_hit_tokens`/`cache_miss_tokens` 取供应商 `usage.prompt_cache_hit_tokens/miss`（`client.py:573-574,682-684`，流式从最后一个 SSE chunk 取并 `stream_options.include_usage`），**是回传真值而非自算**；但 usage 缺失走启发式估算时恒为 0 → 成本被高估（丢缓存折扣）。
- 调用次数：每轮学生发言 **2~3 次逻辑调用**（`emotion_analysis` + `patient_chat` + 泄漏修正最多 +1/2）。最坏 HTTP：流式 3 + 2×(1+2) = 9 次；非流式 3 + 3×3 = 12 次。评分独立后台：两阶段并行、各首试 + 重试 → 最多 **4 次大流式生成**（每次 `max_tokens=16384` + `enable_thinking=True`），全局超时 180s。
- 记账两套（OPS-14）：`llm_call_logs.estimated_cost` 用模型价 + 缓存折扣；`ApiSecret.total_cost_today/monthly_cost_used` 用 key 价、无缓存折扣、key 未配价时恒 0。
- 无主动成本闸门（CTX-18）；env 兜底内存记账每进程单例、重启清零、无对外出口（OPS-2/OPS-5）。
- 预算侧用字符近似（CTX-3）与账侧 usage 口径不同；`metrics.py` 无 cache 维度（CTX-19）。

### R1–R7 建议清单（编号与投入）

**R1 · 历史裁剪破坏前缀缓存**｜M｜未登记 —— **结论**：预算超过 2000 token 后每轮丢弃最旧的**不同**消息，数组首部变化 → 整段前缀缓存 miss，DeepSeek 自动缓存收益归零；成本与延迟同步上升，且当前无 cache 命中率指标可观测（CTX-19）。
- 证据：`context/budget.py:22-54`（从最旧端丢弃、首个超预算即 break、无轮次对齐）；`LlmClientAudit` R3；相邻项 CTX-1/CTX-5/CTX-7。 ｜ **建议**：按**整数轮**对齐裁剪边界（始终保留最近 N 轮完整对），使相邻两轮只做「尾部追加」；或把历史预算从 token 改为轮数窗口。投入 M。

**R2 · 情绪分析器绕过 profile**｜S｜未登记 —— **结论**：`emotion_analysis` 的实际参数与 profile 声明的（timeout=10 / `max_tokens`=128 / `max_retries`=1 / `json_object`）全不符：硬编码 `temperature=0.3, max_tokens=256`，落到 `call()` 默认（timeout=30、`max_retries`=2）→ 最坏 3 次尝试、单次可挂 30s；无 JSON mode 使输出加 markdown 即解析失败；解析用严格 `json.loads` 且异常时静默返回空事件 → **4D 情绪系统静默冻结**（仅一条 warning）。
- 证据：`patient_ai/emotion/analyzer.py:153-154,158-159,165`；`infra/llm/profile.py:86-94`；`infra/llm/client.py:118-122`；`LlmClientAudit` R1+R2。 ｜ **建议**：改用 `get_llm_config("emotion_analysis")` 透传并删硬编码参数；解析改 `safe_parse_json`；对「空 events 且非空回复」加计数指标与告警。投入 S。

**R3 · 敌意词表预闸**｜S（情绪侧）/ M（含评分维度）｜未登记 —— **结论**：辱骂/威胁在情绪系统里落不到任何语义事件——事件枚举封闭且只有 `judgmental_language`（-0.08/+0.08），经 confidence、人格敏感度、边界阻尼与每轮恢复后**结构上到不了 irritated 门槛 0.7**；回复侧另有 tone 死锁与 note 硬约束；护栏只有身份泄漏与隐藏主题，GUARD 阶段为空；评分 rubric 无职业素养维度（最坏仅经 `comm_04`/`comm_13` 丢 4/38）。结果：学生怎么骂，患者只「皱眉」，评分几乎不受影响。
- 证据：`emotion/events.py:67-83`；`analyzer.py:30,53-61,82-87`；`rules.py:59-64`；`engine.py:100-124,153-158`；`behavior.py:75-76,136-143`；`renderer.py:26-38,52-73`；`prompts/patient.py:28-30`；`prompt_context_builder.py:120`；`pipeline/builder.py:19-31`；`scoring/rubric.json:2-8,44-50,125-131`；`scoring/engine.py:339-344`；源：`agent://PatientAbusePath`。**核实补充**：合并时工作区已存在未跟踪的 `patient_ai/emotion/hostility.py`（确定性词表预闸，命中即产出 `INSULT`/confidence 1.0，默认只收「针对患者本人」的辱骂/诅咒/人身攻击，医疗歧义词不入表）——本文只记录该代码事实，不判定其覆盖范围是否足够。 ｜ **建议**：以「确定性预闸 + 语义事件类型」双层推进——① 词表预闸覆盖高确定性辱骂（已有模块，按需扩词表与反例测试）；② 新增 `VERBAL_ABUSE`/`THREAT` 事件与能跨 0.7 阈值的 delta，并在 analyzer prompt 里强制 confidence ≥0.9；③ 解除 tone/note 的升级死锁并补「拒绝继续/要求换人」分支；④ 人设卡补「被侮辱时按真人反应」例外；⑤ 评分增职业素养条目（`raw_max` 38→40）。①–③ 为必要条件。投入 S（①②③）/ M（含⑤与数据/rubric 联动）。

**R4 · token 口径**｜S–M（**评审分歧**）｜未登记 —— **结论**：预算侧与 note 侧两套字符近似（0.6/0.3 vs 1.5 char/token），与账侧的真实 usage 又是第三种口径；误差约 ±20–30%，直接决定 CTX-2 的裁剪点与 CTX-7 的击穿风险。
- 【分歧】`ContextAssemblyAudit` R4 判「投入 **M**：装真实 tokenizer（离线词表），字符近似降级为 fallback」；`LlmClientAudit` R10 判「**低风险/可接受**，投入 **S**：按真实 usage 反推校准，或直接以轮数窗口替代 token 预算」。两条都写。
- 证据：`infra/llm/token_counter.py:24-25,40-47`；`patient_ai/note_collector.py:24-28`；`infra/llm/logging.py:45-52`（usage 权威计数，缺失时 `token_estimated=1`）。 ｜ **建议**：无论选哪案，先让 note 侧与预算侧复用**同一个**函数（消除内部不一致），再决定是否引入真 tokenizer。投入 S→M。

**R5 · 逐句流式与守卫**｜M｜未登记（T1/T2 的修复选择了 collect-then-push，本条是其代价） —— **结论**：T1/T2 的修复方案是「全量收集 → 过守卫 → 一次性推送」（`stream_queue.put(full_reply)`），于是**整段生成期间零字节下发**——这不是边缘情况：单轮 total latency（情绪分析 LLM + note 收集 + 患者 LLM）一旦超过前端 `STREAM_IDLE_TIMEOUT = 60_000`，`reader.cancel()` 就会触发断线，进而撞上 PIP-1 的断线死代码（重试后同轮落两条消息、修正静默失败）。泄漏守卫仍需在推送前生效，所以「先守卫再推」不能简单放弃。
- 证据：`pipeline/middleware/llm_caller.py:144-206`；`pipeline/runner.py:50-53,63-66`；`frontend/src/api/sse.ts:36,48-52`；`pipelines/runner.py:78-88`（PIP-1）；`defect-list` T1/T2。 ｜ **建议**：把「守卫」下沉到**句边界**做增量校验（逐句/分片过身份与隐藏主题守卫后立即下发，命中则改走修正路径并撤回/覆盖该句），同时在生成期间发心跳帧把 idle 超时与「是否真有输出」解耦；配套把断线清理做成幂等（PIP-1/ASG-1 的重复轮次前提）。投入 M。

**R6 · 成本闸门**｜M–L｜部分已登记（`defect-list` S9；`refactor-guide.md:120` 记录 S9 按「评分截断 120→400、`max_tokens` 16k」缩范围执行） —— **结论**：`monthly_cost_limit` 只展示不执行，唯一拦截是失败型熔断；评分单轮最坏 4 次 16384+thinking 大生成，可瞬间超额；同时成本账本两套口径（OPS-14）、env 兜底熔断失效且记账无出口（OPS-2/OPS-5）、落库失败只记 DEBUG（OPS-9）→ 即使加了闸门也缺少可信的输入数据。
- 证据：`modules/admin/costs.py:242`；`infra/llm/router.py:29-56,276-279,346-348`；`infra/llm/profile.py:60-65`；`scoring/engine.py:648-677`；`defect-list` S9/I5；`LlmClientAudit` R4/R5；`core/rate_limits.py:124-146`（限流约束频次而非金额）。 ｜ **建议**：① 先统一记账口径（`estimate_cost_cny` 单出口，含 cache hit 与调用时刻）；② `select()` 前比较 `monthly_cost_used >= monthly_cost_limit` → 降级或改低价模型；③ 加每会话/每用户调用数上限；④ 把 env 兜底用量纳入同一账本并对外可见。投入 M（①+②+③）→ L（含生产对账）。 

**R7 · 评测台**｜M–L｜未登记 —— **结论**：上下文/LLM 层目前**没有任何离线评测或回归台**：仓库无 benchmark/golden/fixtures（对 `backend/modules`、`backend/tests` 的 bench/golden/regression_set/fixtures 检索零命中；`backend/scripts/` 只有两个 `gen_*_ts.py`）；`docs/ideas/context-mechanism-redesign.md:109-112` 承诺的 `CaseContext` 规范化 + golden 快照 + `Message.kind` 全未落地；`docs/10-training-system-roadmap.md:130` 的「真实浏览器端到端验收」未开始；可观测面缺 cache 命中率（CTX-19）与 thinking 占比/截断率（CTX-15），使 R1–R5 的收益与回归都无法测量。
- 证据：`grep bench|golden|regression_set|fixtures`（`backend/modules`、`backend/tests`）= 0；`backend/scripts/` 目录内容；`NextStepsInventory` #7（NOT STARTED）、#57（NOT STARTED）；`LlmClientAudit` R7/R8；`ContextAssemblyAudit` 的「契约/ledger 机制」（`assembler.py:71-79` 的分段 token 账本可作评测输入）。 ｜ **建议**：建轻量评测台——① 病例级固定输入集（含情绪/辱骂/长会话/含 `/` 教材小节等边界样本）跑 patient_chat 与评分，记录成本、token、cache 命中率、截断率、守卫命中率作为基线；② 把 `assembler` 的分段 ledger 与 `history_dropped` 计数接入告警；③ 与 `scripts/score-health.sql`/`cost-health.sql`（见 ARCH-3）分工：SQL 看生产分布，评测台看改动前后回归。投入 M（基线 + 指标）→ L（含 golden 快照与端到端）。

---

## 已核实无问题

> 以下为源报告在各自基线时点的**负结论**（「已修」「非缺陷」「无重复实现」），保留以避免后人重复审计；不等于当前工作区状态（合并时工作区有并行修改）。

**病例 / 迁移 / 数据**
- 覆盖范围内业务域无「模型改了迁移没补」；迁移图为单 root（`c23e1bfb8824`）、单 head（`d4f6a8b0c2e4f6a8`）、仅一处 merge；`models/__init__.py` 导出全部 32 个模型类。
- `data/cases` 11 个 JSON 顶层 key 集合一致（19 key，均无 `training_type`/`capabilities`/`exam_anchors`/`phases`），`tools.physical_exam` + `tools.nursing_record` 全量存在；`patient_info` 均为三键与 `PatientInfo` 一致（无未声明子字段被 dump 丢弃）。
- `seed.py` 的角色/权限/用户段幂等策略自洽，角色权限另有迁移兜底（`mreipemggvlq_resync_system_role_permissions`）。
- `feedback` 与遥测/诊断/运维域无重复建模（`Feedback` 在 `infra/telemetry.py`、`infra/diagnostics.py`、`infra/error_archive.py`、`admin/ops.py`、`infra/ops_queries.py` 中零命中）。
- `simulations` 三个端点都有前端封装与调用，无死端点；非法状态推进被显式拦截（幂等收尾 + 非 ACTIVE 拒绝动作）；快照对未揭示记录做白名单隔离。
- `scoreboard` 的 fallback 排除四处一致；复核分读侧已用 `COALESCE(reviewed_total,total_score)`；`admin/grades.py` 只用 `class_id` 做删除守卫，不推导提交状态。
- 病例内嵌 `tools.quiz` 与问卷 DB 表是**两个功能**（字段与消费链均不同），不构成题目结构双写；`assign_cases` 用 delete + 重插于 `unit_of_work` 内、配合唯一约束无重复；`scoreboard` 的 `assignment_status` 内部两条分支与 `list_all` 一致。

**评分**
- INV-2（总分 = Σ条目分）真正落地（`validation.py:250-271` + `engine.py:488-489,502-514`，测试有效守护）；旧「维度分参与总分」路径已删净。
- INV-5 除 `assignments/router.py:107` 外全部 hunk 逐个核对（exports 2 / llm_monitor 1 / stats 6 / users 4 / assignments.service 3 / scoreboard 4 / session_views 3，含 `load_only`）；`effective_total` 与 SQL `coalesce` 语义一致（`reviewed_total=0` 时不回退）。
- 复核「不改分提交恒等」在两代 rubric 下都成立（57/3 与 38/2 的每项展示刻度恰好都是 5）；`_resolve_rubric` 优先用记录快照，未串用新口径。
- fallback 不进排行榜四处齐全；S8 超时预算单一来源（2 次尝试 + 30s 间隔 ≤180s < 210s 宽限，测试守护）；S7 重评竞态在当前结构下不可达（残余：`_persist_score` 无 upsert/版本号）；`retry_scoring` 宽限窗口 + 10 分钟 sweep 自愈；`lifecycle.py` 三函数语义自洽、`QueueFullError` 回滚路径正确；`tests/scoring/**` 7 文件 + `tests/scoreboard/test_scoreboard.py` 覆盖不变量、纯函数、prompt 渲染；`scoring/__init__.py` 无 eager import。

**训练管线 / 情绪**
- T1/T2/T3/T10 与 T4 的负结论见「训练管线与情绪」末段（含逐条锚点，基线时点）。
- 上下文组装只有唯一入口；`pipeline/prompt_context.py` 与 assembler 职责不重叠；`context/budget.py` 与 assembler 分工清晰，无第二份历史裁剪实现。
- session 状态机值集合收敛、跃迁点闭合（无并发双开；`completed/discarded` 幂等；`TrainingStatus.FAILED` 无写入点属可删项）；时间口径单一；`ws.py` 消费者分支闭合且心跳/`send_lock`/退订完整；SSE 帧契约（除 PIP-1）生产者与消费者对齐；120 条截断与情绪判定已解耦。

**上下文 / LLM 层**
- 四域前缀隔离布局正确（per-turn 状态放尾部，**不要**改成插在 history 之前）；泄漏重试复用原 `messages` + 末尾追加 system 修正，前缀逐字节保留；few-shot 以 user/assistant 对置于稳定前缀；情绪分析是独立小调用。
- `cache_hit/miss` 取供应商 usage 真值而非自算；成本按模型价而非 key 价（有单测）；thinking 默认显式 disabled、评分链单独开启并 `reasoning_effort=high`；评分输出三层容错（`response_format` + `safe_parse_json` 含截断修复 + fallback 结构化落库）；熔断/降级分型（402 长 TTL vs 429/5xx 容量型）；按 purpose 的 semaphore + `LLM_WORKER_COUNT` 分割 + 异步批量写日志 + 溢出落盘；流式路径客户端重试置 0；`emotion_analysis` 用 `max(msg.id)` 作 `turn_id`（勿回退）；`user` 字段设为 `record_id`（会话级缓存分区）；`assembler` 输出分段 token 账本。

**QA / 语音 / 工具**
- 工具调用单一路径（无第二张工具表/旁路写库，`router/ws.py` 已无工具分支）；QA 检索单实现；后端 ASR 零残留（抽象在前端单实现单切换点）；`chapter_index` 索引/读取本身正确；工具失败审计落库策略一致（错误行不污染评分时间线）；`load` 只读动作零审计、不 bump revision；`modules/exam/**` 不存在。
- 已登记未修并经复核仍成立（保留在分域清单）：`defect-list` P3、P4、T5（工具侧已串行化、chat/persister 侧未修）。

**鉴权 / 运维 / 基建**
- `infra/` 与 `infrastructure/` 非双实现；旧分层未被真实导入；权限模型无双轨；登录策略无双轨；`PgRateLimiter` 在 DB 异常时 fail-closed（问题只在 IP 取值）；`ErrorArchive` 边界正确；`LogWorker._flush` 的逐条隔离真实；`core/statuses.py` 与写入端一致（`VoiceCallLog` 的 `"error"` 是对的，**错的只有 LLM 那两处**）；诊断数据源主路径统一；导出引擎单一实现且防注入；全局异常处理链路闭合（6 个领域 handler + 兜底 handler 带 `exc_info`）。

**前端**
- 评分刻度 S1/S2/S5 的复核链路自洽（展示刻度 → `display_to_raw` → 钳制 → `apply_score_mapping` 保 `[0,100]`，与前端契约一致）；SSE/WS 事件名与分发无静默丢弃；通知类型枚举前后端全覆盖（`reminder` 为未使用预留项）；9 态情绪与 capabilities 键两侧一致；34 处 `satisfies ApiPath` 字面量路径有编译期保护；`engine/training-record-types.ts` 属合理精化；U1 已修；6 个「长但单一职责」页面无需拆分。

**架构 / CI**
- 旧分层零代码引用；CI/部署引用的文件全部存在；`scripts/deploy-banner.sh` 非死脚本；`push-retry.sh` 属手工工具；`case-audit`/病例校验器本身可用（`variant_of` 已落地）；`check:api` 三条 `.gen.ts` 路径存在；迁移目录契约三方一致；`docs/superpowers/specs/**` 属历史快照；隐式命名空间包无成本；根目录产物已 gitignore；`.env` 未被跟踪。

---

## 无法从代码判断

> 需运行期/生产数据或产品口径；每条标注所属域与源报告。

**病例 / 作业 / 问卷**
1. 老库 `cases.case_data` 的真实内容：内置病例是否仍是 C1/C2 修复前的旧文本；是否已有病例被教师编辑过而**已经丢了 `tools`**（CAS-1 的存量损伤面）。需 `SELECT id,name,case_data FROM cases` 快照。
2. 问卷后台是否曾被使用（`questionnaire_templates`/`case_questionnaires` 是否有行、`trigger_event` 的实际分布）——决定 ASG-7/ASG-9 是「恢复路由」还是「删除废弃」。
3. `completed_count > student_count` 是否已在生产发生（ASG-4）：需 `assignments.student_ids` 与 `training_records` 联合快照。
4. 重复问卷提交是否已发生（ASG-5）：`SELECT user_id,template_id,case_id,count(*) … HAVING count(*)>1`。
5. `scores.score_scale` / `simulation_sessions.state` 默认值差异是否已造成实际数据差异（CAS-5）：需 `\d+ scores` 与 `\d+ simulation_sessions`。

**评分**
6. `scores.rubric_snapshot` 与 `raw_total` 的实际分布（是否存在缺 `raw_scale` 的快照；57/3 与 38/2 两代占比）——决定 SCR-8 是纯理论还是现实可达。
7. LLM 实际返回「有 `detail_scores` 但缺 `total_score`」的比例（决定 SCR-1 的触发频率）；建议用 `LLMCallLog.response` 离线 regex 统计（不改代码）。
8. 前端复核编辑器提交的 `detail_scores` 是展示刻度还是 raw 刻度（`review_total_from_detail` 按展示刻度设计，若前端传 raw，复核分会系统性偏小）；需前端契约确认与真实请求样本。
9. 前端是否把 `detail_scores[dim].score` 当「维度得分」展示（SCR-9 #4 的界面影响面）。
10. 教师是否实际使用「只填评语」的复核（SCR-6 触发概率）。

**管线 / 情绪 / 上下文**
11. 历史 `prompt_snapshot` 是否还有 v1 行（决定 PIP-8 的兼容层能否只留 `schema_version`）：`SELECT count(*) FROM scores WHERE prompt_version=1` 或对 `training_records.prompt_snapshot` 做 `jsonb_typeof(...->'segments')` 统计。
12. SSE 60s idle 超时的真实触发率（PIP-1/R5 的严重度取决于「单轮 total latency > 60s」的比例），需 access log / `LLMCallLog` 时长分位数。
13. `training_session_emotion_event` 是否被仓库外的分析脚本/论文导出依赖（决定 PIP-2 契约方向）。
14. `emotion_analysis` 静默降级（全异常吞掉只 `log.warning`）的发生率——决定是否需要 `runtime_state.emotion_degraded` + 前端提示。
15. `initiative` 惩罚（信任 −0.08）在真实会话中的触发频次（`MAX_INITIATIVE_PER_SESSION=3`，只在真实触发后惩罚）。
16. 缓存命中率实际水平（当前无指标，CTX-19）与评分 thinking 占比/截断率（CTX-15）——R6/R7 的量级判断都需要。

**QA / 语音 / 工具**
17. 是否已有客户端以同一 `idem_key` 重试（决定 QA-3 实际触发率，若从未发生可降级）。
18. 存量 AI 生成病例中 `exam_anchors` 的占比与质量（决定 CAS-4 迁移脚本规模与是否需要兼容期）。
19. 运维/计费是否依赖 `VoiceCallLog` 的失败行（决定 QA-6 后半优先级）。
20. 教师新增教材中出现含 `/` 的 heading 的频率（决定 QA-1 第三处暴露面；当前语料 274 个 heading 中 1 个）。

**鉴权 / 运维 / 成本**
21. `/api/metrics` 是否真的公网可达（仓库内 nginx 只写 `location /api/` 全量转发，未见单独拦截；生产是否另有 WAF/allowlist）——决定 OPS-10(a) 的优先级。
22. env 兜底粘住的实际发生率（取决于线上 DB 密钥降级频率与重启频次）：需 `LLMCallLog.api_key_id IS NULL` 或 provider 名称分布历史。
23. `pro` 模型是否真的启用（全档 `deepseek-v4-flash`，`model_override` 可由 admin 设成 pro）——决定 OPS-14 的分叉幅度与 R6 的量级。
24. 多 worker 下 metrics/诊断缓冲的失真幅度（per-worker 进程内计数 vs DB 真值），需 2-worker staging 实测。
25. `/admin/ops/report|errors|diagnose` 是否被仓库外的脚本/定时任务调用（若线上 crontab 依赖，删除需先核实）。
26. 教师端 `EXPORT_DATA` 导出是否含学生姓名等隐私字段的合规要求（产品口径）。

**前端**
27. Web Speech「松开即发送」是否丢最后一小段（`session.stop()` 后立即 `finalize`，晚到的 final 结果被 `finalizedRef` 丢弃；丢字量取决于浏览器 `onend`/`onresult` 时序，需真机 Chrome/Edge 实测）。
28. 未读通知的真实分布（是否长期 >20 条）与后端是否愿意加 `unread_total`（FE-4 的方案选择）。
29. 情绪轨迹图 404（FE-1）在生产是否被网关层 alias/rewrite 掩盖（仓库内无 nginx 配置可证）。
30. `rubric.json` 的导出部署流程是否真有人用（FE-11 的优先级取决于此）。

**架构 / CI**
31. `pnpm-workspace.yaml` 的无效 `sandbox` 成员是否会让 `pnpm install` 直接报错（源报告 `[INFERENCE]` 认为只是空匹配；`pnpm run dev:sandbox` 必失败可由目录不存在直接推定）。
32. `score-health.sql` / `cost-health.sql` 是否以「仓库外的运维笔记本/SQL 客户端」形式存在（只能证明基线时仓库内 `git ls-files` 为空；合并时磁盘已存在未跟踪副本，见 ARCH-3）。
33. `docs/01-architecture.md` 的「最后更新」日期是作者有意保留的历史快照还是漏更新（若为前者，应在文档顶部显式标注「历史版本」）。
34. 三个 `--` 迁移名的成因（alembic slug 行为 vs 人工 `-m "--"`），不影响其「按名不可检索」的事实。
