# 病例数据域重构指南（Phase 3）

> 基线：9410d921（`backend/data/cases/*` + `schemas/case_schema.py` + `modules/cases/generation.py`）
> 缺陷映射：defect-list.md C1-C4。

---

## 1. 定位与洞察（为什么这域最该先自动化的钱花在这里）

**业务需求**：病例是训练产品的**唯一内容资产**——10 个内置病例 + AI 生成入口，直接决定"学生学到什么"。数据错误（矛盾、医学硬伤）是**单位修复成本最低、伤害最高**的缺陷类别：一行 JSON 的错 = 一个班级学错一个知识点。

**单人开发 + AI 辅助**：手工审 11 个病例 + 未来 AI 生成的每一个病例，靠人肉不可持续。正确的形态是**内容生产流水线**：AI 生成 → 同一道校验器闸门 → 入库。校验器一次编写，永久守护，AI 辅助开发时它就是评审人的角色。

**快反维修**：病例问题通常是"学生反馈/教师发现"驱动——需要一个**一键诊断脚本**（case-audit），5 秒内列出全部嫌疑点，而不是打开 JSON 逐个读。

## 2. 现状盘点

| 项 | 现状 | 问题 |
|---|---|---|
| 文件 | `case1-10.json` + `diabetes_foot_quiz.json` | quiz 与 case2 同患者（李秀兰）病史冲突（C3） |
| 结构 | 顶层键一致；`tools.nursing_record` 类型不统一（case2/quiz 为 dict，其余为 bool） | 类型漂移，schema 校验无法强约束 |
| 示例 | case4 仅 2 条 example_dialogues（其余 3 条） | 一致性缺口 |
| 内容 | case3/case9 示例与病史矛盾（C1）；case6 三岁"前囟平坦"（C2）；case9 日期 2024 vs 当前 2026 | 教错学生 |
| 生成 | `modules/cases/generation.py` 产出 `hidden_info/exam_anchors`；内置病例只有 `deep_background` | 两个 schema 世界观（C4） |
| 时长 | 全部 `time_limit: 20` | 与 D5（硬截止 30 分钟）冲突：要么改数据，要么统一 `max(30, ...)`（推荐后者，见主指南附录 A） |

## 3. 病例校验器设计（`backend/modules/cases/validator.py` 新建）

> 单一入口，供 CI、AI 生成闸门、case-audit 脚本三方复用。纯函数 + 结构化错误输出（`list[CaseIssue{severity, field, message, fix_hint}]`）。

### 断言规则集

| 类别 | 规则 | 示例 |
|---|---|---|
| 时间线 | present_illness 中的时间锚点（"X小时前""X天前"）与主诉 duration 一致；example 对话中的时间不冲突 | case3"腹痛18小时" vs 示例"今天早上开始的" |
| 症状有无 | example 对话中的症状断言不得与 present_illness 的否定/肯定冲突 | case3"无明显呕吐" vs 示例"吐了两回了" |
| 人物关系 | social_history 的人物状态（去世/离异/独居）与 example 对话引用一致 | case9"丈夫5年前去世" vs "老伴把我扶起来" |
| 年龄-生理 | 年龄相关的查体/生理断言区间：前囟（<18 月）、生命体征按年龄分组的合理区间、儿科用药 | case6 前囟 |
| 类型统一 | `tools.nursing_record` 必须统一为同一 schema（bool 或 object 二选一）；physical_exam 键集合一致 | case2 dict vs case4 bool |
| 数量约束 | example_dialogues ∈ [3,5]；required_inquiries ∈ [10,18]；deep_background 键 ≥2 字且非空 | case4 仅 2 条 |
| 时效 | 病史中的绝对年份必须 ≤ 当前年份 | case9 "2024年2月" |
| 唯一性 | 跨文件 patient_info（姓名+性别+主诉域）去重；重复患者必须显式声明"变体"关系 | case2 vs quiz |
| 难度-内容 | difficulty 与 required_inquiries 数量/复杂度的弱相关性告警（供评分域校准参考） | case1 难度1 却 avg 最低 |

### 输出与门禁
- CI：`severity=error` 全量阻断；`warning` 允许通过但必须出现在 PR 摘要。
- AI 生成闸门：`modules/cases/generation.py` 两阶段生成后、入库前跑同一校验器；修复循环（现有校验-修复机制）改为吃 `CaseIssue.fix_hint` 喂回 LLM。
- 快反：见 §5。

## 4. 数据修复清单（文件级）

| 文件 | 修复 |
|---|---|
| `case3.json` | 统一呕吐/腹泻描述（改 present_illness 或改示例，二选一——**推荐改示例**，病史是评分依据）；统一起病时间锚点 |
| `case9.json` | 人物关系：删除"老伴把我扶起来"或改史实（推荐：患者自述"邻居把我扶起来"）；跌倒次数 3 次统一；日期 2024→当前年份 |
| `case6.json` | 删除"前囟平坦"（3 岁无前囟）；改为"头颅无畸形" |
| `case2.json` / `diabetes_foot_quiz.json` | 二选一：quiz 改为独立患者（改姓名/用药/病程），或 case_data 加 `variant_of: "case2"` 显式声明并统一冲突事实（推荐后者，保留教学变体价值） |
| `case4.json` | 补 1 条 example_dialogue |
| 全部 10 个 | `tools.nursing_record` 统一为 object schema（type/hints），或全部降为 bool——**推荐 object**（评分域 S10 已把护理记录做成独立维度，需要 hints） |
| 全部 10 个 | `time_limit` 改 30 或保留 20 + 代码统一 `max(30, ...)`（推荐后者，见主指南附录 A.3-1） |

## 5. case-audit 快反脚本（`scripts/case-audit.py`）

单人快反形态：一条命令，5 秒输出全库嫌疑点。

```bash
uv run python scripts/case-audit.py            # 全量校验 + 摘要
uv run python scripts/case-audit.py --json     # 机器可读（喂给 AI 助手做修复）
uv run python scripts/case-audit.py --case 9   # 单病例深查（示例↔病史逐条对照）
```

输出分组：`[ERROR] 医学/矛盾`、`[WARN] 类型/数量/时效`、`[INFO] 难度校准提示`。JSON 模式供 AI 代理直接消费（符合"AI 辅助"形态：脚本负责发现，AI 负责修，脚本再验）。

## 6. AI 生成病例接入

1. `generation.py`：`_validate_core_stage/_validate_derivative_stage` 替换为 `validator.py` 的对外规则（同一套断言，删除两套手写校验）；
2. 生成入口：`case_data` 入库前强制 `validator` 全量通过（error 级阻断）；
3. `schemas/case_schema.py`：`nursing_record` 类型收敛 + `variant_of` 可选字段；
4. 生成 prompt（`cases/prompts.py`）同步字段说明（hidden_info 与 deep_background 的关系已有文档，需与 validator 规则对齐）。

## 7. 测试与 CI（校验器即测试）

- **校验器本身就是守护**：`case-audit.py` 是运行时诊断 + CI 门禁，不另建冗余单测；
- 只补 2 个测试：`test_case_validator_rules`（每条规则 1 正 1 反，用 case3/case6/case9 现状缺陷做反例夹具）、`test_seeded_cases_pass_validator`（11 个内置病例全量过闸，防回归）；
- CI：`pnpm test:backend` 覆盖上述 2 个 + `case-audit --json` 作为独立门禁命令。

## 8. 验收

- 11 个内置病例全量过校验器（error=0）；
- case-audit 单条命令可运行、JSON 输出可被 AI 消费；
- AI 生成病例（跑 3 次生成 + 修复循环）100% 过闸门；
- 修复后 staging 重新导入，训练全流程（问诊→查体→评分）无回归（冒烟清单）。
