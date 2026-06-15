import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from core.database import get_db
from core.security import hash_password, require_permission
from models import Class, Role, Score, TrainingRecord, User, UserClass
from schemas import (
    AdminStats,
    BatchCreateResult,
    BatchUserItem,
    DeleteResponse,
    PaginatedResponse,
    StudentDetail,
    TrainingRecordBrief,
    UserBrief,
    UserUpdateRequest,
)

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/users", response_model=PaginatedResponse[UserBrief])
def list_users(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None,
    role: Annotated[str | None, Query(description="角色筛选 student/teacher")] = None,
    class_id: Annotated[int | None, Query()] = None,
    grade_id: Annotated[int | None, Query()] = None,
    current_user: User = Depends(require_permission("user_manage")),
    db: Session = Depends(get_db),
):
    q = db.query(User).filter(User.school_id == current_user.school_id)
    if class_id is not None or grade_id is not None:
        q = q.join(UserClass, UserClass.user_id == User.id, isouter=True)
        if class_id is not None:
            q = q.filter(UserClass.class_id == class_id)
        elif grade_id is not None:
            q = q.join(Class, Class.id == UserClass.class_id)
            q = q.filter(Class.grade_id == grade_id)
    if search:
        search_term = f"%{search}%"
        q = q.filter(
            or_(
                User.username.ilike(search_term),
                User.display_name.ilike(search_term),
                User.student_id.ilike(search_term),
            )
        )
    if role:
        role_obj = db.query(Role).filter(Role.name == role, Role.school_id == current_user.school_id).first()
        q = q.filter(User.role_id == role_obj.id) if role_obj else q.filter(User.role_id == -1)
    total = q.count()
    users = (
        q.options(
            joinedload(User.role), joinedload(User.user_classes).joinedload(UserClass.class_).joinedload(Class.grade)
        )
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    items = []
    for u in users:
        ucs = u.user_classes
        uc = ucs[0] if ucs else None
        cls = uc.class_ if uc else None
        items.append(
            UserBrief(
                id=u.id,
                username=u.username,
                role=u.role.name if u.role else "",
                role_display_name=u.role.display_name if u.role else "",
                display_name=u.display_name,
                student_id=u.student_id,
                gender=u.gender,
                avatar=u.avatar,
                created_at=u.created_at,
                class_id=cls.id if cls else None,
                class_name=cls.name if cls else None,
                grade_name=cls.grade.name if (cls and cls.grade) else None,
            )
        )
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.put("/users/{user_id}", response_model=UserBrief)
def update_user(
    user_id: int,
    req: UserUpdateRequest,
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    user = (
        db.query(User)
        .options(
            joinedload(User.role), joinedload(User.user_classes).joinedload(UserClass.class_).joinedload(Class.grade)
        )
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if current_user.school_id is not None and user.school_id != current_user.school_id:
        raise HTTPException(status_code=404, detail="用户不存在")

    if req.display_name is not None:
        user.display_name = req.display_name
    if req.student_id is not None:
        user.student_id = req.student_id or None
    if req.role is not None:
        role_obj = db.query(Role).filter(Role.name == req.role, Role.school_id == current_user.school_id).first()
        if not role_obj:
            raise HTTPException(status_code=400, detail="角色不存在")
        user.role_id = role_obj.id
    if req.password is not None and req.password:
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="密码长度不能少于6位")
        user.password_hash = hash_password(req.password)
    if req.gender is not None:
        user.gender = req.gender or None
    if req.avatar is not None:
        user.avatar = req.avatar or None

    if req.class_id is not None:
        if req.class_id != 0:
            cls = db.query(Class).filter(Class.id == req.class_id).first()
            if not cls:
                raise HTTPException(status_code=400, detail="班级不存在")
        uc = db.query(UserClass).filter(UserClass.user_id == user_id).first()
        if req.class_id == 0:
            if uc:
                db.delete(uc)
        else:
            if not uc:
                uc = UserClass(user_id=user_id)
                db.add(uc)
            uc.class_id = req.class_id

    db.commit()
    db.refresh(user)

    ucs = user.user_classes if user else []
    uc = ucs[0] if ucs else None
    cls = uc.class_ if uc else None

    log.info(
        f"用户更新: target_id={user_id} target_name={user.username}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return UserBrief(
        id=user.id,
        username=user.username,
        role=user.role.name if user.role else "",
        role_display_name=user.role.display_name if user.role else "",
        display_name=user.display_name,
        student_id=user.student_id,
        gender=user.gender,
        avatar=user.avatar,
        created_at=user.created_at,
        class_id=cls.id if cls else None,
        class_name=cls.name if cls else None,
        grade_name=cls.grade.name if (cls and cls.grade) else None,
    )


@router.get("/users/{user_id}", response_model=StudentDetail)
def get_user_detail(
    user_id: int,
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    student_role = db.query(Role).filter(Role.name == "student", Role.school_id == current_user.school_id).first()
    if not student_role:
        raise HTTPException(status_code=404, detail="学生角色不存在")
    user = (
        db.query(User)
        .options(joinedload(User.role))
        .filter(User.id == user_id, User.role_id == student_role.id, User.school_id == current_user.school_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在或不是学生")

    now = datetime.now(UTC)
    since = now - timedelta(days=30)

    stats = (
        db.query(
            func.count(TrainingRecord.id).label("total_sessions"),
            func.coalesce(
                func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60),
                0,
            ).label("total_minutes"),
            func.coalesce(func.avg(Score.total_score), 0).label("avg_score"),
        )
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(
            TrainingRecord.user_id == user_id,
            TrainingRecord.status == "completed",
        )
        .first()
    )
    total_sessions = int(stats.total_sessions or 0) if stats else 0
    total_minutes = round(float(stats.total_minutes or 0)) if stats else 0
    avg_score = round(float(stats.avg_score), 1) if stats and stats.avg_score else None

    daily_rows = (
        db.query(
            func.date(TrainingRecord.start_time).label("d"),
            func.count().label("sessions"),
            func.sum(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60).label("minutes"),
            func.avg(Score.total_score).label("avg_score"),
        )
        .outerjoin(Score, Score.record_id == TrainingRecord.id)
        .filter(
            TrainingRecord.user_id == user_id,
            TrainingRecord.status == "completed",
            TrainingRecord.start_time >= since,
        )
        .group_by(func.date(TrainingRecord.start_time))
        .order_by("d")
        .all()
    )

    daily = [
        {
            "date": str(r.d),
            "sessions": r.sessions,
            "minutes": round(float(r.minutes or 0), 1),
            "avg_score": round(float(r.avg_score), 1) if r.avg_score is not None else None,
        }
        for r in daily_rows
    ]

    recent = (
        db.query(TrainingRecord)
        .options(
            joinedload(TrainingRecord.case),
            joinedload(TrainingRecord.score),
        )
        .filter(
            TrainingRecord.user_id == user_id,
        )
        .order_by(TrainingRecord.start_time.desc())
        .limit(20)
        .all()
    )

    recent_records = [
        TrainingRecordBrief(
            id=r.id,
            case_id=r.case_id,
            case_name=r.case.name if r.case else "",
            user_display_name=user.display_name,
            user_student_id=user.student_id,
            status=r.status,
            scoring_status=r.scoring_status,
            scoring_error=r.scoring_error,
            start_time=r.start_time,
            end_time=r.end_time,
            score_total=r.score.total_score if r.score else None,
        )
        for r in recent
    ]

    return StudentDetail(
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


@router.delete("/users/{user_id}", response_model=DeleteResponse)
def delete_user(
    user_id: int,
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if current_user.school_id is not None and user.school_id != current_user.school_id:
        raise HTTPException(status_code=404, detail="用户不存在")

    record_count = db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.user_id == user_id).scalar() or 0
    if record_count > 0:
        raise HTTPException(
            status_code=400,
            detail=f"该用户有 {record_count} 条训练记录，无法删除。请先删除相关训练记录。",
        )

    target_name = user.username
    db.delete(user)
    db.commit()
    log.info(
        f"用户删除: target_id={user_id} target_name={target_name}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "用户已删除"}


@router.post("/users/batch", response_model=BatchCreateResult)
def batch_create_users(
    users: list[BatchUserItem],
    current_user: Annotated[User, Depends(require_permission("user_manage"))],
    db: Annotated[Session, Depends(get_db)],
):
    created = 0
    skipped = 0
    errors = []
    class_ids = {u.class_id for u in users if u.class_id}
    valid_class_ids = {c.id for c in db.query(Class).filter(Class.id.in_(class_ids)).all()} if class_ids else set()

    for i, u in enumerate(users, 1):
        if not u.username.strip() or not u.password or not u.display_name.strip():
            errors.append(f"第{i}行跳过: 用户名/密码/姓名不能为空")
            skipped += 1
            continue
        if len(u.password) < 6:
            errors.append(f"第{i}行跳过 {u.username}: 密码长度不能少于6位")
            skipped += 1
            continue
        existing = db.query(User).filter(User.username == u.username).first()
        if existing:
            errors.append(f"第{i}行跳过 {u.username}: 用户名已存在")
            skipped += 1
            continue
        if u.class_id and u.class_id not in valid_class_ids:
            errors.append(f"第{i}行跳过 {u.username}: 班级ID {u.class_id} 不存在")
            skipped += 1
            continue
        role_obj = db.query(Role).filter(Role.name == u.role, Role.school_id == current_user.school_id).first()
        if not role_obj:
            errors.append(f"第{i}行跳过 {u.username}: 角色 {u.role} 不存在")
            skipped += 1
            continue
        user = User(
            username=u.username,
            password_hash=hash_password(u.password),
            display_name=u.display_name,
            role_id=role_obj.id,
            school_id=current_user.school_id,
            student_id=u.student_id or None,
        )
        db.add(user)
        db.flush()
        if u.class_id:
            db.add(UserClass(user_id=user.id, class_id=u.class_id))
        created += 1
    db.commit()
    log.info(
        f"批量导入: created={created} skipped={skipped}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/stats", response_model=AdminStats)
def get_stats(
    current_user: Annotated[User, Depends(require_permission("stats_view"))], db: Annotated[Session, Depends(get_db)]
):
    student_role_id = None
    student_role = db.query(Role).filter(Role.name == "student", Role.school_id == current_user.school_id).first()
    if student_role:
        student_role_id = student_role.id
    total_students = (
        db.query(User).filter(User.role_id == student_role_id, User.school_id == current_user.school_id).count()
        if student_role_id
        else 0
    )
    total_records = db.query(TrainingRecord).join(User).filter(User.school_id == current_user.school_id).count()
    completed_records = (
        db.query(TrainingRecord)
        .join(User)
        .filter(User.school_id == current_user.school_id, TrainingRecord.status == "completed")
        .count()
    )
    avg_score = (
        db.query(func.avg(Score.total_score))
        .join(TrainingRecord, Score.record_id == TrainingRecord.id)
        .join(User, TrainingRecord.user_id == User.id)
        .filter(User.school_id == current_user.school_id)
        .scalar()
    )

    avg_duration = (
        db.query(func.avg(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60))
        .join(User, TrainingRecord.user_id == User.id)
        .filter(
            TrainingRecord.status == "completed",
            TrainingRecord.end_time.isnot(None),
            TrainingRecord.start_time.isnot(None),
            User.school_id == current_user.school_id,
        )
        .scalar()
    )

    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    today_records = (
        db.query(func.count(TrainingRecord.id))
        .join(User, TrainingRecord.user_id == User.id)
        .filter(
            TrainingRecord.start_time >= today_start,
            User.school_id == current_user.school_id,
        )
        .scalar()
    ) or 0

    return AdminStats(
        total_students=total_students,
        total_records=total_records,
        completed_records=completed_records,
        average_score=round(float(avg_score), 1) if avg_score else None,
        avg_duration_min=round(float(avg_duration), 1) if avg_duration else None,
        today_records=today_records,
    )
