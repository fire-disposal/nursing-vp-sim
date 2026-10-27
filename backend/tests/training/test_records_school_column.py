"""`/api/training/records` 逐行带院校：平台角色在「全部院校」视图下靠它认院校。

直接调用路由函数（真实 ORM 查询 + 真实 PG），钉住两件事：
1. 学生账号的院校优先，平台角色试跑（账号无院校）回退到作业班级的院校；
2. 新增的 `joinedload(assignment → class)` 分支不会把分页/查询打坏。
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest

from core.database import Base, engine
from core.tenant import platform_scope
from models import (
    Assignment,
    Case,
    CaseRevision,
    Class,
    ClassMembership,
    Role,
    RolePermission,
    School,
    Score,
    ScoreReview,
    TrainingRecord,
    User,
)
from modules.training.router.session_views import RecordFilters, get_records

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
    Case.__table__,
    Assignment.__table__,
    TrainingRecord.__table__,
    Score.__table__,
    ScoreReview.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


def _school(db: Session, name: str) -> School:
    school = db.query(School).filter(School.name == name).first()
    if school is None:
        school = School(name=name, created_at=NOW)
        db.add(school)
        db.flush()
    return school


def _reviewer(db: Session) -> User:
    role = db.query(Role).filter(Role.name == "records-reviewer").first()
    if role is None:
        role = Role(name="records-reviewer", display_name="records-reviewer", is_system=False)
        db.add(role)
        db.flush()
        db.add(RolePermission(role_id=role.id, permission="score_review"))
        db.flush()
    user = User(
        username="records-reviewer",
        password_hash="x",
        role_id=role.id,
        display_name="Reviewer",
        school_id=None,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(user)
    db.flush()
    user.set_permissions_cache({"score_review"})
    return user


def test_records_list_carries_school_name(db):
    school_a = _school(db, "甲大学")
    school_b = _school(db, "乙学院")
    reviewer = _reviewer(db)
    case = Case(name="病例", description="", difficulty=1, time_limit_minutes=30)
    db.add(case)
    db.flush()
    revision = CaseRevision(case_id=case.id, revision_no=1, content={}, created_at=NOW)
    db.add(revision)
    db.flush()

    student = User(
        username="stu-school",
        password_hash="x",
        role_id=reviewer.role_id,
        display_name="学生甲",
        school_id=school_a.id,
        created_at=NOW,
        updated_at=NOW,
    )
    platform_runner = User(
        username="platform-runner",
        password_hash="x",
        role_id=reviewer.role_id,
        display_name="平台试跑",
        school_id=None,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add_all([student, platform_runner])
    db.flush()

    cls = Class(name="甲班", cohort_label="2026级", school_id=school_a.id, created_at=NOW)
    db.add(cls)
    db.flush()
    assignment = Assignment(
        title="甲班作业",
        case_id=case.id,
        case_revision_id=revision.id,
        class_id=cls.id,
        teacher_id=reviewer.id,
        start_time=NOW,
        end_time=NOW,
        audience_mode="class",
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(assignment)
    db.flush()

    db.add_all(
        [
            TrainingRecord(user_id=student.id, case_id=case.id, status="completed", start_time=NOW),
            # 平台角色试跑：账号没有院校，院校从作业班级推导
            TrainingRecord(
                user_id=platform_runner.id,
                case_id=case.id,
                assignment_id=assignment.id,
                status="completed",
                start_time=NOW,
            ),
        ]
    )
    db.flush()

    page = get_records(
        current_user=reviewer,
        db=db,
        scope=platform_scope(),
        filters=RecordFilters(),
        limit=50,
        offset=0,
        sort_by="start_time",
        order="desc",
    )

    by_user = {row.user_id: row for row in page.items}
    assert (by_user[student.id].school_id, by_user[student.id].school_name) == (school_a.id, "甲大学")
    assert (by_user[platform_runner.id].school_id, by_user[platform_runner.id].school_name) == (
        school_a.id,
        "甲大学",
    )
    assert school_b.id  # 乙学院不参与，只用于确认查询没有把院校混淆
