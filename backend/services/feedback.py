from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from core.config import APP_VERSION
from core.datetime_utils import parse_iso_datetime
from core.exceptions import NotFoundError, ValidationError
from core.pagination import paginate
from core.unit_of_work import unit_of_work
from models import Feedback, Notification, User
from models.feedback_image import FeedbackImage
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
    image_count: int = 0
    image_ids: list[int] | None = None
    developer_reply: str | None = None
    replied_at: datetime | None = None
    created_at: datetime | None = None


class FeedbackService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = FeedbackRepository(db)

    def submit(
        self,
        user_id: int,
        rating: int,
        tag: str,
        content: str | None,
        images: list[tuple[bytes, str]] | None = None,
    ) -> Feedback:
        if images is not None:
            if len(images) > 3:
                raise ValidationError("每次最多上传 3 张图片")
            for data, mime in images:
                self._validate_image(data, mime)

        with unit_of_work(self.db, conflict_detail="反馈提交冲突"):
            fb = self.repo.add(
                Feedback(
                    user_id=user_id,
                    rating=rating,
                    tag=tag or "",
                    content=content,
                    version=APP_VERSION,
                )
            )
            if images:
                for data, mime in images:
                    self.db.add(
                        FeedbackImage(
                            feedback_id=fb.id,
                            image_data=data,
                            mime_type=mime,
                            file_size=len(data),
                        )
                    )
            return fb

    def list_admin(
        self,
        tag: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
        search: str | None = None,
        replied: bool | None = None,
        offset: int = 0,
        limit: int = 20,
    ) -> tuple[list[FeedbackRow], int]:
        df = self._parse_date(date_from)
        dt = self._parse_date(date_to)

        q = self.repo.query_admin_list(tag=tag, date_from=df, date_to=dt, search=search, replied=replied)
        q = q.add_columns(User.display_name.label("user_name")).join(User, Feedback.user_id == User.id)

        rows, total = paginate(q, offset, limit)

        feedback_ids = [r.id for r in rows]
        if feedback_ids:
            counts = (
                self.db.query(
                    FeedbackImage.feedback_id,
                    func.count(FeedbackImage.id).label("cnt"),
                )
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .group_by(FeedbackImage.feedback_id)
                .all()
            )
            count_map = {c.feedback_id: c.cnt for c in counts}
            all_images = (
                self.db.query(FeedbackImage.feedback_id, FeedbackImage.id)
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .order_by(FeedbackImage.id)
                .all()
            )
            ids_map: dict[int, list[int]] = {}
            for img in all_images:
                ids_map.setdefault(img.feedback_id, []).append(img.id)
        else:
            count_map = {}
            ids_map = {}

        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                user_name=r.user_name,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                image_count=count_map.get(r.id, 0),
                image_ids=ids_map.get(r.id, []),
                developer_reply=r.developer_reply,
                replied_at=r.replied_at,
                created_at=r.created_at,
            )
            for r in rows
        ]
        return items, total

    def list_my(
        self,
        user_id: int,
        tag: str | None = None,
        replied: bool | None = None,
        offset: int = 0,
        limit: int = 50,
    ) -> tuple[list[FeedbackRow], int]:
        q = self.db.query(Feedback).filter(Feedback.user_id == user_id).order_by(Feedback.created_at.desc())
        if tag:
            q = q.filter(Feedback.tag == tag)
        if replied is True:
            q = q.filter(Feedback.developer_reply.isnot(None))
        elif replied is False:
            q = q.filter(Feedback.developer_reply.is_(None))
        rows, total = paginate(q, offset, limit)

        feedback_ids = [r.id for r in rows]
        if feedback_ids:
            counts = (
                self.db.query(
                    FeedbackImage.feedback_id,
                    func.count(FeedbackImage.id).label("cnt"),
                )
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .group_by(FeedbackImage.feedback_id)
                .all()
            )
            count_map = {c.feedback_id: c.cnt for c in counts}
            all_images = (
                self.db.query(FeedbackImage.feedback_id, FeedbackImage.id)
                .filter(FeedbackImage.feedback_id.in_(feedback_ids))
                .order_by(FeedbackImage.id)
                .all()
            )
            ids_map: dict[int, list[int]] = {}
            for img in all_images:
                ids_map.setdefault(img.feedback_id, []).append(img.id)
        else:
            count_map = {}
            ids_map = {}

        items = [
            FeedbackRow(
                id=r.id,
                user_id=r.user_id,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                version=r.version,
                image_count=count_map.get(r.id, 0),
                image_ids=ids_map.get(r.id, []),
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

    def get_image(self, feedback_id: int, image_id: int) -> FeedbackImage:
        img = self.repo.get_image(feedback_id, image_id)
        if img is None:
            raise NotFoundError("图片不存在")
        return img

    def storage_stats(self) -> dict:
        return self.repo.storage_stats()

    @staticmethod
    def _validate_image(data: bytes, mime_type: str) -> None:
        ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
        if mime_type not in ALLOWED_MIME:
            raise ValidationError(f"不支持的图片格式: {mime_type}")

        if len(data) == 0:
            raise ValidationError("图片文件为空")

        if len(data) > 512_000:
            raise ValidationError("图片大小超过限制 (最大 512KB)")

        MAGIC = {
            b"\xff\xd8": "image/jpeg",
            b"\x89PNG\r\n\x1a\n": "image/png",
            b"RIFF": "image/webp",
        }
        matched = False
        for magic, _ in MAGIC.items():
            if data.startswith(magic):
                matched = True
                if magic == b"RIFF" and (len(data) < 12 or data[8:12] != b"WEBP"):
                    raise ValidationError("非法的 WebP 文件")
                break

        if not matched:
            raise ValidationError("无法识别的图片格式，仅支持 JPEG / PNG / WebP")

    @staticmethod
    def _parse_date(val: str | None):
        if not val:
            return None
        try:
            return parse_iso_datetime(val)
        except ValueError:
            raise ValidationError(f"无效日期格式: {val}")
