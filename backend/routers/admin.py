import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Integer as SAInteger
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from auth import hash_password, require_teacher
from database import get_db
from models import ApiProvider, Class, LLMCallLog, Score, TrainingRecord, User, UserClass
from models import Case as CaseModel
from schemas import (
    AdminStats,
    BatchCreateResult,
    BatchUserItem,
    LLMCallLogItem,
    LLMStatsResponse,
    MessageResponse,
    PaginatedResponse,
    StudentDetail,
    TrainingRecordBrief,
    UserBrief,
    UserUpdateRequest,
)

log = logging.getLogger(__name__)
from typing import Annotated

from fastapi.responses import Response

router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/users", response_model=PaginatedResponse[UserBrief])
def list_users(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    search: Annotated[str | None, Query(description="搜索用户名/姓名/学号")] = None,
    role: Annotated[str | None, Query(description="角色筛选 student/teacher")] = None,
    class_id: Annotated[int | None, Query()] = None,
    grade_id: Annotated[int | None, Query()] = None,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(User)
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
        q = q.filter(User.role == role)
    total = q.count()
    users = (
        q.options(joinedload(User.user_class).joinedload(UserClass.class_).joinedload(Class.grade))
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    items = []
    for u in users:
        uc = u.user_class
        cls = uc.class_ if uc else None
        items.append(
            UserBrief(
                id=u.id,
                username=u.username,
                role=u.role,
                display_name=u.display_name,
                student_id=u.student_id,
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
    current_user: Annotated[User, Depends(require_teacher)],
    db: Annotated[Session, Depends(get_db)],
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")

    if req.display_name is not None:
        user.display_name = req.display_name
    if req.student_id is not None:
        user.student_id = req.student_id or None
    if req.role is not None:
        if req.role not in ("student", "teacher"):
            raise HTTPException(status_code=400, detail="角色必须为 student 或 teacher")
        user.role = req.role
    if req.password is not None and req.password:
        if len(req.password) < 6:
            raise HTTPException(status_code=400, detail="密码长度不能少于6位")
        user.password_hash = hash_password(req.password)

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

    user = (
        db.query(User)
        .options(joinedload(User.user_class).joinedload(UserClass.class_).joinedload(Class.grade))
        .filter(User.id == user_id)
        .first()
    )

    uc = user.user_class if user else None
    cls = uc.class_ if uc else None

    log.info(
        f"用户更新: target_id={user_id} target_name={user.username}",
        extra={"user_id": current_user.id, "user_role": current_user.role},
    )
    return UserBrief(
        id=user.id,
        username=user.username,
        role=user.role,
        display_name=user.display_name,
        student_id=user.student_id,
        created_at=user.created_at,
        class_id=cls.id if cls else None,
        class_name=cls.name if cls else None,
        grade_name=cls.grade.name if (cls and cls.grade) else None,
    )


@router.get("/users/{user_id}/detail", response_model=StudentDetail)
def get_user_detail(
    user_id: int,
    current_user: Annotated[User, Depends(require_teacher)],
    db: Annotated[Session, Depends(get_db)],
):
    user = db.query(User).filter(User.id == user_id, User.role == "student").first()
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
        role=user.role,
        display_name=user.display_name,
        student_id=user.student_id,
        created_at=user.created_at,
        total_sessions=stats.total_sessions or 0,
        total_minutes=round(float(stats.total_minutes or 0)),
        avg_score=round(float(stats.avg_score), 1) if stats.avg_score else None,
        recent_records=recent_records,
        daily=daily,
    )


@router.delete("/users/{user_id}", response_model=MessageResponse)
def delete_user(
    user_id: int,
    current_user: Annotated[User, Depends(require_teacher)],
    db: Annotated[Session, Depends(get_db)],
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="不能删除自己")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
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
        extra={"user_id": current_user.id, "user_role": current_user.role},
    )
    return {"message": "用户已删除"}


@router.post("/users/batch", response_model=BatchCreateResult)
def batch_create_users(
    users: list[BatchUserItem],
    current_user: Annotated[User, Depends(require_teacher)],
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
        if u.role not in ("student", "teacher"):
            errors.append(f"第{i}行跳过 {u.username}: 角色无效")
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
        user = User(
            username=u.username,
            password_hash=hash_password(u.password),
            display_name=u.display_name,
            role=u.role,
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
        extra={"user_id": current_user.id, "user_role": current_user.role},
    )
    return {"created": created, "skipped": skipped, "errors": errors}


@router.get("/stats", response_model=AdminStats)
def get_stats(current_user: Annotated[User, Depends(require_teacher)], db: Annotated[Session, Depends(get_db)]):
    total_students = db.query(User).filter(User.role == "student").count()
    total_records = db.query(TrainingRecord).count()
    completed_records = db.query(TrainingRecord).filter(TrainingRecord.status == "completed").count()
    avg_score = db.query(func.avg(Score.total_score)).scalar()

    avg_duration = (
        db.query(func.avg(func.extract("epoch", TrainingRecord.end_time - TrainingRecord.start_time) / 60))
        .filter(
            TrainingRecord.status == "completed",
            TrainingRecord.end_time.isnot(None),
            TrainingRecord.start_time.isnot(None),
        )
        .scalar()
    )

    today_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    today_records = (
        db.query(func.count(TrainingRecord.id)).filter(TrainingRecord.start_time >= today_start).scalar() or 0
    )

    return AdminStats(
        total_students=total_students,
        total_records=total_records,
        completed_records=completed_records,
        average_score=round(float(avg_score), 1) if avg_score else None,
        avg_duration_min=round(float(avg_duration), 1) if avg_duration else None,
        today_records=today_records,
    )


# ── LLM 调用监控 ──


def _build_llm_stats(db: Session, since: datetime):
    """查询指定时间范围内的 LLM 调用统计数据"""
    base = db.query(LLMCallLog).filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
    total = base.count()
    if total == 0:
        return {"count": 0, "success_rate": 0, "avg_latency_ms": 0, "total_cost": 0}
    success_count = base.filter(LLMCallLog.status == "success").count()
    avg_latency = (
        db.query(func.avg(LLMCallLog.latency_ms))
        .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
        .scalar()
        or 0
    )
    total_cost = (
        db.query(func.sum(LLMCallLog.estimated_cost))
        .filter(LLMCallLog.created_at >= since, LLMCallLog.created_at < datetime.now(UTC))
        .scalar()
        or 0
    )
    return {
        "count": total,
        "success_rate": round(success_count / total * 100, 1),
        "avg_latency_ms": round(avg_latency, 0),
        "total_cost": round(total_cost, 4),
    }


@router.get("/llm-stats", response_model=LLMStatsResponse)
def get_llm_stats(current_user: Annotated[User, Depends(require_teacher)], db: Annotated[Session, Depends(get_db)]):
    now = datetime.now(UTC)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=7)
    month_start = today_start - timedelta(days=30)

    today_stats = _build_llm_stats(db, today_start)
    week_stats = _build_llm_stats(db, week_start)
    month_start_cal = today_start.replace(day=1)
    month_stats = _build_llm_stats(db, month_start_cal)

    # by_purpose
    rows = (
        db.query(
            LLMCallLog.purpose,
            func.count().label("count"),
            func.avg(LLMCallLog.latency_ms).label("avg_latency"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
        )
        .filter(LLMCallLog.created_at >= week_start, LLMCallLog.created_at < now)
        .group_by(LLMCallLog.purpose)
        .all()
    )
    by_purpose = [
        {"purpose": r[0], "count": r[1], "avg_latency_ms": round(r[2] or 0, 0), "error_count": r[3]} for r in rows
    ]

    # daily: 最近30天
    daily_rows = (
        db.query(
            func.date(LLMCallLog.created_at).label("date"),
            func.count().label("count"),
            func.sum(func.cast(LLMCallLog.status == "success", type_=SAInteger)).label("success_count"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("fail_count"),
            func.sum(LLMCallLog.estimated_cost).label("total_cost"),
        )
        .filter(LLMCallLog.created_at >= month_start, LLMCallLog.created_at < now)
        .group_by("date")
        .order_by("date")
        .all()
    )
    daily = [
        {
            "date": str(r[0]),
            "count": r[1],
            "success_count": r[2] or 0,
            "fail_count": r[3] or 0,
            "total_cost": round(r[4] or 0, 4),
        }
        for r in daily_rows
    ]

    # by_provider: 最近7天按 Provider 统计
    provider_rows = (
        db.query(
            LLMCallLog.provider_name,
            func.count().label("count"),
            func.coalesce(func.sum(LLMCallLog.estimated_cost), 0).label("total_cost"),
            func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
        )
        .filter(LLMCallLog.created_at >= week_start, LLMCallLog.created_at < now)
        .group_by(LLMCallLog.provider_name)
        .all()
    )
    by_provider = [
        {"provider": r[0] or "unknown", "count": r[1], "total_cost": round(float(r[2]), 4), "error_count": r[3] or 0}
        for r in provider_rows
    ]

    return LLMStatsResponse(
        today=today_stats,
        week=week_stats,
        month=month_stats,
        by_purpose=by_purpose,
        by_provider=by_provider,
        daily=daily,
    )


@router.get("/llm-logs", response_model=PaginatedResponse[LLMCallLogItem])
def get_llm_logs(
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    purpose: str | None = None,
    status: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
    aggregate_patient_chat: bool = True,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """返回 LLM 调用日志。aggregate_patient_chat=true 时将同一训练下的 patient_chat 聚合为一条训练级记录。"""
    do_agg = aggregate_patient_chat and (purpose is None or purpose == "patient_chat")
    need_raw = (not aggregate_patient_chat) or (purpose != "patient_chat")

    agg_count = 0
    raw_count = 0
    agg_rows = []
    raw_rows = []

    if do_agg:
        agg_q = (
            db.query(
                LLMCallLog.record_id.label("record_id"),
                func.max(LLMCallLog.id).label("id"),
                func.max(LLMCallLog.user_id).label("user_id"),
                func.max(LLMCallLog.case_id).label("case_id"),
                func.count().label("call_count"),
                func.avg(LLMCallLog.latency_ms).label("latency_ms"),
                func.sum(LLMCallLog.prompt_tokens).label("prompt_tokens"),
                func.sum(LLMCallLog.completion_tokens).label("completion_tokens"),
                func.sum(LLMCallLog.total_tokens).label("total_tokens"),
                func.max(LLMCallLog.token_estimated).label("token_estimated"),
                func.sum(LLMCallLog.estimated_cost).label("estimated_cost"),
                func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)).label("error_count"),
                func.min(LLMCallLog.created_at).label("first_called_at"),
                func.max(LLMCallLog.created_at).label("created_at"),
                User.display_name.label("student_name"),
                CaseModel.name.label("case_name"),
                ApiProvider.display_name.label("provider_display_name"),
            )
            .join(TrainingRecord, LLMCallLog.record_id == TrainingRecord.id, isouter=True)
            .join(User, TrainingRecord.user_id == User.id, isouter=True)
            .join(CaseModel, TrainingRecord.case_id == CaseModel.id, isouter=True)
            .join(ApiProvider, LLMCallLog.provider_name == ApiProvider.name, isouter=True)
            .filter(
                LLMCallLog.purpose == "patient_chat",
                LLMCallLog.record_id.isnot(None),
            )
        )

        if date_from:
            agg_q = agg_q.filter(LLMCallLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            agg_q = agg_q.filter(LLMCallLog.created_at < datetime.fromisoformat(date_to))

        agg_q = agg_q.group_by(LLMCallLog.record_id, User.display_name, CaseModel.name, ApiProvider.display_name)

        if status == "success":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) == 0)
        elif status == "failed":
            agg_q = agg_q.having(func.sum(func.cast(LLMCallLog.status != "success", type_=SAInteger)) > 0)

        agg_count = agg_q.order_by(None).count()
        agg_rows = agg_q.order_by(func.max(LLMCallLog.created_at).desc()).offset(offset).limit(limit).all()

    if need_raw:
        q = db.query(LLMCallLog)
        if aggregate_patient_chat and purpose is None:
            q = q.filter(LLMCallLog.purpose != "patient_chat")
        elif purpose:
            q = q.filter(LLMCallLog.purpose == purpose)
        if status:
            q = q.filter(LLMCallLog.status == status)
        if date_from:
            q = q.filter(LLMCallLog.created_at >= datetime.fromisoformat(date_from))
        if date_to:
            q = q.filter(LLMCallLog.created_at < datetime.fromisoformat(date_to))

        raw_count = q.order_by(None).count()

        remaining_offset = max(0, offset - agg_count)
        remaining_limit = max(0, limit - len(agg_rows))
        if remaining_limit > 0:
            raw_rows = q.order_by(LLMCallLog.created_at.desc()).offset(remaining_offset).limit(remaining_limit).all()

    total = agg_count + raw_count

    all_items = []

    for r in agg_rows:
        avg_lat = round(r.latency_ms) if r.latency_ms is not None else None
        all_items.append(
            {
                "id": r.id,
                "user_id": r.user_id,
                "record_id": r.record_id,
                "case_id": r.case_id,
                "purpose": "patient_chat",
                "provider_name": r.provider_display_name or "deepseek",
                "model": "",
                "temperature": None,
                "max_tokens": None,
                "prompt_tokens": r.prompt_tokens,
                "completion_tokens": r.completion_tokens,
                "total_tokens": r.total_tokens,
                "token_estimated": 1 if r.token_estimated else 0,
                "estimated_cost": round(r.estimated_cost, 6) if r.estimated_cost is not None else None,
                "cost_currency": None,
                "latency_ms": avg_lat,
                "status": "success" if (r.error_count or 0) == 0 else "failed",
                "error_type": None,
                "error_message": None,
                "request_chars": None,
                "response_chars": None,
                "created_at": r.created_at,
                "call_count": r.call_count,
                "avg_latency_ms": avg_lat,
                "error_count": r.error_count or 0,
                "first_called_at": r.first_called_at,
                "last_called_at": r.created_at,
                "student_name": r.student_name,
                "case_name": r.case_name,
                "is_aggregated": True,
            }
        )

    all_items.extend(raw_rows)

    def _get_ts(item):
        if isinstance(item, dict):
            return item["created_at"]
        return item.created_at

    all_items.sort(key=_get_ts, reverse=True)

    items = []
    for it in all_items:
        if isinstance(it, dict):
            items.append(LLMCallLogItem(**it))
        else:
            items.append(LLMCallLogItem.model_validate(it))

    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/llm-logs/{log_id}", response_model=LLMCallLogItem)
def get_llm_log_detail(
    log_id: int,
    current_user: Annotated[User, Depends(require_teacher)],
    db: Annotated[Session, Depends(get_db)],
):
    """查看单条 LLM 调用日志详情（含请求/响应全文）"""
    entry = db.query(LLMCallLog).filter(LLMCallLog.id == log_id).first()
    if not entry:
        raise HTTPException(404, "日志不存在")
    return entry


@router.get("/llm-logs/export")
def export_llm_logs_csv(
    date_from: str | None = None,
    date_to: str | None = None,
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """导出 LLM 调用日志为 CSV 文件"""
    import csv
    import io

    q = db.query(LLMCallLog)
    if date_from:
        q = q.filter(LLMCallLog.created_at >= datetime.fromisoformat(date_from))
    if date_to:
        q = q.filter(LLMCallLog.created_at < datetime.fromisoformat(date_to))
    logs = q.order_by(LLMCallLog.created_at.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "ID",
            "时间",
            "用户ID",
            "训练记录ID",
            "病例ID",
            "用途",
            "Provider",
            "模型",
            "状态",
            "延迟(ms)",
            "PromptTokens",
            "CompletionTokens",
            "TotalTokens",
            "估算标记",
            "预估费用",
            "错误类型",
            "错误信息",
            "请求字符数",
            "响应字符数",
        ]
    )
    for entry in logs:
        writer.writerow(
            [
                entry.id,
                entry.created_at.isoformat() if entry.created_at else "",
                entry.user_id or "",
                entry.record_id or "",
                entry.case_id or "",
                entry.purpose,
                getattr(entry, "provider_name", ""),
                entry.model,
                entry.status,
                entry.latency_ms or "",
                entry.prompt_tokens or "",
                entry.completion_tokens or "",
                entry.total_tokens or "",
                entry.token_estimated,
                entry.estimated_cost if entry.estimated_cost is not None else "",
                entry.error_type or "",
                (entry.error_message or "")[:200],
                entry.request_chars or "",
                entry.response_chars or "",
            ]
        )

    csv_content = output.getvalue()
    output.close()
    return Response(
        content=csv_content.encode("utf-8-sig"),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=llm_logs_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.csv"
        },
    )
