"""Tests for case_data validation schema."""

import pytest
from pydantic import ValidationError

from core.case_schema import (
    CaseDataSchema,
    assert_valid_case_data,
    validate_case_data,
)


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

    def test_extra_fields_ignored(self):
        data = {"name": "病例", "scoring_criteria": {"旧字段": "值"}, "hidden_info": ["旧数据"]}
        result = CaseDataSchema(**data)
        assert result.name == "病例"

    def test_validate_case_data_strict_raises(self):
        with pytest.raises(ValidationError):
            assert_valid_case_data({"name": ""})

    def test_validate_case_data_non_strict_returns_raw(self):
        result = validate_case_data("history_taking", {"name": ""}, strict=False)
        assert result == {"name": ""}

    def test_rubric_ref_default(self):
        data = {"name": "病例"}
        result = CaseDataSchema(**data)
        assert result.rubric_ref == "active"

    def test_deep_background_valid(self):
        data = {"name": "病例", "deep_background": {"手术史": "3年前胆囊切除"}}
        result = CaseDataSchema(**data)
        assert result.deep_background["手术史"] == "3年前胆囊切除"
