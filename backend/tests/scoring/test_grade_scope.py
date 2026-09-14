"""成绩口径单一出口（INV-3 / INV-5）。

守护：
- ``grade_expr()`` 就是 ``COALESCE(reviewed_total, total_score)``，与
  ``Score.effective_total`` 同一语义；``grade_conditions()`` 就是排除兜底分。
- 成绩管理的聚合查询消费这两个函数，而不是各自内联 SQL（口径漂移即失败）。
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import literal_column
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from models import Score
from modules.scoreboard import service as scoreboard_service
from modules.scoreboard.service import ScoreboardService
from modules.training.scoring.grade_scope import grade_conditions, grade_expr

if TYPE_CHECKING:
    from sqlalchemy.sql import ColumnElement


def _sql(expr: ColumnElement) -> str:
    return str(expr.compile(dialect=postgresql.dialect()))


class _RecordingQuery:
    """记录 filter() 条件、不连 DB 的 Query 替身。"""

    def __init__(self, session: _RecordingSession) -> None:
        self._session = session

    def join(self, *_args: object, **_kwargs: object) -> _RecordingQuery:
        return self

    def outerjoin(self, *_args: object, **_kwargs: object) -> _RecordingQuery:
        return self

    def filter(self, *criteria: ColumnElement) -> _RecordingQuery:
        self._session.filters.append(criteria)
        return self

    def order_by(self, *_args: object, **_kwargs: object) -> _RecordingQuery:
        return self

    def all(self) -> list:
        return []


class _RecordingSession:
    def __init__(self) -> None:
        self.filters: list[tuple[ColumnElement, ...]] = []

    def query(self, *_entities: object) -> _RecordingQuery:
        return _RecordingQuery(self)


def test_grade_expr_is_reviewed_total_over_total_score():
    """INV-5：展示成绩 = COALESCE(reviewed_total, total_score)（教师复核分优先）。"""
    assert _sql(grade_expr()) == "coalesce(scores.reviewed_total, scores.total_score)"


def test_grade_conditions_exclude_fallback_scores():
    """INV-3：兜底分（评分故障降级结果）不进聚合。"""
    assert [_sql(condition) for condition in grade_conditions()] == ["scores.fallback IS NULL"]


def test_ranking_stats_query_reads_grades_through_the_shared_scope(monkeypatch):
    """排行统计的平均分/最高分同源，且兜底过滤来自同源（内联 SQL 会让本测试失败）。"""
    monkeypatch.setattr(scoreboard_service, "grade_expr", lambda: literal_column("987654"))
    marker = literal_column("999888")
    monkeypatch.setattr(scoreboard_service, "grade_conditions", lambda: [marker])

    query = ScoreboardService(Session())._stats_query([])
    sql = _sql(query.statement)

    assert sql.count("987654") == 2  # avg_score + best_score
    assert "999888" in sql


def test_progress_query_filters_through_the_shared_scope(monkeypatch):
    marker = Score.total_score > 999
    monkeypatch.setattr(scoreboard_service, "grade_conditions", lambda: [marker])

    db = _RecordingSession()
    ScoreboardService(db)._progress_for_users([1], [])  # type: ignore[arg-type]

    assert db.filters
    assert all(any(condition is marker for condition in call) for call in db.filters)
