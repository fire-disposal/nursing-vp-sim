"""执行成绩表达式，验证 NULL 资格、复核零分和空聚合，不依赖外部数据库。"""

import pytest
from sqlalchemy import create_engine, func, select, text

from models import Score
from modules.training.scoring.grade_scope import grade_conditions, grade_expr


@pytest.fixture
def grade_db():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        # 只需这四列即可执行共享成绩表达式；无需为单元测试安装 PostgreSQL。
        connection.exec_driver_sql(
            "CREATE TABLE scores (id INTEGER PRIMARY KEY, total_score REAL, reviewed_total REAL, fallback JSON)"
        )
        yield connection
    engine.dispose()


def test_absent_fallback_grades_include_json_null_and_reviewed_zero(grade_db):
    grade_db.execute(
        text("INSERT INTO scores VALUES (:id, :total, :reviewed, :fallback)"),
        [
            {"id": 1, "total": 70, "reviewed": None, "fallback": None},
            {"id": 2, "total": 90, "reviewed": 0, "fallback": "null"},
            {"id": 3, "total": 100, "reviewed": None, "fallback": '{"kind":"degraded"}'},
            {"id": 4, "total": 100, "reviewed": 100, "fallback": "{}"},
        ],
    )
    grades = grade_db.execute(select(Score.id, grade_expr()).where(*grade_conditions()).order_by(Score.id)).all()
    assert grades == [(1, 70), (2, 0)]
    average = grade_db.execute(select(func.avg(grade_expr())).where(*grade_conditions())).scalar_one()
    assert average == 35


def test_only_fallback_scores_produce_no_eligible_grade(grade_db):
    grade_db.execute(text("INSERT INTO scores VALUES (1, 100, NULL, :fallback)"), {"fallback": '{"kind":"failed"}'})
    result = grade_db.execute(select(func.count(grade_expr()), func.avg(grade_expr())).where(*grade_conditions())).one()
    assert result == (0, None)
