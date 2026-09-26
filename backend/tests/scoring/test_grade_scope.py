"""执行成绩表达式，验证 NULL 资格、复核零分和空聚合。

真库判据（**PostgreSQL**，`nursing_test`）：直接对 ``scores`` 真表跑共享的
``grade_conditions()`` / ``grade_expr()`` —— ``fallback`` 是 JSONB，SQL NULL 与 JSON
``null`` 是两种不同的值（``grade_conditions()`` 两个分支都要命中），这是 SQLite 上
用 ``JSON`` 变体测不到的真实行为。

``scores.record_id`` NOT NULL + UNIQUE 且是真外键，故夹具在 savepoint 内种出训练记录。
"""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy import func, select

from core.database import Base
from core.database import engine as pg_engine
from models import Case, Role, Score, TrainingRecord, User
from modules.training.scoring.grade_scope import grade_conditions, grade_expr

_TABLES = [Role.__table__, User.__table__, Case.__table__, TrainingRecord.__table__, Score.__table__]

_CASE_NAME = "成绩口径病例"

#: ``fallback`` 用文本字面量插入再 ``CAST``：None → SQL NULL，'null' → JSON null
_INSERT_SCORE = sa.text(
    "INSERT INTO scores (id, record_id, total_score, reviewed_total, fallback, created_at, mapping_version) "
    "VALUES (:id, :record_id, :total, :reviewed, CAST(:fallback AS JSONB), :created_at, 0)"
)


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：真库建表（幂等），不用 SQLite 替身。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def grade_db(pg_session):
    """savepoint 隔离 + 确定性起点：清空成绩表，并种出可供 ``record_id`` 引用的训练记录。"""
    role = pg_session.query(Role).filter(Role.name == "student").first() or Role(
        name="student", display_name="学生", is_system=True
    )
    pg_session.add(role)
    pg_session.flush()
    # score_reviews.score_id 是 FK ON DELETE CASCADE，整表清空安全
    pg_session.query(Score).delete()
    user = User(username="grade-scope-student", password_hash="x", role_id=role.id, display_name="成绩口径学生")
    case = Case(name=_CASE_NAME, description="", difficulty=1, time_limit_minutes=30)
    pg_session.add_all([user, case])
    pg_session.flush()
    pg_session.add_all([TrainingRecord(user_id=user.id, case_id=case.id, status="in_progress") for _ in range(4)])
    pg_session.flush()
    return pg_session


def _record_ids(db) -> list[int]:
    case = db.query(Case).filter(Case.name == _CASE_NAME).one()
    return [
        row.id for row in db.query(TrainingRecord).filter(TrainingRecord.case_id == case.id).order_by(TrainingRecord.id)
    ]


def _insert_scores(db, rows: list[dict]) -> None:
    """按参数顺序给 1..N 号成绩行（训练记录一一对应）。"""
    record_ids = _record_ids(db)
    for index, row in enumerate(rows, start=1):
        db.execute(
            _INSERT_SCORE,
            {
                "id": index,
                "record_id": record_ids[index - 1],
                "created_at": datetime.now(UTC).replace(tzinfo=None),
                **row,
            },
        )


def test_absent_fallback_grades_include_json_null_and_reviewed_zero(grade_db):
    _insert_scores(
        grade_db,
        [
            {"total": 70, "reviewed": None, "fallback": None},
            {"total": 90, "reviewed": 0, "fallback": "null"},
            {"total": 100, "reviewed": None, "fallback": '{"kind":"degraded"}'},
            {"total": 100, "reviewed": 100, "fallback": "{}"},
        ],
    )
    grades = grade_db.execute(select(Score.id, grade_expr()).where(*grade_conditions()).order_by(Score.id)).all()
    assert grades == [(1, 70), (2, 0)]
    average = grade_db.execute(select(func.avg(grade_expr())).where(*grade_conditions())).scalar_one()
    assert average == 35


def test_only_fallback_scores_produce_no_eligible_grade(grade_db):
    _insert_scores(grade_db, [{"total": 100, "reviewed": None, "fallback": '{"kind":"failed"}'}])

    result = grade_db.execute(select(func.count(grade_expr()), func.avg(grade_expr())).where(*grade_conditions())).one()
    assert result == (0, None)
