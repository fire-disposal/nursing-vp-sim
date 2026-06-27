from sqlalchemy import func

from models import Assignment, Class, Grade, UserClass
from repositories.base import Repository


class GradeRepository(Repository[Grade]):
    model = Grade

    def list_ordered(self) -> list[Grade]:
        return self.db.query(Grade).order_by(Grade.name).all()

    def name_exists(self, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Grade).filter(Grade.name == name)
        if exclude_id is not None:
            q = q.filter(Grade.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def class_counts(self, grade_ids: list[int]) -> dict[int, int]:
        if not grade_ids:
            return {}
        rows = (
            self.db.query(Class.grade_id, func.count(Class.id))
            .filter(Class.grade_id.in_(grade_ids))
            .group_by(Class.grade_id)
            .all()
        )
        return {gid: c for gid, c in rows}

    def student_counts(self, grade_ids: list[int]) -> dict[int, int]:
        if not grade_ids:
            return {}
        rows = (
            self.db.query(Class.grade_id, func.count(UserClass.user_id))
            .join(UserClass, Class.id == UserClass.class_id)
            .filter(Class.grade_id.in_(grade_ids))
            .group_by(Class.grade_id)
            .all()
        )
        return {gid: c for gid, c in rows}

    def class_ids_for(self, grade_id: int) -> list[int]:
        return [row[0] for row in self.db.query(Class.id).filter(Class.grade_id == grade_id).all()]

    def assignment_count_for_classes(self, class_ids: list[int]) -> int:
        if not class_ids:
            return 0
        return self.db.query(func.count(Assignment.id)).filter(Assignment.class_id.in_(class_ids)).scalar() or 0
