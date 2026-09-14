"""Tests for case_data validation schema."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from modules.training.capabilities import detect_capabilities
from schemas.case_schema import (
    CaseDataSchema,
    assert_valid_case_data,
    validate_case_data,
)

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def _load(name: str) -> dict:
    return json.loads((CASES_DIR / f"{name}.json").read_text(encoding="utf-8"))


class TestCaseDataSchema:
    def test_minimal_valid(self):
        data = {"name": "测试病例"}
        result = CaseDataSchema(**data)
        assert result.name == "测试病例"
        assert result.time_limit == 20
        assert result.personality.health_literacy == "normal"

    def test_invalid_name_empty(self):
        with pytest.raises(ValidationError):
            CaseDataSchema(name="")

    def test_patient_info_valid(self):
        data = {"name": "病例", "patient_info": {"name": "张三", "age": 45, "gender": "男"}}
        result = CaseDataSchema(**data)
        assert result.patient_info.name == "张三"

    def test_patient_info_invalid_gender(self):
        data = {"name": "病例", "patient_info": {"name": "李四", "age": 30, "gender": "unknown"}}
        with pytest.raises(ValidationError):
            CaseDataSchema(**data)

    def test_extra_fields_pass_through(self):
        """写路径落库的是 model_dump() 结果 —— 未声明字段必须原样保留，不能被丢弃。"""
        data = {"name": "病例", "scoring_criteria": {"旧字段": "值"}, "hidden_info": ["旧数据"]}
        result = CaseDataSchema(**data)
        assert result.name == "病例"
        assert result.model_dump()["scoring_criteria"] == {"旧字段": "值"}

    def test_validate_case_data_strict_raises(self):
        with pytest.raises(ValidationError):
            assert_valid_case_data({"name": ""})

    def test_validate_case_data_non_strict_returns_raw(self):
        result = validate_case_data({"name": ""}, strict=False)
        assert result == {"name": ""}

    def test_deep_background_valid(self):
        data = {"name": "病例", "deep_background": {"手术史": "3年前胆囊切除"}}
        result = CaseDataSchema(**data)
        assert result.deep_background["手术史"] == "3年前胆囊切除"


def test_strict_round_trip_preserves_tool_config():
    """教师保存链路（strict 校验 → dump → 落库）不得丢掉查体/护理记录配置。"""
    data = _load("case1")
    out = validate_case_data(data, strict=True)

    assert out["tools"] == data["tools"]
    assert out["tools"]["physical_exam"]["vital_signs"]["spo2"] == "91-94"
    assert detect_capabilities(out)["physical_exam"] is True
    assert detect_capabilities(out)["nursing_record"] is True


def test_strict_round_trip_preserves_quiz_tool_config():
    data = _load("diabetes_foot_quiz")
    out = validate_case_data(data, strict=True)

    assert out["tools"]["quiz"] == data["tools"]["quiz"]
    assert detect_capabilities(out)["quiz"] is True


def test_strict_round_trip_preserves_nested_unknown_keys():
    """在已声明对象里新增的未知子键，保存往返（strict 校验 → dump → 落库）不得丢失。"""
    data = {
        "name": "病例",
        "patient_info": {"name": "张三", "age": 45, "gender": "男", "护理等级": "一级护理"},
        "personality": {"mood": "low", "方言": "四川话"},
    }
    out = validate_case_data(data, strict=True)

    # 写路径原样往返：已声明子键与未声明子键都不被改写/丢弃
    assert out["patient_info"] == data["patient_info"]
    assert out["personality"] == data["personality"]


def test_strict_round_trip_preserves_nested_quiz_unknown_keys():
    data = {
        "name": "病例",
        "quiz": {
            "title": "引导题目",
            "custom_flag": True,
            "questions": [
                {
                    "id": "q1",
                    "stem": "题干",
                    "answer": "A",
                    "tag": "难点",
                    "options": [{"key": "A", "text": "甲", "score": 1}],
                }
            ],
        },
    }
    out = validate_case_data(data, strict=True)

    assert out["quiz"] == data["quiz"]
