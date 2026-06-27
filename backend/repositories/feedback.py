from sqlalchemy import case, func

from models import Feedback
from repositories.base import Repository


class FeedbackRepository(Repository[Feedback]):
    model = Feedback

    def query_admin_list(self, tag: str | None = None, date_from=None, date_to=None):
        q = self.db.query(
            Feedback.id,
            Feedback.user_id,
            Feedback.rating,
            Feedback.tag,
            Feedback.content,
            Feedback.created_at,
        ).order_by(Feedback.created_at.desc())

        if tag:
            q = q.filter(Feedback.tag == tag)
        if date_from is not None:
            q = q.filter(Feedback.created_at >= date_from)
        if date_to is not None:
            q = q.filter(Feedback.created_at < date_to)

        return q

    def query_daily_stats(self, date_from=None, date_to=None):
        q = (
            self.db.query(
                func.date(Feedback.created_at).label("date"),
                func.count(case((Feedback.rating == 1, 1))).label("rating_1"),
                func.count(case((Feedback.rating == 2, 1))).label("rating_2"),
                func.count(case((Feedback.rating == 3, 1))).label("rating_3"),
                func.count(case((Feedback.rating == 4, 1))).label("rating_4"),
                func.count(case((Feedback.rating == 5, 1))).label("rating_5"),
            )
            .group_by(func.date(Feedback.created_at))
            .order_by(func.date(Feedback.created_at))
        )
        if date_from is not None:
            q = q.filter(Feedback.created_at >= date_from)
        if date_to is not None:
            q = q.filter(Feedback.created_at < date_to)
        return q
