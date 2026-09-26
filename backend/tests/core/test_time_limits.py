"""训练时限唯一口径的回归测试。

不变量：
1. 声明值在 [30, 180] 内**原样生效**（禁止静默改写）。
2. 未声明 → 默认 30。
3. 历史数据越界 → 按边界收敛，且必须留下 warning（越界可见）。
4. 病例校验器把越界视为 error，而不是"代码会覆盖"的 warning。
5. 病例 schema 的 range 与常量一致（曾出现 ge=5/le=120 的第三套区间）。
"""

import logging

import pytest

from core.time_limits import (
    DEFAULT_TIME_LIMIT_MINUTES,
    MAX_TIME_LIMIT_MINUTES,
    MIN_TIME_LIMIT_MINUTES,
    resolve_time_limit_minutes,
)
from modules.cases.validator import validate_case
from schemas.case_schema import CaseDataSchema


class TestResolveTimeLimit:
    def test_declared_value_takes_effect_verbatim(self):
        for value in (MIN_TIME_LIMIT_MINUTES, 45, MAX_TIME_LIMIT_MINUTES):
            assert resolve_time_limit_minutes(value, source="case") == value

    def test_none_falls_back_to_default(self):
        assert resolve_time_limit_minutes(None, source="case") == DEFAULT_TIME_LIMIT_MINUTES

    def test_out_of_range_clamps_and_warns(self, caplog):
        with caplog.at_level(logging.WARNING, logger="core.time_limits"):
            assert resolve_time_limit_minutes(20, source="legacy-case") == MIN_TIME_LIMIT_MINUTES
            assert resolve_time_limit_minutes(999, source="legacy-case") == MAX_TIME_LIMIT_MINUTES
        assert "训练时限越界" in caplog.text
        assert "legacy-case" in caplog.text


class TestCaseValidatorTimeLimit:
    @staticmethod
    def _case(**overrides) -> dict:
        case = {
            "name": "时限测试病例",
            "time_limit": 30,
            "difficulty": 1,
            "patient_info": {"name": "张三", "age": 60, "gender": "男"},
            "chief_complaint": "胸痛",
        }
        case.update(overrides)
        return case

    def test_short_declaration_is_error_not_warning(self):
        report = validate_case(self._case(time_limit=20))
        assert [i for i in report.errors if i.field == "time_limit"], report.issues
        assert report.ok() is False

    def test_long_declaration_is_error(self):
        report = validate_case(self._case(time_limit=200))
        assert [i for i in report.errors if i.field == "time_limit"], report.issues

    def test_in_range_declaration_has_no_time_limit_issue(self):
        report = validate_case(self._case(time_limit=45))
        assert not [i for i in report.issues if i.field == "time_limit"]


class TestCaseSchemaTimeLimit:
    def test_defaults_to_30(self):
        assert CaseDataSchema(name="默认病例").time_limit == DEFAULT_TIME_LIMIT_MINUTES

    @pytest.mark.parametrize("value", [MIN_TIME_LIMIT_MINUTES, MAX_TIME_LIMIT_MINUTES])
    def test_accepts_boundaries(self, value):
        assert CaseDataSchema(name="边界病例", time_limit=value).time_limit == value

    @pytest.mark.parametrize("value", [MIN_TIME_LIMIT_MINUTES - 1, MAX_TIME_LIMIT_MINUTES + 1])
    def test_rejects_out_of_range(self, value):
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            CaseDataSchema(name="越界病例", time_limit=value)
