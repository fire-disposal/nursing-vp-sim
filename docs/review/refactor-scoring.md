# 评分域重构指南（Phase 1）

> 基线：9410d921（`backend/modules/training/scoring/*` 43 提交零改动，行号有效）
> 缺陷映射：defect-list.md S1-S10。目标：**评分可信、区间合理、故障可见、成本可控**。

---

## 1. 问题盘点（缺陷 → 目标行为）

| # | 缺陷 | 现状（证据） | 目标行为 |
|---|------|------|------|
| S1 | 复核总分公式错乱（>100） | `validation.py:204-226` 换算落库 + `score_review.py:60-67` raw 公式重算 | 复核与初评同一换算路径；"不改分提交"恒等 |
| S2 | 总分 ≠ Σ条目分（条目是装饰） | `validation.py:250-265` 用 dim.score | 总分 = Σ(条目分)；维度分仅自评展示 |
| S3 | LLM 故障 = 0 分 = "已完成" | `engine.py:677-687,449-488,667-674` + `models/training.py:94-110` | fallback 落库标记 + UI 呈现 + 不阻断但不伪装 |
| S4 | 维度静默丢失 = 静默扣分 | `validation.py:229-233,268-280` + `engine.py:475-485` | 漏维度 → 阻断重试，仍失败 → 显式 fallback |
| S5 | 复核不写回 Score → 成绩单用 AI 分 | `score_review.py:65-69` + `scoreboard/service.py:148-149` | 成绩口径 = review（优先）否则 display |
| S6 | force 重评先删后算丢分 | `router/scoring.py:487-489` | 新分落库成功后再删旧（两阶段） |
| S7 | 重评竞态撞 unique | `models/training.py:99` + `engine.py:492-502` | 幂等 upsert + 版本号；旧任务晚写被版本拒绝 |
| S8 | 超时预算互相矛盾（实测 41 次超时） | `engine.py:60` + `router/scoring.py:199,272` | 重试总预算 < 全局超时 - 余量（常量单一来源） |
| S9 | 成本无闸门（65536 token + thinking） | `profile.py:57-76` + `engine.py:282,545-619,239-248` | 输入预算 + 输出上限 8k + 会话/用户配额 |
| S10 | "19 项"叙事 vs 实际 24 项 | `rubric.py:74-78` | 叙事对齐；护理记录维度显式标记 |

**实测支撑**（staging 2026-08-14）：467 completed → 74 条故障（15.8%）；33 条 0 分全在 2026-07；score_reviews=0；case1 avg 39.9 最低 / case5 max 65 / 全库无 >93。

## 2. 目标数据契约（Score 表演进）

```text
scores 表新增（迁移 ddl/ 新版本）：
  raw_total       float  NULL  -- 原始分（Σ条目分，0..raw_max），历史行回填 NULL 表示不可逆
  display_total   float  NOT NULL  -- 展示分（映射曲线版本化）
  mapping_version int    NOT NULL DEFAULT 1  -- 曲线/系数版本，展示语义随版本可解释
  fallback        jsonb  NULL   -- {kind: 'llm_empty'|'dims_injected'|'recalc_zero', note, attempts}
  dim_total       jsonb  NULL   -- LLM 维度自评快照（展示用，不参与总分）
  reviewed_total  float  NULL   -- 教师复核展示分（写回 Score，review 表仍存明细）
scores.record_id unique 保留；新增 (record_id, revision) 幂等键由版本号代替
```

**不变量（写进测试）**：
- INV-1：`display_total == apply_score_mapping(raw_total, raw_max, version)`（raw_total 非 NULL 时）
- INV-2：`raw_total == Σ(条目分)`（逐项聚合，条目在 detail_scores 内）
- INV-3：`fallback != NULL ⇒ 该分数在 UI 必须呈现故障标记，且不得进排行榜/平均分`
- INV-4：复核提交不改 raw 数据时 `display_total` 不变
- INV-5：review 写回后成绩口径 = `reviewed_total`（无 review 才用 display_total）

## 3. 文件级重构步骤

> 重设计核心（先想清楚再动代码）：**数据契约（§2）是重设计本身**——raw/display 双轨、Σ条目聚合、fallback 落库、复核写回，四项决定后，代码步骤是机械落地；反之先改函数就是打补丁。执行顺序：3.1→3.2→3.3（契约骨架）→ 3.4→3.5（rubric/复核）→ 3.6→3.7→3.8（配置/超时/成本）→ 3.9（前端契约）。

### 3.1 `backend/modules/training/scoring/validation.py`（重写核心）
1. `_recalc_total_from_dimensions` → 改为 `aggregate_item_scores(detail_scores)`：只累加 `items[].score`（以 `len(items)*raw_scale` 为维上限，钳制后求和）；**删除 dim.score 参与总分**（S2）。
2. `_validate_scoring_result`：把 `_validate_items_content` 的错误从"降为警告"改为**阻断重试**（S4 配套）；`EVIDENCE_COVERAGE_THRESHOLD` 从 log 改为可配置的阻断阈值（默认 0.5 → 低于即重试）。
3. `_convert_to_100_scale` → 改为纯函数 `to_display(raw, mapping_version)`：**不再就地修改** detail_scores（就地修改是 S1 的根源）；落库 detail_scores 保持 raw 语义，展示换算移到响应层（S1/S2）。
4. 新增 `validate_invariants(result)`：INV-1/INV-2 校验；不符 → 重试一次 → 仍不符 → fallback。
5. `_clamp_scores`：非数字 score 的处理从 `float()` 崩溃改为显式类型错误 → 触发重试（S4 配套，防整场 failed）。

### 3.2 `backend/modules/training/scoring/engine.py`
1. `_fallback_scoring`：产出 `{raw_total:0, fallback:{kind:'llm_empty',...}}` 而非裸 `total_score:0`（S3）；`_postprocess_scoring_result` 中 `_scoring_fallback` 从内存标记改为**写入 result['fallback']**（S3）。
2. `_persist_score`：写 `raw_total/display_total/mapping_version/fallback/dim_total`；用 `record_id + scoring_revision` 幂等（读 `record.scoring_revision`，旧任务晚写时 revision 不匹配 → 丢弃不写）（S7）。
3. `_load_record_and_messages`：加条数上限（与 chat 的 120 一致）+ token 预算（复用 `context/budget.py` 的 `select_history_messages`），超限截断 + 记录截断统计进 fallback.note（S9）。
4. `_build_feedback_messages`：改为**接收评分结果**（在 scoring 阶段完成后构建，或单次调用同时输出评分+反馈两段 JSON）；删除"并行双发"（S9 成本 ×2；顺带消灭"反馈不引用评分"的假话）。
5. `_stage_with_retry`：per-stage 超时改为从全局预算动态分配（`SCORING_GLOBAL_TIMEOUT - 已用 - 余量(15s)`）；重试消息不再全量重发（只发 partial + 修正指令）（S8/S9）。

### 3.3 `backend/modules/training/prompts/scoring.py`
1. 未涉及条目：`score=1, evidence="未涉及"` → `score=0, evidence="未涉及"`（产品决策 D1，需负责人确认；配合 33 分保底移除）。
2. 删除不可观察条目的评分指令（comm_08/comm_10/comm_02 若从 rubric 移除，这里同步）。
3. `SCORING_FEEDBACK_*`：明确注入 `{#scoring_result#}`（总分+逐项分+evidence 摘要），与 docstring"基于评分结果"一致。
4. 自检段增加"total_score 必须等于条目分之和"（双保险，即便 3.1 有强校验）。

### 3.4 `backend/modules/training/scoring/rubric.json` + `rubric.py`
1. 条目裁剪（产品决策 D3）：comm_08/comm_10 删除或改写为文本可观测行为（"主动确认理解""复述患者陈述"）；comm_02 改为"主动核对患者信息（姓名/年龄）而非直接复用界面展示"。
2. `build_final_rubric`：nursing_record 维度改为**独立子评分**（不并入 raw_max，或显式标记"护理记录分"），消除 S10 的"19 vs 24"叙事漂移。
3. 新增 `rubric_version` 与 `rubric_mapping_version` 强关联：换 rubric 必须换 mapping version。

### 3.5 `backend/modules/training/router/score_review.py`
1. 重算：`apply_score_mapping(aggregate_item_scores(req.detail_scores), raw_max, version)`（S1）；**校验 ≤ display_max**，超限 400。
2. **写回**：`Score.reviewed_total = 复核展示分` + `reviewed_at`（S5）；成绩单/排行榜/作业读取改为 `COALESCE(reviewed_total, display_total)`。
3. force 重评：改为两阶段——新评分成功落库后，事务内删除旧 Score/ScoreReview；失败则保留旧分并提示（S6）。

### 3.6 `backend/modules/training/scoring/mapping.py`
1. `ScoreMappingConfig` → `MappingPolicy`（版本化）：`{version, curve, press_factor, floor, raw_max, display_max}` 存 DB 或配置；`apply_score_mapping(raw, policy)` 纯函数；删除 `dimension_weights` 死配置（全仓库零引用）。
2. 文档注释更新："改配置即生效，无需重跑评分" 的表述删除——**展示分可重算，原始分不可重评**。

### 3.7 `backend/modules/training/router/scoring.py`
1. 超时：`SCORING_GLOBAL_TIMEOUT` 与 engine 的 per-stage 预算统一到一个常量模块；删除 `:272` 注释里的自相矛盾逻辑（重试序列 ≤ 全局 - 余量）。
2. 完成通知：`scoring_complete` 事件携带 `fallback != NULL` 时 body 加"评分异常，请查看"标记（S3 配套，防"0 分还庆祝"）。
3. 成本闸门：入队前检查 `LLMCallLog` 当日该用户成本（或简化：评分前查会话轮次/消息数上限），超限 → 返回 429/400 并提示教师人工处理。

### 3.8 `backend/infra/llm/profile.py`
1. scoring/scoring_feedback `max_tokens: 65536 → 8192`（thinking 保留但输出受控）；`temperature=0` 保留（配合 D4 的确定性采样）。
2. 如需更强确定性：评分阶段固定 provider（`purpose` 绑定不允许降级换 provider），并把 provider/model 写入 Score 快照（已有 model_name，补 provider_name）。

### 3.9 前端配套（Phase 5 入口，先立契约）
1. 评分结果展示双轨：明细显示 raw（0-3/条目、0-72/维度）+ 总分显示 display（0-100），附"映射版本 v1"小字。
2. fallback 徽章：`fallback != NULL` → 分数旁红色"评分异常（系统故障）"徽章，禁止进入成绩对比。
3. 复核编辑器：提交前本地预览"新总分"，>100 直接前端拦截。

## 4. 回归测试（克制：只保关键不变量，不逐项建测试）

> 现状：`test_scoring.py` 纯函数、`test_scoring_integration.py` 仅 prompt 渲染，核心路径（fallback/postprocess/review）无测试。**只补 5 个不变量回归**，其余靠 §6 的 staging 指标验证（score-health 数字比测试更能说明问题）。

| 测试 | 守护的不变量 |
|---|---|
| `test_review_unchanged_submission` | INV-1/INV-4：复核不改分 → 总分不变且 ≤100 |
| `test_total_equals_item_sum` | INV-2：总分 == Σ条目分 |
| `test_llm_empty_fallback_marked` | INV-3：兜底 0 分带 fallback 标记，不进排行榜 |
| `test_stale_task_write_rejected` | S7：旧 revision 不写库 |
| `test_fallback_excluded_from_scoreboard` | INV-3 前端侧：成绩口径 = COALESCE(reviewed_total, display_total) |

其余缺陷（S4 维度丢失、S6 先删后算、S8 超时预算、S9 成本）通过**代码结构与 staging 指标**验证（fallback 标记落库后 score-health 直接统计），不单独建测试。

## 5. 数据迁移与上线

1. **历史分不动**：旧 Score 行 `raw_total=NULL`（不可逆），`display_total` 沿用现值；`mapping_version=0` 标记"旧口径"；成绩单对 `mapping_version=0` 显示"历史分（旧口径）"。
2. 双轨期：新评分写全字段；旧分只读。排行榜口径切换（INV-5）与前端 Phase 5 同步上线。
3. 灰度：staging 跑满一个"作业周期"（≥7 天、≥100 条新评分），对比新旧口径分布；故障率目标 <3% 达成后合入生产。
4. 回滚：评分变更全部后端，前端仅展示契约；回滚 = 前端保留双轨渲染 + 后端切 mapping_version=0 分支。

## 6. 验收口径（摘自主指南 §6 Phase 1，附测量脚本）

- `scripts/score-health.sql`（Phase 0 固化）：failed+0 分兜底率 < 3%（基线 15.8%）；0 分兜底 100% 带 fallback 标记；case5/case1 难度-得分不再倒挂（或豁免记录）。
- 回归测试：§4 的 5 个不变量测试全绿。
- 产品确认：D1（未涉及→0 分）、D3（条目裁剪）、D4（provider 固定）三决策书面确认并落 doc。
