"""运维面板「未回复反馈」计数 —— 空库与非空库两侧。

日报（宿主脚本）被应用内 `/admin/system-ops` 面板接替后，「未回复用户反馈 N 条」
改由 ``FeedbackService.unreplied_summary()`` 提供。这里锁定两件事：

1. 回复判定与后台反馈列表同口径（``developer_reply IS NULL``），已回复的旧反馈
   不会把计数或"最老一条"带偏；
2. 返回体只有计数与最老一条的时间，**不含正文/用户标识**（面板只需展示数字）。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from core.database import Base
from models import Feedback
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
            id=fb_id,
            user_id=42,
            rating=3,
            tag="bug",
            content="正文不得出现在运维面板",
            developer_reply=reply,
            created_at=created_at,
        )
    )
    db.commit()


class TestUnrepliedSummary:
    def test_empty_db_reports_zero_without_timestamps(self, db):
        summary = FeedbackService(db).unreplied_summary(datetime.now(UTC))

        assert summary == {"unanswered": 0, "oldest_created_at": None, "oldest_age_days": None}

    def test_counts_only_unreplied_and_reports_oldest_one(self, db):
        now = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
        # 更早但已回复 → 既不计数，也不能当"最老一条"。
        _add(db, 1, now - timedelta(days=10), reply="已修复")
        _add(db, 2, now - timedelta(days=3))
        _add(db, 3, now - timedelta(hours=6))

        summary = FeedbackService(db).unreplied_summary(now)

        assert summary["unanswered"] == 2
        assert summary["oldest_created_at"] == (now - timedelta(days=3)).isoformat()
        assert summary["oldest_age_days"] == 3.0

    def test_payload_carries_no_content_or_user_identifier(self, db):
        now = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
        _add(db, 1, now - timedelta(hours=2))

        summary = FeedbackService(db).unreplied_summary(now)

        assert set(summary) == {"unanswered", "oldest_created_at", "oldest_age_days"}

    def test_fresh_unreplied_feedback_ages_under_one_day(self, db):
        now = datetime(2026, 9, 25, 12, 0, tzinfo=UTC)
        _add(db, 1, now - timedelta(hours=2))

        summary = FeedbackService(db).unreplied_summary(now)

        assert summary["unanswered"] == 1
        assert summary["oldest_age_days"] == pytest.approx(0.1)
