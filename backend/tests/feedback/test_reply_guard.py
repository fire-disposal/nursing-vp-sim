"""反馈回复两条写路径共用同一守卫的回归（内存 Session 替身，无数据库）。

守护评审报告 mess-domain-crud.md 第 15 条：admin 的 reply 曾无任何前置校验，
可静默覆盖已发出的（bot 或人工）回复并重置 replied_at。
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

import pytest

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from core.exceptions import ConflictError
from models import Feedback, Notification
from modules.feedback.service import FeedbackService

FIRST_REPLY_AT = datetime(2026, 3, 1, 9, 0, tzinfo=UTC)


class _FakeQuery:
    def __init__(self, row: Feedback) -> None:
        self._row = row

    def filter(self, *_criteria: object) -> "_FakeQuery":
        return self

    def first(self) -> Feedback:
        return self._row


class _FakeSession:
    """FeedbackService.reply 只用到 query().filter().first() / add / commit / refresh。"""

    def __init__(self, row: Feedback) -> None:
        self.row = row
        self.added: list[object] = []

    def query(self, _model: object) -> _FakeQuery:
        return _FakeQuery(self.row)

    def add(self, obj: object) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def refresh(self, _obj: object) -> None:
        pass


def _feedback(reply: str | None = None, replied_at: datetime | None = None) -> Feedback:
    return Feedback(
        id=1,
        user_id=42,
        rating=5,
        tag="bug",
        content="报错",
        developer_reply=reply,
        replied_at=replied_at,
    )


def _service(fb: Feedback) -> tuple[FeedbackService, _FakeSession]:
    db = _FakeSession(fb)
    # 替身实现了本次路径用到的 Session 子集（query/filter/first/add/commit/refresh）
    return FeedbackService(cast("Session", db)), db


def _notifications(db: _FakeSession) -> list[Notification]:
    return [obj for obj in db.added if isinstance(obj, Notification)]


class TestReplyGuard:
    def test_first_reply_writes_text_and_time(self):
        fb = _feedback()
        service, db = _service(fb)
        service.reply(1, "已修复", "管理员")

        assert fb.developer_reply == "已修复"
        assert fb.replied_at is not None
        assert [n.type for n in _notifications(db)] == ["feedback_replied"]

    def test_second_reply_is_rejected_without_overwrite(self):
        fb = _feedback("首次回复", FIRST_REPLY_AT)
        service, db = _service(fb)

        with pytest.raises(ConflictError):
            service.reply(1, "改写", "管理员")

        assert fb.developer_reply == "首次回复"
        assert fb.replied_at == FIRST_REPLY_AT
        assert _notifications(db) == []

    def test_explicit_overwrite_replaces_text_and_keeps_first_reply_time(self):
        """覆盖只替换正文：首条回复时间不被重置，用户收到回复的时间轴可追溯。"""
        fb = _feedback("首次回复", FIRST_REPLY_AT)
        service, db = _service(fb)
        service.reply(1, "补充说明", "管理员", overwrite=True)

        assert fb.developer_reply == "补充说明"
        assert fb.replied_at == FIRST_REPLY_AT
        assert len(_notifications(db)) == 1

    def test_bot_reply_shares_the_same_guard(self):
        fb = _feedback("人工回复", FIRST_REPLY_AT)
        service, _ = _service(fb)

        with pytest.raises(ConflictError):
            service.bot_reply(1, "自动回复", "bot")

        assert fb.developer_reply == "人工回复"

    def test_bot_reply_can_overwrite_explicitly(self):
        fb = _feedback("人工回复", FIRST_REPLY_AT)
        service, _ = _service(fb)
        service.bot_reply(1, "自动回复", "bot", overwrite=True)

        assert fb.developer_reply == "自动回复"
