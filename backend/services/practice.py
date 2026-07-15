from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING

from core.capabilities import ALL_CAPABILITIES
from core.exceptions import NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from models import Case, Practice
from repositories.practice import PracticeRepository

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


@dataclass
class PracticeView:
    id: int
    name: str
    description: str | None
    case_id: int
    case_name: str
    training_type: str
    features: dict
    behavior: dict
    is_active: bool
    training_count: int
    created_at: datetime
    updated_at: datetime


class PracticeService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = PracticeRepository(db)

    def _view(self, p: Practice, training_count: int = 0) -> PracticeView:
        return PracticeView(
            id=p.id,
            name=p.name,
            description=p.description,
            case_id=p.case_id,
            case_name=p.case.name if p.case else "",
            training_type=p.case.training_type if p.case else "history_taking",
            features=p.features or {},
            behavior=p.behavior or {},
            is_active=p.is_active,
            training_count=training_count,
            created_at=p.created_at,
            updated_at=p.updated_at,
        )

    def list(self, offset: int, limit: int) -> tuple[list[PracticeView], int]:
        practices, total = self.repo.list_with_cases(offset, limit)
        ids = [p.id for p in practices]
        counts = self.repo.training_counts(ids)
        views = [self._view(p, counts.get(p.id, 0)) for p in practices]
        return views, total

    def get(self, practice_id: int) -> PracticeView:
        p = self.repo.get_or_404(practice_id, "练习模板不存在")
        return self._view(p)

    def create(self, data) -> PracticeView:
        case = self.db.query(Case).filter(Case.id == data.case_id).first()
        if not case:
            raise NotFoundError("病例不存在")

        features = data.features or {}
        valid_keys = set(ALL_CAPABILITIES.keys())
        for k in features:
            if k not in valid_keys:
                raise ValidationError(f"未知功能开关: {k}")

        with unit_of_work(self.db, conflict_detail="练习模板创建失败"):
            p = self.repo.add(
                Practice(
                    name=data.name,
                    description=data.description,
                    case_id=data.case_id,
                    features=features,
                    behavior=data.behavior or {},
                )
            )
        return self._view(p)

    def update(self, practice_id: int, data) -> PracticeView:
        p = self.repo.get_or_404(practice_id, "练习模板不存在")

        for field in ("name", "description", "case_id", "is_active"):
            val = getattr(data, field, None)
            if val is not None:
                setattr(p, field, val)
        if data.features is not None:
            valid_keys = set(ALL_CAPABILITIES.keys())
            for k in data.features:
                if k not in valid_keys:
                    raise ValidationError(f"未知功能开关: {k}")
            p.features = data.features
        if data.behavior is not None:
            p.behavior = data.behavior

        with unit_of_work(self.db, conflict_detail="练习模板更新失败"):
            self.db.flush()
        return self._view(p)

    def delete(self, practice_id: int) -> None:
        p = self.repo.get_or_404(practice_id, "练习模板不存在")

        if self.repo.assignment_count(practice_id) > 0:
            raise ValidationError("该练习存在关联的作业，无法删除")

        count = self.repo.training_record_count(practice_id)
        if count > 0:
            raise ValidationError(f"该练习已有 {count} 条训练记录，无法删除")

        with unit_of_work(self.db, conflict_detail="练习模板删除失败"):
            self.repo.delete(p)
