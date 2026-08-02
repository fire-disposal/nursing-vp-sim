from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.config import APP_VERSION
from core.datetime_utils import parse_iso_datetime
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.pagination import paginate
from core.unit_of_work import unit_of_work
from models import Feedback, Notification, User
from models.feedback_image import FeedbackImage


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
            fb = Feedback(
                user_id=user_id,
                rating=rating,
                tag=tag or "",
                content=content,
                version=APP_VERSION,
            )
            self.db.add(fb)
            self.db.flush()
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

        q = self._query_admin_list(tag=tag, date_from=df, date_to=dt, search=search, replied=replied)
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
        rows = self._query_daily_stats(date_from=df, date_to=dt).all()
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
        img = self._get_image(feedback_id, image_id)
        if img is None:
            raise NotFoundError("图片不存在")
        return img

    def image_count_for_feedback(self, feedback_id: int) -> int:
        return (
            self.db.query(func.count(FeedbackImage.id)).filter(FeedbackImage.feedback_id == feedback_id).scalar()
        ) or 0

    def storage_stats(self) -> dict:
        total_images = self.db.query(func.count(FeedbackImage.id)).scalar() or 0
        total_bytes = self.db.query(func.coalesce(func.sum(FeedbackImage.file_size), 0)).scalar() or 0
        return {
            "total_images": total_images,
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        }

    def _query_admin_list(
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

    def _query_daily_stats(self, date_from=None, date_to=None):
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

    def _get_image(self, feedback_id: int, image_id: int) -> FeedbackImage | None:
        return (
            self.db.query(FeedbackImage)
            .filter(
                FeedbackImage.feedback_id == feedback_id,
                FeedbackImage.id == image_id,
            )
            .first()
        )

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

    # ── Bot API ──

    def bot_list(
        self,
        since: str | None = None,
        version: str | None = None,
        tag: str | None = None,
        replied: bool | None = None,
        include_fixed: bool = False,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        q = self.db.query(Feedback).order_by(Feedback.created_at.desc())
        if not include_fixed:
            q = q.filter(Feedback.auto_fix_attempted == False)
        if replied is True:
            q = q.filter(Feedback.developer_reply.isnot(None))
        elif replied is False:
            q = q.filter(Feedback.developer_reply.is_(None))
        if since:
            try:
                q = q.filter(Feedback.created_at >= datetime.fromisoformat(since))
            except ValueError:
                raise ValidationError("Invalid since format, use ISO datetime")
        if version:
            q = q.filter(Feedback.version == version)
        if tag:
            q = q.filter(Feedback.tag == tag)
        total = q.count()
        items = q.offset(offset).limit(limit).all()
        return {
            "items": [
                {
                    "id": f.id,
                    "rating": f.rating,
                    "tag": f.tag,
                    "content": f.content,
                    "version": f.version,
                    "developer_reply": f.developer_reply,
                    "replied_at": f.replied_at.isoformat() if f.replied_at else None,
                    "auto_fix_attempted": f.auto_fix_attempted,
                    "auto_fix_at": f.auto_fix_at.isoformat() if f.auto_fix_at else None,
                    "created_at": f.created_at.isoformat(),
                }
                for f in items
            ],
            "total": total,
            "offset": offset,
            "limit": limit,
        }

    def bot_mark_fix_attempted(self, feedback_id: int) -> dict:
        fb = self.db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not fb:
            raise NotFoundError("反馈不存在")
        fb.auto_fix_attempted = True
        now = datetime.now(UTC)
        fb.auto_fix_at = now
        self.db.commit()
        return {"id": fb.id, "auto_fix_attempted": True, "auto_fix_at": now.isoformat()}

    def bot_reply(self, feedback_id: int, reply_text: str, admin_name: str, overwrite: bool = False) -> Feedback:
        """Bot 直写开发者回复（token 鉴权路由复用）。

        已回复且未显式 overwrite 时拒绝，防止自动回复静默覆盖人工回复。
        """
        fb = self.db.query(Feedback).filter(Feedback.id == feedback_id).first()
        if not fb:
            raise NotFoundError("反馈不存在")
        if fb.developer_reply is not None and not overwrite:
            raise ConflictError("该反馈已有回复，如需覆盖请传 overwrite=true")
        return self.reply(feedback_id, reply_text, admin_name)
