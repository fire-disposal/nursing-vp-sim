"""训练记录排序表达式的免库判据。

线上事故（2026-09-26）：`/api/training/records?sort_by=score_total` 每次 500 ——
ORDER BY 直接引用 mapped `Score`（`scores.reviewed_total`），而该端点用
`joinedload(TrainingRecord.score)` 预取评分，SQLAlchemy 把那份 join 匿名别名为
`scores_1`，于是 FROM 里没有 `scores`，PG 报 "invalid reference to FROM-clause entry"。

这里把**生产表达式**（`record_sort_expressions`）按路由同样的方式装配后编译成 PG SQL：
括号深度 0 处不允许出现 `scores.`，必须是相关子查询（`(SELECT coalesce(scores.…)`）。
"""

from __future__ import annotations

import re

from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, joinedload

from models import Case, Score, TrainingRecord
from modules.training.record_sorting import record_sort_expressions


def _compiled_sql(sort_by: str, order: str = "desc", *, with_case_join: bool = True) -> str:
    """按线上请求的装配编译：base 上先有其它 join（病例过滤/班级过滤就走这条），
    随后 joinedload(score) 才会被匿名成 `scores_1` —— 这正是 500 的触发条件。"""
    query = Session().query(TrainingRecord)
    if with_case_join:
        query = query.join(Case, Case.id == TrainingRecord.case_id)
    query = query.options(joinedload(TrainingRecord.score).load_only(Score.id, Score.total_score, Score.reviewed_total))
    query = query.order_by(*record_sort_expressions(sort_by, order))
    return str(query.statement.compile(dialect=postgresql.dialect()))


def test_score_sort_uses_correlated_subquery() -> None:
    sql = _compiled_sql("score_total")
    assert "coalesce(scores.reviewed_total, scores.total_score)" in sql, sql


def test_score_sort_is_a_correlated_subquery_in_order_by() -> None:
    """回归判据：ORDER BY 里的评分列必须是**相关子查询**。

    历史 bug 的形式是 `ORDER BY coalesce(scores.reviewed_total, …)`（直接引用 mapped 实体），
    而 FROM 里只有别名 `scores_1` → PG 报 invalid reference。判据必须能区分两者：
    旧形式既没有子查询、也没有把 `scores` 关联回外层记录表。
    """
    for order in ("asc", "desc"):
        sql = _compiled_sql("score_total", order)
        # 前置断言：装配确实让 FROM 走了别名（否则判据是空转）
        assert "scores_1" in sql, sql
        order_clause = sql.split("ORDER BY", 1)[1]
        assert "(SELECT" in order_clause, sql
        assert "scores.record_id = training_records.id" in order_clause, sql


def test_duration_and_start_time_sorts() -> None:
    duration_sql = _compiled_sql("duration", "asc")
    assert re.search(r"ORDER BY.*training_records\.end_time - training_records\.start_time", duration_sql), duration_sql
    assert " ASC" in duration_sql.upper()

    start_sql = _compiled_sql("start_time", "desc")
    assert "training_records.start_time DESC" in start_sql, start_sql


def test_unknown_sort_field_falls_back_to_start_time() -> None:
    assert "training_records.start_time" in _compiled_sql("wat", "desc")


def test_nulls_last_term_present_for_every_sort() -> None:
    for field in ("start_time", "score_total", "duration"):
        sql = _compiled_sql(field)
        assert "IS NULL" in sql.upper(), sql
