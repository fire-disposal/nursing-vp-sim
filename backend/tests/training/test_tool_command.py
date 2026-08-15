"""工具指令面纯函数测试（Phase 2.5）。"""

import pytest

from core.exceptions import ValidationError
from modules.training.tools.service import parse_cmd


def test_parse_cmd_split():
    assert parse_cmd("physical_exam.measure") == ("physical_exam", "measure")


def test_parse_cmd_missing_dot():
    with pytest.raises(ValidationError):
        parse_cmd("physical_exam")


def test_parse_cmd_empty_parts():
    with pytest.raises(ValidationError):
        parse_cmd(".measure")
    with pytest.raises(ValidationError):
        parse_cmd("physical_exam.")
