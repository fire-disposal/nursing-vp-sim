"""`/admin/ops/dashboard` 的 `feedback` 块（未回复反馈计数）。

面板取代宿主日报后，「未回复用户反馈 N 条」由 dashboard 直接提供。两条约束：

1. 块自带 `scope` / `window`（与其它块同规则，口径词表见 docs/ops/diagnostics.md）；
2. 反馈统计失败只能降级为 0/None，不能让整个 dashboard 500 —— 运维面板的首要
   职责是显示 LLM/评分/错误，反馈计数只是附带信息。

真库判据（**PostgreSQL**，`nursing_test`）：`feedbacks.user_id`/`replied_by` 是真外键，
因此夹具在 savepoint 内种一条作者行，并清空反馈表（断言"未回复 0 条"需要确定性空起点）。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from core.database import Base
from core.database import engine as pg_engine
from models import Feedback, Role, User
from modules.admin.ops import _feedback_block
from modules.feedback.service import FeedbackService

_TABLES = [Role.__table__, User.__table__, Feedback.__table__]

_AUTHOR = "ops-feedback-author"


@pytest.fixture(scope="module", autouse=True)
def _schema():
    """本仓面向 PostgreSQL：真库建表（幂等），不用 SQLite 替身。"""
    Base.metadata.create_all(pg_engine, tables=_TABLES)


@pytest.fixture
def db(pg_session):
    """savepoint 隔离 → 用例内部的 commit 只释放 savepoint，对库零残留。"""
    role = pg_session.query(Role).filter(Role.name == "student").first() or Role(
        name="student", display_name="学生", is_system=True
    )
    pg_session.add(role)
    pg_session.flush()
    pg_session.query(Feedback).delete()  # 断言"未回复 0 条"需要确定性的空表
    pg_session.add(User(username=_AUTHOR, password_hash="x", role_id=role.id, display_name="反馈作者"))
    pg_session.flush()
    return pg_session


def _author_id(db: Session) -> int:
    return db.query(User.id).filter(User.username == _AUTHOR).one()[0]


def _add(db: Session, fb_id: int, created_at: datetime, *, reply: str | None = None) -> None:
    # ``feedbacks.created_at`` 自 2026-09-26 起是 timestamptz（迁移 f4e5f6a7b8c9）：
    # 直接写 aware-UTC，往返不偏移（见 docs/ops/timezone-alignment.md）。
    db.add(
        Feedback(
            id=fb_id,
            user_id=_author_id(db),
            rating=3,
            tag="bug",
            content="正文",
            developer_reply=reply,
            created_at=created_at,
        )
    )
    db.commit()


def test_block_declares_scope_and_window(db):
    block = _feedback_block(db)

    assert block["scope"] == "db"
    assert block["window"] == "now"
    assert block["unanswered"] == 0
    assert block["oldest_created_at"] is None
    assert block["oldest_age_days"] is None


def test_block_reports_unreplied_count(db):
    now = datetime.now(UTC)
    _add(db, 1, now - timedelta(days=4))
    _add(db, 2, now - timedelta(hours=1), reply="已回复")

    block = _feedback_block(db)

    assert block["unanswered"] == 1
    assert block["oldest_created_at"] is not None
    assert block["oldest_age_days"] == pytest.approx(4.0, abs=0.1)


def test_query_failure_degrades_to_zero(db, monkeypatch):
    def boom(self, now=None):
        raise RuntimeError("feedback table unavailable")

    monkeypatch.setattr(FeedbackService, "unreplied_summary", boom)

    block = _feedback_block(db)

    assert block == {
        "scope": "db",
        "window": "now",
        "unanswered": 0,
        "oldest_created_at": None,
        "oldest_age_days": None,
    }
