from sqlalchemy import case, func

from models import Feedback
from models.feedback_image import FeedbackImage
from repositories.base import Repository


class FeedbackRepository(Repository[Feedback]):
    model = Feedback

    def query_admin_list(
        self,
        tag: str | None = None,
        date_from=None,
        date_to=None,
        search: str | None = None,
        replied: bool | None = None,
    ):
        q = self.db.query(
            Feedback.id,
            Feedback.user_id,
            Feedback.rating,
            Feedback.tag,
            Feedback.content,
            Feedback.version,
            Feedback.developer_reply,
            Feedback.replied_at,
            Feedback.created_at,
        ).order_by(Feedback.created_at.desc())

        if tag:
            q = q.filter(Feedback.tag == tag)
        if date_from is not None:
            q = q.filter(Feedback.created_at >= date_from)
        if date_to is not None:
            q = q.filter(Feedback.created_at < date_to)
        if search:
            q = q.filter(Feedback.content.ilike(f"%{search}%"))
        if replied is True:
            q = q.filter(Feedback.developer_reply.isnot(None))
        elif replied is False:
            q = q.filter(Feedback.developer_reply.is_(None))

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

    def get_image(self, feedback_id: int, image_id: int) -> FeedbackImage | None:
        return (
            self.db.query(FeedbackImage)
            .filter(
                FeedbackImage.feedback_id == feedback_id,
                FeedbackImage.id == image_id,
            )
            .first()
        )

    def image_count_for_feedback(self, feedback_id: int) -> int:
        return (
            self.db.query(func.count(FeedbackImage.id)).filter(FeedbackImage.feedback_id == feedback_id).scalar() or 0
        )

    def storage_stats(self) -> dict:
        total_images = self.db.query(func.count(FeedbackImage.id)).scalar() or 0
        total_bytes = self.db.query(func.coalesce(func.sum(FeedbackImage.file_size), 0)).scalar() or 0
        return {
            "total_images": total_images,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        }
