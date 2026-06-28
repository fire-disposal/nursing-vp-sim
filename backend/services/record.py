import logging

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, selectinload

from core.exceptions import AuthError, NotFoundError
from models import Message, TrainingRecord, User

log = logging.getLogger(__name__)


class RecordService:
    def __init__(self, db: Session):
        self.db = db

    def get_records_for_export(self, current_user: User) -> tuple[list[TrainingRecord], dict[int, int]]:
        if not current_user.has_permission("export_data"):
            raise AuthError("权限不足", status_code=403)

        query = self.db.query(TrainingRecord).options(
            selectinload(TrainingRecord.user),
            selectinload(TrainingRecord.case),
            selectinload(TrainingRecord.score),
        )
        records = query.order_by(TrainingRecord.start_time.desc()).yield_per(100).all()

        record_ids = [r.id for r in records]
        msg_counts: dict[int, int] = {}
        if record_ids:
            msg_counts = {
                rid: count
                for rid, count in self.db.query(Message.record_id, func.count(Message.id))
                .filter(Message.record_id.in_(record_ids))
                .group_by(Message.record_id)
                .all()
            }
        return records, msg_counts

    def get_record_detail(self, record_id: int, current_user: User) -> TrainingRecord:
        record = (
            self.db.query(TrainingRecord)
            .options(
                joinedload(TrainingRecord.user),
                joinedload(TrainingRecord.case),
                joinedload(TrainingRecord.score),
                joinedload(TrainingRecord.messages),
            )
            .filter(TrainingRecord.id == record_id)
            .first()
        )
        if not record:
            raise NotFoundError("记录不存在")
        if not current_user.has_permission("export_data") and record.user_id != current_user.id:
            raise AuthError("无权导出此记录", status_code=403)
        return record
