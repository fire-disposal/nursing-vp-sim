"""学生身份：本校同学号只能有一个账号；名单再导一次是「并入」而不是再造一个人。

线上形状（2026-10）：同名同学号两个账号，20 / 14 条已完成训练挂在旧号上，护理242 的
班级统计里这两人是 0。判定必须在预检阶段就能看见，否则管理员仍然只能事后发现。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from core.database import Base, engine
from core.exceptions import ValidationError
from core.tenant import platform_scope
from models import Class, ClassMembership, Role, RolePermission, School, User
from modules.admin.users import UserService
from schemas.user import UserUpdateRequest

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
    for name, display in (("student", "学生"), ("teacher", "教师")):
        if pg_session.query(Role).filter(Role.name == name).first() is None:
            pg_session.add(Role(name=name, display_name=display, is_system=True))
    pg_session.flush()
    return pg_session


def _student_role(db: Session) -> Role:
    return db.query(Role).filter(Role.name == "student").one()


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


def test_same_student_number_links_instead_of_creating_second_account(db):
    school = _school(db, "身份大学")
    service = UserService(db, platform_scope())
    first = service.batch_create(
        [_row("old-1", school_name="身份大学", student_id="S1", display_name="张三", class_name="护理1班")]
    )
    assert first.created == 1

    second = service.batch_create(
        [_row("new-1", school_name="身份大学", student_id="S1", display_name="张三", class_name="护理2班")]
    )

    assert (second.created, second.linked, second.skipped) == (0, 1, 0)
    users = db.query(User).filter(User.student_id == "S1").all()
    assert len(users) == 1  # 没有第二个账号
    assert users[0].username == "old-1"
    class_names = {m.class_.name for m in db.query(ClassMembership).filter_by(user_id=users[0].id)}
    assert class_names == {"护理1班", "护理2班"}  # 多班级靠成员关系叠加


def test_same_number_different_name_is_rejected_not_merged(db):
    _school(db, "身份大学")
    service = UserService(db, platform_scope())
    service.batch_create([_row("old-2", school_name="身份大学", student_id="S2", display_name="李四")])

    result = service.batch_create([_row("new-2", school_name="身份大学", student_id="S2", display_name="王五")])

    assert (result.created, result.linked, result.skipped) == (0, 0, 1)
    assert "与姓名「王五」不一致" in result.skipped_rows[0].reason
    assert db.query(User).filter(User.username == "new-2").first() is None


def test_duplicate_student_number_inside_one_batch_skips_the_later_row(db):
    _school(db, "身份大学")
    service = UserService(db, platform_scope())

    result = service.batch_create(
        [
            _row("dup-a", school_name="身份大学", student_id="S3", display_name="赵六"),
            _row("dup-b", school_name="身份大学", student_id="S3", display_name="赵六"),
        ]
    )

    assert (result.created, result.linked, result.skipped) == (1, 0, 1)
    assert "本批次内学号 S3 重复" in result.skipped_rows[0].reason


def test_preview_writes_nothing_and_reports_plan(db):
    _school(db, "预览大学")
    service = UserService(db, platform_scope())
    before_users = db.query(User).count()

    preview = service.preview_batch(
        [
            _row("prev-1", school_name="预览大学", student_id="P1", display_name="预览一", class_name="新班"),
            _row("prev-2", school_name="预览大学", student_id="P2", display_name="预览二"),
            _row("prev-3", school_name="不存在大学"),
        ]
    )

    assert (preview.create, preview.link, preview.skip) == (2, 0, 1)
    assert preview.rows[0].will_create_class is True
    assert preview.rows[2].action == "skip"
    assert db.query(User).count() == before_users
    assert db.query(Class).filter(Class.name == "新班").first() is None  # 预检不建班


def test_preview_reports_link_target(db):
    _school(db, "预览大学")
    service = UserService(db, platform_scope())
    service.batch_create([_row("prev-old", school_name="预览大学", student_id="P3", display_name="钱七")])

    preview = service.preview_batch(
        [_row("prev-new", school_name="预览大学", student_id="P3", display_name="钱七", class_name="护理3班")]
    )

    [row] = preview.rows
    assert row.action == "link"
    assert (row.existing_username, row.existing_display_name) == ("prev-old", "钱七")


def test_username_can_be_renamed_and_stays_unique(db):
    school = _school(db, "改名大学")
    service = UserService(db, platform_scope())
    service.batch_create(
        [
            _row("rename-a", school_name="改名大学", display_name="甲"),
            _row("rename-b", school_name="改名大学", display_name="乙"),
        ]
    )
    user_a = db.query(User).filter(User.username == "rename-a").one()

    service.update(user_a.id, UserUpdateRequest(username="S2024001"), current_user=user_a)

    assert db.query(User).filter(User.username == "S2024001").one().id == user_a.id
    with pytest.raises(ValidationError, match="已被占用"):
        service.update(user_a.id, UserUpdateRequest(username="rename-b"), current_user=user_a)


def test_update_rejects_student_number_owned_by_another_account(db):
    _school(db, "改名大学")
    service = UserService(db, platform_scope())
    service.batch_create(
        [
            _row("id-a", school_name="改名大学", student_id="U1", display_name="甲一"),
            _row("id-b", school_name="改名大学", student_id="U2", display_name="乙二"),
        ]
    )
    user_b = db.query(User).filter(User.username == "id-b").one()

    with pytest.raises(ValidationError, match="已被账号"):
        service.update(user_b.id, UserUpdateRequest(student_id="U1"), current_user=user_b)
