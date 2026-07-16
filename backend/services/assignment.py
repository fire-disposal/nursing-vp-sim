import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from core.database import SessionLocal
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from models import Assignment, Practice, TrainingRecord, UserClass
from repositories.assignment import AssignmentRepository

log = logging.getLogger(__name__)


@dataclass
class AssignmentListView:
    id: str
    title: str
    practice_name: str
    class_name: str
    start_time: datetime
    end_time: datetime
    student_count: int
    completed_count: int
    created_at: datetime


@dataclass
class AssignmentStudentItemView:
    user_id: int
    display_name: str
    student_id: str | None = None
    record_id: int | None = None
    status: str = "not_started"
    score_total: float | None = None
    scoring_status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None
    is_overdue: bool = False
    attempt_count: int = 0


@dataclass
class AssignmentDetailView:
    id: str
    title: str
    description: str | None
    practice_id: int
    practice_name: str
    class_id: int
    class_name: str
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
    student_count: int
    completed_count: int
    scored_count: int
    students: list[AssignmentStudentItemView] = field(default_factory=list)


class AssignmentService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = AssignmentRepository(db)

    def _build_detail_view(self, assignment: Assignment) -> AssignmentDetailView:
        students_in_class = self.repo.get_students_in_class(assignment.class_id)
        training_records = self.repo.get_records_for_assignment(assignment.id)

        records_by_user: dict[int, list[TrainingRecord]] = {}
        for r in training_records:
            records_by_user.setdefault(r.user_id, []).append(r)

        student_items: list[AssignmentStudentItemView] = []
        for student in students_in_class:
            user_records = records_by_user.get(student.id, [])
            if not user_records:
                student_items.append(
                    AssignmentStudentItemView(
                        user_id=student.id,
                        display_name=student.display_name,
                        student_id=student.student_id,
                    )
                )
                continue

            best = None
            best_score = None
            for r in user_records:
                if r.scoring_status == "completed" and r.score and r.score.total_score is not None:
                    if best_score is None or r.score.total_score > best_score:
                        best = r
                        best_score = r.score.total_score
            if best is None:
                best = max(user_records, key=lambda r: r.start_time or datetime.min.replace(tzinfo=UTC))

            student_items.append(
                AssignmentStudentItemView(
                    user_id=student.id,
                    display_name=student.display_name,
                    student_id=student.student_id,
                    record_id=best.id,
                    status=best.status,
                    score_total=best.score.total_score if best.score and best.scoring_status == "completed" else None,
                    scoring_status=best.scoring_status,
                    start_time=best.start_time,
                    end_time=best.end_time,
                    is_overdue=best.is_overdue,
                    attempt_count=len(user_records),
                )
            )

        completed_count = sum(
            1 for records in records_by_user.values() if any(r.status == "completed" for r in records)
        )
        scored_count = sum(
            1 for records in records_by_user.values() if any(r.scoring_status == "completed" for r in records)
        )

        return AssignmentDetailView(
            id=assignment.id,
            title=assignment.title,
            description=assignment.description,
            practice_id=assignment.practice_id,
            practice_name=assignment.practice.name if assignment.practice else "",
            class_id=assignment.class_id,
            class_name=assignment.class_.name if assignment.class_ else "",
            start_time=assignment.start_time,
            end_time=assignment.end_time,
            created_at=assignment.created_at,
            updated_at=assignment.updated_at,
            student_count=len(students_in_class),
            completed_count=completed_count,
            scored_count=scored_count,
            students=student_items,
        )

    def create(
        self,
        practice_id: int,
        class_id: int,
        title: str,
        description: str | None,
        start_time: datetime,
        end_time: datetime,
        teacher_id: int,
    ) -> AssignmentDetailView:
        practice = self.db.query(Practice).options(joinedload(Practice.case)).filter(Practice.id == practice_id).first()
        if not practice:
            raise NotFoundError("练习不存在")

        if end_time <= start_time:
            raise ValidationError("截止时间必须晚于开始时间")

        with unit_of_work(self.db, conflict_detail="创建失败，请重试"):
            assignment = self.repo.add(
                Assignment(
                    practice_id=practice_id,
                    class_id=class_id,
                    teacher_id=teacher_id,
                    title=title,
                    description=description,
                    start_time=start_time,
                    end_time=end_time,
                )
            )
        self.db.refresh(assignment)

        self._notify_students(class_id, title, practice.case.name if practice.case else "")
        log.info(f"Assignment created: id={assignment.id} title={assignment.title}", extra={"user_id": teacher_id})
        return self._build_detail_view(assignment)

    def list_all(
        self,
        teacher_id: int,
        class_id: int | None,
        status: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[AssignmentListView], int]:
        rows, total = self.repo.list_with_counts(teacher_id, class_id, status, datetime.now(UTC), offset, limit)
        items = [
            AssignmentListView(
                id=r[0].id,
                title=r[0].title,
                practice_name=r[0].practice.name if r[0].practice else "",
                class_name=r[0].class_.name if r[0].class_ else "",
                start_time=r[0].start_time,
                end_time=r[0].end_time,
                student_count=r[1],
                completed_count=r[2],
                created_at=r[0].created_at,
            )
            for r in rows
        ]
        return items, total

    def get(self, assignment_id: str, teacher_id: int) -> AssignmentDetailView:
        assignment = self.repo.get_with_relations(assignment_id)
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if assignment.teacher_id != teacher_id:
            raise AuthError("无权查看", status_code=403)
        return self._build_detail_view(assignment)

    def update(
        self,
        assignment_id: str,
        teacher_id: int,
        practice_id: int | None,
        class_id: int | None,
        title: str | None,
        description: str | None,
        start_time: datetime | None,
        end_time: datetime | None,
    ) -> AssignmentDetailView:
        assignment = self.repo.get_with_relations(assignment_id)
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if assignment.teacher_id != teacher_id:
            raise AuthError("无权修改", status_code=403)

        if practice_id is not None:
            practice = (
                self.db.query(Practice).options(joinedload(Practice.case)).filter(Practice.id == practice_id).first()
            )
            if not practice:
                raise NotFoundError("练习不存在")
            assignment.practice_id = practice_id
        if class_id is not None:
            assignment.class_id = class_id
        if title is not None:
            assignment.title = title
        if description is not None:
            assignment.description = description
        if start_time is not None:
            assignment.start_time = start_time
        if end_time is not None:
            assignment.end_time = end_time

        if assignment.end_time <= assignment.start_time:
            raise ValidationError("截止时间必须晚于开始时间")

        assignment.updated_at = datetime.now(UTC)
        with unit_of_work(self.db, conflict_detail="更新失败，请刷新后重试"):
            self.db.flush()
        self.db.refresh(assignment)
        return self._build_detail_view(assignment)

    def delete(self, assignment_id: str, teacher_id: int) -> dict:
        assignment = self.db.query(Assignment).filter(Assignment.id == assignment_id).with_for_update().first()
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if assignment.teacher_id != teacher_id:
            raise AuthError("无权删除", status_code=403)

        if self.repo.has_any_records(assignment_id):
            raise ValidationError("已有学生开始练习，无法删除")

        with unit_of_work(self.db, conflict_detail="删除失败，请刷新后重试"):
            self.repo.delete(assignment)

        return {"message": "练习发布已删除"}

    @staticmethod
    def _notify_students(class_id: int, title: str, case_name: str) -> None:
        from models.ux import Notification

        db = SessionLocal()
        try:
            students = db.execute(db.query(UserClass.user_id).filter(UserClass.class_id == class_id)).scalars().all()
            body = f"病例：{case_name}" if case_name else ""
            now = datetime.now(UTC)
            for uid in students:
                db.add(
                    Notification(
                        user_id=uid,
                        type="assignment_new",
                        title=f"新作业：{title}",
                        body=body,
                        created_at=now,
                    )
                )
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()
