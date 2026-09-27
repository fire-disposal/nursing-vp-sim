# 历史训练深化批次验收记录（原 docs/19 W0–W6，2026-09-27）

> 本文件记录**实际执行**的验收与观察结果，不代替教师校准，也不代表已发布。
> 未执行的部分明确列为待办（含可直接复制的命令），不做"应当通过"的推断。

## 一、执行环境

| 项 | 值 |
|---|---|
| 代码 | 本工作树（未提交、未打 tag、未部署） |
| 后端 | `uvicorn main:app --host 127.0.0.1 --port 8000`，`DATABASE_URL=…/nursing_verify`（**本地验收库，非生产**） |
| 前端 | `pnpm dev`（`http://localhost:3000`，`/api` 代理到 8000，含 `ws: true`） |
| 迁移 | 新迁移 `b1c2d3e4f5a6`（`scores.raw_detail_scores` / `scores.score_meta`）已应用到验收库；启动时 schema 校验 `head=b1c2d3e4f5a6` 通过 |
| 生产数据 | **未读写、未修改**；未调用生产 `/api/diagnose` 等只读端点 |

## 二、已执行的验收

### 2.1 后端回归

```bash
pnpm test:backend          # cd backend && uv run python -m pytest -x -q
```

结果：**1615 passed**（新增：`tests/scoring/test_evidence_and_applicability.py` 23 项、
`tests/scoring/test_judging_set.py` 8 项、`tests/cases/test_case_blueprint.py` 31 项、
`tests/training/test_finalize_terminal_persisted.py` 2 项）。

### 2.2 真实 LLM 端到端评分（本地验收库）

脚本：建带教学蓝图的病例 → 发布 → 学生开始 → 真实患者对话两轮 → 提交护理评估并结束 →
等后台评分到终态 → 检查详情与复核。观察结果：

| 观察项 | 结果 |
|---|---|
| 评分终态 | `scoring_status=completed`，`fallback=null` |
| 逐项原始层 | 24 条：`scored=23`、`not_applicable=1`（`nr_05 评价环节的反思深度`，score=null） |
| 适用分母 | `applicable_raw_max=46`（48 − 2），展示分按 46 换算 |
| 溯源 | `rubric_content_id=nursing_history_v1@abe982dbb9f1`、`scoring_prompt_id=history_taking.scoring@13942e712838`、`grade_policy={nursing_history_grade,1}`、`assistance.mode=guided` |
| 证据引用 | 23 条得分条目中 **21 条**定位到真实记录（`message`/`action`/`artifact`）；2 条标 `evidence_verified=false` |
| 查体证据送达 | 模型给出的失分理由明确引用"未实施查体却记录的生命体征与肺部听诊结果" —— 证明查体与护理评估已进入评分输入（此前模板未引用该变量） |
| 等第 | `grade.capability_band=null`、`capability_label=尚未校准能力等第`、`policy.calibrated=false`；`numeric_band_label=数值参考 · 低` |
| 空反馈语义 | 本次非空，`score_meta.feedback_note` 解释了为何没有空数组 |
| 关键选择 | `review_focus` 4 条（含 `principle` 来自该条目 2 分锚点），无证据条目被排除 |
| 引导提示 | `guided_hints` = 2 条（领域 + 评估意义），非问句清单 |
| 教师复核基准 | `review_basis=score_meta`、`applicable_raw_max=46`、`not_applicable_items=['nr_05']` |
| **不改条目提交复核** | `review_total=48` == AI 展示分 `48`（不变量保持；§2.6 修复后复跑） |
| 学生可见复核 | `review_status=reviewed`、`reviewed_by=教师`、备注可见、`effective_total=48`、`source=review` |
| 复核后复跑（§2.6 修复后） | 24 条目（19+5，`nr_05` 不适用）、`applicable_raw_max=46`、`fallback=null`、带引用证据的条目**全部**定位成功（未定位 0） |
| 再练习（无家族） | `transfer` 入口 `available=false`（`reason=no_family_declared`，界面不渲染假入口）；`remediation` 可用 |
| 再练习留痕 | 同例纠正记录 `practice_snapshot.practice={kind:remediation,source_record_id:…}`，`from_assignment=false` |

### 2.3 迁移变式链路（真实 LLM）

把验收病例声明为 `variant_role=practice`（`family_id=w4-acceptance-cough`），新建同家族
`variant_role=transfer` 变式（同患者、同核心事实，改变线索表达与出现位置），发布门禁先拦下
一次缺 `family_id` 的声明（**门禁生效的正向证据**），补齐后通过。观察结果：

- 练习病例详情：`remediation` 与 `transfer` 两个入口都 `available=true`，带目标 `case_id`；
- `POST /api/training/start-practice {kind:transfer}` → 200，新记录落在变式病例上，
  `practice={kind:transfer,purpose:变式迁移练习,source_record_id:7}`，`from_assignment=false`（不占作业次数/不进作业成绩）；
- 变式记录自身（进行中）不再提供迁移入口。

### 2.4 缺陷发现与修复：训练终态不落库（P0）

现象：真实流程里 `/end` 返回 `record_status=completed`，但库里 `status=in_progress`、`end_time` 为空；
下一位学生的开始请求被"同时只能有一条进行中训练"挡住（实测 409）。根因与证据：

- `finalize_training` 先写 `record.status`/`end_time`，随后 `mark_terminal_reason` 走
  `patch_runtime_state`（`select(...).with_for_update().execution_options(populate_existing=True)`）；
- 生产 `SessionLocal` 是 `autoflush=False`，这次重读把**尚未 flush 的列改动**按库中旧值覆盖；
- 对照实验（同一段代码，两种会话语义）：

```text
autoflush=True  (测试夹具默认) → status=completed end_time_null=False
autoflush=False (生产 SessionLocal) → status=in_progress end_time_null=True
```

修复与验证：`patch_runtime_state` 在重读前显式 `db.flush()`（写入顺序不再决定成败，见
[docs/17 §2.4](../17-training-identity-and-state-contract.md)）；新增回归用例
`tests/training/test_finalize_terminal_persisted.py`——它自建 `autoflush=False` 的会话（共享夹具用的是
SQLAlchemy 默认值，正是这个差异掩盖了缺陷），**去掉修复即失败**（completed/discarded 两个用例都失败），
恢复修复即通过。修复后真实流程落库为 `status=completed, end_time 非空, terminal=user_end`。

### 2.5 其它已执行

- 发布门禁：蓝图引用悬空（`situational`/`key_omissions` 指向不存在线索）、`nr_*` 在未启用
  `nursing_record` 的病例上被引用、`teacher_reviewed` 缺 reviewer —— 均按预期报 error（见 §2.3 与用例）。
- 作者面：前端 `BlueprintEditor` 单测 13 项（未声明时不注入 blueprint、保存保持内容一致）。
- 工作区（由前端切片执行）：离页暂停改为鉴权 keepalive + 服务器确认；保存回执改为服务端响应驱动；
  TTS/ASR 降级可见；WS 断线不再误报"工具不可用"；`guided_hints` 优先。

### 2.6 独立复核与修复（批次复核）

对本批次 diff 做了一次独立只读复核（后端评分/门禁/数据安全 + 前端呈现），报出 6 处缺陷，**全部已修**并补了回归：

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | 分母取自**模型实际返回的条目**而非冻结 rubric：维度内漏答的条目会同时从分子分母消失 → 漏答反而抬高展示分，且不触发 fallback | 分数可被"答得少"抬高并进统计 | 维度内非 rubric 条目剔除；漏答条目回填为 `unscored_by_model`（score=null）并落 `items_backfilled` 降级标记；分母恒为病例声明的条目集合。用例：`test_denominator_comes_from_frozen_rubric_not_model_output`、`test_hallucinated_item_inside_valid_dimension_is_dropped` |
| 2 | 降级分（fallback）也投影"关键选择"：注入的未判定条目会被学生读成自己的关键遗漏 | 误导学生 | `get_record_detail` 在 `score.fallback` 非空时不投影；`build_review_focus` 只接受 `status=scored` 条目。用例：`test_review_focus_skips_unscored_and_not_applicable_items` |
| 3 | 记录列表把降级分标成「AI 初评」并当正常成绩展示 | 列表撒谎 | `TrainingRecordBrief` 增 `score_source`/`score_degraded`；列表与前端徽标显示「系统降级」 |
| 4 | 历史记录（无 `raw_detail_scores`）的原始层反推分支不可达（条件要求 `score_meta`，而历史行正是没有它） | 本批次之前的记录全部静默失去关键选择 | 条件改为"有展示层即可反推"，分母回落 rubric 原始满分 |
| 5 | 同例纠正未校验 `Case.is_open`（`/start` 与变式候选都有），再练习成为绕过"病例已关闭"的入口 | 门禁旁路 | 统一 `_require_startable_case(kind, case)`；用例 `test_closed_case_blocks_remediation`（去掉该门禁即失败，已实测） |
| 6 | `_stage_with_retry` 收到 `not_applicable` 形参但调用点没传 → 合法的 `score=null` 在重试提示里被说成"缺分数" | 无效重试与误导 | 调用点传入 `not_applicable` |

复核同时确认无问题的部分（摘要）：原始/展示两层无交叉写入（engine 深拷贝后再换算；force 重评快照已覆盖两个新列；复核只写 `ScoreReview` + `reviewed_total/reviewed_at`）、`applicable_raw_max==0` 与各类降级均被标记且被 `grade_scope` 排除出聚合、`grade_policy` 仍是唯一阈值来源、迁移纯增量且可逆、无任何回填或覆盖历史成绩的路径、再练习的鉴权/单开/版本钉住/作业隔离正确。

## 三、本轮补充执行

1. **后端全量**：`pnpm test:backend` → **1631 passed**（含本次新增的 7 项分母/关键选择/再练习门禁用例）。
2. **前端全量检查**：`cd frontend && pnpm exec tsc --noEmit` → exit 0；
   `pnpm exec vitest run` → **86 文件 / 582 通过 / 1 跳过**。
3. **浏览器走查（学生结果页 + 教师页）**：`pnpm dev`（`localhost:3000`）+ 验收后端（8000），
   以 `nursing-auth` 会话注入登录态后实访：

   | 页面 | 观察 |
   |---|---|
   | `/record/7`（练习病例，家族已声明） | 「有效成绩来源 · 教师复核」「数值参考」「尚未校准能力等第」「本次不适用」均出现；「关键选择回看」置顶，每条含原始分（0/2）、漏问徽标、判定理由、「下次练习原则」与「常见错误」；「同例纠正练习」与「变式迁移练习」两个入口都出现 |
   | `/record/5`（家族声明**之前**完成） | 迁移入口**不出现**（该记录的冻结快照没有家族声明）—— 符合"以记录冻结内容为准、不生成假入口" |
   | `/admin/records/5`（教师） | 「教师复核」「AI 初评」「本次不适用」「原始」等来源与状态标签可见 |

   顺带修正：结果页顶部"得分"卡片图标原为固定绿色（与分数高低无关却暗示"好"），改为中性色；
   等第语义仍只由服务端政策给出。

## 四、未执行 / 待维护者执行

以下项**本轮未完成**，不得据此宣称通过：

1. **工作区交互走查**（离页暂停、保存回执、语音降级、断线提示）：本轮由前端切片做过一次浏览器
   冒烟，但本记录未独立复核。建议启动 `cd frontend && pnpm dev`（需后端在 8000）后按下表走查：

   | 组 | 步骤 | 预期 |
   |---|---|---|
   | 学生 | 登录 → 「历史」→ 打开一条已完成记录 | ①「有效成绩来源：教师复核」与教师备注可见；②数值分层显示为「数值参考 · …」且同时显示「尚未校准能力等第」；③逐项显示原始分（如 1/2）与「本次不适用」；④「关键选择」在结果区顶部且证据可跳转到对话；⑤空反馈显示明确空态（不是「AI 未生成」）；⑥同例纠正/变式迁移入口只在可用时出现 |
   | 教师 | `/admin/records` → 打开同一记录 → 复核 | 编辑的是**原始条目**（0–2）；不适用条目不可编辑；未改动提交后总分不变；历史记录显示「复核基准不是原始量尺」提示；AI 初评/教师复核/系统降级三个来源各自标注 |
   | 工作区 | 开始一次训练 | 引导提示显示「领域 + 意义」而非问句清单（独立考核/盲盒不显示）；离开页面时只有在服务器确认后才提示已暂停；断开通知通道时提示只说"通知不可用"，不声称工具不可用；诊断面板的「已保存」来自服务端回执；语音降级时显示降级提示 |

2. **教师校准**（W0 输入，非代码可补）：判例内容、教师判定记录（**单人即可**）、在
   [校准工作区](../calibration/README.md) 第五节登记并签字的阈值、留出集。**完成前不启用能力等第**，
   也不宣称评分已校准或教学有效。

3. **发布动作**：未提交、未打 tag、未部署（按用户授权边界）。

## 五、安全与数据边界核对

- 未修改生产数据；本地验收库的新建病例（"W4 验收病例/变式"）仅存在于 `nursing_verify`；
- 未覆盖历史成绩、未批量重算、未从展示分伪造原始分（历史行 `raw_detail_scores`/`score_meta` 保持 NULL）；
- 未删除任何历史证据；`clinical_reasoning` 与 `simulations` 未接入本批次闭环、未新增第二套评分体系；
- 新增迁移只加两个可空列，历史行为 NULL = 身份不明（不可比），不回填。
