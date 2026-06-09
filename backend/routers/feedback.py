from collections import defaultdict
from datetime import datetime

from backend.core.datetime_utils import parse_iso_datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user, require_permission
from middleware.dependencies import resolve_school_filter
from models import Feedback, User
from schemas import (
    FeedbackDailyItem,
    FeedbackItem,
    FeedbackSubmit,
    FeedbackSubmitResponse,
    PaginatedResponse,
)
from core.pagination import paginate

router = APIRouter(prefix="/api", tags=["反馈"])


@router.post("/feedback", response_model=FeedbackSubmitResponse)
def submit_feedback(
    req: FeedbackSubmit,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    fb = Feedback(
        user_id=current_user.id,
        rating=req.rating,
        tag=req.tag,
        content=req.content,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    return {"id": fb.id, "created_at": fb.created_at}


@router.get("/admin/feedback", response_model=PaginatedResponse[FeedbackItem])
def admin_list_feedback(
    current_user: Annotated[User, Depends(require_permission("feedback_review"))],
    db: Annotated[Session, Depends(get_db)],
    tag: Annotated[str | None, Query()] = None,
    date_from: Annotated[str | None, Query()] = None,
    date_to: Annotated[str | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    effective_school = resolve_school_filter(current_user, school_id)
    query = (
        db.query(
            Feedback.id,
            Feedback.user_id,
            Feedback.rating,
            Feedback.tag,
            Feedback.content,
            Feedback.created_at,
            User.display_name.label("user_name"),
        )
        .join(User, Feedback.user_id == User.id)
    )
    if effective_school is not None:
        query = query.filter(User.school_id == effective_school)
    query = query.order_by(Feedback.created_at.desc())

    if tag:
        query = query.filter(Feedback.tag == tag)

    if date_from:
        try:
            df = parse_iso_datetime(date_from)
            query = query.filter(Feedback.created_at >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = parse_iso_datetime(date_to)
            query = query.filter(Feedback.created_at < dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_to}")

    rows, total = paginate(query, offset, limit)
    items = [
        FeedbackItem(
            id=r.id,
            user_id=r.user_id,
            user_name=r.user_name,
            rating=r.rating,
            tag=r.tag,
            content=r.content,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/admin/feedback/stats", response_model=list[FeedbackDailyItem])
def feedback_stats(
    current_user: Annotated[User, Depends(require_permission("feedback_review"))],
    db: Annotated[Session, Depends(get_db)],
    date_from: Annotated[str | None, Query()] = None,
    date_to: Annotated[str | None, Query()] = None,
    school_id: Annotated[int | None, Query(description="super_admin 按学校筛选")] = None,
):
    """Return daily count of feedback by rating level, for stacked bar chart."""
    effective_school = resolve_school_filter(current_user, school_id)
    base = db.query(Feedback)
    if effective_school is not None:
        base = base.join(User, Feedback.user_id == User.id).filter(User.school_id == effective_school)
    if date_from:
        try:
            df = parse_iso_datetime(date_from)
            base = base.filter(Feedback.created_at >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = parse_iso_datetime(date_to)
            base = base.filter(Feedback.created_at < dt)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_to}")

    rows = base.order_by(Feedback.created_at).all()

    daily = defaultdict(lambda: {1: 0, 2: 0, 3: 0, 4: 0, 5: 0})
    for fb in rows:
        day = fb.created_at.strftime("%Y-%m-%d")
        daily[day][fb.rating] += 1

    result = []
    for day in sorted(daily.keys()):
        d = daily[day]
        result.append(
            {
                "date": day,
                "rating_1": d[1],
                "rating_2": d[2],
                "rating_3": d[3],
                "rating_4": d[4],
                "rating_5": d[5],
            }
        )
    return result
