from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from core.datetime_utils import parse_iso_datetime
from core.exceptions import ValidationError
from core.pagination import paginate
from core.unit_of_work import unit_of_work
from models import Feedback, User
from repositories.feedback import FeedbackRepository


@dataclass
class FeedbackAdminRow:
    id: int
    user_id: int
    rating: int
    tag: str
    content: str | None
    created_at: datetime
    user_name: str = ""


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
                    tag=tag,
                    content=content,
                )
            )

    def list_admin(
        self,
        tag: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[FeedbackAdminRow], int]:
        df = None
        dt = None
        if date_from:
            try:
                df = parse_iso_datetime(date_from)
            except ValueError:
                raise ValidationError(f"无效日期格式: {date_from}")
        if date_to:
            try:
                dt = parse_iso_datetime(date_to)
            except ValueError:
                raise ValidationError(f"无效日期格式: {date_to}")

        q = self.repo.query_admin_list(tag=tag, date_from=df, date_to=dt)

        # Join with User for display_name
        q = q.add_columns(User.display_name.label("user_name")).join(User, Feedback.user_id == User.id)

        rows, total = paginate(q, offset, limit)
        items = [
            FeedbackAdminRow(
                id=r.id,
                user_id=r.user_id,
                user_name=r.user_name,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return items, total

    def daily_stats(self, date_from: str | None = None, date_to: str | None = None) -> list[dict]:
        df = None
        dt = None
        if date_from:
            try:
                df = parse_iso_datetime(date_from)
            except ValueError:
                raise ValidationError(f"无效日期格式: {date_from}")
        if date_to:
            try:
                dt = parse_iso_datetime(date_to)
            except ValueError:
                raise ValidationError(f"无效日期格式: {date_to}")

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
