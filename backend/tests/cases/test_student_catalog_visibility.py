"""学生目录的可见性边界：**只列可开始训练的病例**（docs/15 §六/§十六）。

为什么要钉住：学生工作区未交付的 workflow（``runtime_ready=False``，如 clinical_reasoning）
一旦漏进目录，学生就会看到"点不动的病例"——目录是产品面，不是路线图。
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from modules.cases.service import CaseService


class _Query:
    """最小查询替身：只覆盖 list_brief 用到的链路（filter/order_by → all）。"""

    def __init__(self, rows: list[object]) -> None:
        self._rows = rows

    def filter(self, *_args, **_kwargs) -> _Query:
        return self

    def order_by(self, *_args, **_kwargs) -> _Query:
        return self

    def all(self) -> list[object]:
        return list(self._rows)


def _case(case_id: int, workflow: str | None) -> SimpleNamespace:
    case_data = {} if workflow is None else {"workflow": workflow}
    return SimpleNamespace(id=case_id, case_data=case_data, current_revision=None)


@pytest.fixture
def rows() -> list[SimpleNamespace]:
    return [_case(1, None), _case(2, "history_taking"), _case(3, "clinical_reasoning"), _case(4, "clinician_unknown")]


def _service(rows) -> CaseService:
    service = CaseService.__new__(CaseService)
    service.db = SimpleNamespace(query=lambda *_a, **_k: _Query(rows))
    return service


class TestStudentCatalogVisibility:
    def test_hides_non_startable_workflows(self, rows):
        service = _service(rows)

        items, total = service.list_brief(0, 50)

        assert [case.id for case in items] == [1, 2]
        assert total == 2

    def test_total_reflects_filtered_set_not_raw_query(self, rows):
        """分页 total 必须按过滤后的集合算，否则前端会显示不存在的页数。"""
        service = _service(rows)

        items, total = service.list_brief(1, 1)

        assert [case.id for case in items] == [2]
        assert total == 2

    def test_unknown_workflow_declaration_is_hidden(self):
        """数据层面异常（未登记的 workflow id）不进目录，也不抛错。"""
        service = _service([_case(9, "clinician_unknown")])

        items, total = service.list_brief(0, 50)

        assert items == []
        assert total == 0
