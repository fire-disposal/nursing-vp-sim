"""Practice repository."""

from sqlalchemy import func
from sqlalchemy.orm import joinedload

from models import Assignment, Practice, TrainingRecord
from repositories.base import Repository


class PracticeRepository(Repository[Practice]):
    model = Practice

    def list_with_cases(self, offset: int, limit: int) -> tuple[list[Practice], int]:
        q = self.db.query(Practice).options(joinedload(Practice.case)).order_by(Practice.created_at.desc())
        total = q.order_by(None).count()
        items = q.offset(offset).limit(limit).all()
        return items, total

    def training_counts(self, practice_ids: list[int]) -> dict[int, int]:
        if not practice_ids:
            return {}
        rows = (
            self.db.query(TrainingRecord.practice_id, func.count(TrainingRecord.id))
            .filter(TrainingRecord.practice_id.in_(practice_ids))
            .group_by(TrainingRecord.practice_id)
            .all()
        )
        return {pid: cnt for pid, cnt in rows}

    def training_record_count(self, practice_id: int) -> int:
        return (
            self.db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.practice_id == practice_id).scalar()
        ) or 0

    def assignment_count(self, practice_id: int) -> int:
        return (self.db.query(func.count(Assignment.id)).filter(Assignment.practice_id == practice_id).scalar()) or 0
