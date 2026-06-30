"""Case repository."""

from sqlalchemy import func

from models import Case, Practice, TrainingRecord
from repositories.base import Repository


class CaseRepository(Repository[Case]):
    model = Case

    def list_brief(
        self,
        offset: int,
        limit: int,
        *,
        training_type: str | None = None,
        difficulty: int | None = None,
    ) -> tuple[list[Case], int]:
        q = self.db.query(Case).order_by(Case.id)
        if training_type:
            q = q.filter(Case.training_type == training_type)
        if difficulty is not None:
            q = q.filter(Case.difficulty == difficulty)
        total = q.order_by(None).count()
        items = q.offset(offset).limit(limit).all()
        return items, total

    def list_manage(
        self,
        offset: int,
        limit: int,
        *,
        name: str | None = None,
        difficulty: int | None = None,
        training_type: str | None = None,
    ) -> tuple[list[Case], int]:
        q = self.db.query(Case).order_by(Case.created_at.desc())
        if name:
            q = q.filter(Case.name.ilike(f"%{name}%"))
        if difficulty is not None:
            q = q.filter(Case.case_data["difficulty"].as_integer() == difficulty)
        if training_type:
            q = q.filter(Case.training_type == training_type)
        total = q.order_by(None).count()
        items = q.offset(offset).limit(limit).all()
        return items, total

    def training_counts(self, case_ids: list[int]) -> dict[int, int]:
        if not case_ids:
            return {}
        rows = (
            self.db.query(TrainingRecord.case_id, func.count(TrainingRecord.id))
            .filter(TrainingRecord.case_id.in_(case_ids))
            .group_by(TrainingRecord.case_id)
            .all()
        )
        return {cid: cnt for cid, cnt in rows}

    def training_count(self, case_id: int) -> int:
        return (self.db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.case_id == case_id).scalar()) or 0

    def has_practices(self, case_id: int) -> bool:
        return bool(self.db.query(self.db.query(Practice).filter(Practice.case_id == case_id).exists()).scalar())

    def list_active_practices(self, case_id: int) -> list[Practice]:
        return (
            self.db.query(Practice)
            .filter(Practice.case_id == case_id, Practice.is_active == True)
            .order_by(Practice.name)
            .all()
        )
