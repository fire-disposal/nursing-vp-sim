"""_seed_cases 收敛行为测试 —— 内置病例修复必须进得了已初始化的库。

用假 SessionLocal 顶替真实数据库：只验证「哪一行会被仓库版本覆盖、哪一行必须让路」
的策略（旧库坏行 → 覆盖；教师改过的行 → 保留），不连库。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

import seed
from models import Case
from modules.cases.builtin_sync import has_bookmark, is_locally_edited, with_seed_bookmark

CASES_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "cases"


def _load(name: str) -> dict:
    return json.loads((CASES_DIR / f"{name}.json").read_text(encoding="utf-8"))


class _FakeQuery:
    def __init__(self, rows: list[Case]) -> None:
        self._rows = rows

    def filter(self, *args, **kwargs) -> _FakeQuery:
        return self

    def all(self) -> list[Case]:
        return list(self._rows)


class _FakeSession:
    def __init__(self, rows: list[Case]) -> None:
        self.rows = rows
        self.added: list[Case] = []
        self.committed = False

    def query(self, *args, **kwargs) -> _FakeQuery:
        return _FakeQuery(self.rows)

    def add(self, obj) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.committed = True

    def rollback(self) -> None:
        self.committed = False

    def close(self) -> None:
        pass


@pytest.fixture
def fake_db(monkeypatch) -> _FakeSession:
    session = _FakeSession([])
    monkeypatch.setattr(seed, "SessionLocal", lambda: session)
    return session


def _seed_all_in_sync(fake_db: _FakeSession) -> dict[str, Case]:
    """把每个内置病例都当作「已按仓库版本种过且未被改动」的行。"""
    rows: dict[str, Case] = {}
    for fpath in sorted(CASES_DIR.glob("*.json")):
        d = json.loads(fpath.read_text(encoding="utf-8"))
        row = Case(id=len(rows) + 1, name=d["name"], case_data=with_seed_bookmark(d))
        fake_db.rows.append(row)
        rows[d["name"]] = row
    return rows


def test_legacy_row_is_converged_to_repository_content(fake_db):
    """旧库里被丢过 tools 的坏行（无指纹）必须被仓库版本覆盖。"""
    rows = _seed_all_in_sync(fake_db)
    case1 = _load("case1")
    row = rows[case1["name"]]
    row.case_data = {k: v for k, v in case1.items() if k != "tools"}

    seed._seed_cases()

    assert row.case_data["tools"] == case1["tools"]
    assert is_locally_edited(row.case_data) is False
    assert fake_db.committed is True


def test_teacher_edited_row_is_kept(fake_db):
    """教师改过的行不得被仓库版本静默回滚，且不产生任何写入。"""
    rows = _seed_all_in_sync(fake_db)
    case1 = _load("case1")
    row = rows[case1["name"]]
    row.case_data = {**with_seed_bookmark(case1), "chief_complaint": "教师修改过的主诉"}

    seed._seed_cases()

    assert row.case_data["chief_complaint"] == "教师修改过的主诉"
    assert fake_db.committed is False


def test_row_already_in_sync_is_not_rewritten(fake_db):
    rows = _seed_all_in_sync(fake_db)
    before = {name: dict(row.case_data) for name, row in rows.items()}

    seed._seed_cases()

    assert fake_db.committed is False
    assert {name: dict(row.case_data) for name, row in rows.items()} == before


def test_missing_builtin_cases_are_imported_with_fingerprint(fake_db):
    seed._seed_cases()

    assert len(fake_db.added) == len(list(CASES_DIR.glob("*.json")))
    assert all(has_bookmark(c.case_data) for c in fake_db.added)
    assert fake_db.committed is True
