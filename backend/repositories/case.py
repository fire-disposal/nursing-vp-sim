"""Case repository."""

from sqlalchemy.orm import Session

from models import Case


class CaseRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, case_id: int) -> Case | None:
        return self.db.query(Case).filter(Case.id == case_id).first()

    def create(self, **kwargs) -> Case:
        case = Case(**kwargs)
        self.db.add(case)
        self.db.flush()
        return case

    def update(self, case: Case, **kwargs) -> Case:
        for k, v in kwargs.items():
            setattr(case, k, v)
        self.db.flush()
        return case

    def delete(self, case: Case) -> None:
        self.db.delete(case)
        self.db.flush()
