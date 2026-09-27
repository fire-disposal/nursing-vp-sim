"""docs/19 W4 的可执行基线：锚点送达、适用性分母、证据引用、等第政策。

这些断言针对**真实逻辑**（生成的评分输入文本、就地判定的条目状态、确定性证据定位、
服务端等第政策），不是对源码字面量的复述：改动行为就会失败。
"""

from __future__ import annotations

from typing import Any

import pytest

from modules.training.blueprint import (
    guided_hints,
    intervention_observable,
    not_applicable_item_ids,
    scoring_task_boundary_text,
)
from modules.training.scoring.engine import _postprocess_scoring_result
from modules.training.scoring.evidence import resolve_evidence_refs
from modules.training.scoring.grade_policy import (
    CALIBRATION_UNCALIBRATED,
    capability_band,
    grade_view,
    numeric_band,
    policy_descriptor,
    score_source,
)
from modules.training.scoring.prompt_builder import build_scoring_criteria, build_scoring_json_schema
from modules.training.scoring.review_focus import build_review_focus
from modules.training.scoring.rubric_loader import load_rubric
from modules.training.scoring.validation import sanitize_review_raw

RUBRIC: dict[str, Any] = {
    "id": "test_rubric",
    "version": "1.0",
    "raw_max": 8,
    "raw_scale": 2,
    "dimensions": [
        {
            "id": "communication",
            "name": "沟通技能",
            "max": 4,
            "items": [
                {"id": "c0", "name": "问候", "anchors": {"2": "自然问候", "1": "简单问候", "0": "未问候"}},
                {"id": "c1", "name": "开放提问", "anchors": {"2": "开放切入", "1": "开放过少", "0": "全封闭"}},
            ],
        },
        {
            "id": "nursing_record",
            "name": "护理记录",
            "max": 4,
            "items": [
                {"id": "n0", "name": "记录完整性", "anchors": {"2": "五步齐全", "1": "部分缺失", "0": "严重缺失"}},
                {
                    "id": "n1",
                    "name": "效果评价反思",
                    "anchors": {"2": "有批判性反思", "1": "简单评价", "0": "无评价"},
                },
            ],
        },
    ],
}


def _detail(scores: dict[str, dict[str, Any]]) -> dict:
    return scores


# ── 1. 锚点送达（W0 基线 + W4 §4.2 第 1 条）───────────────────────────────


def test_scoring_criteria_delivers_every_anchor():
    rubric = load_rubric()
    text = build_scoring_criteria(rubric)

    anchors = [anchor for dim in rubric["dimensions"] for item in dim["items"] for anchor in item["anchors"].values()]
    assert anchors, "基准 rubric 必须带锚点"
    missing = [anchor for anchor in anchors if anchor not in text]
    assert not missing, f"未送达模型的锚点: {missing[:3]}"


def test_scoring_criteria_header_matches_real_scale():
    rubric = load_rubric()
    text = build_scoring_criteria(rubric)
    # 真实量尺是 0-raw_scale；标题写 1-N 会让模型以为没有 0 分档
    assert f"0-{rubric['raw_scale']}" in text
    assert f"每项 1-{rubric['raw_scale']} 分" not in text


def test_brief_criteria_keeps_structure_without_anchors():
    rubric = load_rubric()
    text = build_scoring_criteria(rubric, level="brief")
    first_item = rubric["dimensions"][0]["items"][0]
    assert first_item["id"] in text
    assert first_item["anchors"]["2"] not in text  # 反馈阶段不需要锚点


def test_scoring_schema_allows_null_for_not_applicable_only():
    text = build_scoring_json_schema(load_rubric(), stage="scoring")
    assert "null" in text
    assert "不适用的条目" in text


def test_feedback_schema_no_longer_mandates_two_items():
    text = build_scoring_json_schema(load_rubric(), stage="feedback")
    assert "至少" not in text
    assert "空数组" in text


# ── 2. 适用性：分母与原始精度（W4 §4.2 第 4/6 条）─────────────────────────


def _raw_items(na_ids: frozenset[str] = frozenset()) -> dict:
    """四个条目：c0/c1 得 2 分，n0 得 1 分，n1 声明不适用（状态与真实落库形状一致）。"""
    return {
        "沟通技能": {
            "score": 4,
            "max": 4,
            "items": [
                {
                    "id": "c0",
                    "name": "问候",
                    "score": 2,
                    "max": 2,
                    "status": "scored",
                    "evidence": "老师您好",
                    "reason": "主动问候",
                },
                {
                    "id": "c1",
                    "name": "开放提问",
                    "score": 2,
                    "max": 2,
                    "status": "scored",
                    "evidence": "您哪里不舒服",
                    "reason": "开放切入",
                },
            ],
        },
        "护理记录": {
            "score": 1,
            "max": 4,
            "items": [
                {
                    "id": "n0",
                    "name": "记录完整性",
                    "score": 1,
                    "max": 2,
                    "status": "scored",
                    "evidence": "记录片段",
                    "reason": "缺评价",
                },
                {"id": "n1", "name": "效果评价反思", "score": None, "max": 2, "status": "not_applicable"}
                if "n1" in na_ids
                else {
                    "id": "n1",
                    "name": "效果评价反思",
                    "score": 0,
                    "max": 2,
                    "status": "scored",
                    "reason": "未提及",
                },
            ],
        },
    }


def test_not_applicable_item_excluded_from_denominator():
    result = _postprocess_scoring_result(
        {"total_score": 5, "detail_scores": _raw_items(frozenset({"n1"}))},
        {},
        RUBRIC,
        not_applicable=frozenset({"n1"}),
    )

    assert result["applicable_raw_max"] == 6  # 8 - 2：声明不适用的条目不进分母
    assert result["not_applicable_items"] == ["n1"]
    n1 = result["raw_detail_scores"]["护理记录"]["items"][1]
    assert n1["status"] == "not_applicable"
    assert n1["score"] is None
    assert result["raw_total"] == 5
    # 展示分按适用分母换算（5/6），不是按 8
    assert result["total_score"] == round(5 / 6 * 100)
    assert result["detail_scores"]["护理记录"]["max"] == round(2 * 100 / 6)


def test_undeclared_missing_score_is_not_zero_and_not_degraded():
    """未声明不适用却没有分数 → 标"未判定"并进不完整清单；**不打成降级**（成绩照常计）。

    早期写法把"模型漏一条"当成整条记录不可用（退出统计），比例失当且不可行：模型偶发漏答
    会让学生拿不到成绩。现在只有真正不可用（解析失败/全维度缺失）才走 fallback。
    """
    broken = _raw_items()
    broken["护理记录"]["items"][1]["score"] = None

    result = _postprocess_scoring_result({"total_score": 4, "detail_scores": broken}, {}, RUBRIC)

    assert "fallback" not in result
    assert result["detail_scores"]["护理记录"]["items"][1]["status"] == "unscored_by_model"
    assert result["incomplete"]["count"] == 1
    assert result["incomplete"]["unscored_items"]


def test_raw_layer_keeps_integer_precision():
    result = _postprocess_scoring_result({"total_score": 5, "detail_scores": _raw_items()}, {}, RUBRIC)
    raw_item = result["raw_detail_scores"]["沟通技能"]["items"][0]
    assert raw_item["score"] == 2
    assert raw_item["max"] == 2
    # 展示投影是另一层（×factor 取整），不再覆盖原始精度
    assert result["detail_scores"]["沟通技能"]["items"][0]["max"] == round(2 * 100 / 8)


def test_denominator_comes_from_frozen_rubric_not_model_output():
    """模型漏答维度内的条目 → 条目被补齐且**分母不缩水**（否则漏答反而抬高展示分）。"""
    partial = _raw_items()
    partial["沟通技能"]["items"] = partial["沟通技能"]["items"][:1]  # 模型只答了 c0

    result = _postprocess_scoring_result({"total_score": 2, "detail_scores": partial}, {}, RUBRIC)

    assert result["applicable_raw_max"] == 8  # 4 条目 × 2：仍然是病例声明的原始满分
    backfilled = [it for it in result["raw_detail_scores"]["沟通技能"]["items"] if it["id"] == "c1"]
    assert backfilled
    assert backfilled[0]["status"] == "unscored_by_model"
    assert backfilled[0]["score"] is None
    assert "fallback" not in result
    assert result["incomplete"]["unscored_items"]


def test_hallucinated_item_inside_valid_dimension_is_dropped():
    """维度内凭空多出的条目会被丢弃：它会把分母抬过该病例声明的原始满分。"""
    detail = _raw_items()
    detail["沟通技能"]["items"].append({"id": "ghost", "name": "不存在的条目", "score": 2, "max": 2})

    result = _postprocess_scoring_result({"total_score": 9, "detail_scores": detail}, {}, RUBRIC)

    ids = [it["id"] for it in result["raw_detail_scores"]["沟通技能"]["items"]]
    assert "ghost" not in ids
    assert result["applicable_raw_max"] == 8


def test_review_focus_skips_unscored_and_not_applicable_items():
    """未判定/不适用条目不得被投影成学生的"关键选择"。"""
    raw = _raw_items(frozenset({"n1"}))
    raw["护理记录"]["items"].append(
        {"id": "n0b", "name": "系统未判定条目", "score": None, "status": "unscored_by_model", "reason": ""}
    )
    raw["护理记录"]["items"][0]["score"] = 0

    focus = build_review_focus(raw, RUBRIC, None)
    ids = [entry["item_id"] for entry in focus]
    assert "n1" not in ids  # not_applicable
    assert "n0b" not in ids  # unscored_by_model
    assert "n0" in ids


# ── 3. 证据引用定位（W4 §5 最小语义）───────────────────────────────────────


def test_evidence_refs_locate_student_message():
    refs, verified = resolve_evidence_refs(
        "老师您好，我是实习护生",
        messages=[(7, "student", "老师您好，我是实习护生，今天想了解一下您的情况"), (8, "patient", "嗯，你说")],
    )
    assert verified
    assert refs == [{"kind": "message", "id": 7, "role": "student"}]


def test_evidence_refs_locate_quote_inside_explanatory_text():
    """模型常在引用外面裹一句解释：句中片段也必须能定位。"""
    refs, verified = resolve_evidence_refs(
        "学生问到：痰是什么样的？（属于对症状特点的追问）",
        messages=[(3, "student", "咳嗽有多久了？痰是什么样的？"), (4, "patient", "咳了三天，痰是白色的。")],
    )
    assert verified
    assert refs[0]["id"] == 3


def test_evidence_refs_fall_back_to_exam_action():
    refs, verified = resolve_evidence_refs(
        "体温 38.9 摄氏度",
        messages=[(1, "student", "我给您量个体温")],
        actions=[(3, "physical_exam", '{"体温": "38.9 摄氏度"}')],
    )
    assert verified
    assert refs[0]["kind"] == "action"


def test_evidence_refs_unverified_when_text_absent():
    refs, verified = resolve_evidence_refs(
        "学生主动安慰患者并说明检查目的",
        messages=[(1, "student", "您好")],
    )
    assert refs == []
    assert verified is False


def test_evidence_refs_ignore_too_short_quote():
    refs, verified = resolve_evidence_refs("嗯", messages=[(1, "patient", "嗯")])
    assert refs == []
    assert verified is False


# ── 4. 等第政策（W4 §4.2 第 8/9 条）──────────────────────────────────────


def test_capability_band_withheld_before_calibration():
    assert policy_descriptor()["calibrated"] is False
    assert capability_band(92.0) is None


def test_numeric_band_is_description_only():
    assert numeric_band(92.0) == "good"
    assert numeric_band(70.0) == "medium"
    assert numeric_band(50.0) == "poor"
    assert numeric_band(None) == "none"

    view = grade_view(92.0)
    assert view["numeric_band"] == "good"
    assert view["capability_band"] is None
    assert view["capability_label"]
    assert view["policy"]["capability_available"] is False


def test_grade_view_reports_score_source():
    assert score_source(reviewed_total=88.0, fallback=None) == "review"
    assert score_source(reviewed_total=None, fallback=None) == "ai"
    assert score_source(reviewed_total=None, fallback={"kind": "llm_empty"}) == "fallback"
    assert grade_view(0.0, fallback={"kind": "llm_empty"})["source"] == "fallback"


def test_uncalibrated_state_constant_is_documented_value():
    assert CALIBRATION_UNCALIBRATED == "uncalibrated"


# ── 5. 复核写入收敛（W4 §4.2 第 6 条）─────────────────────────────────────


def test_sanitize_review_drops_unknown_items_and_clamps():
    payload = {
        "沟通技能": {
            "score": 99,
            "items": [
                {"id": "c0", "score": 9, "evidence": "无关文本"},  # 越界 → 钳到 raw_scale
                {"id": "unknown", "score": 2},  # 未知条目 → 丢弃
            ],
        },
        "不存在的维度": {"items": [{"id": "x", "score": 2}]},
    }
    out = sanitize_review_raw(payload, RUBRIC)

    assert set(out) == {"沟通技能"}
    assert [item["id"] for item in out["沟通技能"]["items"]] == ["c0"]
    assert out["沟通技能"]["items"][0]["score"] == 2.0
    assert "evidence" not in out["沟通技能"]["items"][0]  # 不搬运自由文本


def test_sanitize_review_forces_not_applicable_to_none():
    payload = {"护理记录": {"items": [{"id": "n1", "score": 2}]}}
    out = sanitize_review_raw(payload, RUBRIC, frozenset({"n1"}))
    assert out["护理记录"]["items"][0]["score"] is None


# ── 6. 蓝图运行时视图（W2 消费面）────────────────────────────────────────


def test_blueprint_view_absent_means_no_claims():
    assert not_applicable_item_ids(None) == frozenset()
    assert intervention_observable(None) is False
    assert guided_hints(None) == []
    assert scoring_task_boundary_text(None) == ""  # 无蓝图 → 不凭空声明适用性


def test_blueprint_view_reads_declarations():
    case_data = {
        "blueprint": {
            "learning_objectives": ["能根据患者回答继续追问"],
            "must_cover": ["咳嗽持续时间"],
            "not_applicable_items": ["n1"],
            "intervention_observable": False,
            "clues": [{"id": "k1", "label": "咳嗽性质", "significance": "决定是否需要追问诱因", "source": "inquiry"}],
        }
    }
    assert not_applicable_item_ids(case_data) == frozenset({"n1"})
    boundary = scoring_task_boundary_text(case_data)
    assert "咳嗽持续时间" in boundary
    assert "没有" in boundary
    assert "实施干预" in boundary
    hints = guided_hints(case_data)
    assert hints[0]["domain"] == "咳嗽性质"
    assert "诱因" in hints[0]["significance"]


@pytest.mark.parametrize("declared", [True, False])
def test_blueprint_intervention_flag(declared: bool):
    assert intervention_observable({"blueprint": {"intervention_observable": declared}}) is declared
