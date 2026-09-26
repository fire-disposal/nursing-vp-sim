"""病例生命周期的审计判据（真实 PG）：归档 / 开放开关 / 删除。

病例是教学内容的源头：发布、归档、面向学生开放、删除都会改变"学生能练什么"，
因此都属于必审事件（2026-09-26 审计 §3.3）。这里覆盖最直接的三条（发布路径的
门禁拒绝另见 A4 的独立 session 判据模式）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.audit import (
    ACTION_CASE_ARCHIVED,
    ACTION_CASE_DELETED,
    ACTION_CASE_OPEN_CHANGED,
    TARGET_TYPE_CASE,
)
from core.database import Base
from core.database import engine as pg_engine
from models import AuditLog, Case, CaseRevision, Role, TrainingRecord, User
from modules.cases.service import CaseService

_TABLES = [
    Role.__table__,
    User.__table__,
    Case.__table__,
    CaseRevision.__table__,
    TrainingRecord.__table__,
    AuditLog.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


@pytest.fixture
def admin(db) -> User:
    role = db.query(Role).filter(Role.name == "admin").first() or Role(
        name="admin", display_name="管理员", is_system=True
    )
    db.add(role)
    db.flush()
    user = User(
        username="case-audit-admin",
        password_hash="x",
        role_id=role.id,
        display_name="病例审计员",
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _request(actor: User, rid: str = "req-case"):
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=actor),
        headers={"user-agent": "pytest"},
        method="POST",
        url=SimpleNamespace(path="/api/cases"),
    )


def _case(db, name: str, status: str = "published") -> Case:
    case = Case(name=name, status=status, is_open=False, case_data={})
    db.add(case)
    db.flush()
    return case


def test_archive_records_status_transition(db, admin):
    case = _case(db, "归档用例")
    CaseService(db).archive(case.id, admin.id, "admin", request=_request(admin))

    row = db.query(AuditLog).filter(AuditLog.action == ACTION_CASE_ARCHIVED).one()
    assert row.target_type == TARGET_TYPE_CASE
    assert row.target_id == str(case.id)
    assert row.target_label == "归档用例"
    assert row.payload["status"] == {"before": "published", "after": "archived"}
    assert row.actor_id == admin.id


def test_open_toggle_records_before_and_after(db, admin):
    case = _case(db, "开放用例")
    service = CaseService(db)
    service.set_open(case.id, is_open=True, request=_request(admin, "req-open-1"))
    service.set_open(case.id, is_open=False, request=_request(admin, "req-open-2"))

    rows = db.query(AuditLog).filter(AuditLog.action == ACTION_CASE_OPEN_CHANGED).order_by(AuditLog.id).all()
    assert [r.payload["is_open"] for r in rows] == [
        {"before": False, "after": True},
        {"before": True, "after": False},
    ]
    assert [r.request_id for r in rows] == ["req-open-1", "req-open-2"]


def test_delete_records_case_identity(db, admin):
    case = _case(db, "待删用例", status="draft")
    CaseService(db).delete(case.id, admin.id, "admin", request=_request(admin))

    row = db.query(AuditLog).filter(AuditLog.action == ACTION_CASE_DELETED).one()
    assert row.target_label == "待删用例"
    assert row.payload == {"status": "draft"}


def test_open_requires_published_and_leaves_no_audit_on_refusal(db, admin):
    """未发布不能开放（既有约束）→ 拒绝时不产生 open_changed 行（没发生的变更不留痕）。"""
    from core.exceptions import ConflictError

    case = _case(db, "草稿用例", status="draft")
    with pytest.raises(ConflictError):
        CaseService(db).set_open(case.id, is_open=True, request=_request(admin))

    assert db.query(AuditLog).filter(AuditLog.action == ACTION_CASE_OPEN_CHANGED).count() == 0
