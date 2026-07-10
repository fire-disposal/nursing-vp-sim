"""list_brief 的 name 模糊搜索测试。"""

import pytest

from models import Case
from repositories.case import CaseRepository


@pytest.fixture
def three_cases(db_session):
    ids = []
    for nm in ("急性胸痛", "腹痛待查", "胸闷气短"):
        c = Case(
            name=nm, training_type="history_taking", difficulty=1, case_data={},
        )
        db_session.add(c)
        db_session.flush()
        ids.append(c.id)
    return ids


def test_list_brief_filters_by_name(db_session, three_cases):
    repo = CaseRepository(db_session)
    items, _total = repo.list_brief(0, 50, name="胸")
    names = {c.name for c in items}
    assert names == {"急性胸痛", "胸闷气短"}


def test_list_brief_no_name_returns_all(db_session, three_cases):
    repo = CaseRepository(db_session)
    items, total = repo.list_brief(0, 50)
    result_ids = {c.id for c in items}
    assert set(three_cases).issubset(result_ids)
    assert total >= 3
