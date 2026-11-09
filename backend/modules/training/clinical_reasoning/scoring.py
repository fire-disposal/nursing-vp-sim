"""``evaluate_clinical_reasoning`` —— 确定性评分（不走 LLM）。

评分域 = 病例声明的 ``rubric.anchors``（经 :func:`build_clinical_rubric` 规范化）。
每条锚点按**规则**在运行态里找证据，能算的绝不问模型：

| rule | 判定 |
|---|---|
| ``finding_observed`` | 锚点引用的 findings **全部**已观察 → 2；部分 → 1；无 → 0 |
| ``objective_met`` | 引用的目标里 ``must_notice`` 由证据达成、``must_act`` 由动作达成、``must_communicate`` 由沟通达成；全部 → 2，部分 → 1 |
| ``action_taken`` | 引用的 ``must_act`` 目标全部完成 → 2，部分 → 1 |
| ``communicated`` | 引用的 ``must_communicate`` 目标全部完成 → 2，部分 → 1 |

落库形状与 LLM 评分**同一套契约**（``Score.detail_scores`` 是展示投影、
``raw_detail_scores`` 是原始刻度、``raw_total``/``score_meta`` 是溯源），因此
``RecordDetail`` / 教师复核 / 导出无需为 V2 分叉。每个条目都带真实
``reason`` 与 ``evidence``/``evidence_refs``：没有证据的条目就写明"未获取/未执行",
绝不编造。

展示换算与问诊评分共用 :func:`modules.training.scoring.mapping.apply_score_mapping`
（线性 ``raw/raw_max*100``），不另立第二套刻度。
"""

from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any

from core.statuses import ScoringStatus, normalize_training_mode
from models import Score, TrainingRecord
from modules.training.scoring.grade_policy import GRADE_POLICY_ID, GRADE_POLICY_VERSION
from modules.training.scoring.mapping import (
    LEGACY_VERSION,
    MAPPING_VERSION,
    apply_score_mapping,
    display_factor,
)
from modules.training.scoring.validation import (
    STATUS_NOT_APPLICABLE,
    STATUS_SCORED,
)

from .rubric import build_clinical_rubric, rubric_item_status
from .state import (
    findings_index,
    objectives_of,
    read_state,
)

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

#: 评分口径身份（写进 ``Score.rubric_version`` 与 ``score_meta``）
SCORING_PROFILE = "clinical_reasoning.deterministic"
SCORING_EVALUATOR_ID = "clinical_reasoning.deterministic@1"

#: 三档判定（与 rubric ``anchors{"0"/"1"/"2"}`` 对应）
LEVEL_FULL = 2
LEVEL_PARTIAL = 1
LEVEL_NONE = 0


# ── 判定 ───────────────────────────────────────────────────────────────────


class _Facts:
    """一次评分用到的全部事实（只读快照，避免边算边读库）。"""

    def __init__(self, case_data: Mapping[str, Any], runtime_state: Mapping[str, Any]) -> None:
        stored = read_state(runtime_state)
        self.evidence = [dict(item) for item in stored["evidence"]]
        self.observed = {str(item.get("finding_id")) for item in self.evidence}
        self.completed = set(stored["completed_objectives"])
        self.communicated = set(stored["communicated_objectives"])
        self.findings = findings_index(case_data)
        self.objectives = objectives_of(case_data)
        self.objective_groups: dict[str, str] = {}
        for group, items in self.objectives.items():
            for item in items:
                oid = str(item.get("id") or "")
                if oid:
                    self.objective_groups[oid] = group
        self.objective_label_index = {
            str(item.get("id")): str(item.get("label") or item.get("id") or "")
            for items in self.objectives.values()
            for item in items
            if item.get("id")
        }

    # -- 证据 --

    def finding_labels(self, ids: Sequence[str]) -> list[str]:
        return [str(self.findings[fid].get("label") or fid) for fid in ids if fid in self.findings]

    def evidence_refs(self, ids: Sequence[str]) -> list[dict[str, Any]]:
        refs: list[dict[str, Any]] = []
        by_id = {str(item.get("finding_id")): item for item in self.evidence}
        for fid in ids:
            entry = by_id.get(fid)
            if entry is None:
                continue
            ref = {"finding_id": fid, "label": entry.get("label"), "source": entry.get("source")}
            if entry.get("message_id") is not None:
                ref["message_id"] = entry["message_id"]
            refs.append(ref)
        return refs

    # -- 目标 --

    def objective_done(self, oid: str) -> bool:
        group = self.objective_groups.get(oid)
        if group == "must_act":
            return oid in self.completed
        if group == "must_communicate":
            return oid in self.communicated
        # must_notice：目标引用的证据全部已观察即视为达成（目标本身没有独立动作）
        for item in self.objectives.get("must_notice", []):
            if str(item.get("id")) == oid:
                finding = str(item.get("finding") or "")
                return bool(finding) and finding in self.observed
        return False

    def objective_label_list(self, ids: Sequence[str]) -> list[str]:
        return [self.objective_label_index.get(oid, oid) for oid in ids]


def _ratio_level(done: int, total: int) -> int:
    if total <= 0:
        return LEVEL_NONE
    if done >= total:
        return LEVEL_FULL
    if done > 0:
        return LEVEL_PARTIAL
    return LEVEL_NONE


def _judge_anchor(anchor: Mapping[str, Any], facts: _Facts) -> dict[str, Any]:
    """单条锚点 → ``{score, reason, evidence, evidence_refs}``（确定性）。"""
    rule = str(anchor.get("rule") or "")
    finding_ids = [str(fid) for fid in anchor.get("findings") or [] if isinstance(fid, str)]
    objective_ids = [str(oid) for oid in anchor.get("objectives") or [] if isinstance(oid, str)]

    if rule == "finding_observed":
        refs = [fid for fid in finding_ids if fid]
        done = sum(1 for fid in refs if fid in facts.observed)
        level = _ratio_level(done, len(refs))
        labels = facts.finding_labels(refs)
        if level == LEVEL_FULL:
            reason = f"已获取全部关键证据：{'、'.join(labels)}"
        elif level == LEVEL_PARTIAL:
            missing = [fid for fid in refs if fid not in facts.observed]
            reason = f"仅获取 {done}/{len(refs)} 条证据，遗漏：{'、'.join(facts.finding_labels(missing))}"
        else:
            reason = f"未获取关键证据：{'、'.join(labels) or '（锚点未引用证据）'}"
        return {
            "score": level,
            "reason": reason,
            "evidence": "、".join(labels),
            "evidence_refs": facts.evidence_refs(refs),
        }

    if rule in {"objective_met", "action_taken", "communicated"}:
        refs = [oid for oid in objective_ids if oid]
        done_ids = [oid for oid in refs if facts.objective_done(oid)]
        level = _ratio_level(len(done_ids), len(refs))
        labels = facts.objective_label_list(refs)
        verb = {
            "objective_met": "达成目标",
            "action_taken": "完成动作",
            "communicated": "完成沟通",
        }.get(rule, "达成目标")
        if level == LEVEL_FULL:
            reason = f"{verb}：{'、'.join(labels)}"
        elif level == LEVEL_PARTIAL:
            missing = [oid for oid in refs if oid not in set(done_ids)]
            reason = (
                f"部分{verb}（{len(done_ids)}/{len(refs)}），未完成：{'、'.join(facts.objective_label_list(missing))}"
            )
        else:
            reason = f"未{verb}：{'、'.join(labels) or '（锚点未引用目标）'}"
        action_refs = [
            {
                "objective_id": oid,
                "label": facts.objective_label_list([oid])[0],
                "group": facts.objective_groups.get(oid, ""),
                "completed": oid in done_ids,
            }
            for oid in refs
        ]
        evidence_refs = [ref for oid in done_ids for ref in _evidence_for_objective(oid, facts)]
        return {
            "score": level,
            "reason": reason,
            "evidence": "、".join(labels),
            "evidence_refs": [*evidence_refs, *action_refs],
        }

    return {
        "score": LEVEL_NONE,
        "reason": f"未知判定规则：{rule or '（空）'}",
        "evidence": "",
        "evidence_refs": [],
    }


def _evidence_for_objective(oid: str, facts: _Facts) -> list[dict[str, Any]]:
    """目标达成所依赖的证据引用（must_notice 目标 → 其证据；其余目标无直接证据）。"""
    for item in facts.objectives.get("must_notice", []):
        if str(item.get("id")) == oid:
            finding = str(item.get("finding") or "")
            return facts.evidence_refs([finding]) if finding else []
    return []


# ── 结构装配 ───────────────────────────────────────────────────────────────


def _build_detail_scores(rubric: Mapping[str, Any], facts: _Facts) -> dict[str, Any]:
    by_dim: dict[str, dict[str, Any]] = {}
    for dim in rubric.get("dimensions", []) or []:
        if not isinstance(dim, Mapping):
            continue
        dim_id = str(dim.get("id") or "")
        by_dim[dim_id] = {
            "id": dim_id,
            "name": str(dim.get("name") or dim_id),
            "score": 0.0,
            "max": 0.0,
            "items": [],
        }

    dim_index = rubric_item_status(rubric)
    for dim in rubric.get("dimensions", []) or []:
        for item in dim.get("items", []) or []:
            item_id = str(item.get("id") or "")
            dim_id = dim_index.get(item_id) or str(dim.get("id") or "")
            bucket = by_dim.get(dim_id)
            if bucket is None or not item_id:
                continue
            judged = _judge_anchor(item, facts)
            item_max = float(item.get("max") or 0)
            raw = float(judged["score"]) / LEVEL_FULL * item_max
            bucket["items"].append(
                {
                    "id": item_id,
                    "name": str(item.get("name") or item_id),
                    "score": round(raw, 4),
                    "max": item_max,
                    "status": STATUS_SCORED,
                    "reason": judged["reason"],
                    "evidence": judged["evidence"],
                    "evidence_refs": judged["evidence_refs"],
                    "rule": str(item.get("rule") or ""),
                    "weight": float(item.get("weight") or 0),
                    "anchors": item.get("anchors") or {},
                }
            )
            bucket["score"] += raw
            bucket["max"] += item_max

    for bucket in by_dim.values():
        bucket["score"] = round(float(bucket["score"]), 4)
        bucket["max"] = round(float(bucket["max"]), 4)
    return by_dim


def _display_view(raw_detail: dict[str, Any], raw_max: float) -> dict[str, Any]:
    """展示投影（``Score.detail_scores``）：维度与条目的分数按比例换到 100 分制。"""
    import copy

    factor = display_factor(raw_max)
    view = copy.deepcopy(raw_detail)
    for dim in view.values():
        if not isinstance(dim, dict):
            continue
        dim["score"] = round(float(dim.get("score") or 0) * factor)
        dim["max"] = round(float(dim.get("max") or 0) * factor)
        for item in dim.get("items", []) or []:
            if not isinstance(item, dict):
                continue
            if item.get("status") == STATUS_NOT_APPLICABLE or item.get("score") is None:
                item["max"] = round(float(item.get("max") or 0) * factor)
                continue
            item["score"] = round(float(item.get("score") or 0) * factor)
            item["max"] = round(float(item.get("max") or 0) * factor)
    return view


def _feedback(raw_detail: dict[str, Any]) -> tuple[list[str], list[str], list[str], str]:
    """确定性反馈：强项 / 不足 / 遗漏 / 建议（只由条目判定派生，不编造）。"""
    strengths: list[str] = []
    weaknesses: list[str] = []
    missed: list[str] = []
    for dim in raw_detail.values():
        for item in dim.get("items", []) or []:
            name = str(item.get("name") or "")
            reason = str(item.get("reason") or "")
            score = float(item.get("score") or 0)
            cap = float(item.get("max") or 0) or 1.0
            if score >= cap:
                strengths.append(f"{name}：{reason}")
            elif score > 0:
                weaknesses.append(f"{name}：{reason}")
            else:
                missed.append(f"{name}：{reason}")
    suggestions = (
        "按线索—证据—行动—沟通的顺序回顾：先确认关键证据都已获取，再核对处置动作与沟通是否完成。"
        if (weaknesses or missed)
        else "本次关键证据、处置动作与沟通均已覆盖，可尝试在更短时间内完成同样的判断。"
    )
    return strengths, weaknesses, missed, suggestions


# ── 入口 ───────────────────────────────────────────────────────────────────


def _case_data_for(record: TrainingRecord) -> dict[str, Any]:
    snapshot = getattr(record, "case_snapshot", None)
    return dict(snapshot) if isinstance(snapshot, Mapping) else {}


def score_for_record(record: TrainingRecord) -> dict[str, Any]:
    """纯函数：记录 → 评分结果 dict（不写库，便于测试与复盘重算）。"""
    case_data = _case_data_for(record)
    frozen_rubric = getattr(record, "rubric_snapshot", None)
    rubric = (
        dict(frozen_rubric)
        if isinstance(frozen_rubric, Mapping) and frozen_rubric.get("dimensions") is not None
        else build_clinical_rubric(case_data)
    )
    runtime_state = getattr(record, "runtime_state", None) or {}
    facts = _Facts(case_data, runtime_state)
    raw_detail = _build_detail_scores(rubric, facts)
    raw_max = float(rubric.get("raw_max") or 0)

    raw_total = round(sum(float(dim.get("score") or 0) for dim in raw_detail.values()), 4)
    display_total = apply_score_mapping(raw_total, raw_max) if raw_max > 0 else 0
    detail_scores = _display_view(raw_detail, raw_max) if raw_max > 0 else {}
    strengths, weaknesses, missed, suggestions = _feedback(raw_detail)
    return {
        "rubric": rubric,
        "raw_detail_scores": raw_detail,
        "detail_scores": detail_scores,
        "raw_total": raw_total,
        "applicable_raw_max": raw_max,
        "total_score": display_total,
        "strengths": strengths,
        "weaknesses": weaknesses,
        "missed_content": missed,
        "suggestions": suggestions,
    }


def _score_meta(record: TrainingRecord, result: Mapping[str, Any]) -> dict[str, Any]:
    from modules.training.prompt_identity import compute_prompt_id

    from .prompts import JSON_CONTRACT, SYSTEM

    practice = getattr(record, "practice_snapshot", None) or {}
    return {
        "applicable_raw_max": result.get("applicable_raw_max"),
        "not_applicable_items": [],
        "rubric_content_id": _rubric_content_id(result.get("rubric") or {}),
        "scoring_prompt_id": None,
        "feedback_prompt_id": None,
        "turn_prompt_id": compute_prompt_id("clinical_reasoning.turn", SYSTEM, JSON_CONTRACT),
        "evaluator": {"id": SCORING_EVALUATOR_ID, "deterministic": True},
        "grade_policy": {"id": GRADE_POLICY_ID, "version": GRADE_POLICY_VERSION},
        "assistance": {"mode": normalize_training_mode((practice.get("behavior") or {}).get("mode"))},
        "rubric_source": "case",
    }


def _rubric_content_id(rubric: Mapping[str, Any]) -> str:
    from modules.training.scoring.rubric_loader import rubric_content_id

    return rubric_content_id(dict(rubric))


def evaluate_clinical_reasoning(record: TrainingRecord, db: Session) -> Score:
    """同步确定性评分并落库（``Score`` 一行；重复调用覆盖同一条）。

    与 LLM 评分共享 ``Score`` 契约：``detail_scores``（展示投影）、
    ``raw_detail_scores``（原始刻度 + reason/evidence/evidence_refs）、``raw_total``、
    ``score_meta``（溯源）与 ``fallback``（无评分域时显式标记）。
    """
    result = score_for_record(record)
    rubric = result["rubric"]
    raw_max = float(result["applicable_raw_max"] or 0)
    fallback = None
    if raw_max <= 0:
        # 没有锚点 = 没有可判分依据：明确降级，而不是让学生凭空得 0 分
        fallback = {"kind": "no_clinical_anchors", "note": "病例未声明可判分的 rubric 锚点"}
        log.warning("clinical_reasoning scoring has no anchors: record_id=%d", record.id)

    existing = db.query(Score).filter(Score.record_id == record.id).first()
    score = existing or Score(record_id=record.id, total_score=0)
    score.total_score = result["total_score"]
    score.detail_scores = result["detail_scores"] if raw_max > 0 else {}
    score.strengths = result["strengths"]
    score.weaknesses = result["weaknesses"]
    score.missed_content = result["missed_content"]
    score.suggestions = result["suggestions"]
    score.rubric_version = f"{rubric.get('id')}@{rubric.get('version')}"
    score.model_name = SCORING_PROFILE
    score.prompt_schema_version = 2
    score.raw_total = result["raw_total"] if raw_max > 0 else None
    score.mapping_version = MAPPING_VERSION if raw_max > 0 else LEGACY_VERSION
    score.fallback = fallback
    score.dim_total = {
        name: {"score": dim.get("score"), "max": dim.get("max")} for name, dim in result["detail_scores"].items()
    }
    score.raw_detail_scores = result["raw_detail_scores"] if raw_max > 0 else {}
    score.score_meta = _score_meta(record, result)
    if existing is None:
        db.add(score)
    db.commit()
    db.refresh(score)

    record.scoring_status = ScoringStatus.COMPLETED if raw_max > 0 else ScoringStatus.FAILED
    record.scoring_error = None if fallback is None else fallback["note"]
    db.commit()
    log.info(
        "clinical_reasoning score persisted: record_id=%d raw=%s/%s display=%d",
        record.id,
        result["raw_total"],
        raw_max,
        result["total_score"],
    )
    return score
