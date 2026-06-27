from sqlalchemy import func

from models import Assignment, Class, Grade, UserClass
from repositories.base import Repository


class ClassRepository(Repository[Class]):
    model = Class

    def list_with_grade(self, grade_id: int | None = None):
        q = self.db.query(Class, Grade.name.label("grade_name"))
        q = q.join(Grade, Grade.id == Class.grade_id)
        if grade_id is not None:
            q = q.filter(Class.grade_id == grade_id)
        return q.order_by(Grade.name, Class.name).all()

    def student_counts(self, class_ids: list[int]) -> dict[int, int]:
        if not class_ids:
            return {}
        rows = (
            self.db.query(UserClass.class_id, func.count(UserClass.user_id))
            .filter(UserClass.class_id.in_(class_ids))
            .group_by(UserClass.class_id)
            .all()
        )
        return {class_id: count for class_id, count in rows}

    def get_grade(self, grade_id: int) -> Grade | None:
        return self.db.query(Grade).filter(Grade.id == grade_id).first()

    def name_exists_in_grade(self, grade_id: int, name: str, exclude_id: int | None = None) -> bool:
        q = self.db.query(Class).filter(Class.grade_id == grade_id, Class.name == name)
        if exclude_id is not None:
            q = q.filter(Class.id != exclude_id)
        return bool(self.db.query(q.exists()).scalar())

    def assignment_count(self, class_id: int) -> int:
        return self.db.query(func.count(Assignment.id)).filter(Assignment.class_id == class_id).scalar() or 0
