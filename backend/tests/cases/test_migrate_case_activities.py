"""一次性病例迁移（``tools.* → activities.<id>.config``）测试。

守护（docs/15 §九）：
  - 迁移无损：config 与旧 payload 逐字段相等；
  - 顶层 ``exam_anchors`` 并入 ``activities.physical_exam.config``；
  - 不因 handler 存在就把 ``nursing_diagnosis`` 写进病例；
  - 未知 ``tools.*`` 键拒绝改写（宁可停手，不静默丢配置）；
  - 仓库病例已迁移且解析结果不变。
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2]
CASES_DIR = BACKEND_DIR / "data" / "cases"

_spec = importlib.util.spec_from_file_location(
    "migrate_case_activities", BACKEND_DIR / "scripts" / "migrate_case_activities.py"
)
assert _spec is not None
assert _spec.loader is not None
migration = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = migration  # dataclass 解析需要模块可被解析
_spec.loader.exec_module(migration)

_LEGACY = {
    "name": "旧病例",
    "patient_info": {"name": "张三", "age": 40, "gender": "男"},
    "tools": {
        "physical_exam": {"vital_signs": {"temperature": "38.5"}, "skin": {"全身": "潮红"}},
        "nursing_record": True,
    },
}


def test_tools_are_mapped_into_activities_losslessly():
    conversion = migration.convert_case_data(_LEGACY)

    assert conversion.errors == []
    assert "tools" not in conversion.case
    assert conversion.case["activities"] == {
        "physical_exam": {"config": _LEGACY["tools"]["physical_exam"]},
        "nursing_record": {"config": True},
    }
    assert migration._lossless(conversion.case, _LEGACY) == []


def test_input_payload_is_not_mutated():
    snapshot = json.loads(json.dumps(_LEGACY))
    migration.convert_case_data(_LEGACY)
    assert snapshot == _LEGACY


def test_exam_anchors_merge_into_physical_exam_config():
    case = {
        "name": "旧病例",
        "exam_anchors": {"vital_signs": {"temperature": "37.0"}, "skin": {"全身": "干燥"}},
    }
    conversion = migration.convert_case_data(case)

    assert conversion.errors == []
    assert conversion.case["activities"]["physical_exam"]["config"] == case["exam_anchors"]
    assert "exam_anchors" not in conversion.case


def test_exam_anchors_and_tools_physical_exam_merge_with_tools_winning():
    case = {
        "name": "双源病例",
        "exam_anchors": {"vital_signs": {"temperature": "37.0"}, "pain_score": 3},
        "tools": {"physical_exam": {"vital_signs": {"temperature": "39.0"}}},
    }
    conversion = migration.convert_case_data(case)

    config = conversion.case["activities"]["physical_exam"]["config"]
    assert config["vital_signs"] == {"temperature": "39.0"}  # tools.* 优先
    assert config["pain_score"] == 3  # 仅 exam_anchors 提供的键保留
    assert any("覆盖同名键" in change for change in conversion.changes)


def test_nursing_diagnosis_is_never_added():
    case = {**_LEGACY, "tools": {**_LEGACY["tools"], "nursing_diagnosis": {"enabled": True}}}
    conversion = migration.convert_case_data(case)

    assert conversion.errors
    assert "不得迁移" in conversion.errors[0]
    assert "activities" not in conversion.case or "nursing_diagnosis" not in conversion.case.get("activities", {})
    assert "tools" in conversion.case  # 报错时保持原样，不落盘


def test_unknown_tool_key_refuses_conversion():
    case = {**_LEGACY, "tools": {**_LEGACY["tools"], "telepathy": {"enabled": True}}}
    conversion = migration.convert_case_data(case)

    assert any("无迁移映射" in error for error in conversion.errors)
    assert "activities" not in conversion.case


def test_already_migrated_case_is_left_alone():
    case = {"name": "新病例", "activities": {"quiz": {"config": {"questions": [{"id": "q1"}]}}}}
    conversion = migration.convert_case_data(case)

    assert conversion.already_migrated
    assert conversion.case == case


def test_activities_lands_where_tools_was():
    conversion = migration.convert_case_data(_LEGACY)
    assert list(conversion.case)[-1] == "activities"


@pytest.mark.parametrize("path", sorted(CASES_DIR.glob("*.json")), ids=lambda p: p.name)
def test_repository_cases_are_migrated(path: Path):
    case = json.loads(path.read_text(encoding="utf-8"))

    assert "tools" not in case
    assert "exam_anchors" not in case
    assert migration.convert_case_data(case).already_migrated
