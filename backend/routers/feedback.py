from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from core.database import get_db
from core.datetime_utils import parse_iso_datetime
from core.pagination import paginate
from core.security import get_current_user, require_permission
from models import Feedback, User
from schemas import (
    FeedbackDailyItem,
    FeedbackItem,
    FeedbackSubmit,
    FeedbackSubmitResponse,
    PaginatedResponse,
)

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
):
    query = db.query(
        Feedback.id,
        Feedback.user_id,
        Feedback.rating,
        Feedback.tag,
        Feedback.content,
        Feedback.created_at,
        User.display_name.label("user_name"),
    ).join(User, Feedback.user_id == User.id)
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
):
    """Return daily count of feedback by rating level, for stacked bar chart."""
    base = db.query(Feedback)
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

    rows = (
        base.with_entities(
            func.date(Feedback.created_at).label("date"),
            func.count(case((Feedback.rating == 1, 1))).label("rating_1"),
            func.count(case((Feedback.rating == 2, 1))).label("rating_2"),
            func.count(case((Feedback.rating == 3, 1))).label("rating_3"),
            func.count(case((Feedback.rating == 4, 1))).label("rating_4"),
            func.count(case((Feedback.rating == 5, 1))).label("rating_5"),
        )
        .group_by(func.date(Feedback.created_at))
        .order_by(func.date(Feedback.created_at))
        .all()
    )

    return [
        {
            "date": str(r.date),
            "rating_1": r.rating_1,
            "rating_2": r.rating_2,
            "rating_3": r.rating_3,
            "rating_4": r.rating_4,
            "rating_5": r.rating_5,
        }
        for r in rows
    ]
