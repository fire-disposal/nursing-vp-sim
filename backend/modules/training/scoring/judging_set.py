"""判例集的**入选规则**（docs/19 W0，可执行的那一半）。

W0 要交付去标识判例集：正例、反例、边界例。判例内容与判定必须由护理教师给出，代码不能代替；
但「哪些记录**没有资格**充当完整能力判例」是可以机械判定的，而且必须机械判定，否则
单回合对话或系统缺证的记录会被当成"学生表现不好"混进判例集 —— 那正是把评分问题误判成
学生能力问题的开端。

因此本模块只回答一个问题：这条记录能不能进入判例集？不能的话，原因是什么。
判例集本身的文件格式、审阅留痕与预先登记的验收规则见 ``docs/calibration/README.md``。

裁决入口：``eligible_for_judging``。排除原因都是机器可读码，便于导出脚本与文档对齐。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

#: 少于该学生对答回合数不足以承载"根据回答继续评估"（docs/19 §4.3 判例最小单元）
MIN_STUDENT_TURNS = 4

EXCLUDE_SINGLE_TURN = "insufficient_turns"
EXCLUDE_TRAINING_NOT_FINISHED = "training_not_finished"
EXCLUDE_SYSTEM_DEGRADED = "system_degraded"
EXCLUDE_IDENTITY_UNKNOWN = "no_raw_identity"
EXCLUDE_DUPLICATE_SOURCE = "duplicate_source"

EXCLUSION_LABELS = {
    EXCLUDE_SINGLE_TURN: f"学生回合不足 {MIN_STUDENT_TURNS} 次，无法体现响应式评估",
    EXCLUDE_TRAINING_NOT_FINISHED: "训练未正常结束（超时/患者中止/未提交产物）",
    EXCLUDE_SYSTEM_DEGRADED: "评分由系统降级产生，不能作为学生能力判例",
    EXCLUDE_IDENTITY_UNKNOWN: "缺少原始量尺与规则身份（本批次之前的历史分）",
    EXCLUDE_DUPLICATE_SOURCE: "同一记录的重复导出",
}


@dataclass(frozen=True)
class JudgingEligibility:
    eligible: bool
    reasons: tuple[str, ...] = ()

    @property
    def labels(self) -> tuple[str, ...]:
        return tuple(EXCLUSION_LABELS.get(reason, reason) for reason in self.reasons)


def eligible_for_judging(
    *,
    student_turns: int,
    training_status: str,
    terminal_reason: str | None,
    score_fallback: Mapping[str, Any] | None,
    score_meta: Mapping[str, Any] | None,
    seen_record_ids: set[int] | None = None,
    record_id: int | None = None,
) -> JudgingEligibility:
    """这条记录能否进入判例集；不能则给出全部机器可读原因。

    Args:
        student_turns: 学生消息条数
        training_status: ``training_records.status``
        terminal_reason: ``user_end`` / ``timeout`` / ``patient_walkout`` / None
        score_fallback: ``scores.fallback``（非空 = 系统降级）
        score_meta: ``scores.score_meta``（空 = 原始量尺与规则身份不可知）
        seen_record_ids / record_id: 去重（同一记录只导一次）
    """
    reasons: list[str] = []
    if training_status != "completed":
        reasons.append(EXCLUDE_TRAINING_NOT_FINISHED)
    elif terminal_reason not in (None, "", "user_end"):
        # 系统终止（超时/患者离开）不是学生主动完成的完整访谈
        reasons.append(EXCLUDE_TRAINING_NOT_FINISHED)
    if student_turns < MIN_STUDENT_TURNS:
        reasons.append(EXCLUDE_SINGLE_TURN)
    if score_fallback:
        reasons.append(EXCLUDE_SYSTEM_DEGRADED)
    if not score_meta:
        reasons.append(EXCLUDE_IDENTITY_UNKNOWN)
    if seen_record_ids is not None and record_id is not None and record_id in seen_record_ids:
        reasons.append(EXCLUDE_DUPLICATE_SOURCE)
    return JudgingEligibility(eligible=not reasons, reasons=tuple(dict.fromkeys(reasons)))


#: 判例必须覆盖的边界类型（docs/19 §4.3「必须包含」清单）——教师编写对照时按此登记，
#: 代码不代替教师判断内容，只保证类型不漏项。
REQUIRED_CASE_KINDS: tuple[tuple[str, str], ...] = (
    ("mechanical_coverage", "机械逐项覆盖 vs 按回答追问"),
    ("empathy_without_content", "共情话术丰富但关键内容遗漏"),
    ("concise_effective", "简洁有效 vs 冗长重复"),
    ("volunteered_info", "患者主动提供信息后的确认与整合"),
    ("reasonable_uncertainty", "合理表达不确定性"),
    ("no_intervention_result", "无干预结果可观察时的计划/评价方法"),
    ("genuinely_no_gaps", "真实无不足（反馈应为空）"),
    ("system_missing_evidence", "系统缺证/降级（不得计入能力判断）"),
)


def coverage_gaps(covered_kinds: set[str]) -> list[str]:
    """判例集尚未覆盖的边界类型（教师登记的类型集合 → 缺失清单）。"""
    return [kind for kind, _label in REQUIRED_CASE_KINDS if kind not in covered_kinds]
