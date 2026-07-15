from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.config import APP_VERSION
from core.datetime_utils import parse_iso_datetime
from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.unit_of_work import unit_of_work
from models import Feedback, Notification, User
from repositories.feedback import FeedbackRepository


@dataclass
class FeedbackRow:
    id: int
    user_id: int
    user_name: str = ""
    rating: int = 3
    tag: str = ""
    content: str | None = None
    version: str = ""
    developer_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime | None = None


class FeedbackService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = FeedbackRepository(db)

    def submit(self, user_id: int, rating: int, tag: str, content: str | None) -> Feedback:
        with unit_of_work(self.db, conflict_detail="反馈提交冲突"):
            return self.repo.add(
                Feedback(
                    user_id=user_id,
                    rating=rating,
                    tag=tag or "",
                    content=content,
                    version=APP_VERSION,
                )
            )

    def list_admin(
        self,
        tag: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[FeedbackRow], int]:
        df = self._parse_date(date_from)
        dt = self._parse_date(date_to)

        q = self.repo.query_admin_list(tag=tag, date_from=df, date_to=dt)
        q = q.add_columns(User.display_name.label("user_name")).join(User, Feedback.user_id == User.id)

        rows, total = paginate(q, offset, limit)
        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                user_name=r.user_name,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return items, total

    def list_my(self, user_id: int, offset: int = 0, limit: int = 50) -> tuple[list[FeedbackRow], int]:
        q = self.db.query(Feedback).filter(Feedback.user_id == user_id).order_by(Feedback.created_at.desc())
        rows, total = paginate(q, offset, limit)
        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return items, total

    def reply(self, feedback_id: int, reply_text: str, admin_name: str) -> Feedback:
        fb = self.db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not fb:
            raise NotFoundError("反馈不存在")

        now = datetime.now(UTC)
        with unit_of_work(self.db, conflict_detail="回复保存冲突"):
            fb.developer_reply = reply_text
            fb.replied_at = now

            notification = Notification(
                user_id=fb.user_id,
                type="feedback_replied",
                title="开发者回复了你的反馈",
                body=f"{admin_name} 回复了你的反馈：{reply_text[:100]}{'...' if len(reply_text) > 100 else ''}",
            )
            self.db.add(notification)

        self.db.refresh(fb)
        return fb

    def daily_stats(self, date_from: str | None = None, date_to: str | None = None) -> list[dict]:
        df = self._parse_date(date_from)
        dt = self._parse_date(date_to)
        rows = self.repo.query_daily_stats(date_from=df, date_to=dt).all()
        return [
            {
                "date": str(r.date),
                "rating_1": r.rating_1,
                "rating_2": r.rating_2,
                "rating_3": r.rating_3,
                "rating_4": r.rating_4,
                "rating_5": r.rating_5,
            }
            for r in rows
        ]

    @staticmethod
    def _parse_date(val: str | None):
        if not val:
            return None
        try:
            return parse_iso_datetime(val)
        except ValueError:
            raise ValidationError(f"无效日期格式: {val}")
