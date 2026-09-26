"""内置病例收敛策略测试 — 保证 seed 既能送达仓库修复，又不回滚教师改动。"""

import json
from pathlib import Path

from modules.cases.builtin_sync import (
    SEED_HASH_KEY,
    content_hash,
    has_bookmark,
    is_locally_edited,
    same_content,
    with_seed_bookmark,
)
from schemas.case_schema import strip_case_metadata, validate_case_data

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def _load(name: str) -> dict:
    return json.loads((CASES_DIR / f"{name}.json").read_text(encoding="utf-8"))


def test_freshly_seeded_row_is_not_locally_edited():
    assert is_locally_edited(with_seed_bookmark(_load("case1"))) is False


def test_teacher_edit_is_detected():
    payload = with_seed_bookmark(_load("case1"))
    payload["chief_complaint"] = "教师改过的主诉"
    assert is_locally_edited(payload) is True


def test_teacher_edit_of_activity_config_is_detected():
    payload = with_seed_bookmark(_load("case1"))
    payload["activities"]["physical_exam"]["config"]["vital_signs"]["spo2"] = "95-99"
    assert is_locally_edited(payload) is True


def test_legacy_row_without_bookmark_is_converged():
    """旧库行没有指纹 → seed 必须覆盖它，否则内置病例修复永远进不了老库。"""
    legacy = _load("case1")
    assert has_bookmark(legacy) is False
    assert is_locally_edited(legacy) is False


def test_content_hash_ignores_bookmark_and_order():
    payload = with_seed_bookmark(_load("case1"))
    shuffled = {k: payload[k] for k in reversed(list(payload))}
    assert content_hash(shuffled) == content_hash(payload)
    assert same_content(payload, _load("case1")) is True


def test_content_differs_after_repository_fix():
    """仓库改了病例内容 → 与库内旧内容不再相同（seed 据此判定需要更新）。"""
    repo = _load("case3")
    stale = {**repo, "chief_complaint": repo["chief_complaint"] + "（旧版本）"}
    assert same_content(stale, repo) is False


def test_bookmark_survives_case_crud_round_trip():
    """写路径（strict 校验 → 剥离元数据落库）必须保住指纹，否则教师一保存就会被 seed 覆盖。"""
    file_data = _load("case1")
    stored_payload = with_seed_bookmark(file_data)
    # 编辑部回传的载荷带元数据键（name/difficulty/time_limit），落库前由写路径剥离
    incoming = {**file_data, SEED_HASH_KEY: stored_payload[SEED_HASH_KEY]}
    stored = strip_case_metadata(validate_case_data(incoming, strict=True))

    assert stored[SEED_HASH_KEY] == stored_payload[SEED_HASH_KEY]
    assert is_locally_edited(stored) is False
    assert same_content(stored, file_data) is True
