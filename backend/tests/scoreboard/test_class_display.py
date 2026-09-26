"""成绩/花名册的「班级名」口径回归。

契约（docs/15 §七）：
  - 有 ``scope.class_id`` 时显示该班（作用域即语境）；
  - 无作用域时显示 class_id 最小的班级 —— **稳定可复现**，不得由扫描顺序决定；
  - 只有 ``member_role='student'`` 的成员参与，教师成员不得混入。

缺陷背景：旧实现把 ``(user_id → 班级名)`` 直接塞进 dict，多班级学生显示哪个班
取决于查询返回顺序；趋势视图再用 ``.first()``，同一学生在两个页面的班级结论不同。
"""

from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.database import Base
from models import Class, ClassMembership, User
from modules.scoreboard.service import ScoreboardScope, ScoreboardService

_TABLES = [User.__table__, Class.__table__, ClassMembership.__table__]


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=_TABLES)
    with Session(engine) as session:
        yield session


def _seed(db: Session) -> tuple[Class, Class]:
    from datetime import UTC, datetime

    from models import Role

    Base.metadata.create_all(db.get_bind(), tables=[Role.__table__])
    role = Role(name="student", display_name="学生", is_system=True)
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
