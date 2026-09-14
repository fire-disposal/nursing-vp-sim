"""成绩口径单一出口 —— 聚合/排名/统计/导出共用同一份 SQL 口径。

两个不变量在这里定义一次，消费方不再各写一份 SQL：

- INV-5 展示成绩 = ``COALESCE(reviewed_total, total_score)``（教师复核分优先）
- INV-3 兜底分（``scores.fallback`` 非空 = 评分故障降级结果）不进任何聚合/排名/导出

Python 侧的同一口径是 ``Score.effective_total``（非聚合读取用，语义与
``grade_expr()`` 一致：``reviewed_total=0`` 时不回退到 ``total_score``）。
"""

from sqlalchemy import ColumnElement, func

from models import Score


def grade_expr() -> ColumnElement[float]:
    """成绩口径 SQL 表达式（INV-5）。调用方自行 ``.label(...)``。"""
    return func.coalesce(Score.reviewed_total, Score.total_score)


def grade_conditions() -> list[ColumnElement[bool]]:
    """成绩口径过滤条件（INV-3）：排除兜底分，未 JOIN ``Score`` 时不要加。"""
    return [Score.fallback.is_(None)]
