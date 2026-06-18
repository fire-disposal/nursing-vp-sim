"""Practice repository."""

from sqlalchemy.orm import Session

from models import Practice


class PracticeRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, practice_id: int) -> Practice | None:
        return self.db.query(Practice).filter(Practice.id == practice_id).first()

    def list_by_case(self, case_id: int, offset: int = 0, limit: int = 50):
        return (
            self.db.query(Practice)
            .filter(Practice.case_id == case_id)
            .offset(offset)
            .limit(limit)
            .all()
        )

    def count_by_case(self, case_id: int) -> int:
        return self.db.query(Practice).filter(Practice.case_id == case_id).count()

    def create(self, **kwargs) -> Practice:
        practice = Practice(**kwargs)
        self.db.add(practice)
        self.db.flush()
        return practice

    def update(self, practice: Practice, **kwargs) -> Practice:
        for k, v in kwargs.items():
            setattr(practice, k, v)
        self.db.flush()
        return practice

    def delete(self, practice: Practice) -> None:
        self.db.delete(practice)
        self.db.flush()
