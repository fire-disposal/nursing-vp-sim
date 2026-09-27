# 评分校准工作区（历史 W0 / W4 资产）

> 状态：**工作区已建立，校准未完成，当前停放**。本目录与 `backend/modules/training/scoring/judging_set.py`、
> `grade_policy.py` 构成既有校准机制；判例内容与阈值仍缺教师输入，但不阻塞 19-C0/U0。
> 未完成校准之前，系统**不授予任何能力等第**（`CALIBRATION_STATE = uncalibrated`）。

## 一、这份文档管什么

| 归属 | 内容 |
|---|---|
| 本文件 | 判例集格式、入选/排除规则、教师工作流程、预先登记的验收规则模板、能力等第阻塞 |
| `backend/modules/training/scoring/judging_set.py` | **可执行**的入选规则（哪些记录没资格当判例）与必须覆盖的边界类型 |
| `backend/modules/training/scoring/grade_policy.py` | 等第政策身份、数值分层阈值、未校准时能力等第恒为空 |
| [docs/19](../19-training-experience-next-generation-plan.md) | 当前 C0/U0 计划及 U0 后实验边界；不再把校准列为 U0 前置 |
| [docs/05](../05-llm-design.md) | 当前评分数据流与量尺（实现说明，不是教学有效性声明） |

校准**不是**“把分数调高”或“让优秀比例达标”：它要回答的是“这些证据与这条量尺能不能支撑我们说学生
做到了/没做到”。这属于能力等第与评分效度边界，不属于 U0 系统可用性结果。

## 二、判例集格式

去标识 JSONL，一行一条判例；同一记录只能出现一次：

```jsonc
{
  "case_id": "jc-2026-10-001",          // 判例自身编号（不是训练记录 id）
  "kind": "mechanical_coverage",        // REQUIRED_CASE_KINDS 之一（见下）
  "source": {
    "record_ref": "sha256:…",           // 训练记录的去标识指纹（不得写入学生身份）
    "case_revision": {"case": "咳嗽咳痰伴呼吸困难", "revision_no": 3},
    "assistance": {"mode": "guided"},   // guided | assessment | blind_box
    "scale": {"applicable_raw_max": 46.0, "raw_scale": 2},
    "rubric_content_id": "nursing_history_v1@abe982dbb9f1",
    "grade_policy": {"id": "nursing_history_grade", "version": 1},
    "student_turns": 12,
    "terminal_reason": "user_end"
  },
  "evidence_excerpt": [{ "kind": "message", "role": "student", "text": "…" }],
  "teacher_judgement": {
    "judge": "T1",                     // 教师代号（不写姓名）
    "verdict": "partial",              // reference_met | partial | not_met
    "item_verdicts": [{ "item_id": "comm_06", "verdict": "partial", "note": "…" }],
    "key_omissions": ["hist_04"],
    "judged_at": "2026-10-02",
    "ai_score_seen": false             // 必须先独立判定，再看 AI 分
  },
  "notes": "comm_06 判为 partial 的依据：患者已述起病时间，学生未继续澄清诱因",
  "reviewed_against_ai": {             // 看完 AI 分与原标签后的复核记录（可选，用于分歧分析）
    "ai_item_verdicts_differ": ["comm_06"],
    "comment": "AI 给了 2 分，本文认为只到 partial"
  }
}
```

去标识要求：不写学生姓名/学号/班级；`evidence_excerpt` 只保留判定所需片段；`record_ref` 用单向指纹。

## 三、入选规则（可执行）

判例**内容**由护理教师给出；**资格**由代码判定。`eligible_for_judging()`（`judging_set.py`）在任何
判例进入工作区之前先跑一遍，排除原因全部是机器可读码：

| 码 | 含义 | 为什么必须排除 |
|---|---|---|
| `insufficient_turns` | 学生回合 < 4 | 单回合无法体现"根据回答继续评估" |
| `training_not_finished` | 未正常结束（超时/患者中止/未完成） | 不是学生主动完成的完整访谈 |
| `system_degraded` | `scores.fallback` 非空 | 系统降级分不是学生能力证据（非 NULL 时也不进统计） |
| `no_raw_identity` | 无 `score_meta` | 原始量尺/规则身份不可知，不可与可比组混算 |
| `duplicate_source` | 同一记录重复导出 | 判例集计数即权重，重复会放大单例 |

必须覆盖的边界类型（`REQUIRED_CASE_KINDS`，登记时逐类计数，缺哪类由 `coverage_gaps()` 报出）：

`mechanical_coverage`（机械逐项 vs 按回答追问）、`empathy_without_content`（漂亮共情但关键内容遗漏）、
`concise_effective`（简洁有效 vs 冗长重复）、`volunteered_info`（患者主动提供信息后的确认与整合）、
`reasonable_uncertainty`（合理表达不确定性）、`no_intervention_result`（无干预结果可观察时的计划与评价方法）、
`genuinely_no_gaps`（真实无不足，反馈应为空）、`system_missing_evidence`（系统缺证，只作对照不进能力判断）。

## 四、教师工作流程

1. 先**独立**按任务评判（不看 AI 分、不看旧标签），记录到 `teacher_judgement`；
2. 再打开 AI 分与逐项判定，把"AI 与教师不一致"的条目记进 `reviewed_against_ai`（不一致本身是证据，不是要抹平的噪声）；
3. 开发判例与**留出判例分开**；留出集在阈值登记并冻结之后才允许运行。

> **单人判定即可**：不要求多位教师联合宣判，也不统计教师间一致性（维护者裁定该目标在产品上用不着）。
> 判例由负责该病例的护理教师给出并留痕即可；同一记录若有多人判定，按同一格式各记一条。

## 五、预先登记的验收规则（模板，**尚未登记**）

> 规则必须在看到留出集结果**之前**填写并由教师签字；见结果后不得降低标准。
> 下表的每个 `____` 都是待教师填写的空位，不是默认值。

| 规则 | 观测对象 | 阈值 | 登记人 | 登记日期 |
|---|---|---|---|---|
| 优秀参考表现识别率 | 留出集中教师判为"达到参考表现"的判例，AI 判为 `reference_met` 的比例 | ≥ `____` | `____` | `____` |
| 关键遗漏漏判率 | 教师标为关键遗漏而 AI 未单独指出的比例 | ≤ `____` | `____` | `____` |
| 条目级一致率 | AI 条目判定与教师条目判定一致的条目比例 | ≥ `____` | `____` | `____` |
| 重复评分稳定性 | 同一输入重复评分，条目判定翻转的比例 | ≤ `____` | `____` | `____` |
| 边界排序不反转 | "机械覆盖 vs 合理追问""简洁有效 vs 冗长重复"等对照组的排序方向与教师一致 | ≥ `____` | `____` | `____` |
| 阈值附近表现 | 展示分落在数值分段边界（±5）的判例单独复核通过率 | ≥ `____` | `____` | `____` |

通过上述规则后，才允许把 `grade_policy.CALIBRATION_STATE` 改为 `calibrated`（该改动是教学决定，
不是代码决定），届时能力等第才会出现在学生页、教师页与导出中。

## 六、发布策略：改规则必须升版本

`rubric.json` 的 `version` 是**人工维护的规则版本号**；改动锚点或量尺（`raw_scale`、条目集合、
分母）时**必须同时升版本**，不允许在同一个 `id@version` 下改规则后继续发布 —— 历史分正是因此
无法互相比较（见 [05](../05-llm-design.md) §三）。

新记录的 `scores.score_meta.rubric_content_id`（`{id}@{内容摘要}`）用于**事后识别**"同一个版本号下
规则是否变过"，它是审计线索，不是允许改动的许可。判例集与留出集必须记录各自的 `rubric_content_id`
与 `applicable_raw_max`，否则两次评价的"同一分"不可比。

## 七、当前状态与能力等第阻塞

已具备（代码侧，已验证）：

- 锚点真的送达评分输入，标题与真实量尺一致（`build_scoring_criteria`，见 `tests/scoring/test_evidence_and_applicability.py`）；
- 逐项原始分/上限/状态/证据引用落库（`scores.raw_detail_scores`），展示换算只是投影；
- 评分溯源身份落库（`scores.score_meta`：适用原始满分、`not_applicable_items`、rubric 内容身份、
  评分/反馈提示词内容身份、等第政策身份、辅助条件）；
- 不适用条目由病例声明、不进分母；系统未判定条目单独标记且不进统计；
- 反馈允许为空并解释其含义（不再强制凑不足/漏问）；
- 等第只由服务端政策给出，未校准时能力等第为空；
- 可比性分组（`comparability.py`）：跨量尺/跨辅助条件不计算"进步"。

**缺少的输入（只阻塞能力等第与评分效度声明，非 U0 阻塞）**：

1. 教师编写的正例/反例/边界例判例内容（8 类边界至少各一例）；
2. 护理教师对关键边界判例的判定记录（**单人即可**）；
3. 在上表登记、并签字的验收阈值；
4. 留出判例集（与开发判例分离）。

在上述输入到位并通过第五节的规则之前：

- **不得**启用能力等第（`capability_band()` 恒为 `None`，界面显示“尚未校准能力等第”）；
- **不得**宣称评分已校准或教学有效性已证实；
- 可以使用当前形成性反馈（逐项表现、证据、关键选择与下一次练习原则）；
- 可以执行 19-C0 上下文收敛与 U0 可用性评价，但 U0 结果不能反推评分效度或能力提升。
