"""Phase 1 评分契约不变量回归（克制：5 个关键不变量）。

守护：
- INV-1 复核"不改分提交"总分不变且 ≤100（S1）
- INV-2 总分 == Σ条目分（S2）
- INV-3 兜底 0 分带 fallback 标记（S3）
- INV-4 维度丢失 → fallback 标记（S4）
"""

from typing import Any

from modules.training.scoring.engine import _fallback_scoring, _postprocess_scoring_result
from modules.training.scoring.mapping import apply_score_mapping
from modules.training.scoring.validation import review_total_from_detail

RUBRIC: dict[str, Any] = {
    "raw_max": 72,
    "raw_scale": 3,
    "dimensions": [
        {
            "id": "communication",
            "name": "沟通技能",
            "max": 42,
            "items": [{"id": f"c{i}", "name": f"沟通条目{i}", "max": 3} for i in range(14)],
        },
        {
            "id": "history_taking",
            "name": "病史采集",
            "max": 15,
            "items": [{"id": f"h{i}", "name": f"病史条目{i}", "max": 3} for i in range(5)],
        },
    ],
}


def _raw_detail(item_scores: list[list[int]]) -> dict:
    """构造 raw 刻度 detail_scores（每个维度一份条目分列表）。"""
    dims = {}
    for dim, scores in zip(RUBRIC["dimensions"], item_scores, strict=False):
        dims[dim["name"]] = {
            "score": sum(scores),
            "max": len(scores) * 3,
            "items": [
                {"id": it["id"], "name": it["name"], "score": s, "max": 3, "evidence": "x" * 12, "reason": "y" * 6}
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
                {"id": it["id"], "name": it["name"], "score": round(it["score"] * factor), "max": 5}
                for it in d["items"]
            ],
        }
    return out


# ── INV-1 复核不改分提交 → 总分不变且 ≤100 ────────────────────────────────


def test_review_unchanged_submission_keeps_total():
    raw = _raw_detail([[3] * 14, [3] * 5])  # 全满分 raw=57
    expected = apply_score_mapping(57, 72)
    display = _display_detail(raw, 72)
    assert review_total_from_detail(display, 72) == expected
    assert 0 <= review_total_from_detail(display, 72) <= 100


def test_review_never_exceeds_max_with_arbitrary_input():
    # 教师把展示刻度全部拉满（item 5/5）→ 复核总分仍 ≤100
    display = _display_detail(_raw_detail([[3] * 14, [3] * 5]), 72)
    for dim in display.values():
        dim["score"] = 999
        for it in dim["items"]:
            it["score"] = 5
    assert 0 <= review_total_from_detail(display, 72) <= 100


# ── INV-2 总分 == Σ条目分 ──────────────────────────────────────────────────


def test_postprocess_raw_total_equals_item_sum():
    first = [3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2, 1, 3, 2]
    second = [3, 2, 1, 2, 1]
    raw = _raw_detail([first, second])
    result = _postprocess_scoring_result({"total_score": 99, "detail_scores": raw}, {}, RUBRIC)
    assert result["raw_total"] == sum(first + second)
    assert result["total_score"] == apply_score_mapping(result["raw_total"], 72)


# ── INV-3 兜底 0 分带 fallback 标记 ────────────────────────────────────────


def test_llm_empty_fallback_marked():
    result = _fallback_scoring({}, {})
    assert result["fallback"] == {"kind": "llm_empty"}
    assert result["total_score"] == 0


# ── INV-4 维度丢失 → fallback 标记 ─────────────────────────────────────────


def test_missing_dimension_fallback_marked():
    raw = _raw_detail([[3] * 14, [3] * 5])
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
