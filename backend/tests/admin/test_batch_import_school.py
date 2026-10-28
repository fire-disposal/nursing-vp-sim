"""批量导入的「学校」列：平台角色没有班级时靠它定院校归属。

规则（与单条建号同一套归属口径）：
- 行内「学校」= 「院校管理」里的名称；不存在 / 属于别的院校 → 该行丢弃并给出原因；
- 学校与班级同时给出且不一致 → 该行丢弃（院校归属不能有两个答案）；
- 给学校 + 本校没有的班级 → 在该学校下新建班级（同名班在别的院校存在不构成拒绝理由）；
- 学校、班级都没有 → 丢弃，绝不造出「无院校的学生账号」。

每个被丢弃的行都要能从回执里核对到：``skipped_rows`` 给 (批次行序, 用户名, 原因)，
审计 payload 另按原因聚合 —— 前者给管理员改数据，后者给运维定性。
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

    assert (result.created, result.skipped, result.skipped_rows) == (1, 0, [])
    user = db.query(User).filter(User.username == "stu-school-only").one()
    assert user.school_id == school.id


def test_school_and_missing_class_creates_class_in_that_school(db):
    school = _school(db, "乙学院")
    service = UserService(db, platform_scope())

    result = service.batch_create(
        [_row("stu-new-class", school_name="乙学院", class_name="护理9班", cohort_label="2026级")]
    )

    assert (result.created, result.skipped) == (1, 0), result.skipped_rows
    cls = db.query(Class).filter(Class.name == "护理9班", Class.cohort_label == "2026级").one()
    assert cls.school_id == school.id


def test_unknown_school_skips_row_with_reason(db):
    service = UserService(db, platform_scope())

    result = service.batch_create([_row("stu-bad-school", school_name="不存在的院校")])

    assert result.created == 0
    [skipped] = result.skipped_rows
    assert (skipped.index, skipped.username) == (1, "stu-bad-school")
    assert "学校「不存在的院校」不存在" in skipped.reason
    assert db.query(User).filter(User.username == "stu-bad-school").first() is None


def test_same_name_class_in_another_school_does_not_block_creation(db):
    """2026-10-28 生产事故：护理241 只存在于别的院校，本校整批 16 行被丢弃。

    班级名是院校内的概念 —— 行内已写明「学校」时就在该校新建，不去别校找同名的来挡。
    """
    other = _school(db, "甲大学")
    own = _school(db, "乙学院")
    db.add(Class(name="护理241", cohort_label="2024级", school_id=other.id, created_at=NOW))
    db.flush()
    service = UserService(db, platform_scope())

    result = service.batch_create(
        [_row("stu-collide", school_name="乙学院", class_name="护理241", cohort_label="2024级")]
    )

    assert (result.created, result.skipped) == (1, 0), result.skipped_rows
    created = (
        db.query(Class).filter(Class.name == "护理241", Class.cohort_label == "2024级", Class.school_id == own.id).one()
    )
    assert db.query(User).filter(User.username == "stu-collide").one().school_id == own.id
    assert db.query(ClassMembership).filter(ClassMembership.class_id == created.id).count() == 1


def test_neither_school_nor_class_skips_row(db):
    service = UserService(db, platform_scope())

    result = service.batch_create([_row("stu-orphan")])

    assert result.created == 0
    [skipped] = result.skipped_rows
    assert "请填写「学校」列" in skipped.reason
    assert db.query(User).filter(User.username == "stu-orphan").first() is None


def test_incident_shape_all_forty_four_rows_land(db):
    """2026-10-28 现场形状：45 行里前 16 行走 护理241、其余走 护理242，同属杭州师范大学。

    修复前 `created=28 / skipped=16`（"只进去了下半部分"）；修复后整批入库。
    """
    hangzhou = _school(db, "杭州师范大学")
    other = _school(db, "杭州职业技术大学")
    db.add(Class(name="护理241", cohort_label="2024级", school_id=other.id, created_at=NOW))
    db.flush()

    rows = [
        _row(f"inc-{i:02d}", school_name="杭州师范大学", class_name="护理241", cohort_label="2024级")
        for i in range(1, 17)
    ] + [
        _row(f"inc-{i:02d}", school_name="杭州师范大学", class_name="护理242", cohort_label="2024级")
        for i in range(17, 45)
    ]

    result = UserService(db, platform_scope()).batch_create(rows)

    assert result.created == 44, f"只进去了 {result.created} 行"  # 修复前：28
    assert result.skipped == 0, [(r.index, r.reason) for r in result.skipped_rows]
    own_classes = {c.name for c in db.query(Class).filter(Class.school_id == hangzhou.id).all()}
    assert own_classes == {"护理241", "护理242"}


def test_mixed_batch_reports_every_skipped_row_with_its_index(db):
    """一半合法一半非法：合法行照常入库，非法行逐条回执（索引 = 提交批次行序）。"""
    school = _school(db, "丙学院")
    db.add(
        User(
            username="dup-user",
            password_hash="x",
            display_name="dup",
            role_id=_student_role(db).id,
            school_id=school.id,
            created_at=NOW,
        )
    )
    db.flush()
    service = UserService(db, platform_scope())

    result = service.batch_create(
        [
            _row("mix-1", school_name="丙学院"),
            _row("dup-user", school_name="丙学院"),  # 2: 用户名已存在
            _row("mix-3", school_name="丙学院", password="123"),  # 3: 密码太短
            _row("mix-4", school_name="丙学院"),
            _row("mix-5", school_name="没这所学校"),  # 5: 学校不存在
            _row("mix-6", school_name="丙学院"),
        ]
    )

    assert (result.created, result.skipped) == (3, 3)
    assert [(r.index, r.username) for r in result.skipped_rows] == [(2, "dup-user"), (3, "mix-3"), (5, "mix-5")]
    assert [r.reason for r in result.skipped_rows] == [
        "用户名已存在",
        "密码长度不能少于6位",
        "学校「没这所学校」不存在（名称需与「院校管理」里的一致）",
    ]
    created = {u.username for u in db.query(User).filter(User.username.like("mix-%")).all()}
    assert created == {"mix-1", "mix-4", "mix-6"}


def test_audit_records_skip_reasons(db):
    """只有 created/skipped 时无法定性「个别脏数据」还是「整批被同一规则拒掉」。"""
    from models import AuditLog

    _school(db, "丁学院")
    service = UserService(db, platform_scope())

    service.batch_create([_row("audit-1", school_name="丁学院"), _row("audit-2", school_name="没这所学校")])

    entry = db.query(AuditLog).filter(AuditLog.action == "user.bulk_imported").order_by(AuditLog.id.desc()).first()
    assert entry is not None
    assert entry.payload["created"] == 1
    assert entry.payload["skipped"] == 1
    assert entry.payload["requested"] == 2
    assert entry.payload["skip_reasons"] == {"学校「没这所学校」不存在（名称需与「院校管理」里的一致）": 1}


def _student_role(db: Session) -> Role:
    return db.query(Role).filter(Role.name == "student").one()


def test_batch_endpoint_serializes_skipped_rows(db):
    """HTTP 边界上锁形状：前端按 `skipped_rows[i].index` 把原因映射回 CSV 行号。"""
    from fastapi.testclient import TestClient

    from core.database import get_db
    from core.security import get_current_user
    from main import app

    _school(db, "戊学院")

    class _Admin:
        # 假用户不落库，actor_id 必须为空（audit_logs.actor_id 有 FK）
        id = None
        school_id = None
        username = "api-admin"
        display_name = "API 管理员"
        role = type("_Role", (), {"name": "super_admin"})()

        def has_permission(self, *_args: object) -> bool:
            return True

    def _db():
        yield db

    before = dict(app.dependency_overrides)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_current_user] = _Admin
    try:
        resp = TestClient(app).post(
            "/api/admin/users/batch",
            json=[
                {
                    "username": "api-ok",
                    "password": "secret123",
                    "display_name": "api-ok",
                    "school_name": "戊学院",
                },
                {
                    "username": "api-dup",
                    "password": "123",
                    "display_name": "api-dup",
                    "school_name": "戊学院",
                },
            ],
        )
    finally:
        app.dependency_overrides = before

    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "created": 1,
        "skipped": 1,
        "skipped_rows": [{"index": 2, "username": "api-dup", "reason": "密码长度不能少于6位"}],
    }
