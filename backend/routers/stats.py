from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, TrainingRecord, Score
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
    ).group_by(User.id).order_by(User.id)

    items, total = paginate(base, offset, limit)

    data = [
        {"user_id": r.user_id, "display_name": r.display_name, "student_code": r.student_code,
         "total_sessions": r.total_sessions, "total_minutes": round(float(r.total_minutes))}
        for r in items
    ]
    return PaginatedResponse(items=data, total=total, offset=offset, limit=limit)


@router.get("/ranking")
def student_ranking(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
):
    """教师视角：学生成绩排名（按平均分降序）"""
    students = db.query(User).filter(User.role == "student").all()
    result = []
    for s in students:
        records = db.query(TrainingRecord).filter(
            TrainingRecord.user_id == s.id,
            TrainingRecord.status == "completed",
        ).all()
        if not records:
            result.append({
                "user_id": s.id,
                "display_name": s.display_name,
                "student_id": s.student_id,
                "total_sessions": 0,
                "avg_score": None,
                "total_score": 0,
                "total_minutes": 0,
            })
            continue

        record_ids = [r.id for r in records]
        scores = db.query(Score).filter(Score.record_id.in_(record_ids)).all()
        score_map = {sc.record_id: sc.total_score for sc in scores}

        total_score = 0
        score_count = 0
        total_sec = 0
        for r in records:
            if r.id in score_map:
                total_score += score_map[r.id]
                score_count += 1
            if r.start_time and r.end_time:
                total_sec += (r.end_time - r.start_time).total_seconds()

        result.append({
            "user_id": s.id,
            "display_name": s.display_name,
            "student_id": s.student_id,
            "total_sessions": len(records),
            "avg_score": round(total_score / score_count, 1) if score_count > 0 else None,
            "total_score": round(total_score, 1),
            "total_minutes": round(total_sec / 60),
        })

    # 按平均分降序排列
    result.sort(key=lambda x: (x["avg_score"] is not None, x["avg_score"] or 0), reverse=True)

    # 添加排名
    for i, item in enumerate(result):
        item["rank"] = i + 1

    return result
