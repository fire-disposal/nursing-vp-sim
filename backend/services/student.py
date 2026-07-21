"""Student assignment business logic."""

from datetime import UTC, datetime

from sqlalchemy.orm import Session, joinedload

from core.datetime_utils import ensure_utc
from models import Assignment, TrainingRecord, UserClass
from schemas import StudentAssignmentItem


class StudentService:
    def __init__(self, db: Session):
        self.db = db

    def list_assignments(self, user_id: int) -> list[StudentAssignmentItem]:
        user_class = self.db.query(UserClass).filter(UserClass.user_id == user_id).first()
        if not user_class or not user_class.class_id:
            return []

        now = datetime.now(UTC)
        assignments = (
            self.db.query(Assignment)
            .options(joinedload(Assignment.case))
            .filter(
                Assignment.class_id == user_class.class_id,
                Assignment.start_time <= now,
            )
            .order_by(Assignment.end_time.desc())
            .all()
        )

        assignment_ids = [a.id for a in assignments]
        records = (
            self.db.query(TrainingRecord)
            .options(joinedload(TrainingRecord.score))
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.assignment_id.in_(assignment_ids),
                TrainingRecord.is_test == False,
            )
            .all()
        )
        record_by_assignment = {r.assignment_id: r for r in records if r.assignment_id}

        items: list[StudentAssignmentItem] = []
        for a in assignments:
            if a.student_ids is not None and user_id not in a.student_ids:
                continue

            case_name = a.case.name if a.case else ""

            end_time = ensure_utc(a.end_time)
            if a.is_closed or now > end_time:
                items.append(
                    StudentAssignmentItem(
                        id=a.id,
                        title=a.title,
                        case_name=case_name,
                        start_time=a.start_time,
                        end_time=a.end_time,
                        status="closed",
                    )
                )
                continue

            record = record_by_assignment.get(a.id)
            if record:
                status = record.status
                if status != "completed" and record.is_overdue:
                    status = "overdue"
                items.append(
                    StudentAssignmentItem(
                        id=a.id,
                        title=a.title,
                        case_name=case_name,
                        start_time=a.start_time,
                        end_time=a.end_time,
                        status=status,
                        record_id=record.id,
                        score_total=record.score.total_score if record.score else None,
                        is_overdue=record.is_overdue,
                    )
                )
            else:
                status = "pending"
                items.append(
                    StudentAssignmentItem(
                        id=a.id,
                        title=a.title,
                        case_name=case_name,
                        start_time=a.start_time,
                        end_time=a.end_time,
                        status=status,
                    )
                )

        return items
