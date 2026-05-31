from fastapi import APIRouter, Depends, Query
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
