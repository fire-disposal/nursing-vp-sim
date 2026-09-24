"""`/admin/ops/dashboard` 的 `feedback` 块（未回复反馈计数）。

面板取代宿主日报后，「未回复用户反馈 N 条」由 dashboard 直接提供。两条约束：

1. 块自带 `scope` / `window`（与其它块同规则，口径词表见 docs/ops/diagnostics.md）；
2. 反馈统计失败只能降级为 0/None，不能让整个 dashboard 500 —— 运维面板的首要
   职责是显示 LLM/评分/错误，反馈计数只是附带信息。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.database import Base
from models import Feedback
from modules.admin.ops import _feedback_block
from modules.feedback.service import FeedbackService


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[Feedback.__table__])
    with Session(engine) as session:
        yield session


def _add(db: Session, fb_id: int, created_at: datetime, *, reply: str | None = None) -> None:
    db.add(
        Feedback(
            id=fb_id, user_id=42, rating=3, tag="bug", content="正文", developer_reply=reply, created_at=created_at
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
