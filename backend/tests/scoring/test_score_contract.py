"""Phase 1 评分契约不变量回归（克制：5 个关键不变量）。

守护：
- INV-1 复核"不改分提交"总分不变且 ≤100（S1）
- INV-2 总分 == Σ条目分（S2）
- INV-3 兜底 0 分带 fallback 标记（S3）
- INV-4 维度丢失 → fallback 标记（S4）
"""

from __future__ import annotations

from typing import Any

import pytest

from core.statuses import ScoringStatus
from models import Score, TrainingRecord
from modules.training.scoring import engine
from modules.training.scoring.engine import _fallback_scoring, _postprocess_scoring_result
from modules.training.scoring.mapping import apply_score_mapping
from modules.training.scoring.validation import review_total_from_detail

RUBRIC: dict[str, Any] = {
    "raw_max": 38,
    "raw_scale": 2,
    "dimensions": [
        {
            "id": "communication",
            "name": "沟通技能",
            "max": 28,
            "items": [{"id": f"c{i}", "name": f"沟通条目{i}", "max": 2} for i in range(14)],
        },
        {
            "id": "history_taking",
            "name": "病史采集",
            "max": 10,
            "items": [{"id": f"h{i}", "name": f"病史条目{i}", "max": 2} for i in range(5)],
        },
    ],
}


def _raw_detail(item_scores: list[list[int]]) -> dict:
    """构造 raw 刻度 detail_scores（每个维度一份条目分列表）。"""
    dims = {}
    for dim, scores in zip(RUBRIC["dimensions"], item_scores, strict=False):
        dims[dim["name"]] = {
            "score": sum(scores),
            "max": len(scores) * 2,
            "items": [
                {"id": it["id"], "name": it["name"], "score": s, "max": 2, "evidence": "x" * 12, "reason": "y" * 6}
                for it, s in zip(dim["items"], scores, strict=False)
            ],
        }
    return dims


def _display_detail(raw: dict, raw_max: int) -> dict:
    """把 raw detail 展示化（模拟落库后的展示刻度，item max=5）。"""
    factor = 100.0 / raw_max
    out = {}
    for name, d in raw.items():
        out[name] = {
            "score": round(d["score"] * factor),
            "max": round(d["max"] * factor),
            "items": [
                {"id": it["id"], "name": it["name"], "score": round(it["score"] * factor), "max": round(2 * factor)}
                for it in d["items"]
            ],
        }
    return out


# ── INV-1 复核不改分提交 → 总分不变且 ≤100 ────────────────────────────────


def test_review_unchanged_submission_keeps_total():
    raw = _raw_detail([[2] * 14, [2] * 5])  # 全满分 raw=38
    expected = apply_score_mapping(38, 38)
    display = _display_detail(raw, 38)
    assert review_total_from_detail(display, 38) == expected
    assert 0 <= review_total_from_detail(display, 38) <= 100


def test_review_never_exceeds_max_with_arbitrary_input():
    # 教师把展示刻度全部拉满（item 5/5）→ 复核总分仍 ≤100
    display = _display_detail(_raw_detail([[2] * 14, [2] * 5]), 38)
    for dim in display.values():
        dim["score"] = 999
        for it in dim["items"]:
            it["score"] = 5
    assert 0 <= review_total_from_detail(display, 38) <= 100


# ── INV-2 总分 == Σ条目分 ──────────────────────────────────────────────────


def test_postprocess_raw_total_equals_item_sum():
    first = [2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1]
    second = [2, 1, 2, 1, 2]
    raw = _raw_detail([first, second])
    result = _postprocess_scoring_result({"total_score": 99, "detail_scores": raw}, {}, RUBRIC)
    assert result["raw_total"] == sum(first + second)
    assert result["total_score"] == apply_score_mapping(result["raw_total"], 38)


# ── INV-3 兜底 0 分带 fallback 标记 ────────────────────────────────────────


def test_llm_empty_fallback_marked():
    result = _fallback_scoring({}, {})
    assert result["fallback"] == {"kind": "llm_empty"}
    assert result["total_score"] == 0


# ── INV-4 维度丢失 → fallback 标记 ─────────────────────────────────────────


def test_missing_dimension_fallback_marked():
    raw = _raw_detail([[2] * 14, [2] * 5])
    raw.pop("病史采集")  # LLM 漏掉一个维度
    result = _postprocess_scoring_result({"total_score": 40, "detail_scores": raw}, {}, RUBRIC)
    assert result["fallback"]["kind"] == "dims_injected"
    assert "病史采集" in result["fallback"]["dims"]


# ── S8 超时预算一致（重试总预算 ≤ 全局 - 余量）─────────────────────────────


def test_timeout_budget_consistent():
    from core.config import SCORING_TIMEOUT_SECONDS
    from modules.training.scoring import engine

    stage_budget = max(60.0, float(SCORING_TIMEOUT_SECONDS) - engine.SCORING_BUDGET_MARGIN_SECONDS)
    # 单阶段首试上限（150s）不得超过阶段预算（否则重试无剩余预算，必被全局超时杀死）
    assert stage_budget + engine.SCORING_BUDGET_MARGIN_SECONDS >= engine.PER_STAGE_TIMEOUT_SEC
    assert stage_budget <= SCORING_TIMEOUT_SECONDS


# ── S5 复核写回成绩口径（COALESCE(reviewed_total, total_score)）──────────────


def test_reviewed_total_is_effective_grade():
    """教师复核后：成绩口径恒为复核分；无复核回退 AI 原始分；两者皆空为 None。"""
    assert Score(record_id=1, total_score=80.0).effective_total == 80.0
    assert Score(record_id=2, total_score=80.0, reviewed_total=90.0).effective_total == 90.0
    assert Score(record_id=3, total_score=80.0, reviewed_total=0.0).effective_total == 0.0


# ── S3 半坏兜底必须能落库（不能退化成"无分 failed"）─────────────────────────


def test_partial_fallback_missing_total_score_survives_postprocess():
    """首试"半坏"（有 detail_scores、缺 total_score）→ 兜底分必须落库且可审计。

    修复前：``_validate_scoring_result`` 抛"缺失字段: total_score" → 整轮评分失败、
    不写 Score、无 fallback 标记（比"LLM 完全空"的路径更糟）。
    """
    partial = _fallback_scoring({"detail_scores": _raw_detail([[2] * 14, [2] * 5])}, {})
    assert partial["fallback"] == {"kind": "llm_partial"}

    result = _postprocess_scoring_result(partial, {}, RUBRIC)

    assert result["fallback"]["kind"] == "llm_partial"
    assert result["raw_total"] == 38.0  # Σ条目分仍可审计
    assert result["total_score"] == apply_score_mapping(result["raw_total"], 38)
    assert 0 <= result["total_score"] <= 100
    assert result["detail_scores"]  # 部分分保留，不伪装成"无分"


def test_partial_fallback_illegal_total_score_survives_postprocess():
    """total_score 类型非法（字符串）同样必须落库，不能被判死。"""
    partial = _fallback_scoring({"total_score": "N/A", "detail_scores": _raw_detail([[2] * 14, [2] * 5])}, {})

    result = _postprocess_scoring_result(partial, {}, RUBRIC)

    assert result["fallback"]["kind"] == "llm_partial"
    assert result["total_score"] == apply_score_mapping(result["raw_total"], 38)


def test_partial_fallback_keeps_llm_total_when_present():
    """LLM 自评分可用时保留它（兜底是"证据不足"，不是"重算"）。"""
    partial = _fallback_scoring({"total_score": 12, "detail_scores": _raw_detail([[1] * 14, [1] * 5])}, {})

    result = _postprocess_scoring_result(partial, {}, RUBRIC)

    assert result["total_score"] == apply_score_mapping(12, 38)


def test_non_fallback_result_without_total_score_normalizes_to_item_sum():
    """非兜底结果缺 total_score 时按 Σ条目分归一（同一 S2 不变量），不抛 KeyError。"""
    result = _postprocess_scoring_result({"detail_scores": _raw_detail([[2] * 14, [2] * 5])}, {}, RUBRIC)

    assert result["total_score"] == apply_score_mapping(result["raw_total"], 38)
    assert "fallback" not in result


def test_non_fallback_zero_result_is_still_rejected():
    """兜底豁免是有界的：零分且缺 total_score 的非兜底结果仍被终局校验拒绝。"""
    with pytest.raises(ValueError, match="total_score"):
        _postprocess_scoring_result({"detail_scores": _raw_detail([[0] * 14, [0] * 5])}, {}, RUBRIC)


# ── mapping_version 单一来源 ───────────────────────────────────────────────


class _SingleRowSession:
    """``_persist_score`` 的最小 Session 替身（记录落库的 Score 行）。"""

    def __init__(self, record: TrainingRecord) -> None:
        self.record = record
        self.score: Score | None = None

    def query(self, model: object) -> _SingleRowSession:
        return self

    def filter(self, *_criteria: object) -> _SingleRowSession:
        return self

    def first(self) -> object | None:
        return self.record

    def add(self, obj: object) -> None:
        self.score = obj

    def commit(self) -> None:
        pass

    def refresh(self, _obj: object) -> None:
        pass


def _persist(raw_total: float | None, db: _SingleRowSession) -> None:
    engine._persist_score(
        {
            "total_score": 80.0,
            "detail_scores": {},
            "strengths": [],
            "weaknesses": [],
            "missed_content": [],
            "suggestions": "",
            "raw_total": raw_total,
        },
        RUBRIC,
        1,
        db,
    )


def test_mapping_version_follows_the_single_policy_constant(monkeypatch):
    """mapping_version 不是硬编 1：有 raw_total ⇒ MAPPING_VERSION，否则 LEGACY_VERSION。"""
    monkeypatch.setattr(engine, "MAPPING_VERSION", 7, raising=True)
    record = TrainingRecord(id=1, user_id=1, status="completed", scoring_status=ScoringStatus.PROCESSING)

    db = _SingleRowSession(record)
    _persist(30.0, db)
    assert db.score is not None
    assert db.score.mapping_version == 7

    db2 = _SingleRowSession(record)
    _persist(None, db2)
    assert db2.score is not None
    assert db2.score.mapping_version == engine.LEGACY_VERSION
