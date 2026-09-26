"""运维面板「未回复反馈」计数 —— 空库与非空库两侧。

日报（宿主脚本）被应用内 `/admin/system-ops` 面板接替后，「未回复用户反馈 N 条」
改由 ``FeedbackService.unreplied_summary()`` 提供。这里锁定两件事：

1. 回复判定与后台反馈列表同口径（``developer_reply IS NULL``），已回复的旧反馈
   不会把计数或"最老一条"带偏；
2. 返回体只有计数与最老一条的时间，**不含正文/用户标识**（面板只需展示数字）。

真库判据（**PostgreSQL**，`nursing_test`）：夹具在 savepoint 内清空反馈表并种一条
作者行（``feedbacks.user_id`` 是真外键，PG 会拒收无主行）。
"""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.orm import Session

from core.database import Base
from core.database import engine as pg_engine
from models import Feedback, Role, User
from modules.feedback.service import FeedbackService

_TABLES = [Role.__table__, User.__table__, Feedback.__table__]

_AUTHOR = "unreplied-fb-author"


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
    pg_session.query(Feedback).delete()  # 空库/计数判据需要确定性的空表
    pg_session.add(User(username=_AUTHOR, password_hash="x", role_id=role.id, display_name="反馈作者"))
    pg_session.flush()
    return pg_session


def _author_id(db: Session) -> int:
    return db.query(User.id).filter(User.username == _AUTHOR).one()[0]


def _add(db: Session, fb_id: int, created_at: datetime, *, reply: str | None = None) -> None:
    # ``feedbacks.created_at`` 是 naïve 列（timestamp without time zone，见 information_schema）。
    # PG 会把 aware 值按**会话时区**折算（本机/生产库都是 Asia/Shanghai），读回时服务层
    # ``ensure_utc()`` 按 UTC 解释 → 读路径整体偏 8 小时（3 天变 2.7 天，isoformat 也偏）。
    # 列的口径就是 UTC 墙钟时间，故这里显式写 naïve-UTC —— 与列类型无关，且与 SQLite 上的
    # 实际存储（DATETIME 丢 tzinfo）一致。
    db.add(
        Feedback(
            id=fb_id,
            user_id=_author_id(db),
            rating=3,
            tag="bug",
            content="正文不得出现在运维面板",
            developer_reply=reply,
            created_at=created_at.replace(tzinfo=None),
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
