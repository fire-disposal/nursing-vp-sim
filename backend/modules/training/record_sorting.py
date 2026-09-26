"""训练记录列表的服务端排序表达式。

为什么单独成模块：评分列的排序**必须**用相关子查询，不能直接引用 mapped `Score` 实体。
`/api/training/records` 用 `joinedload(TrainingRecord.score)` 预取评分，当 base 上已有其它
join 时 SQLAlchemy 会把这份预取 join 匿名别名为 `scores_1`；此时 ORDER BY 里 `scores.…`
就成了 "invalid reference to FROM-clause entry for table scores"（2026-09-26 线上
每次按评分排序都 500）。相关子查询把 `scores` 放进子查询自己的 FROM，与外层
join 顺序、是否已有 score/review 过滤都无关。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, cast

from sqlalchemy import func, select

from models import Score, TrainingRecord

if TYPE_CHECKING:
    from sqlalchemy.sql.elements import ColumnElement

VALID_SORT_FIELDS = ("start_time", "score_total", "duration")


def _sort_column(sort_by: str) -> ColumnElement[Any]:
    if sort_by == "score_total":
        # 相关子查询：外层怎么 join 都不影响（见模块 docstring）
        return (
            select(func.coalesce(Score.reviewed_total, Score.total_score))
            .where(Score.record_id == TrainingRecord.id)
            .scalar_subquery()
        )
    if sort_by == "duration":
        return TrainingRecord.end_time - TrainingRecord.start_time
    # ORM 属性在类型桩里是 descriptor，运行时实现 __clause_element__（SQLAlchemy 的列语义）
    return cast("ColumnElement[Any]", TrainingRecord.start_time)


def record_sort_expressions(sort_by: str, order: str) -> tuple[ColumnElement[Any], ...]:
    """返回 order_by 表达式：空值（未评分 / 未结束）排最后，再按方向排序。"""
    column = _sort_column(sort_by if sort_by in VALID_SORT_FIELDS else "start_time")
    descending = order != "asc"
    return (column.is_(None), column.desc() if descending else column.asc())
