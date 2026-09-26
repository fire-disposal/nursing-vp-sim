"""反馈回复的判据（真实 PG）：回复人落业务表 + 一行审计。

维护者决策（2026-09-26）：新增 `feedbacks.replied_by`，让"谁回复的"既在业务表可查、
也在审计里留痕（2026-09-26 审计 A5）。
"""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from core.audit import ACTION_FEEDBACK_REPLIED
from core.database import Base
from core.database import engine as pg_engine
from models import AuditLog, Feedback, FeedbackImage, Notification, Role, User
from modules.feedback.service import FeedbackService

_TABLES = [
    Role.__table__,
    User.__table__,
    Feedback.__table__,
    FeedbackImage.__table__,
    Notification.__table__,
    AuditLog.__table__,
]


@pytest.fixture(scope="module", autouse=True)
def _schema():
    # 测试库里的 feedbacks 可能建自旧模型（缺 replied_by）——create_all 不会改既有表，
    # 故先重建它，保证与被测模型一致（测试库为一次性库，重建无副作用）。
    FeedbackImage.__table__.drop(pg_engine, checkfirst=True)  # 先删引用方，避免 FK 阻塞
    Feedback.__table__.drop(pg_engine, checkfirst=True)
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    return pg_session


def _user(db, name: str) -> User:
    role = db.query(Role).filter(Role.name == "student").first() or Role(
        name="student", display_name="学生", is_system=True
    )
    db.add(role)
    db.flush()
    user = User(
        username=name,
        password_hash="x",
        role_id=role.id,
        display_name=name,
        created_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
    )
    db.add(user)
    db.flush()
    return user


def _request(actor: User, rid: str = "req-reply"):
    return SimpleNamespace(
        state=SimpleNamespace(request_id=rid, audit_actor=actor),
        headers={"user-agent": "pytest"},
        method="PUT",
        url=SimpleNamespace(path="/api/admin/feedback/1/reply"),
    )


def test_reply_sets_replied_by_and_writes_one_audit_row(db):
    author = _user(db, "fb-author-1")
    admin = _user(db, "fb-admin-1")
    fb = Feedback(user_id=author.id, rating=4, tag="bug", content="崩溃了", version="1.0")
    db.add(fb)
    db.flush()

    FeedbackService(db).reply(fb.id, "已修复，感谢反馈", "管理员", replier_id=admin.id, request=_request(admin))

    row = db.query(Feedback).filter(Feedback.id == fb.id).one()
    assert row.replied_by == admin.id
    assert row.developer_reply == "已修复，感谢反馈"

    audits = db.query(AuditLog).filter(AuditLog.action == ACTION_FEEDBACK_REPLIED).all()
    assert len(audits) == 1
    assert audits[0].target_id == str(fb.id)
    assert audits[0].payload["replied_by"] == admin.id
    assert audits[0].payload["overwrite"] is False
    assert audits[0].payload["reply_length"] == len("已修复，感谢反馈")
    # PII 最小化：回复正文不入审计
    assert "已修复" not in str(audits[0].payload)


def test_overwrite_updates_replier_and_marks_overwrite(db):
    author = _user(db, "fb-author-2")
    first_admin = _user(db, "fb-admin-2a")
    second_admin = _user(db, "fb-admin-2b")
    fb = Feedback(user_id=author.id, rating=3, tag="other", content="x", version="1.0")
    db.add(fb)
    db.flush()

    service = FeedbackService(db)
    service.reply(fb.id, "第一次回复", "A", replier_id=first_admin.id, request=_request(first_admin, "r1"))
    service.reply(
        fb.id, "更正后的回复", "B", overwrite=True, replier_id=second_admin.id, request=_request(second_admin, "r2")
    )

    row = db.query(Feedback).filter(Feedback.id == fb.id).one()
    assert row.replied_by == second_admin.id  # 覆盖后记最新回复人
    audits = db.query(AuditLog).filter(AuditLog.action == ACTION_FEEDBACK_REPLIED).order_by(AuditLog.id).all()
    assert [a.payload["overwrite"] for a in audits] == [False, True]
    assert [a.request_id for a in audits] == ["r1", "r2"]
