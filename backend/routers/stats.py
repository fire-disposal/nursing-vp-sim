from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, TrainingRecord, Score, UserClass, Class, Grade
from schemas import DurationStats, TrendStats, PaginatedResponse
from auth import get_current_user, require_teacher
from pagination import paginate

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/duration", response_model=DurationStats)
def get_duration_stats(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    period: str = Query("month", description="统计周期: week / month / all"),
):
    now = datetime.now(timezone.utc)
    if period == "week":
        since = now - timedelta(days=7)
    elif period == "month":
        since = now - timedelta(days=30)
    else:
        since = datetime(2000, 1, 1, tzinfo=timezone.utc)

    base = db.query(
        func.date(TrainingRecord.start_time).label("d"),
        func.sum(
            func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60
        ).label("minutes"),
        func.count().label("sessions"),
    ).filter(
        TrainingRecord.status == "completed",
        TrainingRecord.start_time >= since,
    )

    if current_user.role != "teacher":
        base = base.filter(TrainingRecord.user_id == current_user.id)

    rows = base.group_by(func.date(TrainingRecord.start_time)).order_by("d").all()

    daily = [{"date": str(r.d), "minutes": round(float(r.minutes or 0), 1)} for r in rows]
    total_minutes = round(sum(r.minutes or 0 for r in rows))
    total_sessions = sum(r.sessions for r in rows)

    return DurationStats(daily=daily, total_minutes=total_minutes, total_sessions=total_sessions)


@router.get("/trends", response_model=TrendStats)
def get_trends(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    period: str = Query("month", description="统计周期: week / month / all"),
):
    now = datetime.now(timezone.utc)
    if period == "week":
        since = now - timedelta(days=7)
    elif period == "month":
        since = now - timedelta(days=30)
    else:
        since = datetime(2000, 1, 1, tzinfo=timezone.utc)

    base = db.query(
        func.date(TrainingRecord.start_time).label("d"),
        func.count().label("sessions"),
        func.sum(
            func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60
        ).label("minutes"),
        func.avg(Score.total_score).label("avg_score"),
    ).outerjoin(Score, Score.record_id == TrainingRecord.id).filter(
        TrainingRecord.status == "completed",
        TrainingRecord.start_time >= since,
    )

    if current_user.role != "teacher":
        base = base.filter(TrainingRecord.user_id == current_user.id)

    rows = base.group_by(func.date(TrainingRecord.start_time)).order_by("d").all()

    daily = [
        {"date": str(r.d), "sessions": r.sessions,
         "minutes": round(float(r.minutes or 0), 1),
         "avg_score": round(float(r.avg_score), 1) if r.avg_score is not None else None}
        for r in rows
    ]
    total_sessions = sum(r.sessions for r in rows)
    total_minutes = round(sum(r.minutes or 0 for r in rows))
    all_scores = [float(r.avg_score) for r in rows if r.avg_score is not None]
    overall_avg = round(sum(all_scores) / len(all_scores), 1) if all_scores else None

    return TrendStats(daily=daily, total_sessions=total_sessions, total_minutes=total_minutes, avg_score=overall_avg)


@router.get("/teacher-summary", response_model=PaginatedResponse[dict])
def teacher_summary(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    class_id: int | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    base = db.query(
        User.id.label("user_id"),
        User.display_name.label("display_name"),
        User.student_id.label("student_code"),
        func.count(TrainingRecord.id).label("total_sessions"),
        func.coalesce(
            func.sum(func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60),
            0,
        ).label("total_minutes"),
    ).outerjoin(
        TrainingRecord,
        (TrainingRecord.user_id == User.id) & (TrainingRecord.status == "completed")
    ).filter(
        User.role == "student"
    )
    if class_id is not None:
        base = base.filter(User.id.in_(
            db.query(UserClass.user_id).filter(UserClass.class_id == class_id)
        ))
    base = base.group_by(User.id).order_by(User.id)

    items, total = paginate(base, offset, limit)

    data = [
        {"user_id": r.user_id, "display_name": r.display_name, "student_code": r.student_code,
         "total_sessions": r.total_sessions, "total_minutes": round(float(r.total_minutes))}
        for r in items
    ]
    return PaginatedResponse(items=data, total=total, offset=offset, limit=limit)


@router.get("/ranking", response_model=PaginatedResponse[dict])
def student_ranking(
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    class_id: int | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    sub = db.query(
        User.id.label("user_id"),
        User.display_name.label("display_name"),
        User.student_id.label("student_id"),
        func.count(TrainingRecord.id).label("total_sessions"),
        func.coalesce(func.avg(Score.total_score), 0).label("avg_score"),
        func.coalesce(func.sum(Score.total_score), 0).label("total_score"),
        func.coalesce(
            func.sum(func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60),
            0,
        ).label("total_minutes"),
        func.rank().over(order_by=func.coalesce(func.avg(Score.total_score), 0).desc()).label("rank"),
    ).outerjoin(
        TrainingRecord,
        (TrainingRecord.user_id == User.id) & (TrainingRecord.status == "completed")
    ).outerjoin(
        Score, Score.record_id == TrainingRecord.id
    ).filter(
        User.role == "student"
    )
    if class_id is not None:
        sub = sub.filter(User.id.in_(
            db.query(UserClass.user_id).filter(UserClass.class_id == class_id)
        ))
    sub = sub.group_by(User.id).subquery()

    total = db.query(func.count()).select_from(sub).scalar()
    rows = db.query(sub).order_by(sub.c.rank).offset(offset).limit(limit).all()

    items = [
        {"user_id": r.user_id, "display_name": r.display_name, "student_id": r.student_id,
         "total_sessions": r.total_sessions, "avg_score": round(float(r.avg_score), 1) if r.avg_score else None,
         "total_score": round(float(r.total_score), 1), "total_minutes": round(float(r.total_minutes)),
         "rank": r.rank}
        for r in rows
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/class-summary", response_model=list[dict])
def class_summary(
    grade_id: int | None = Query(None),
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    q = db.query(Class, Grade.name.label("grade_name"))
    q = q.join(Grade, Grade.id == Class.grade_id)
    if grade_id is not None:
        q = q.filter(Class.grade_id == grade_id)
    rows = q.order_by(Grade.name, Class.name).all()

    result = []
    for cls, grade_name in rows:
        student_count = db.query(func.count(UserClass.user_id)).filter(
            UserClass.class_id == cls.id
        ).scalar() or 0

        sub = db.query(TrainingRecord).join(
            UserClass, UserClass.user_id == TrainingRecord.user_id
        ).filter(
            UserClass.class_id == cls.id,
            TrainingRecord.status == "completed",
        )
        total_sessions = sub.count()
        total_minutes = sub.filter(
            TrainingRecord.end_time.isnot(None),
            TrainingRecord.start_time.isnot(None),
        ).with_entities(
            func.sum(
                func.extract('epoch', TrainingRecord.end_time - TrainingRecord.start_time) / 60
            )
        ).scalar() or 0

        avg_score = sub.join(Score, Score.record_id == TrainingRecord.id).with_entities(
            func.avg(Score.total_score)
        ).scalar()

        completion_rate = total_sessions / student_count if student_count > 0 else 0

        result.append({
            "class_id": cls.id,
            "class_name": cls.name,
            "grade_name": grade_name,
            "student_count": student_count,
            "avg_score": round(float(avg_score), 1) if avg_score else None,
            "completion_rate": round(float(completion_rate), 1),
            "total_sessions": total_sessions,
            "total_minutes": round(float(total_minutes)),
        })
    return result
