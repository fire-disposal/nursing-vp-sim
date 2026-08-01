import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from core.exceptions import AuthError, NotFoundError, ValidationError
from core.pagination import paginate
from core.unit_of_work import unit_of_work
from models import Assignment, Case, TrainingRecord, User, UserClass

log = logging.getLogger(__name__)


@dataclass
class AssignmentListView:
    id: str
    title: str
    case_name: str
    class_name: str
    start_time: datetime
    end_time: datetime
    student_count: int
    completed_count: int
    created_at: datetime
    teacher_name: str = ""
    is_closed: bool = False


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
    case_id: int
    case_name: str
    class_id: int
    class_name: str
    features: dict
    behavior: dict
    student_ids: list[int] | None
    start_time: datetime
    end_time: datetime
    created_at: datetime
    updated_at: datetime
    student_count: int
    completed_count: int
    scored_count: int
    avg_score: float | None = None
    max_score: float | None = None
    min_score: float | None = None
    completion_rate: float = 0.0
    students: list[AssignmentStudentItemView] = field(default_factory=list)
    max_attempts: int | None = None


class AssignmentService:
    def __init__(self, db: Session):
        self.db = db

    def get_with_relations(self, id_: str) -> Assignment | None:
        return (
            self.db.query(Assignment)
            .options(
                joinedload(Assignment.case),
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
        completed_sub = (
            self.db.query(func.count(func.distinct(TrainingRecord.user_id)))
            .filter(
                TrainingRecord.assignment_id == Assignment.id,
                TrainingRecord.status == "completed",
                TrainingRecord.is_test == False,
            )
            .correlate(Assignment)
            .scalar_subquery()
        )

        q = self.db.query(
            Assignment,
            completed_sub.label("completed_count"),
        ).options(
            joinedload(Assignment.case),
            joinedload(Assignment.class_),
            joinedload(Assignment.teacher),
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

    @staticmethod
    def _is_auto_closed(assignment: Assignment) -> bool:
        if assignment.is_closed:
            return True
        now = datetime.now(UTC)
        return (
            now > assignment.end_time.replace(tzinfo=UTC)
            if assignment.end_time.tzinfo is None
            else now > assignment.end_time
        )

    def _get_target_student_ids(self, assignment: Assignment) -> list[int]:
        if assignment.student_ids:
            return assignment.student_ids
        students = self.get_students_in_class(assignment.class_id)
        return [s.id for s in students]

    def _get_target_students(self, assignment: Assignment) -> list[User]:
        if assignment.student_ids:
            return self.db.query(User).filter(User.id.in_(assignment.student_ids)).all()
        return self.get_students_in_class(assignment.class_id)

    def _build_detail_view(self, assignment: Assignment) -> AssignmentDetailView:
        students_in_class = self._get_target_students(assignment)
        training_records = self.get_records_for_assignment(assignment.id)

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
                if r.status in ("abandoned", "discarded"):
                    continue
                if r.scoring_status == "completed" and r.score and r.score.total_score is not None:
                    if best_score is None or r.score.total_score > best_score:
                        best = r
                        best_score = r.score.total_score
            if best is None:
                non_abandoned = [r for r in user_records if r.status not in ("abandoned", "discarded")]
                if non_abandoned:
                    best = max(non_abandoned, key=lambda r: r.start_time or datetime.min.replace(tzinfo=UTC))
                else:
                    best = max(user_records, key=lambda r: r.start_time or datetime.min.replace(tzinfo=UTC))

            status = best.status
            if best.is_overdue and status != "completed":
                status = "overdue"

            student_items.append(
                AssignmentStudentItemView(
                    user_id=student.id,
                    display_name=student.display_name,
                    student_id=student.student_id,
                    record_id=best.id,
                    status=status,
                    score_total=best.score.total_score if best.score and best.scoring_status == "completed" else None,
                    scoring_status=best.scoring_status,
                    start_time=best.start_time,
                    end_time=best.end_time,
                    is_overdue=best.is_overdue,
                    attempt_count=sum(1 for r in user_records if r.status not in ("in_progress", "discarded")),
                )
            )

        completed_count = sum(
            1 for records in records_by_user.values() if any(r.status == "completed" for r in records)
        )
        scored_count = sum(
            1 for records in records_by_user.values() if any(r.scoring_status == "completed" for r in records)
        )

        scored_students = [s for s in student_items if s.scoring_status == "completed" and s.score_total is not None]
        if scored_students:
            scores = [s.score_total for s in scored_students]
            avg_score = round(sum(scores) / len(scores), 1)
            max_score_data = round(max(scores), 1)
            min_score_data = round(min(scores), 1)
        else:
            avg_score = max_score_data = min_score_data = None
        completion_rate = round(completed_count / len(student_items), 2) if student_items else 0.0

        return AssignmentDetailView(
            id=assignment.id,
            title=assignment.title,
            description=assignment.description,
            case_id=assignment.case_id,
            case_name=assignment.case.name if assignment.case else "",
            class_id=assignment.class_id,
            class_name=assignment.class_.name if assignment.class_ else "",
            features=assignment.features or {},
            behavior=assignment.behavior or {},
            student_ids=assignment.student_ids,
            start_time=assignment.start_time,
            end_time=assignment.end_time,
            created_at=assignment.created_at,
            updated_at=assignment.updated_at,
            student_count=len(students_in_class),
            completed_count=completed_count,
            scored_count=scored_count,
            avg_score=avg_score,
            max_score=max_score_data,
            min_score=min_score_data,
            completion_rate=completion_rate,
            students=student_items,
            max_attempts=assignment.max_attempts,
        )

    def create(
        self,
        case_id: int,
        class_id: int,
        title: str,
        description: str | None,
        features: dict,
        behavior: dict,
        student_ids: list[int] | None,
        start_time: datetime,
        end_time: datetime,
        teacher_id: int,
        max_attempts: int | None = None,
    ) -> AssignmentDetailView:
        case = self.db.query(Case).filter(Case.id == case_id).first()
        if not case:
            raise NotFoundError("病例不存在")

        if end_time <= start_time:
            raise ValidationError("截止时间必须晚于开始时间")

        with unit_of_work(self.db, conflict_detail="创建失败，请重试"):
            assignment = Assignment(
                case_id=case_id,
                class_id=class_id,
                teacher_id=teacher_id,
                title=title,
                description=description,
                features=features or {},
                behavior=behavior or {},
                student_ids=student_ids,
                start_time=start_time,
                end_time=end_time,
                max_attempts=max_attempts,
            )
            self.db.add(assignment)
            self.db.flush()
        self.db.refresh(assignment)

        self._notify_students(assignment, case.name if case else "")
        log.info(f"Assignment created: id={assignment.id} title={assignment.title}", extra={"user_id": teacher_id})
        return self._build_detail_view(assignment)

    def list_all(
        self,
        teacher_id: int | None,
        class_id: int | None,
        status: str | None,
        offset: int,
        limit: int,
    ) -> tuple[list[AssignmentListView], int]:
        rows, total = self.list_with_counts(teacher_id, class_id, status, datetime.now(UTC), offset, limit)

        class_ids = {r[0].class_id for r in rows}
        class_sizes: dict[int, int] = {}
        if class_ids:
            count_rows = (
                self.db.query(UserClass.class_id, func.count(UserClass.user_id))
                .filter(UserClass.class_id.in_(class_ids))
                .group_by(UserClass.class_id)
                .all()
            )
            class_sizes = {r[0]: r[1] for r in count_rows}

        items = [
            AssignmentListView(
                id=r[0].id,
                title=r[0].title,
                case_name=r[0].case.name if r[0].case else "",
                class_name=r[0].class_.name if r[0].class_ else "",
                teacher_name=r[0].teacher.display_name if r[0].teacher else "",
                start_time=r[0].start_time,
                end_time=r[0].end_time,
                student_count=len(r[0].student_ids) if r[0].student_ids else class_sizes.get(r[0].class_id, 0),
                completed_count=r[1],
                created_at=r[0].created_at,
                is_closed=r[0].is_closed,
            )
            for r in rows
        ]
        return items, total

    def get(self, assignment_id: str, teacher_id: int, skip_ownership: bool = False) -> AssignmentDetailView:
        assignment = self.get_with_relations(assignment_id)
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if not skip_ownership and assignment.teacher_id != teacher_id:
            raise AuthError("无权查看", status_code=403)
        return self._build_detail_view(assignment)

    def update(
        self,
        assignment_id: str,
        teacher_id: int,
        case_id: int | None,
        class_id: int | None,
        title: str | None,
        description: str | None,
        features: dict | None,
        behavior: dict | None,
        student_ids: list[int] | None,
        start_time: datetime | None,
        end_time: datetime | None,
        is_closed: bool | None = None,
        max_attempts: int | None = None,
        skip_ownership: bool = False,
    ) -> AssignmentDetailView:
        assignment = self.get_with_relations(assignment_id)
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if not skip_ownership and assignment.teacher_id != teacher_id:
            raise AuthError("无权修改", status_code=403)

        if case_id is not None or class_id is not None:
            if self.has_any_records(assignment_id):
                raise ValidationError("已有学生开始练习，不能更换病例或班级")

        if case_id is not None:
            case = self.db.query(Case).filter(Case.id == case_id).first()
            if not case:
                raise NotFoundError("病例不存在")
            assignment.case_id = case_id
        if class_id is not None:
            assignment.class_id = class_id
        if title is not None:
            assignment.title = title
        if description is not None:
            assignment.description = description
        if features is not None:
            assignment.features = features
        if behavior is not None:
            assignment.behavior = behavior
        if student_ids is not None:
            assignment.student_ids = student_ids if len(student_ids) > 0 else None
        if start_time is not None:
            assignment.start_time = start_time
        if end_time is not None:
            assignment.end_time = end_time
        if is_closed is not None:
            assignment.is_closed = is_closed
        if max_attempts is not None:
            assignment.max_attempts = max_attempts

        if assignment.end_time <= assignment.start_time:
            raise ValidationError("截止时间必须晚于开始时间")

        assignment.updated_at = datetime.now(UTC)
        with unit_of_work(self.db, conflict_detail="更新失败，请刷新后重试"):
            self.db.flush()
        self.db.refresh(assignment)
        return self._build_detail_view(assignment)

    def delete(self, assignment_id: str, teacher_id: int, skip_ownership: bool = False) -> dict:
        assignment = self.db.query(Assignment).filter(Assignment.id == assignment_id).with_for_update().first()
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if not skip_ownership and assignment.teacher_id != teacher_id:
            raise AuthError("无权删除", status_code=403)

        if self.has_any_records(assignment_id):
            raise ValidationError("已有学生开始练习，无法删除")

        with unit_of_work(self.db, conflict_detail="删除失败，请刷新后重试"):
            self.db.delete(assignment)
            self.db.flush()

        return {"message": "练习发布已删除"}

    def send_reminder(self, assignment_id: str, teacher_id: int, skip_ownership: bool = False) -> dict:
        assignment = self.get_with_relations(assignment_id)
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if not skip_ownership and assignment.teacher_id != teacher_id:
            raise AuthError("无权操作", status_code=403)

        records = self.get_records_for_assignment(assignment_id)
        submitted_user_ids = {r.user_id for r in records if r.status == "completed"}

        target_ids = self._get_target_student_ids(assignment)
        not_submitted = [uid for uid in target_ids if uid not in submitted_user_ids]

        if not not_submitted:
            return {"message": "所有学生已提交", "reminded": 0}

        self._push_notifications(
            not_submitted,
            "reminder",
            f"催交：{assignment.title}",
            f"病例：{assignment.case.name if assignment.case else ''}\n截止时间：{assignment.end_time.strftime('%m-%d %H:%M')}",
        )

        return {"message": f"已提醒 {len(not_submitted)} 位学生", "reminded": len(not_submitted)}

    def _notify_students(self, assignment: Assignment, case_name: str) -> None:
        from models.notification import Notification

        target_ids = None
        if assignment.student_ids:
            target_ids = assignment.student_ids
        else:
            target_ids = [
                row[0]
                for row in self.db.query(UserClass.user_id).filter(UserClass.class_id == assignment.class_id).all()
            ]

        if not target_ids:
            return

        body = f"病例：{case_name}" if case_name else ""
        now = datetime.now(UTC)
        for uid in target_ids:
            self.db.add(
                Notification(
                    user_id=uid,
                    type="assignment_new",
                    title=f"新作业：{assignment.title}",
                    body=body,
                    created_at=now,
                )
            )
        self.db.commit()

    def _push_notifications(self, user_ids: list[int], type_: str, title: str, body: str) -> None:
        from models.notification import Notification

        now = datetime.now(UTC)
        for uid in user_ids:
            self.db.add(Notification(user_id=uid, type=type_, title=title, body=body, created_at=now))
        self.db.commit()
