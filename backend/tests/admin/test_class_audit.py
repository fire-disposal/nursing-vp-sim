"""班级与班级成员的审计判据（真实 PG）：建 / 改 / 删班 + 成员增删。

班级是「谁能练什么」的组织单位 —— 建班、改名/改届、删班、成员进出都会改变受众口径，
属必审事件（2026-09-26 审计 §3.3）。这里断言**库里的行内容**（action / target / payload）
以及 payload 计数与业务表实况（``class_memberships`` / ``classes`` 行数）的一致性。
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.audit import (
    ACTION_CLASS_CREATED,
    ACTION_CLASS_DELETED,
    ACTION_CLASS_MEMBERS_ADDED,
    ACTION_CLASS_MEMBERS_REMOVED,
    ACTION_CLASS_UPDATED,
    TARGET_TYPE_CLASS,
)
from core.database import Base
from core.database import engine as pg_engine
from models import AuditLog, Class, ClassMembership, Role, User
from models.audit import AUDIT_OUTCOME_SUCCESS
from models.school import legacy_grades_table
from modules.admin.class_memberships import ClassMembershipService
from modules.admin.classes import ClassService

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
    return pg_session


def _role(db) -> Role:
    role = db.query(Role).filter(Role.name == "admin").first()
    if role is None:
        role = Role(name="admin", display_name="管理员", is_system=True)
        db.add(role)
        db.flush()
    return role


def _user(db, username: str) -> User:
    role = _role(db)
    user = User(
        username=username,
        password_hash="x",
        role_id=role.id,
        display_name=username,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _request(actor: User, rid: str = "req-class"):
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=actor),
        headers={"user-agent": "pytest"},
        method="POST",
        url=SimpleNamespace(path="/api/admin/classes"),
    )


def _audits(db, action: str) -> list[AuditLog]:
    return db.query(AuditLog).filter(AuditLog.action == action).order_by(AuditLog.id).all()


def _member_count(db, class_id: int) -> int:
    return db.query(ClassMembership).filter(ClassMembership.class_id == class_id).count()


def test_create_class_writes_one_row_matching_db(db):
    admin = _user(db, "cls-admin-create")
    view = ClassService(db).create("临床1班", "2026级", request=_request(admin, "req-create"))

    rows = _audits(db, ACTION_CLASS_CREATED)
    assert len(rows) == 1
    row = rows[0]
    assert row.target_type == TARGET_TYPE_CLASS
    assert row.target_id == str(view.id)
    assert row.target_label == "临床1班"
    assert row.outcome == AUDIT_OUTCOME_SUCCESS
    assert row.payload == {"name": "临床1班", "cohort_label": "2026级"}
    assert (row.actor_id, row.request_id) == (admin.id, "req-create")
    assert db.get(Class, view.id) is not None


def test_update_class_records_before_after_and_skips_noop(db):
    admin = _user(db, "cls-admin-update")
    service = ClassService(db)
    view = service.create("临床2班", "2026级", request=_request(admin, "req-c"))
    cls = db.get(Class, view.id)

    service.update(view.id, name="临床2班(改)", cohort_label="2027级", request=_request(admin, "req-u"))
    rows = _audits(db, ACTION_CLASS_UPDATED)
    assert len(rows) == 1
    assert rows[0].target_type == TARGET_TYPE_CLASS
    assert rows[0].target_id == str(view.id)
    assert rows[0].target_label == "临床2班(改)"
    assert rows[0].payload == {
        "name": {"before": "临床2班", "after": "临床2班(改)"},
        "cohort_label": {"before": "2026级", "after": "2027级"},
    }
    # payload 的 after 必须与库内实况一致
    db.refresh(cls)
    assert (cls.name, cls.cohort_label) == ("临床2班(改)", "2027级")

    # 反例：等值 PUT（含全 None）不改任何东西 → 不落行
    service.update(view.id, name="临床2班(改)", cohort_label="2027级", request=_request(admin, "req-u-noop"))
    service.update(view.id, request=_request(admin, "req-u-none"))
    assert len(_audits(db, ACTION_CLASS_UPDATED)) == 1


def test_delete_class_records_identity_and_removed_members(db):
    admin = _user(db, "cls-admin-delete")
    view = ClassService(db).create("待删班", "2026级", request=_request(admin, "req-c"))
    students = [_user(db, f"cls-del-stu-{i}") for i in range(3)]
    ClassMembershipService(db).add_members(
        view.id, [s.id for s in students], "student", request=_request(admin, "req-a")
    )
    assert _member_count(db, view.id) == 3

    ClassService(db).delete(view.id, request=_request(admin, "req-d"))

    rows = _audits(db, ACTION_CLASS_DELETED)
    assert len(rows) == 1
    assert rows[0].target_id == str(view.id)
    assert rows[0].target_label == "待删班"
    assert rows[0].payload == {"name": "待删班", "cohort_label": "2026级", "removed_members": 3}
    # 库内实况：班没了、成员行也没了（payload 的 removed_members 与真实清零一致）
    assert db.get(Class, view.id) is None
    assert _member_count(db, view.id) == 0


def test_add_members_counts_match_membership_table(db):
    admin = _user(db, "cls-admin-add")
    view = ClassService(db).create("成员班", "2026级", request=_request(admin, "req-c"))
    service = ClassMembershipService(db)
    s1, s2 = _user(db, "cls-mem-1"), _user(db, "cls-mem-2")

    before = _member_count(db, view.id)
    result = service.add_members(view.id, [s1.id, s2.id, 4242], "student", request=_request(admin, "req-a1"))
    after = _member_count(db, view.id)
    assert (result.added, result.skipped) == (2, 1)
    assert after - before == 2

    # 已存在成员改角色 → 只计 updated，不新增行
    result2 = service.add_members(view.id, [s1.id], "teacher", request=_request(admin, "req-a2"))
    after2 = _member_count(db, view.id)
    assert (result2.added, result2.updated, after2 - after) == (0, 1, 0)

    rows = _audits(db, ACTION_CLASS_MEMBERS_ADDED)
    assert len(rows) == 2
    first = rows[0]
    assert first.target_type == TARGET_TYPE_CLASS
    assert first.target_id == str(view.id)
    assert first.target_label == "成员班"
    assert first.payload == {
        "member_role": "student",
        "requested_count": 3,
        "added": 2,
        "updated": 0,
        "skipped": 1,
        "user_ids_sample": [s1.id, s2.id, 4242],
    }
    second = rows[1]
    assert second.payload["member_role"] == "teacher"
    assert (second.payload["requested_count"], second.payload["added"], second.payload["updated"]) == (1, 0, 1)
    assert second.payload["skipped"] == 0
    assert second.payload["user_ids_sample"] == [s1.id]
    # payload 计数与库内实况：角色确实被改写
    assert (
        db.query(ClassMembership.member_role)
        .filter(ClassMembership.class_id == view.id, ClassMembership.user_id == s1.id)
        .scalar()
        == "teacher"
    )


def test_remove_members_counts_match_membership_table(db):
    admin = _user(db, "cls-admin-remove")
    view = ClassService(db).create("移出班", "2026级", request=_request(admin, "req-c"))
    service = ClassMembershipService(db)
    users = [_user(db, f"cls-rm-{i}") for i in range(3)]
    service.add_members(view.id, [u.id for u in users], "student", request=_request(admin, "req-a"))

    before = _member_count(db, view.id)
    result = service.remove_members(view.id, [users[0].id, users[1].id, 9999], request=_request(admin, "req-r"))
    after = _member_count(db, view.id)
    assert (result.removed, result.skipped) == (2, 1)
    assert before - after == 2

    rows = _audits(db, ACTION_CLASS_MEMBERS_REMOVED)
    assert len(rows) == 1
    assert rows[0].target_type == TARGET_TYPE_CLASS
    assert rows[0].target_id == str(view.id)
    assert rows[0].target_label == "移出班"
    assert rows[0].payload == {
        "requested_count": 3,
        "removed": 2,
        "skipped": 1,
        "user_ids_sample": [users[0].id, users[1].id, 9999],
    }
    assert {uid for (uid,) in db.query(ClassMembership.user_id).filter(ClassMembership.class_id == view.id)} == {
        users[2].id
    }


def test_removing_non_member_leaves_no_row(db):
    """空操作不留痕：单删路由的 removed=0 会抛 NotFoundError（审计已随 service 的 commit 落库，
    故排除空操作必须在 service 内完成），批量移出同一路径亦然。"""
    admin = _user(db, "cls-admin-noop")
    view = ClassService(db).create("空操作班", "2026级", request=_request(admin, "req-c"))
    outsider = _user(db, "cls-outsider")

    result = ClassMembershipService(db).remove_members(view.id, [outsider.id], request=_request(admin, "req-r"))

    assert result.removed == 0
    assert _audits(db, ACTION_CLASS_MEMBERS_REMOVED) == []
