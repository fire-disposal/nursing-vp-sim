"""问卷模板列表筛选的免库判据。

前端一直传 search / is_active，但后端此前只收 type —— 两个控件是死的（审计 UI-CRD-2）。
这里直接调用 **服务自身的** `_list_query` 并把它编译成 PG SQL，确认两个条件真的进了查询
（不重写一份过滤逻辑，否则测的是测试代码而不是产品代码）。
"""

from __future__ import annotations

from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from modules.questionnaires.service import QuestionnaireTemplateFilters, QuestionnaireTemplateService


def _compiled_sql(type_: str | None = None, search: str | None = None, is_active: bool | None = None) -> str:
    # 不连库：Session() 无 bind 也能构造 Query，编译只需要方言
    service = QuestionnaireTemplateService(Session())
    query = service._filtered_query(  # 判据盯的就是这条真实查询
        QuestionnaireTemplateFilters(type=type_, search=search, is_active=is_active)
    )
    return str(query.statement.compile(dialect=postgresql.dialect()))


def test_search_and_status_become_sql_predicates() -> None:
    sql = _compiled_sql(type_="post", search="可用性", is_active=True)
    assert "ILIKE" in sql, sql
    assert "templates.is_active IS true" in sql, sql
    assert "templates.type =" in sql, sql


def test_status_false_filters_inactive_templates() -> None:
    sql = _compiled_sql(is_active=False)
    assert "templates.is_active IS false" in sql, sql


def test_no_filters_means_no_extra_predicates() -> None:
    # 注意：is_active 会出现在 SELECT 列里，判据只能看"有没有 WHERE"
    sql = _compiled_sql()
    assert "ILIKE" not in sql, sql
    assert "WHERE" not in sql, sql
