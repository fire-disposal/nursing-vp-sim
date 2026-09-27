"""问卷答卷导出的**联动列**（U0-C 通过条件：一条导出记录能定位批次/训练记录/病例修订/评分来源）。

纯函数测试（不连库）：用轻量假对象喂 ``build_response_export_columns``，断言列名与取值。
"""

from types import SimpleNamespace
from typing import Any

from infra.exporter import ColumnDef
from modules.questionnaires.response_service import build_response_export_columns


def _response(**overrides: Any) -> SimpleNamespace:
    """一条答卷：默认带关联训练记录（批次/模式/病例修订/评分齐全）。"""
    score = SimpleNamespace(
        rubric_version="nursing_rubric@1.0",
        mapping_version=1,
        reviewed_total=None,
        fallback=None,
    )
    record = SimpleNamespace(
        case=SimpleNamespace(name="咳嗽咳痰伴呼吸困难"),
        case_revision_id=21,
        practice_snapshot={"behavior": {"mode": "guided"}, "experiment": {"batch": "usability-u0"}},
        score=score,
    )
    base = {
        "id": 1,
        "record_id": 12,
        "case": SimpleNamespace(name="咳嗽咳痰伴呼吸困难"),
        "user": SimpleNamespace(display_name="张三", student_id="2023001"),
        "completed_at": None,
        "record": record,
        "answers": [SimpleNamespace(question_id=7, answer_value="4")],
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def _header_map(columns: list[ColumnDef]) -> dict[str, ColumnDef]:
    return {str(c.header): c for c in columns}


def test_linkage_columns_present():
    """导出必须能定位：训练记录、病例与修订、批次、模式、评分来源。"""
    headers = _header_map(build_response_export_columns([_response()], [], {21: 2}))
    for expected in (
        "训练记录ID",
        "病例",
        "病例修订号",
        "实验批次",
        "训练模式",
        "评分标准版本",
        "映射版本",
        "成绩来源",
    ):
        assert expected in headers, expected


def test_linkage_values():
    response = _response()
    headers = _header_map(build_response_export_columns([response], [], {21: 2}))
    assert headers["训练记录ID"].value(response) == "12"
    assert headers["病例"].value(response) == "咳嗽咳痰伴呼吸困难"
    assert headers["病例修订号"].value(response) == "2"
    assert headers["实验批次"].value(response) == "usability-u0"
    assert headers["训练模式"].value(response) == "guided"
    assert headers["评分标准版本"].value(response) == "nursing_rubric@1.0"
    assert headers["映射版本"].value(response) == "1"
    assert headers["成绩来源"].value(response) == "AI 初评"


def test_reviewed_score_reported_as_review_source():
    """教师复核过的成绩不能仍被导出成「AI 初评」。"""
    response = _response()
    response.record.score.reviewed_total = 42.0
    headers = _header_map(build_response_export_columns([response], [], {}))
    assert headers["成绩来源"].value(response) == "教师复核"


def test_standalone_response_leaves_linkage_blank():
    """自由练习/问卷（没有关联训练记录）留空，不用默认值补成"当时就有记录"。"""
    response = _response(record=None, record_id=None, case=None)
    headers = _header_map(build_response_export_columns([response], [], {}))
    assert headers["训练记录ID"].value(response) == ""
    assert headers["病例"].value(response) == ""
    assert headers["病例修订号"].value(response) == ""
    assert headers["实验批次"].value(response) == ""
    assert headers["训练模式"].value(response) == ""
    assert headers["评分标准版本"].value(response) == ""
    assert headers["成绩来源"].value(response) == ""


def test_missing_revision_no_is_blank_not_wrong_number():
    """修订号取不到（修订行已被清）时留空，不猜一个数字。"""
    response = _response()
    headers = _header_map(build_response_export_columns([response], [], {}))
    assert headers["病例修订号"].value(response) == ""


def test_answers_follow_question_order():
    questions = [SimpleNamespace(id=7, content="1. 我想我会经常使用这个训练系统。")]
    response = _response()
    headers = _header_map(build_response_export_columns([response], questions, {}))
    assert headers["1. 我想我会经常使用这个训练系统。"].value(response) == "4"
