"""班级成员（``ClassMembership``）回归：单用户多班级 + 成员范围查询口径。

守护「学生名单 / 作业受众候选 / 班级排名 / 完成率 = member_role='student' 的成员」这条
唯一口径，以及批量增删的幂等性与约束（唯一 (user_id, class_id)、角色 CHECK）。
"""

from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.database import Base
from core.database import engine as pg_engine
from core.exceptions import NotFoundError, ValidationError
from models import AuditLog, Class, ClassMembership, Role, User
from models.school import legacy_grades_table
from modules.admin.class_memberships import (
    ClassMembershipService,
    member_class_ids,
    member_counts,
    memberships_by_user,
    remove_members,
    student_class_ids,
    student_member_ids,
    student_user_id_condition,
    upsert_members,
)
from modules.admin.users import UserService

_TABLES = [
    legacy_grades_table,
    Role.__table__,
    User.__table__,
    Class.__table__,
    ClassMembership.__table__,
    AuditLog.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：真库建表（幂等），不用 SQLite 替身。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    # 用例内部的 commit 只释放 savepoint → teardown 外层回滚，对库零残留
    return pg_session


def _role(db: Session, name: str) -> Role:
    role_obj = db.query(Role).filter(Role.name == name).first()
    if role_obj is None:
        role_obj = Role(name=name, display_name=name, is_system=True)
        db.add(role_obj)
        db.flush()
    return role_obj


def _user(db: Session, username: str, role: str = "student") -> User:
    role_obj = _role(db, role)
    user = User(
        username=username,
        password_hash="x",
        role_id=role_obj.id,
        display_name=username,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _class(db: Session, name: str, cohort_label: str = "2026级") -> Class:
    cls = Class(name=name, cohort_label=cohort_label)
    db.add(cls)
    db.commit()
    db.refresh(cls)
    return cls


class TestMemberScope:
    def test_student_member_ids_excludes_teachers_and_other_classes(self, db):
        c1 = _class(db, "1班")
        c2 = _class(db, "2班")
        s1 = _user(db, "s1")
        s2 = _user(db, "s2")
        t1 = _user(db, "t1", "teacher")
        upsert_members(db, c1.id, [s1.id, s2.id, t1.id], member_role="student")
        # 教师成员改用 teacher 角色（同一个人不重复建行）
        upsert_members(db, c1.id, [t1.id], member_role="teacher")
        upsert_members(db, c2.id, [s2.id], member_role="student")
        db.commit()

        assert student_member_ids(db, c1.id) == sorted([s1.id, s2.id])
        assert student_member_ids(db, c2.id) == [s2.id]
        assert member_counts(db, [c1.id, c2.id], role="student") == {c1.id: 2, c2.id: 1}
        assert member_counts(db, [c1.id], role="teacher") == {c1.id: 1}

    def test_multi_class_membership_and_user_scope(self, db):
        c1 = _class(db, "1班")
        c2 = _class(db, "2班", "2027级")
        student = _user(db, "s3")
        upsert_members(db, c1.id, [student.id], member_role="student")
        upsert_members(db, c2.id, [student.id], member_role="student")
        db.commit()

        assert member_class_ids(db, student.id) == sorted([c1.id, c2.id])
        assert student_class_ids(db, student.id) == sorted([c1.id, c2.id])
        assert sorted(m.id for m in memberships_by_user(db, [student.id])[student.id]) == sorted(
            m.id for m in db.query(ClassMembership).filter(ClassMembership.user_id == student.id).all()
        )

    def test_student_user_id_condition_filters_by_role(self, db):
        c1 = _class(db, "1班")
        s1 = _user(db, "s4")
        t1 = _user(db, "t2", "teacher")
        upsert_members(db, c1.id, [s1.id], member_role="student")
        upsert_members(db, c1.id, [t1.id], member_role="teacher")
        db.commit()

        rows = db.query(User.id).filter(student_user_id_condition(User.id, c1.id)).all()
        assert [r[0] for r in rows] == [s1.id]

    def test_invalid_role_filter_is_rejected(self, db):
        cls = _class(db, "1班")
        with pytest.raises(ValidationError):
            member_counts(db, [cls.id], role="principal")
        with pytest.raises(ValidationError):
            member_class_ids(db, 1, role="principal")


class TestMembershipMutation:
    def test_upsert_is_idempotent_and_updates_role(self, db):
        cls = _class(db, "1班")
        user = _user(db, "s5")

        assert upsert_members(db, cls.id, [user.id], member_role="student") == (1, 0, [])
        db.commit()
        assert upsert_members(db, cls.id, [user.id], member_role="student") == (0, 0, [])
        assert upsert_members(db, cls.id, [user.id], member_role="teacher") == (0, 1, [])
        db.commit()

        rows = db.query(ClassMembership).filter(ClassMembership.user_id == user.id).all()
        assert len(rows) == 1
        assert rows[0].member_role == "teacher"

    def test_upsert_reports_missing_users(self, db):
        cls = _class(db, "1班")
        user = _user(db, "s6")

        added, updated, missing = upsert_members(db, cls.id, [user.id, 9999], member_role="student")

        assert (added, updated, missing) == (1, 0, [9999])

    def test_remove_members_returns_deleted_count(self, db):
        cls = _class(db, "1班")
        user = _user(db, "s7")
        upsert_members(db, cls.id, [user.id], member_role="student")
        db.commit()

        assert remove_members(db, cls.id, [user.id]) == 1
        db.commit()
        assert remove_members(db, cls.id, [user.id]) == 0

    def test_duplicate_membership_violates_unique_constraint(self, db):
        cls = _class(db, "1班")
        user = _user(db, "s8")
        db.add(ClassMembership(user_id=user.id, class_id=cls.id, member_role="student"))
        db.commit()

        db.add(ClassMembership(user_id=user.id, class_id=cls.id, member_role="teacher"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

    def test_member_role_check_constraint(self, db):
        cls = _class(db, "1班")
        user = _user(db, "s9")

        db.add(ClassMembership(user_id=user.id, class_id=cls.id, member_role="principal"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


class TestMembershipService:
    def test_list_members_filters_by_role_and_search(self, db):
        cls = _class(db, "1班")
        s1 = _user(db, "小明")
        t1 = _user(db, "王老师", "teacher")
        upsert_members(db, cls.id, [s1.id], member_role="student")
        upsert_members(db, cls.id, [t1.id], member_role="teacher")
        db.commit()

        service = ClassMembershipService(db)
        students, total = service.list_members(cls.id, role="student")
        assert total == 1
        assert [m.user_id for m in students] == [s1.id]

        teachers, _ = service.list_members(cls.id, role="teacher")
        assert [m.user_id for m in teachers] == [t1.id]

        searched, _ = service.list_members(cls.id, search="王")
        assert [m.user_id for m in searched] == [t1.id]

        everyone, total_all = service.list_members(cls.id)
        assert total_all == 2

    def test_add_and_remove_members_through_service(self, db):
        cls = _class(db, "1班")
        user = _user(db, "s10")
        service = ClassMembershipService(db)

        added = service.add_members(cls.id, [user.id, 4242], "student")
        assert (added.added, added.skipped) == (1, 1)
        assert added.errors == ["用户 4242 不存在"]

        updated = service.add_members(cls.id, [user.id], "teacher")
        assert (updated.added, updated.updated) == (0, 1)

        removed = service.remove_members(cls.id, [user.id])
        assert removed.removed == 1

    def test_unknown_class_raises_not_found(self, db):
        service = ClassMembershipService(db)
        with pytest.raises(NotFoundError):
            service.list_members(991)
        with pytest.raises(NotFoundError):
            service.add_members(991, [1], "student")

    def test_member_role_is_per_class_not_per_account(self, db):
        """同一个账号可以在 A 班是学生、在 B 班是教师 —— 角色是成员属性。"""
        c1 = _class(db, "1班")
        c2 = _class(db, "2班")
        user = _user(db, "dual")
        upsert_members(db, c1.id, [user.id], member_role="student")
        upsert_members(db, c2.id, [user.id], member_role="teacher")
        db.commit()

        assert student_member_ids(db, c1.id) == [user.id]
        assert student_member_ids(db, c2.id) == []


class TestImportClassResolution:
    """CSV/批量导入的班级名解析：歧义班名报错，不静默挑一个。

    缺陷背景：老实现 ``query(Class).filter(Class.name == cn).first()`` —— 同名班级跨
    cohort 时随机命中，且找不到时会偷偷建一个挂在「默认」年级下。
    """

    def _row(self, db: Session, username: str, **extra) -> dict:
        _role(db, "student")
        db.commit()
        return {
            "username": username,
            "password": "secret123",
            "display_name": username,
            "role": "student",
            **extra,
        }

    def test_ambiguous_class_name_is_reported(self, db):
        _class(db, "1班", "2026级")
        _class(db, "1班", "2027级")

        result = UserService(db).batch_create([self._row(db, "u1", class_name="1班")])

        assert result.created == 0
        assert result.skipped == 1
        assert "多个 cohort" in result.errors[0]
        assert db.query(ClassMembership).count() == 0

    def test_cohort_label_disambiguates(self, db):
        older = _class(db, "1班", "2026级")
        newer = _class(db, "1班", "2027级")

        result = UserService(db).batch_create([self._row(db, "u2", class_name="1班", cohort_label="2027级")])

        assert (result.created, result.skipped) == (1, 0)
        membership = db.query(ClassMembership).one()
        assert membership.class_id == newer.id != older.id
        assert membership.member_role == "student"

    def test_missing_class_is_created_with_cohort(self, db):
        result = UserService(db).batch_create([self._row(db, "u3", class_name="新班", cohort_label="2028级")])

        assert result.created == 1
        created = db.query(Class).filter(Class.name == "新班").one()
        assert created.cohort_label == "2028级"
        assert db.query(ClassMembership).one().class_id == created.id

    def test_class_id_still_wins_over_name(self, db):
        cls = _class(db, "1班", "2026级")

        result = UserService(db).batch_create([self._row(db, "u4", class_id=cls.id, class_name="不存在")])

        assert result.created == 1
        assert db.query(ClassMembership).one().class_id == cls.id
