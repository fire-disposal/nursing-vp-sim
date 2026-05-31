from datetime import datetime
from collections import defaultdict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from database import get_db
from models import User, Feedback
from schemas import FeedbackSubmit, FeedbackItem, FeedbackListResponse
from auth import get_current_user, require_teacher
from pagination import paginate

router = APIRouter(prefix="/api", tags=["反馈"])


@router.post("/feedback")
def submit_feedback(req: FeedbackSubmit, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    fb = Feedback(
        user_id=current_user.id,
        rating=req.rating,
        tag=req.tag,
        content=req.content,
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)
    return {"id": fb.id, "created_at": fb.created_at.isoformat()}


@router.get("/admin/feedback", response_model=FeedbackListResponse)
def admin_list_feedback(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
    tag: str = Query(None),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    query = db.query(
        Feedback.id,
        Feedback.user_id,
        Feedback.rating,
        Feedback.tag,
        Feedback.content,
        Feedback.created_at,
        User.display_name.label("user_name"),
    ).join(User, Feedback.user_id == User.id).order_by(Feedback.created_at.desc())

    if tag:
        query = query.filter(Feedback.tag == tag)

    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
            query = query.filter(Feedback.created_at >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
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
    return FeedbackListResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/admin/feedback/stats")
def feedback_stats(
    current_user: User = Depends(require_teacher),
    db: Session = Depends(get_db),
    date_from: str | None = Query(None),
    date_to: str | None = Query(None),
):
    """Return daily count of feedback by rating level, for stacked bar chart."""
    base = db.query(Feedback)
    if date_from:
        try:
            df = datetime.fromisoformat(date_from)
            base = base.filter(Feedback.created_at >= df)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"无效日期格式: {date_from}")
    if date_to:
        try:
            dt = datetime.fromisoformat(date_to)
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
        result.append({
            "date": day,
            "rating_1": d[1],
            "rating_2": d[2],
            "rating_3": d[3],
            "rating_4": d[4],
            "rating_5": d[5],
        })
    return result
