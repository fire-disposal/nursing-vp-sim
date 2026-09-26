import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from core.exceptions import AuthError, NotFoundError, ValidationError
from core.pagination import paginate
from core.statuses import ScoringStatus, TrainingStatus
from core.unit_of_work import unit_of_work
from models import (
    AUDIENCE_CLASS,
    AUDIENCE_MODES,
    AUDIENCE_SELECTED,
    Assignment,
    AssignmentRecipient,
    Case,
    Class,
    TrainingRecord,
    User,
)
from modules.admin.class_memberships import student_member_ids
from modules.assignments.progress import (
    attempt_from_record,
    count_attempts,
    pick_representative,
    progress_status,
)
from modules.cases.revisions import require_current_revision

log = logging.getLogger(__name__)


class _Unset:
    """哨兵：区分「请求未提供该字段」与「显式传 null（= 不限制）」。

    ``max_attempts=None`` 是有意义的值（不限制尝试次数），不能用 ``None`` 兼作
    「不修改」；本哨兵让 update 的调用方显式表达这两种意图。
    """

    __slots__ = ()

    def __repr__(self) -> str:
        return "UNSET"


UNSET = _Unset()


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
    max_attempts: int | None = None
    audience_mode: str = AUDIENCE_CLASS


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
    audience_mode: str
    recipient_ids: list[int]
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
        # 分母 = 受众快照行数（发布即固化，班级成员变动不再改动它）
        recipients_sub = (
            self.db.query(func.count(AssignmentRecipient.user_id))
            .filter(AssignmentRecipient.assignment_id == Assignment.id)
            .correlate(Assignment)
            .scalar_subquery()
        )

        q = self.db.query(
            Assignment,
            completed_sub.label("completed_count"),
            recipients_sub.label("student_count"),
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
            # 与 progress.effective_status 同一规则：关闭的作业不算进行中
            q = q.filter(Assignment.is_closed.is_(False), Assignment.end_time >= now)
        elif status == "ended":
            q = q.filter(or_(Assignment.is_closed.is_(True), Assignment.end_time < now))

        q = q.order_by(Assignment.created_at.desc())
        return paginate(q, offset, limit)

    def get_class_students(self, class_id: int) -> list[User]:
        """本班**学生**成员（``member_role='student'``）—— 学生名单/受众候选口径。"""
        ids = student_member_ids(self.db, class_id)
        if not ids:
            return []
        return self.db.query(User).filter(User.id.in_(ids)).order_by(User.id).all()

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

    # ── 受众（发布即固化的快照） ──

    def resolve_recipients(self, class_id: int, audience_mode: str, user_ids: list[int] | None) -> list[int]:
        """解析并校验受众名单（发布/改受众时调用一次，随后写入快照）。

        - ``class``：取该班当前 student membership 快照；
        - ``selected``：必须显式给出 ``user_ids``，且每个都必须**是本班学生成员**。
        """
        if audience_mode not in AUDIENCE_MODES:
            raise ValidationError(f"受众模式必须是 {'/'.join(AUDIENCE_MODES)}")
        if audience_mode == AUDIENCE_CLASS:
            return student_member_ids(self.db, class_id)

        wanted = list(dict.fromkeys(user_ids or []))
        if not wanted:
            raise ValidationError("指定受众时必须提供学生名单")
        member_ids = set(student_member_ids(self.db, class_id))
        invalid = [uid for uid in wanted if uid not in member_ids]
        if invalid:
            raise ValidationError(f"以下用户不是该班级的学生成员：{invalid}")
        return wanted

    def recipient_ids(self, assignment: Assignment) -> list[int]:
        """已发布作业的受众快照（唯一读口径）。"""
        rows = (
            self.db.query(AssignmentRecipient.user_id)
            .filter(AssignmentRecipient.assignment_id == assignment.id)
            .order_by(AssignmentRecipient.user_id)
            .all()
        )
        return [row[0] for row in rows]

    def _replace_recipients(self, assignment: Assignment, user_ids: list[int]) -> None:
        self.db.query(AssignmentRecipient).filter(AssignmentRecipient.assignment_id == assignment.id).delete(
            synchronize_session=False
        )
        for uid in user_ids:
            self.db.add(AssignmentRecipient(assignment_id=assignment.id, user_id=uid))
        self.db.flush()

    def _get_target_students(self, assignment: Assignment) -> list[User]:
        ids = self.recipient_ids(assignment)
        if not ids:
            return []
        return self.db.query(User).filter(User.id.in_(ids)).order_by(User.id).all()

    def _build_detail_view(self, assignment: Assignment) -> AssignmentDetailView:
        students_in_class = self._get_target_students(assignment)
        training_records = self.get_records_for_assignment(assignment.id)

        records_by_user: dict[int, list[TrainingRecord]] = {}
        for r in training_records:
            records_by_user.setdefault(r.user_id, []).append(r)

        student_items: list[AssignmentStudentItemView] = []
        for student in students_in_class:
            attempts = [attempt_from_record(r) for r in records_by_user.get(student.id, [])]
            representative = pick_representative(attempts)
            student_items.append(
                AssignmentStudentItemView(
                    user_id=student.id,
                    display_name=student.display_name,
                    student_id=student.student_id,
                    record_id=representative.record_id if representative else None,
                    status=progress_status(representative),
                    score_total=representative.score if representative else None,
                    scoring_status=representative.scoring_status if representative else None,
                    start_time=representative.start_time if representative else None,
                    end_time=representative.end_time if representative else None,
                    is_overdue=representative.is_overdue if representative else False,
                    attempt_count=count_attempts(a.status for a in attempts),
                )
            )

        # 分子只统计目标学生（与分母 student_items 同源），否则移出名单会算出 >100%
        target_ids = {s.id for s in students_in_class}
        completed_count = sum(
            1
            for uid in target_ids
            if any(r.status == TrainingStatus.COMPLETED.value for r in records_by_user.get(uid, []))
        )
        scored_count = sum(
            1
            for uid in target_ids
            if any(r.scoring_status == ScoringStatus.COMPLETED.value for r in records_by_user.get(uid, []))
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
            audience_mode=assignment.audience_mode,
            recipient_ids=sorted(s.user_id for s in student_items),
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
        audience_mode: str,
        recipient_user_ids: list[int] | None,
        start_time: datetime,
        end_time: datetime,
        teacher_id: int,
        max_attempts: int | None = 1,
    ) -> AssignmentDetailView:
        case = self.db.query(Case).filter(Case.id == case_id).first()
        if not case:
            raise NotFoundError("病例不存在")
        # 未发布病例不得被作业使用（docs/15 §六）；发布时同时钉住版本（列 NOT NULL），
        # 作业期间病例编辑出新 revision 也不影响本作业的学员
        revision = require_current_revision(self.db, case)
        cls = self.db.query(Class).filter(Class.id == class_id).first()
        if not cls:
            raise NotFoundError("班级不存在")

        if end_time <= start_time:
            raise ValidationError("截止时间必须晚于开始时间")

        # 发布时固化受众：此后班级成员变动不再改动这份快照（分母因此稳定）
        resolved = self.resolve_recipients(class_id, audience_mode, recipient_user_ids)

        with unit_of_work(self.db, conflict_detail="创建失败，请重试"):
            assignment = Assignment(
                case_id=case_id,
                case_revision_id=revision.id,
                class_id=class_id,
                teacher_id=teacher_id,
                title=title,
                description=description,
                features=features or {},
                behavior=behavior or {},
                audience_mode=audience_mode,
                start_time=start_time,
                end_time=end_time,
                max_attempts=max_attempts,
            )
            self.db.add(assignment)
            self.db.flush()
            for uid in resolved:
                self.db.add(AssignmentRecipient(assignment_id=assignment.id, user_id=uid))
        self.db.refresh(assignment)

        self._notify_students(assignment, case.name if case else "")
        log.info(
            f"Assignment created: id={assignment.id} title={assignment.title} "
            f"audience={audience_mode} recipients={len(resolved)}",
            extra={"user_id": teacher_id},
        )
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

        items = [
            AssignmentListView(
                id=r[0].id,
                title=r[0].title,
                case_name=r[0].case.name if r[0].case else "",
                class_name=r[0].class_.name if r[0].class_ else "",
                teacher_name=r[0].teacher.display_name if r[0].teacher else "",
                start_time=r[0].start_time,
                end_time=r[0].end_time,
                student_count=r[2] or 0,
                completed_count=r[1],
                created_at=r[0].created_at,
                is_closed=r[0].is_closed,
                max_attempts=r[0].max_attempts,
                audience_mode=r[0].audience_mode,
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
        audience_mode: str | None,
        recipient_user_ids: list[int] | None,
        start_time: datetime | None,
        end_time: datetime | None,
        is_closed: bool | None = None,
        max_attempts: int | None | _Unset = UNSET,
        skip_ownership: bool = False,
    ) -> AssignmentDetailView:
        assignment = self.get_with_relations(assignment_id)
        if not assignment:
            raise NotFoundError("练习发布不存在")
        if not skip_ownership and assignment.teacher_id != teacher_id:
            raise AuthError("无权修改", status_code=403)

        audience_touched = audience_mode is not None or recipient_user_ids is not None
        class_changed = class_id is not None and class_id != assignment.class_id

        if (case_id is not None or class_changed or audience_touched) and self.has_any_records(assignment_id):
            raise ValidationError("已有学生开始练习，不能更换病例、班级或受众")

        if case_id is not None:
            case = self.db.query(Case).filter(Case.id == case_id).first()
            if not case:
                raise NotFoundError("病例不存在")
            revision = require_current_revision(self.db, case)
            assignment.case_id = case_id
            assignment.case_revision_id = revision.id
        if class_changed:
            cls = self.db.query(Class).filter(Class.id == class_id).first()
            if not cls:
                raise NotFoundError("班级不存在")
            assignment.class_id = class_id
        if class_changed or audience_touched:
            # 受众重新固化：显式给了 audience 就按它解析；只换班则沿用原模式在新班上重新取快照
            mode = audience_mode if audience_mode is not None else assignment.audience_mode
            if mode not in AUDIENCE_MODES:
                raise ValidationError(f"受众模式必须是 {'/'.join(AUDIENCE_MODES)}")
            if audience_touched:
                resolved = self.resolve_recipients(
                    assignment.class_id, mode, recipient_user_ids if mode == AUDIENCE_SELECTED else None
                )
            elif mode == AUDIENCE_SELECTED:
                resolved = self.resolve_recipients(assignment.class_id, mode, self.recipient_ids(assignment))
            else:
                resolved = self.resolve_recipients(assignment.class_id, mode, None)
            assignment.audience_mode = mode
            self._replace_recipients(assignment, resolved)
        if title is not None:
            assignment.title = title
        if description is not None:
            assignment.description = description
        if features is not None:
            assignment.features = features
        if behavior is not None:
            assignment.behavior = behavior
        if start_time is not None:
            assignment.start_time = start_time
        if end_time is not None:
            assignment.end_time = end_time
        if is_closed is not None:
            assignment.is_closed = is_closed
        if not isinstance(max_attempts, _Unset):
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

        target_ids = self.recipient_ids(assignment)
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

        # 通知对象 = 发布时固化的受众快照（与本作业的分母同一份名单）
        target_ids = self.recipient_ids(assignment)

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
