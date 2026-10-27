"""批量导入的「学校」列：平台角色没有班级时靠它定院校归属。

规则（与单条建号同一套归属口径）：
- 行内「学校」= 「院校管理」里的名称；不存在 / 属于别的院校 → 该行丢弃并给出原因；
- 学校与班级同时给出且不一致 → 该行丢弃（院校归属不能有两个答案）；
- 给学校 + 不存在的班级 → 在该学校下新建班级（不再要求平台角色先手动建班）；
- 学校、班级都没有 → 丢弃，绝不造出「无院校的学生账号」。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from core.database import Base, engine
from core.tenant import platform_scope
from models import Class, ClassMembership, Role, RolePermission, School, User
from modules.admin.users import UserService

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

NOW = datetime.now(UTC)

_TABLES = [
    School.__table__,
    Class.__table__,
    ClassMembership.__table__,
    Role.__table__,
    RolePermission.__table__,
    User.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    role = pg_session.query(Role).filter(Role.name == "student").first()
    if role is None:
        role = Role(name="student", display_name="学生", is_system=True)
        pg_session.add(role)
        pg_session.flush()
    return pg_session


def _school(db: Session, name: str) -> School:
    school = db.query(School).filter(School.name == name).first()
    if school is None:
        school = School(name=name, created_at=NOW)
        db.add(school)
        db.flush()
    return school


def _row(username: str, **overrides) -> dict:
    row = {
        "username": username,
        "password": "secret123",
        "display_name": username,
        "role": "student",
        "student_id": None,
        "class_id": None,
        "class_name": None,
        "cohort_label": None,
        "school_name": None,
    }
    row.update(overrides)
    return row


def test_school_column_assigns_account_without_class(db):
    school = _school(db, "甲大学")
    service = UserService(db, platform_scope())

    result = service.batch_create([_row("stu-school-only", school_name="甲大学")])

    assert (result.created, result.skipped) == (1, 0), result.errors
    user = db.query(User).filter(User.username == "stu-school-only").one()
    assert user.school_id == school.id


def test_school_and_missing_class_creates_class_in_that_school(db):
    school = _school(db, "乙学院")
    service = UserService(db, platform_scope())

    result = service.batch_create(
        [_row("stu-new-class", school_name="乙学院", class_name="护理9班", cohort_label="2026级")]
    )

    assert (result.created, result.skipped) == (1, 0), result.errors
    cls = db.query(Class).filter(Class.name == "护理9班", Class.cohort_label == "2026级").one()
    assert cls.school_id == school.id


def test_unknown_school_skips_row_with_reason(db):
    service = UserService(db, platform_scope())

    result = service.batch_create([_row("stu-bad-school", school_name="不存在的院校")])

    assert result.created == 0
    assert "学校「不存在的院校」不存在" in result.errors[0]
    assert db.query(User).filter(User.username == "stu-bad-school").first() is None


def test_school_mismatch_with_class_skips_row(db):
    school_a = _school(db, "甲大学")
    _school(db, "乙学院")
    cls = Class(name="甲班", cohort_label="2024级", school_id=school_a.id, created_at=NOW)
    db.add(cls)
    db.flush()
    service = UserService(db, platform_scope())

    result = service.batch_create(
        [_row("stu-mismatch", school_name="乙学院", class_name="甲班", cohort_label="2024级")]
    )

    assert result.created == 0
    assert "属于其他院校" in result.errors[0]
    assert db.query(User).filter(User.username == "stu-mismatch").first() is None


def test_neither_school_nor_class_skips_row(db):
    service = UserService(db, platform_scope())

    result = service.batch_create([_row("stu-orphan")])

    assert result.created == 0
    assert "请填写「学校」列" in result.errors[0]
    assert db.query(User).filter(User.username == "stu-orphan").first() is None
