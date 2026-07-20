from sqlalchemy import func
from sqlalchemy.orm import joinedload

from core.pagination import paginate
from models import Assignment, TrainingRecord, User, UserClass
from repositories.base import Repository


class AssignmentRepository(Repository[Assignment]):
    model = Assignment

    def get_with_relations(self, id_: str) -> Assignment | None:
        return (
            self.db.query(Assignment)
            .options(
                joinedload(Assignment.practice),
                joinedload(Assignment.class_),
            )
            .filter(Assignment.id == id_)
            .first()
        )

    def list_with_counts(
        self,
        teacher_id: int | None,
        class_id: int | None,
        status: str | None,
        now,
        offset: int,
        limit: int,
    ) -> tuple[list, int]:
        student_sub = (
            self.db.query(func.count(TrainingRecord.id))
            .filter(TrainingRecord.assignment_id == Assignment.id)
            .correlate(Assignment)
            .scalar_subquery()
        )
        completed_sub = (
            self.db.query(func.count(TrainingRecord.id))
            .filter(TrainingRecord.assignment_id == Assignment.id, TrainingRecord.status == "completed")
            .correlate(Assignment)
            .scalar_subquery()
        )

        q = (
            self.db.query(
                Assignment,
                student_sub.label("student_count"),
                completed_sub.label("completed_count"),
            )
            .options(
                joinedload(Assignment.practice),
                joinedload(Assignment.class_),
            )
        )

        if teacher_id is not None:
            q = q.filter(Assignment.teacher_id == teacher_id)

        if class_id is not None:
            q = q.filter(Assignment.class_id == class_id)

        if status == "active":
            q = q.filter(Assignment.end_time >= now)
        elif status == "ended":
            q = q.filter(Assignment.end_time < now)

        q = q.order_by(Assignment.created_at.desc())
        return paginate(q, offset, limit)

    def get_students_in_class(self, class_id: int) -> list[User]:
        return (
            self.db.query(User)
            .join(UserClass, UserClass.user_id == User.id)
            .filter(UserClass.class_id == class_id)
            .all()
        )

    def get_records_for_assignment(self, assignment_id: str) -> list[TrainingRecord]:
        return (
            self.db.query(TrainingRecord)
            .options(joinedload(TrainingRecord.score))
            .filter(
                TrainingRecord.assignment_id == assignment_id,
                TrainingRecord.is_test == False,
            )
            .all()
        )

    def has_any_records(self, assignment_id: str) -> bool:
        return bool(
            self.db.query(TrainingRecord)
            .filter(TrainingRecord.assignment_id == assignment_id)
            .with_for_update()
            .first()
        )
