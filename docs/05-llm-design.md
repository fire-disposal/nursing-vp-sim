# 05 — LLM 与评分：当前入口和量尺边界

> 更新：2026-09-27。本文描述机制，**不证明评分已校准或具备教学效度**。
> 评分改进已按 [19 — 正式训练深化计划](19-training-experience-next-generation-plan.md) W4 落地（锚点送达、原始精度、证据引用、
> 空反馈、等第政策、可比性分组）；**教师校准未完成**，能力等第在 [评分校准工作区](calibration/README.md) 的阈值签字通过前恒不启用。
> 旧 DB 动态 prompt、管理端在线调分及过时参数表不再作为实现说明。

## 一、代码导航

| 责任 | 入口 |
|---|---|
| 外部 LLM 调用 | `backend/infra/llm/client.py`，训练评分通过 `LLMClient` 调用 |
| LLM 配置与调用策略 | `backend/infra/llm/profile.py`；具体参数以代码与当前配置为准，不在本文复制常量表 |
| 患者提示词 | `backend/modules/training/prompts/patient.py`，由 workflow 与上下文装配消费 |
| 评分/反馈提示词 | `backend/modules/training/prompts/scoring.py` |
| 评分标准 | `backend/modules/training/scoring/rubric.json`、`rubric_loader.py`、`rubric.py` |
| 模型评分输入 | `backend/modules/training/scoring/prompt_builder.py`、`engine.py` |
| 结果校验、量尺与展示投影 | `backend/modules/training/scoring/validation.py`、`mapping.py` |
| 证据引用定位 | `backend/modules/training/scoring/evidence.py`（纯函数：原文 → Message/Action/产物） |
| 任务边界与适用性 | `backend/modules/training/blueprint.py`、`backend/schemas/case_schema.py`（`blueprint`） |
| 关键选择投影 | `backend/modules/training/scoring/review_focus.py` |
| 等第政策（阈值与标签单源） | `backend/modules/training/scoring/grade_policy.py` |
| 可比性分组 | `backend/modules/training/scoring/comparability.py` |
| 判例入选规则（W0） | `backend/modules/training/scoring/judging_set.py` + [校准工作区](calibration/README.md) |
| 异步作业与重评快照 | `backend/modules/training/scoring/runner.py` |
| 有效成绩与统计范围 | `backend/modules/training/scoring/grade_scope.py` |
| 记录与复核 | `backend/models/training.py`、`backend/modules/training/router/score_review.py` |

提示词是代码内容，经 `core/template.py` 渲染；本文不再保留“从 prompt_templates 表加载、管理员热修改模板”的旧架构说明。调用成本、错误与运行排查见 [运维指南](09-operations.md) 和 [LLM 排查](ops/llm-troubleshooting.md)。

## 二、评分机制

1. 训练记录保存病例、患者 prompt 与 rubric 快照；含义与冻结边界见 [17](17-training-identity-and-state-contract.md)。患者 prompt 快照不等于评分 prompt 已被冻结；评分提示词的内容身份另存于 `scores.score_meta.scoring_prompt_id`。
2. 评分输入包含：**逐条行为锚点**（`build_scoring_criteria` 输出每个条目的 0/1/2 锚点，标题与真实量尺一致）、**本次任务边界**（病例蓝图：必须覆盖/情境相关/关键遗漏/可接受证据/典型错误/不适用条目/是否有干预观察机会）、对话原文、已记录的查体动作结果与已提交（冻结）的护理评估。四者缺一即视为证据不完整，由对应字段如实标注。
3. 逐项结果经解析、量尺钳制、幻觉维度剔除与缺失维度注入；**总分 = Σ条目原始分**，维度自评分只作展示快照。
4. 展示映射为 `round(raw_total / applicable_raw_max * 100)`：`applicable_raw_max` 是**本次适用的**原始满分 —— 病例声明不适用的条目（`blueprint.not_applicable_items`）不进分母，因此"无干预观察机会"这类不适用不会变成扣分。基础 rubric 19 项 × 2 = 38；启用护理记录维度追加 5 项（48）。
5. **原始精度与展示投影分列**：`scores.raw_detail_scores` 保存原始刻度的逐项分/上限/状态/证据引用，`scores.detail_scores` 只是展示投影（×factor 取整）。教师复核编辑原始条目、不复核取整后的展示项；不改条目提交时总分不变。历史记录没有原始层（NULL），只能按展示层反推并标注基准来源（`review_basis=legacy_display_derived`）。
6. 条目状态区分原因：`not_applicable`（病例声明不适用，score=null，不进分母）、`scored`（学生应做未做记 0 并说明要求与上下文）、`unscored_by_model`（模型未判定 → 记录级 fallback，**不进统计**，不冒充学生 0 分）。证据引用由服务端确定性定位；定位失败标 `evidence_verified=false`，界面显示"未能定位证据"。
7. 反馈允许为空：`weaknesses`/`missed_content` 可以是空数组并附 `explained_empty`（落库于 `score_meta.feedback_note`）；只有字段缺失/类型非法才触发补全重试。前端对空反馈给明确空态。
8. 有效成绩由 `COALESCE(reviewed_total, total_score)` 统一决定；教师给 0 分不能回退成 AI 分。来源由 `grade_policy.score_source()` 给出（`ai`/`review`/`fallback`），三类来源在学生页、教师页与导出中都独立可见；降级分不进正式聚合口径。
9. 等第：数值分层（good ≥ 85、medium ≥ 60）只是**数值描述**；能力等第由 `grade_policy` 单一来源提供，在校准完成前恒为空，界面显示"尚未校准能力等第"。历史记录上的旧 85/60 标签只作旧规则结果，不重新解释学生能力。
10. 可比性：`comparability.comparability_key()` 按病例 + rubric 内容身份 + 适用原始满分 + 辅助条件 + 等第政策分组；跨组不计算"进步"，缺 `score_meta` 的历史分单独成组（身份不明）。

算术一致、schema 合法、模型温度低都不等于教学评价有效。原始证据、展示分、数值分层、能力等第必须分开解释。

## 三、已确认的校准缺口

以下缺口**已在代码侧修复**（回归用例：`tests/scoring/test_evidence_and_applicability.py`、`test_score_contract.py`）：

- 锚点送达：`build_scoring_criteria` 现在逐条输出 0/1/2 锚点，标题与真实量尺一致（不再只发条目名称）。
- 反馈强制凑数：已取消；空数组是合法结果并带原因说明。
- 措施效果：无干预观察机会时（`blueprint.intervention_observable=false`）评价计划与评价方法，不要求也不奖励编造效果；`nr_05` 这类条目可由病例声明为不适用。
- 阈值单源：85/60 只存在于 `grade_policy.py`，且明确是数值描述。

**仍然存在的缺口（不是代码可补）**：

- 教师判例、留出集与预先登记的验收阈值尚未完成（**单人判定即可**，不要求教师间一致性）→ 能力等第不启用（见 [校准工作区](calibration/README.md) 第七节）。
- 维护者报告历史学生未拿过优秀、判例较严格。只读部署取证发现同一个 `nursing_history_v1@1.0` 对应多种历史量尺，不能只凭版本字符串混算趋势；完整证据和限制见 [19 第二节](19-training-experience-next-generation-plan.md#二现状证据与尚未成立的结论)。

## 四、后续改变的边界

[19](19-training-experience-next-generation-plan.md) W4 的九项要求已落地为上面的机制；**等第启用**仍需教师校准（W0 输入）。

不以提高优秀率为目标（`grade_policy.CALIBRATION_STATE` 不由分数分布决定），不静默覆盖历史成绩（历史分保持原值、缺原始层即标身份不明），不从缺失的原始数据伪造可比性（可比性分组把不可比记录分开），不把历史研究重评混成线上"重试评分"。

改锚点/量尺必须同时改 `rubric.json` 的 `version`：`scores.score_meta.rubric_content_id` 会记录内容摘要，使"同一个 `id@version` 下改过规则"事后可识别 —— 但识别不等于允许，正式发布策略仍是**改内容必须升版本**。
