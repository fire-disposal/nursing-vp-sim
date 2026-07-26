"""TrainingRecord repository."""

from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.orm import Session, joinedload

from core.datetime_utils import ensure_utc
from models import Assignment, Message, TrainingRecord
from repositories.base import SyncRepository


class TrainingRepository(SyncRepository):
    """Data access for TrainingRecord and related entities."""

    async def find_by_id(self, record_id: int) -> TrainingRecord | None:
        def _do(session: Session) -> TrainingRecord | None:
            return (
                session.query(TrainingRecord)
                .options(
                    joinedload(TrainingRecord.case),
                    joinedload(TrainingRecord.user),
                    joinedload(TrainingRecord.score),
                    joinedload(TrainingRecord.messages),
                )
                .filter(TrainingRecord.id == record_id)
                .first()
            )

        return await self._run_in_session(_do)

    async def find_messages(self, record_id: int) -> list[Message]:
        def _do(session: Session) -> list[Message]:
            return session.query(Message).filter(Message.record_id == record_id).order_by(Message.created_at).all()

        return await self._run_in_session(_do)

    async def find_timeout_records(self) -> list[TrainingRecord]:
        def _do(session: Session) -> list[TrainingRecord]:
            now = datetime.now(UTC)
            return (
                session.query(TrainingRecord)
                .filter(TrainingRecord.status == "in_progress")
                .filter(
                    text(
                        "training_records.start_time + (training_records.time_limit * interval '1 minute') < :now"
                    ).bindparams(now=now)
                )
                .all()
            )

        return await self._run_in_session(_do)

    def find_timeout_records_sync(self, db: Session) -> list[TrainingRecord]:
        now = datetime.now(UTC)
        return (
            db.query(TrainingRecord)
            .filter(TrainingRecord.status == "in_progress")
            .filter(
                text(
                    "training_records.start_time + (training_records.time_limit * interval '1 minute') < :now"
                ).bindparams(now=now)
            )
            .all()
        )

    async def mark_completed(self, record_id: int) -> None:
        """注意：此方法使用独立的同步 session，因此自行管理 commit。
        调用者不应依赖其事务上下文。"""

        def _do(session: Session) -> None:
            record = session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.status = "completed"
                record.end_time = datetime.now(UTC)
                if record.assignment_id and not record.is_overdue:
                    assignment = session.query(Assignment).filter(Assignment.id == record.assignment_id).first()
                    if assignment and record.end_time and ensure_utc(record.end_time) > ensure_utc(assignment.end_time):
                        record.is_overdue = True
                session.commit()

        await self._run_in_session(_do)

    def mark_completed_sync(self, db: Session, record_id: int) -> None:
        record = db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if record:
            record.status = "completed"
            record.end_time = datetime.now(UTC)
            record.scoring_status = "pending"
            if record.assignment_id and not record.is_overdue:
                assignment = db.query(Assignment).filter(Assignment.id == record.assignment_id).first()
                if assignment and record.end_time and ensure_utc(record.end_time) > ensure_utc(assignment.end_time):
                    record.is_overdue = True

    async def update_scoring_status(self, record_id: int, status: str, error: str | None = None) -> None:
        """注意：此方法使用独立的同步 session，因此自行管理 commit。
        调用者不应依赖其事务上下文。"""

        def _do(session: Session) -> None:
            record = session.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
            if record:
                record.scoring_status = status
                if error is not None:
                    record.scoring_error = error
                session.commit()

        await self._run_in_session(_do)
