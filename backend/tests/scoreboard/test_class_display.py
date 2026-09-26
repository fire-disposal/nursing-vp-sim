"""成绩/花名册的「班级名」口径回归。

契约（docs/15 §七）：
  - 有 ``scope.class_id`` 时显示该班（作用域即语境）；
  - 无作用域时显示 class_id 最小的班级 —— **稳定可复现**，不得由扫描顺序决定；
  - 只有 ``member_role='student'`` 的成员参与，教师成员不得混入。

缺陷背景：旧实现把 ``(user_id → 班级名)`` 直接塞进 dict，多班级学生显示哪个班
取决于查询返回顺序；趋势视图再用 ``.first()``，同一学生在两个页面的班级结论不同。

真库判据（**PostgreSQL**，`nursing_test`）：``user_class.member_role`` 有 CHECK 约束、
``(user_id, class_id)`` 有唯一约束，用例用的 1/2/3 号用户与 1/2 号班级均按显式 id 建在
savepoint 内（真库这几张表为空）。
"""

from types import SimpleNamespace

import pytest

from core.database import Base
from core.database import engine as pg_engine
from models import Class, ClassMembership, Role, User
from modules.scoreboard.service import ScoreboardScope, ScoreboardService

_TABLES = [Role.__table__, User.__table__, Class.__table__, ClassMembership.__table__]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：真库建表（幂等），不用 SQLite 替身。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    """savepoint 隔离 → 用例内部的 flush 只落在 savepoint 里，对库零残留。

    无作用域的断言取「class_id 最小的班级」，且只认 ``member_role='student'``：先清掉
    这三个用户可能残留的成员关系，保证起点与 SQLite 时代的空表一致。
    """
    pg_session.query(ClassMembership).filter(ClassMembership.user_id.in_((1, 2, 3))).delete(synchronize_session=False)
    return pg_session


def _seed(db) -> tuple[Class, Class]:
    from datetime import UTC, datetime

    role = db.query(Role).filter(Role.name == "student").first() or Role(
        name="student", display_name="学生", is_system=True
    )
    db.add(role)
    db.flush()

    class_a = Class(id=1, name="A班", cohort_label="2026级")
    class_b = Class(id=2, name="B班", cohort_label="2026级")
    db.add_all([class_a, class_b])

    now = datetime.now(UTC)
    for uid in (1, 2, 3):
        db.add(
            User(
                id=uid,
                username=f"u{uid}",
                password_hash="x",
                display_name=f"用户{uid}",
                role_id=role.id,
                created_at=now,
                updated_at=now,
            )
        )
    db.flush()
    db.add_all(
        [
            ClassMembership(user_id=1, class_id=1, member_role="student"),
            ClassMembership(user_id=1, class_id=2, member_role="student"),
            ClassMembership(user_id=2, class_id=2, member_role="student"),
            # 3 号是 A 班教师：不得出现在学生口径里
            ClassMembership(user_id=3, class_id=1, member_role="teacher"),
        ]
    )
    db.flush()
    return class_a, class_b


def _rows(*user_ids: int):
    return [SimpleNamespace(user_id=uid) for uid in user_ids]


def test_unscoped_uses_lowest_class_id(db):
    _seed(db)
    names = ScoreboardService(db)._display_class_names(_rows(1, 2), ScoreboardScope())

    assert names == {1: "A班", 2: "B班"}


def test_scoped_shows_the_scoped_class(db):
    class_a, class_b = _seed(db)
    svc = ScoreboardService(db)

    assert svc._display_class_names(_rows(1, 2), ScoreboardScope(class_id=class_b.id)) == {1: "B班", 2: "B班"}
    assert svc._display_class_names(_rows(1, 2), ScoreboardScope(class_id=class_a.id)) == {1: "A班"}


def test_teacher_membership_is_not_a_student_class(db):
    _seed(db)
    svc = ScoreboardService(db)

    assert svc._display_class_names(_rows(3), ScoreboardScope()) == {}
    assert svc._display_class_names(_rows(3), ScoreboardScope(class_id=1)) == {}


def test_multi_class_member_resolves_identically_across_scopes(db):
    _seed(db)
    svc = ScoreboardService(db)

    unscoped = svc._display_class_names(_rows(1), ScoreboardScope())[1]
    scoped_a = svc._display_class_names(_rows(1), ScoreboardScope(class_id=1))[1]
    scoped_b = svc._display_class_names(_rows(1), ScoreboardScope(class_id=2))[1]

    # 无作用域 = 稳定值（最小 class_id）；有作用域 = 该班 —— 两者都不随机
    assert unscoped == "A班"
    assert scoped_a == "A班"
    assert scoped_b == "B班"
