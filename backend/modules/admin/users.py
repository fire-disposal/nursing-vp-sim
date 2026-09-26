"""Admin user management — router + service."""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session, joinedload, selectinload

from core.config import BATCH_USER_LIMIT, MAX_EXPORT_ROWS
from core.deps import DbSession
from core.exceptions import AuthError, NotFoundError, ValidationError
from core.security import hash_password, load_role_permissions, require_permission
from core.unit_of_work import unit_of_work
from infra.exporter import ColumnDef, export_response
from models import (
    MEMBER_ROLE_STUDENT,
    MEMBER_ROLE_TEACHER,
    Class,
    ClassMembership,
    Role,
    Score,
    TrainingRecord,
    User,
)
from modules.admin.class_memberships import upsert_members
from modules.training.scoring.grade_scope import grade_conditions, grade_expr
from schemas import (
    AdminStats,
    BatchCreateResult,
    BatchUserItem,
    BulkAssignClassRequest,
    BulkAssignClassResult,
    DeleteResponse,
    PaginatedResponse,
    StudentDailyStat,
    StudentDetail,
    StudentRecentRecord,
    UserBrief,
    UserMembershipItem,
    UserMembershipUpdate,
    UserUpdateRequest,
)

log = logging.getLogger(__name__)

_DETAIL_RECENT_LIMIT = 20
_DETAIL_DAYS = 30
# core.roles.SYSTEM_PERMISSIONS 的键名：系统内置最高权限角色的名字
_SUPER_ADMIN_ROLE = "super_admin"
# ClassMembership.member_role 的取值白名单：该列是自由字符串，
# 不校验就能写入任意值（数据质量洞，2026-09-26 审计 RB-9）
_MEMBER_ROLES = frozenset({MEMBER_ROLE_STUDENT, MEMBER_ROLE_TEACHER})


@dataclass
class MembershipView:
    """用户所属班级（单用户多班级：列表/行内展示与筛选同源，都是这一集合）。"""

    class_id: int
    class_name: str
    cohort_label: str
    member_role: str
    joined_at: datetime


@dataclass
class UserBriefView:
    id: int
    username: str
    role: str
    role_display_name: str
    display_name: str
    student_id: str | None
    gender: str | None
    avatar: str | None
    created_at: datetime
    memberships: list[MembershipView]
    #: 账号是否启用（停用 = 软删：不能登录，但保留全部训练数据）
    is_active: bool


@dataclass
class PaginatedUsersView:
    items: list[UserBriefView]
    total: int
    offset: int
    limit: int


@dataclass
class RecordBriefView:
    id: int
    case_id: int
    case_name: str
    user_id: int
    user_display_name: str
    user_student_id: str | None
    status: str
    scoring_status: str | None
    scoring_error: str | None
    start_time: datetime
    end_time: datetime | None
    score_total: float | None
    assignment_id: str | None = None
    assignment_title: str | None = None


@dataclass
class StudentDetailView:
    id: int
    username: str
    role: str
    display_name: str
    student_id: str | None
    created_at: datetime
    total_sessions: int
    total_minutes: int
    avg_score: float | None
    recent_records: list[RecordBriefView]
    daily: list[dict]


@dataclass(slots=True)
class UserFilters:
    """用户列表 / 导出的筛选（唯一事实来源）。

    以 `Depends()` 注入，两个端点拿到同一份参数定义：
    后端不会各自声明、也不会出现"新增筛选只加了一边"的漂移。
    """

    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None
    role: Annotated[str | None, Query(description="角色筛选 student/teacher")] = None
    class_id: Annotated[int | None, Query()] = None
    cohort_label: Annotated[str | None, Query(description="届/年级标签精确过滤")] = None
    include_inactive: Annotated[bool, Query(description="是否包含已停用账号（默认隐藏）")] = False


class UserService:
    def __init__(self, db: Session):
        self.db = db

    def _brief(self, user: User) -> UserBriefView:
        return UserBriefView(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            role_display_name=user.role.display_name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
            gender=user.gender,
            avatar=user.avatar,
            created_at=user.created_at,
            memberships=self.membership_views(user),
            is_active=user.is_active,
        )

    @staticmethod
    def membership_views(user: User) -> list[MembershipView]:
        """用户全部成员关系（多班级）。``class_id`` 悬空的遗留行不展示。"""
        views: list[MembershipView] = []
        for m in user.memberships:
            class_id = m.class_id
            class_ = m.class_
            # 悬空遗留行（class_id 可空 + ON DELETE SET NULL）不展示
            if class_id is None or class_ is None:
                continue
            views.append(
                MembershipView(
                    class_id=class_id,
                    class_name=class_.name,
                    cohort_label=class_.cohort_label,
                    member_role=m.member_role,
                    joined_at=m.joined_at,
                )
            )
        views.sort(key=lambda v: (v.cohort_label, v.class_name, v.class_id))
        return views

    def list_all(self, filters: UserFilters, *, offset: int, limit: int) -> PaginatedUsersView:
        """用户列表与导出的**唯一入口**：筛选只认 `UserFilters`，两端点不可能各筛各的。"""
        total, users = self.list_filtered(filters, offset=offset, limit=limit)
        return PaginatedUsersView(
            items=[self._brief(u) for u in users],
            total=total,
            offset=offset,
            limit=limit,
        )

    def _grantable(self, current_user: User) -> set[str]:
        """操作者自身角色拥有的权限 = 其可授予/可支配的上限（与 roles.py 同一套反越权口径）。"""
        return set(load_role_permissions(self.db, current_user.role_id))

    def _assert_role_within_scope(self, current_user: User, role_obj: Role, *, action: str) -> None:
        exceeded = sorted(set(load_role_permissions(self.db, role_obj.id)) - self._grantable(current_user))
        if exceeded:
            raise AuthError(
                f"无权{action}「{role_obj.display_name}」：目标角色包含你自身没有的权限 {exceeded}",
                status_code=403,
            )

    def _assert_not_last_active_super_admin(self, user: User, *, action: str) -> None:
        """禁止让系统失去最后一个**启用中**的 super_admin（2026-09-26 分析 RB-1）。

        `seed.py` 在角色表非空时不再补种管理员，因此一旦最后一个超管被停用/删除，
        改角色与改权限的能力只能直连数据库恢复 —— 这是合法的自毁路径。
        """
        if user.role is None or user.role.name != _SUPER_ADMIN_ROLE or not user.is_active:
            return
        remaining = (
            self.db.query(sa_func.count(User.id))
            .join(Role, Role.id == User.role_id)
            .filter(
                Role.name == _SUPER_ADMIN_ROLE,
                User.is_active.is_(True),
                User.id != user.id,
            )
            .scalar()
        )
        if not remaining:
            raise ValidationError(f"不能{action}最后一个启用中的超级管理员：之后将无人能修改角色与权限")

    def update(self, user_id: int, req: UserUpdateRequest, current_user: User) -> UserBriefView:
        user = self.get_with_relations(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        with unit_of_work(self.db):
            if req.display_name is not None:
                user.display_name = req.display_name
            if req.student_id is not None:
                user.student_id = req.student_id or None
            if req.role is not None:
                if current_user.id == user_id:
                    raise ValidationError("不能修改自己的角色")
                role_obj = self.get_role_by_name(req.role)
                if not role_obj:
                    raise ValidationError("角色不存在")
                # 反越权：只能授予自身权限集合内的角色。admin 没有 role_manage/api_manage，
                # 因此无法把任何账号提为 super_admin（否则等于绕过整个权限表）。
                self._assert_role_within_scope(current_user, role_obj, action="授予角色")
                user.role_id = role_obj.id
            if req.password is not None and req.password:
                if len(req.password) < 6:
                    raise ValidationError("密码长度不能少于6位")
                # 反越权：不能重置权限高于自己的账号的密码（否则等于接管该账号）。
                if user.role is not None and current_user.id != user_id:
                    self._assert_role_within_scope(current_user, user.role, action="重置密码")
                user.password_hash = hash_password(req.password)

            if req.is_active is not None:
                # 停用是软删：保留训练数据，只切断登录（见 auth.service 的 is_active 校验）
                if req.is_active != user.is_active:
                    if current_user.id == user_id and not req.is_active:
                        raise ValidationError("不能停用自己的账号")
                    if current_user.id != user_id and user.role is not None:
                        # 与"授予角色/重置密码"同口径：不能停用/启用权限高于自己的账号
                        # （此前只挡了"不能停用自己"，任何持 user_manage 的角色都能停用超管）
                        self._assert_role_within_scope(
                            current_user,
                            user.role,
                            action="停用账号" if not req.is_active else "启用账号",
                        )
                    if not req.is_active:
                        self._assert_not_last_active_super_admin(user, action="停用")
                user.is_active = req.is_active
            if req.gender is not None:
                user.gender = req.gender or None
            if req.avatar is not None:
                user.avatar = req.avatar or None
            if req.memberships is not None:
                # 单用户多班级：请求携带 memberships = 全量替换该用户的成员关系集合
                # （不再有「只改第一条」或 class_id=0 清除哨兵）。
                self._replace_memberships(user, req.memberships)
        self.db.refresh(user)
        return self._brief(user)

    @staticmethod
    def _assert_member_role(member_role: str) -> None:
        if member_role not in _MEMBER_ROLES:
            raise ValidationError(f"无效的成员角色：{member_role}")

    def _replace_memberships(self, user: User, desired_items: list[UserMembershipUpdate]) -> None:
        desired: dict[int, str] = {}
        for item in desired_items:
            class_id = item.class_id
            if class_id in desired:
                raise ValidationError(f"班级 {class_id} 在成员列表中重复")
            cls = self.get_class(class_id)
            if not cls:
                raise ValidationError(f"班级 {class_id} 不存在")
            self._assert_member_role(item.member_role)
            desired[class_id] = item.member_role

        current = {m.class_id: m for m in user.memberships if m.class_id is not None}
        # 悬空行（class_id IS NULL）顺手清掉：它们不代表任何班级
        for m in user.memberships:
            if m.class_id is None:
                self.db.delete(m)
        for class_id, membership in current.items():
            if class_id not in desired:
                self.db.delete(membership)
        for class_id, member_role in desired.items():
            membership = current.get(class_id)
            if membership is None:
                self.db.add(ClassMembership(user_id=user.id, class_id=class_id, member_role=member_role))
            else:
                membership.member_role = member_role
        self.db.flush()

    def delete(self, user_id: int, current_user: User) -> str:
        if user_id == current_user.id:
            raise ValidationError("不能删除自己")
        user = self.db.get(User, user_id)
        if not user:
            raise NotFoundError("用户不存在")
        if user.role is not None:
            # 超级管理员账号**不可删除**（政策）：系统内如需收回权限用"停用"，
            # 删除只留给普通账号。此前没有任何显式守卫，只是恰好被 llm/voice/qa 的外键
            # 或 assignment.teacher_id RESTRICT 撞成 500 —— 不可预期且理由误导。
            if user.role.name == _SUPER_ADMIN_ROLE:
                raise ValidationError("超级管理员账号不可删除：如需收回权限请改用停用（数据保留、可恢复）")
            # 删除同样受角色范围约束（此前完全无检查）
            self._assert_role_within_scope(current_user, user.role, action="删除账号")
        record_count = self.record_count(user_id)
        if record_count > 0:
            raise ValidationError(f"该用户有 {record_count} 条训练记录，无法删除。请先删除相关训练记录。")
        target_name = user.username
        with unit_of_work(self.db):
            self.db.delete(user)
            self.db.flush()
        return target_name

    def get_detail(self, user_id: int) -> StudentDetailView:
        user = self.get_with_role(user_id)
        if not user:
            raise NotFoundError("用户不存在")
        since = datetime.now(UTC) - timedelta(days=_DETAIL_DAYS)

        stats = self.training_summary(user_id)
        total_sessions = int(stats.total_sessions or 0) if stats else 0
        total_minutes = round(float(stats.total_minutes or 0)) if stats else 0
        # INV-5/INV-3：avg_score 的 0 是聚合默认值，只有存在有效成绩行时才可当成绩展示，
        # 否则「教师复核 0 分」与「整门没有有效成绩」会被混为一谈。
        graded_count = int(stats.graded_count or 0) if stats else 0
        avg_score = round(float(stats.avg_score), 1) if graded_count > 0 else None

        daily = [
            {
                "date": str(r.d),
                "sessions": r.sessions,
                "minutes": round(float(r.minutes or 0), 1),
                "avg_score": round(float(r.avg_score), 1) if r.avg_score is not None else None,
            }
            for r in self.daily_stats(user_id, since)
        ]

        recent_records = [
            RecordBriefView(
                id=r.id,
                case_id=r.case_id,
                case_name=r.case.name if r.case else "",
                user_id=user.id,
                user_display_name=user.display_name,
                user_student_id=user.student_id,
                status=r.status,
                scoring_status=r.scoring_status,
                scoring_error=r.scoring_error,
                start_time=r.start_time,
                end_time=r.end_time,
                score_total=r.score.effective_total if r.score else None,
                assignment_id=r.assignment_id,
                assignment_title=r.assignment.title if r.assignment else None,
            )
            for r in self.recent_records(user_id, _DETAIL_RECENT_LIMIT)
        ]

        return StudentDetailView(
            id=user.id,
            username=user.username,
            role=user.role.name if user.role else "",
            display_name=user.display_name,
            student_id=user.student_id,
            created_at=user.created_at,
            total_sessions=total_sessions,
            total_minutes=total_minutes,
            avg_score=avg_score,
            recent_records=recent_records,
            daily=daily,
        )

    def get_stats(self) -> AdminStats:
        student_role = self.db.query(Role).filter(Role.name == "student").first()
        total_students = 0
        if student_role:
            total_students = self.db.query(User).filter(User.role_id == student_role.id).count()

        base = self.db.query(TrainingRecord).join(User).filter(TrainingRecord.is_test == False)
        total_records = base.count()
        completed_records = base.filter(TrainingRecord.status == "completed").count()
        avg_score = (
            self.db.query(sa_func.avg(grade_expr()))
            .join(TrainingRecord, Score.record_id == TrainingRecord.id)
            .join(User, TrainingRecord.user_id == User.id)
            # INV-3：纯成绩聚合（无父行可保留），兜底分直接过滤
            .filter(TrainingRecord.is_test == False, *grade_conditions())
            .scalar()
        )
        avg_duration = (
            self.db.query(
                sa_func.avg(sa_func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60)
            )
            .join(User, TrainingRecord.user_id == User.id)
            .filter(
                TrainingRecord.status == "completed",
                TrainingRecord.end_time.isnot(None),
                TrainingRecord.start_time.isnot(None),
                TrainingRecord.is_test == False,
            )
            .scalar()
        )
        today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
        today_records = (
            self.db.query(sa_func.count(TrainingRecord.id))
            .join(User, TrainingRecord.user_id == User.id)
            .filter(TrainingRecord.start_time >= today_start, TrainingRecord.is_test == False)
            .scalar()
            or 0
        )

        return AdminStats(
            total_students=total_students,
            total_records=total_records,
            completed_records=completed_records,
            average_score=round(float(avg_score), 1) if avg_score is not None else None,
            avg_duration_min=round(float(avg_duration), 1) if avg_duration is not None else None,
            today_records=today_records,
        )

    def batch_create(self, users_data: list[dict]) -> BatchCreateResult:
        if len(users_data) > BATCH_USER_LIMIT:
            raise ValidationError(f"单次最多导入 {BATCH_USER_LIMIT} 个用户，当前 {len(users_data)} 个")

        created = 0
        skipped = 0
        errors: list[str] = []
        # (cohort_label, class_name) → class_id：同名班级跨 cohort 时按 cohort 消歧
        resolved: dict[tuple[str, str], int] = {}
        class_by_id: dict[int, int] = {}

        for i, u in enumerate(users_data, 1):
            username = (u.get("username") or "").strip()
            password = u.get("password") or ""
            display_name = (u.get("display_name") or "").strip()

            if not username or not password or not display_name:
                errors.append(f"第{i}行跳过: 用户名/密码/姓名不能为空")
                skipped += 1
                continue
            if len(password) < 6:
                errors.append(f"第{i}行跳过 {username}: 密码长度不能少于6位")
                skipped += 1
                continue
            existing = self.db.query(User).filter(User.username == username).first()
            if existing:
                errors.append(f"第{i}行跳过 {username}: 用户名已存在")
                skipped += 1
                continue
            role_name = u.get("role", "")
            if role_name != "student":
                errors.append(f"第{i}行跳过 {username}: 批量导入仅支持学生角色")
                skipped += 1
                continue
            role_obj = self.db.query(Role).filter(Role.name == role_name).first()
            if not role_obj:
                errors.append(f"第{i}行跳过 {username}: 角色 {role_name} 不存在")
                skipped += 1
                continue

            class_id, class_error = self._resolve_import_class(u, resolved, class_by_id)
            if class_error:
                errors.append(f"第{i}行跳过 {username}: {class_error}")
                skipped += 1
                continue

            user = User(
                username=username,
                password_hash=hash_password(password),
                display_name=display_name,
                role_id=role_obj.id,
                student_id=u.get("student_id") or None,
            )
            self.db.add(user)
            self.db.flush()
            if class_id:
                self.db.add(ClassMembership(user_id=user.id, class_id=class_id, member_role=MEMBER_ROLE_STUDENT))
            created += 1
        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            log.exception("batch create commit failed")
            raise
        return BatchCreateResult(created=created, skipped=skipped, errors=errors)

    def _resolve_import_class(
        self,
        row: dict,
        resolved: dict[tuple[str, str], int],
        class_by_id: dict[int, int],
    ) -> tuple[int | None, str | None]:
        """导入行的班级解析：``class_id`` > (cohort_label, class_name) 精确匹配 > 新建。

        班级名在同 cohort 内重复，或跨 cohort 有多条同名而请求又未给出 cohort_label 时，
        报错而不是静默挑一个。
        """
        raw_id = row.get("class_id")
        if raw_id:
            if raw_id not in class_by_id:
                if not self.get_class(raw_id):
                    return None, f"班级ID {raw_id} 不存在"
                class_by_id[raw_id] = raw_id
            return raw_id, None

        name = (row.get("class_name") or "").strip()
        if not name:
            return None, None
        cohort_label = (row.get("cohort_label") or "").strip()
        key = (cohort_label, name)
        if key in resolved:
            return resolved[key], None

        q = self.db.query(Class).filter(Class.name == name)
        if cohort_label:
            q = q.filter(Class.cohort_label == cohort_label)
        matches = q.limit(2).all()
        if len(matches) > 1:
            return None, f"班级名称「{name}」在多个 cohort 下存在，请补充 cohort_label 或 class_id"
        if matches:
            resolved[key] = matches[0].id
            return matches[0].id, None

        cls = Class(name=name, cohort_label=cohort_label)
        self.db.add(cls)
        self.db.flush()
        resolved[key] = cls.id
        return cls.id, None

    def bulk_assign_class(
        self, user_ids: list[int], class_id: int, member_role: str = MEMBER_ROLE_STUDENT
    ) -> BulkAssignClassResult:
        # 契约层（UserMembershipUpdate）是 Literal[student|teacher]，但批量入口收的是裸 str：
        # 不在此校验就能把任意字符串写进 ClassMembership.member_role（2026-09-26 审计 RB-9）。
        self._assert_member_role(member_role)
        target_class = self.get_class(class_id)
        if not target_class:
            raise NotFoundError("班级不存在")

        with unit_of_work(self.db, conflict_detail="操作冲突，请重试"):
            added, updated, missing = upsert_members(self.db, class_id, user_ids, member_role=member_role)

        return BulkAssignClassResult(
            assigned=added,
            updated=updated,
            skipped=len(missing),
            errors=[f"用户 {uid} 不存在" for uid in missing],
        )

    def get_by_username(self, username: str) -> User | None:
        return self.db.query(User).filter(User.username == username).first()

    def get_with_relations(self, user_id: int) -> User | None:
        return (
            self.db.query(User)
            .options(
                joinedload(User.role),
                selectinload(User.memberships).joinedload(ClassMembership.class_),
            )
            .filter(User.id == user_id)
            .first()
        )

    def get_with_role(self, user_id: int) -> User | None:
        return self.db.query(User).options(joinedload(User.role)).filter(User.id == user_id).first()

    def get_role_by_name(self, name: str) -> Role | None:
        return self.db.query(Role).filter(Role.name == name).first()

    def get_class(self, class_id: int) -> Class | None:
        return self.db.query(Class).filter(Class.id == class_id).first()

    def create(self, **kwargs) -> User:
        user = User(**kwargs)
        self.db.add(user)
        self.db.flush()
        return user

    def _filtered_query(self, filters: UserFilters):
        """把筛选 DTO 翻成 SQL：筛选条件只在这里出现一次。"""
        q = self.db.query(User)
        if not filters.include_inactive:
            q = q.filter(User.is_active.is_(True))
        # 成员语义：筛的是「是否属于该班/该 cohort」，展示的是 complete 的 memberships 集合，
        # 因此不存在「筛进 A 班却显示 B 班」的口径错位。
        if filters.class_id is not None:
            q = q.filter(User.memberships.any(ClassMembership.class_id == filters.class_id))
        elif filters.cohort_label is not None:
            q = q.filter(User.memberships.any(ClassMembership.class_.has(Class.cohort_label == filters.cohort_label)))
        if filters.search:
            term = f"%{filters.search}%"
            q = q.filter(
                or_(
                    User.username.ilike(term),
                    User.display_name.ilike(term),
                    User.student_id.ilike(term),
                )
            )
        if filters.role:
            role_obj = self.get_role_by_name(filters.role)
            q = q.filter(User.role_id == (role_obj.id if role_obj else -1))
        return q

    def list_filtered(self, filters: UserFilters, *, offset: int, limit: int) -> tuple[int, list[User]]:
        q = self._filtered_query(filters)
        total = q.count()
        users = (
            q.options(
                joinedload(User.role),
                selectinload(User.memberships).joinedload(ClassMembership.class_),
            )
            .order_by(User.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return total, users

    def record_count(self, user_id: int) -> int:
        return self.db.query(sa_func.count(TrainingRecord.id)).filter(TrainingRecord.user_id == user_id).scalar() or 0

    def training_summary(self, user_id: int):
        return (
            self.db.query(
                sa_func.count(TrainingRecord.id).label("total_sessions"),
                sa_func.coalesce(
                    sa_func.sum(sa_func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                    0,
                ).label("total_minutes"),
                sa_func.coalesce(sa_func.avg(grade_expr()), 0).label("avg_score"),
                sa_func.count(grade_expr()).label("graded_count"),
            )
            # INV-3：兜底分不进平均分，但该学生的场次/时长照旧统计
            .outerjoin(Score, and_(Score.record_id == TrainingRecord.id, *grade_conditions()))
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == "completed",
            )
            .first()
        )

    def daily_stats(self, user_id: int, since: datetime):
        return (
            self.db.query(
                sa_func.date(TrainingRecord.start_time).label("d"),
                sa_func.count().label("sessions"),
                sa_func.sum(sa_func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label(
                    "minutes"
                ),
                sa_func.avg(grade_expr()).label("avg_score"),
            )
            # INV-3：兜底分不进平均分，但当日场次/时长照旧统计
            .outerjoin(Score, and_(Score.record_id == TrainingRecord.id, *grade_conditions()))
            .filter(
                TrainingRecord.user_id == user_id,
                TrainingRecord.status == "completed",
                TrainingRecord.start_time >= since,
            )
            .group_by(sa_func.date(TrainingRecord.start_time))
            .order_by("d")
            .all()
        )

    def recent_records(self, user_id: int, limit: int) -> list[TrainingRecord]:
        return (
            self.db.query(TrainingRecord)
            .options(
                joinedload(TrainingRecord.case),
                joinedload(TrainingRecord.score),
                joinedload(TrainingRecord.assignment),
            )
            .filter(TrainingRecord.user_id == user_id)
            .order_by(TrainingRecord.start_time.desc())
            .limit(limit)
            .all()
        )


router = APIRouter()

_Manager = Annotated[User, Depends(require_permission("user_manage"))]


def _brief(v: UserBriefView) -> UserBrief:
    return UserBrief(
        id=v.id,
        username=v.username,
        role=v.role,
        role_display_name=v.role_display_name,
        display_name=v.display_name,
        student_id=v.student_id,
        gender=v.gender,
        avatar=v.avatar,
        created_at=v.created_at,
        memberships=[
            UserMembershipItem(
                class_id=m.class_id,
                class_name=m.class_name,
                cohort_label=m.cohort_label,
                member_role=m.member_role,
                joined_at=m.joined_at,
            )
            for m in v.memberships
        ],
    )


def _detail(v: StudentDetailView) -> StudentDetail:
    return StudentDetail(
        id=v.id,
        username=v.username,
        role=v.role,
        display_name=v.display_name,
        student_id=v.student_id,
        created_at=v.created_at,
        total_sessions=v.total_sessions,
        total_minutes=v.total_minutes,
        avg_score=v.avg_score,
        recent_records=[
            StudentRecentRecord(
                id=r.id,
                case_id=r.case_id,
                case_name=r.case_name,
                user_id=v.id,
                user_display_name=r.user_display_name,
                user_student_id=r.user_student_id,
                status=r.status,
                scoring_status=r.scoring_status,
                scoring_error=r.scoring_error,
                start_time=r.start_time,
                end_time=r.end_time,
                score_total=r.score_total,
                assignment_id=r.assignment_id,
                assignment_title=r.assignment_title,
            )
            for r in v.recent_records
        ],
        daily=[StudentDailyStat(**d) for d in v.daily],
    )


@router.get("/users", response_model=PaginatedResponse[UserBrief])
def list_users(
    current_user: _Manager,
    db: DbSession,
    filters: Annotated[UserFilters, Depends()],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    view = UserService(db).list_all(filters, offset=offset, limit=limit)
    return PaginatedResponse(
        items=[_brief(v) for v in view.items], total=view.total, offset=view.offset, limit=view.limit
    )


@router.post("/export")
def export_users(
    current_user: _Manager,
    db: DbSession,
    filters: Annotated[UserFilters, Depends()],
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    # 与列表同一个筛选 DTO、同一个服务入口；多取一条以便 export_response 统一判超限
    _total, users = UserService(db).list_filtered(filters, offset=0, limit=MAX_EXPORT_ROWS + 1)
    columns = [
        ColumnDef("用户名", key="username"),
        ColumnDef("姓名", key="display_name"),
        ColumnDef("学号", key="student_id"),
        ColumnDef("角色", value=lambda u: u.role.name if u.role else ""),
        ColumnDef("状态", value=lambda u: "启用" if u.is_active else "已停用"),
    ]
    return export_response(users, columns, "用户列表", "用户列表", format)


@router.put("/users/{user_id}", response_model=UserBrief)
def update_user(user_id: int, req: UserUpdateRequest, current_user: _Manager, db: DbSession):
    view = UserService(db).update(user_id, req, current_user=current_user)
    log.info(
        f"用户更新: target_id={user_id} target_name={view.username}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return _brief(view)


@router.get("/users/{user_id}", response_model=StudentDetail)
def get_user_detail(user_id: int, current_user: _Manager, db: DbSession):
    return _detail(UserService(db).get_detail(user_id))


@router.delete("/users/{user_id}", response_model=DeleteResponse)
def delete_user(user_id: int, current_user: _Manager, db: DbSession):
    target_name = UserService(db).delete(user_id, current_user)
    log.info(
        f"用户删除: target_id={user_id} target_name={target_name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "用户已删除"}


@router.post("/users/batch", response_model=BatchCreateResult)
def batch_create_users(users: list[BatchUserItem], current_user: _Manager, db: DbSession):
    result = UserService(db).batch_create([u.model_dump() for u in users])
    log.info(
        f"批量导入: created={result.created} skipped={result.skipped}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return result


@router.post("/users/bulk-assign-class", response_model=BulkAssignClassResult)
def bulk_assign_class(req: BulkAssignClassRequest, current_user: _Manager, db: DbSession):
    result = UserService(db).bulk_assign_class(req.user_ids, req.class_id, req.member_role)
    log.info(
        f"批量分配班级: assigned={result.assigned} updated={result.updated} "
        f"skipped={result.skipped} class_id={req.class_id} role={req.member_role}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return result


@router.get("/stats", response_model=AdminStats)
def get_stats(current_user: Annotated[User, Depends(require_permission("stats_view"))], db: DbSession):
    return UserService(db).get_stats()
