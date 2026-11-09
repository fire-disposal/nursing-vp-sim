"""概念资产的最小回归：仓库里的病例过得去 schema 与校验，文件夹往返无损。

情境训练的后端运行时已整体下线（docs/scenario.md），`modules/scenario_training` 只保留
概念资产：`schema` / `validation` / `case_folder` / `standard_case` + `cases/**`。
本用例不碰数据库、不碰路由，只证明这份资产仍然自洽可读。
"""

from __future__ import annotations

import pytest

from modules.scenario_training import case_folder, schema, standard_case, validation

#: 仓库里保留的病例（`cases/<key>/`）。
EXPECTED_CASE_KEYS = [
    "bp-contradiction",
    "night-call-decision",
    "sputum-ineffective",
    "triage-hidden-bleed",
    "two-beds-priority",
]


def test_cases_directory_holds_exactly_the_retained_cases() -> None:
    assert case_folder.case_keys() == EXPECTED_CASE_KEYS


@pytest.mark.parametrize("key", EXPECTED_CASE_KEYS)
def test_case_passes_schema_and_validation(key: str) -> None:
    """五个病例都能解析成 `ScenarioPack`，且校验零问题（校验是检查器，这里要求它是干净的）。"""
    parsed = case_folder.read_case(key)

    pack = schema.ScenarioPack.model_validate(parsed.content)

    assert pack.key == key
    assert validation.validate_pack(pack) == []


@pytest.mark.parametrize("key", EXPECTED_CASE_KEYS)
def test_case_folder_round_trip_is_lossless(key: str) -> None:
    """`文件夹 → pack → 文件夹 → pack` 模型深相等，图片字节原样进出。"""
    original = case_folder.read_case(key)
    pack = schema.ScenarioPack.model_validate(original.content)

    files = case_folder.case_files(pack, original.images)
    reparsed = case_folder.parse_files(files)

    assert reparsed.content == original.content
    assert reparsed.images == original.images
    assert reparsed.notes == []
    assert schema.ScenarioPack.model_validate(reparsed.content) == pack


def test_standard_template_parses_and_validates() -> None:
    """标准模板是"病例格式长什么样"的活文档，必须自己先过得去。"""
    files = standard_case.files("new-case", "新病例")

    assert set(files) == {case_folder.CASE_TOML, case_folder.CASE_MD}

    parsed = case_folder.parse_files(files)
    pack = schema.ScenarioPack.model_validate(parsed.content)

    assert validation.validate_pack(pack) == []
    assert standard_case.content("new-case", "新病例") == parsed.content
