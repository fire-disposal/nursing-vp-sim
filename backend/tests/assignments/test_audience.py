"""作业受众回归：发布即固化 + 分母/门控/通知同源于 ``assignment_recipients``。

口径：
- ``class`` 模式 = 发布时该班 **student membership** 快照（教师成员不入名单）；
- ``selected`` 模式 = 显式名单，且每个都必须仍是该班学生成员；
- 发布之后班级成员变动**不**改动已发布作业的受众与分母；
- 已有训练记录后受众被锁定。
"""

from datetime import UTC, datetime

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

from core.exceptions import NotFoundError, ValidationError
from models import (
    Assignment,
    AssignmentRecipient,
    Case,
    CaseRevision,
    Class,
    ClassMembership,
    Notification,
    Role,
    Score,
    TrainingRecord,
    User,
)
from models.school import legacy_grades_table
from modules.admin.class_memberships import upsert_members
from modules.assignments.router import StudentService
from modules.assignments.service import AssignmentService

_SOURCE_TABLES = [
    legacy_grades_table,
    Role.__table__,
    User.__table__,
    Class.__table__,
    ClassMembership.__table__,
    Case.__table__,
    CaseRevision.__table__,
    Assignment.__table__,
    AssignmentRecipient.__table__,
    TrainingRecord.__table__,
    Score.__table__,
    Notification.__table__,
]

START = datetime(2020, 1, 1, tzinfo=UTC)
END = datetime(2030, 1, 1, tzinfo=UTC)


def _sqlite_metadata():
    """SQLite 渲染不了 JSONB —— 复制一份 metadata 把 JSONB 降级为 JSON。

    表名/列名不变，因此仍走真实 ORM 映射（SQL 只依赖表名与列名）。
    ``'{}'::jsonb`` 这类 server_default 里的 PG 强制转换也要一并去掉。
    """
    meta = sa.MetaData()
    for table in _SOURCE_TABLES:
        table.to_metadata(meta)
    for table in meta.tables.values():
        for column in table.columns:
            if not isinstance(column.type, JSONB):
                continue
            column.type = sa.JSON()
            if column.server_default is not None and "::jsonb" in str(column.server_default.arg):
                column.server_default.arg = sa.text(str(column.server_default.arg).replace("::jsonb", ""))
    return meta


@pytest.fixture
def db():
    engine = sa.create_engine("sqlite://")
    _sqlite_metadata().create_all(engine)
    with Session(engine) as session:
        yield session


def _user(db: Session, username: str, role: str = "student") -> User:
    role_obj = db.query(Role).filter(Role.name == role).first()
    if role_obj is None:
        role_obj = Role(name=role, display_name=role, is_system=True)
        db.add(role_obj)
        db.flush()
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


@pytest.fixture
def school(db):
    """一个班（2 名学生 + 1 名教师成员）、一个班外学生、一个教师账号、一个病例。"""
    cls = Class(name="1班", cohort_label="2026级")
    other = Class(name="2班", cohort_label="2027级")
    case = Case(
        name="病例A", case_data={}, status="published", created_at=datetime.now(UTC), updated_at=datetime.now(UTC)
    )
    db.add_all([cls, other, case])
    db.commit()
    # 已发布病例必有当前版本：作业发布时钉住它（docs/15 §六）
    revision = CaseRevision(
        case_id=case.id, revision_no=1, content={}, created_at=datetime.now(UTC), published_at=datetime.now(UTC)
    )
    db.add(revision)
    db.commit()
    case.current_revision_id = revision.id
    db.commit()

    teacher = _user(db, "t1", "teacher")
    s1 = _user(db, "s1")
    s2 = _user(db, "s2")
    outsider = _user(db, "s3")
    upsert_members(db, cls.id, [s1.id, s2.id, teacher.id], member_role="student")
    upsert_members(db, cls.id, [teacher.id], member_role="teacher")
    db.commit()
    return {
        "class": cls,
        "other_class": other,
        "case": case,
        "teacher": teacher,
        "s1": s1,
        "s2": s2,
        "outsider": outsider,
    }


def _create(service: AssignmentService, school, *, mode: str, user_ids=None, title="作业"):
    return service.create(
        case_id=school["case"].id,
        class_id=school["class"].id,
        title=title,
        description=None,
        features={},
        behavior={},
        audience_mode=mode,
        recipient_user_ids=user_ids,
        start_time=START,
        end_time=END,
        teacher_id=school["teacher"].id,
    )


class TestRecipientResolution:
    def test_class_mode_snapshots_student_members_only(self, db, school):
        view = _create(AssignmentService(db), school, mode="class")

        assert view.audience_mode == "class"
        assert view.recipient_ids == sorted([school["s1"].id, school["s2"].id])
        assert view.student_count == 2
        # 教师成员不进学生名单
        assert school["teacher"].id not in view.recipient_ids
        rows = db.query(AssignmentRecipient).filter(AssignmentRecipient.assignment_id == view.id).all()
        assert len(rows) == 2

    def test_selected_mode_requires_class_student_members(self, db, school):
        service = AssignmentService(db)

        with pytest.raises(ValidationError) as exc:
            _create(service, school, mode="selected", user_ids=[school["outsider"].id])
        assert "不是该班级的学生成员" in str(exc.value)

        with pytest.raises(ValidationError):
            _create(service, school, mode="selected", user_ids=[])

        view = _create(service, school, mode="selected", user_ids=[school["s2"].id])
        assert view.recipient_ids == [school["s2"].id]
        assert view.student_count == 1

    def test_selected_mode_dedupes_ids(self, db, school):
        view = _create(AssignmentService(db), school, mode="selected", user_ids=[school["s1"].id, school["s1"].id])

        assert view.recipient_ids == [school["s1"].id]

    def test_unknown_class_rejected(self, db, school):
        with pytest.raises(NotFoundError):
            AssignmentService(db).create(
                case_id=school["case"].id,
                class_id=9999,
                title="x",
                description=None,
                features={},
                behavior={},
                audience_mode="class",
                recipient_user_ids=None,
                start_time=START,
                end_time=END,
                teacher_id=school["teacher"].id,
            )


class TestFrozenAudience:
    def test_membership_change_does_not_move_published_audience(self, db, school):
        service = AssignmentService(db)
        view = _create(service, school, mode="class")

        # 新同学之后才加入 / 原同学被移出，都不改动已发布作业的受众与分母
        upsert_members(db, school["class"].id, [school["outsider"].id], member_role="student")
        db.commit()
        after_add = service.get(view.id, school["teacher"].id)
        assert after_add.recipient_ids == view.recipient_ids
        assert after_add.student_count == 2

        student_ids = [m.user_id for m in db.query(ClassMembership).all()]
        assert school["outsider"].id in student_ids  # 班级确实变了

        db.query(ClassMembership).filter(ClassMembership.user_id == school["s1"].id).delete()
        db.commit()
        after_remove = service.get(view.id, school["teacher"].id)
        assert after_remove.recipient_ids == view.recipient_ids
        assert after_remove.student_count == 2

    def test_audience_locked_once_records_exist(self, db, school):
        service = AssignmentService(db)
        view = _create(service, school, mode="class")
        db.add(
            TrainingRecord(
                user_id=school["s1"].id,
                case_id=school["case"].id,
                status="in_progress",
                time_limit=30,
                start_time=datetime(2026, 1, 1, tzinfo=UTC),
                assignment_id=view.id,
            )
        )
        db.commit()

        with pytest.raises(ValidationError) as exc:
            service.update(
                assignment_id=view.id,
                teacher_id=school["teacher"].id,
                case_id=None,
                class_id=None,
                title=None,
                description=None,
                features=None,
                behavior=None,
                audience_mode="selected",
                recipient_user_ids=[school["s2"].id],
                start_time=None,
                end_time=None,
            )
        assert "不能更换病例、班级或受众" in str(exc.value)

    def test_update_can_resnapshot_audience_before_records(self, db, school):
        service = AssignmentService(db)
        view = _create(service, school, mode="class")

        updated = service.update(
            assignment_id=view.id,
            teacher_id=school["teacher"].id,
            case_id=None,
            class_id=None,
            title=None,
            description=None,
            features=None,
            behavior=None,
            audience_mode="selected",
            recipient_user_ids=[school["s1"].id],
            start_time=None,
            end_time=None,
        )

        assert updated.audience_mode == "selected"
        assert updated.recipient_ids == [school["s1"].id]
        assert updated.student_count == 1


class TestStudentVisibility:
    def test_student_sees_only_own_recipient_assignments(self, db, school):
        service = AssignmentService(db)
        class_view = _create(service, school, mode="class")
        selected_view = _create(service, school, mode="selected", user_ids=[school["s2"].id], title="只给 s2")

        s1_items = {i.id for i in StudentService(db).list_assignments(school["s1"].id)}
        s2_items = {i.id for i in StudentService(db).list_assignments(school["s2"].id)}

        assert class_view.id in s1_items
        assert selected_view.id not in s1_items
        assert selected_view.id in s2_items

    def test_removed_member_loses_visibility_but_stays_in_denominator(self, db, school):
        service = AssignmentService(db)
        view = _create(service, school, mode="class")
        db.query(ClassMembership).filter(ClassMembership.user_id == school["s1"].id).delete()
        db.commit()

        assert view.id not in {i.id for i in StudentService(db).list_assignments(school["s1"].id)}
        assert service.get(view.id, school["teacher"].id).student_count == 2

    def test_student_without_membership_sees_nothing(self, db, school):
        service = AssignmentService(db)
        _create(service, school, mode="class")

        assert StudentService(db).list_assignments(school["outsider"].id) == []
