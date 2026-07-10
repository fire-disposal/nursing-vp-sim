from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import get_current_user, require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import User
from schemas import (
    FeedbackDailyItem,
    FeedbackItem,
    FeedbackSubmit,
    FeedbackSubmitResponse,
    PaginatedResponse,
)
from services.feedback import FeedbackService

router = APIRouter(prefix="/api", tags=["反馈"])

_AnyUser = Annotated[User, Depends(get_current_user)]
_FeedbackReviewer = Annotated[User, Depends(require_permission("feedback_review"))]


@router.post("/feedback", response_model=FeedbackSubmitResponse)
def submit_feedback(
    req: FeedbackSubmit,
    current_user: _AnyUser,
    db: DbSession,
):
    fb = FeedbackService(db).submit(current_user.id, req.rating, req.tag, req.content)
    return {"id": fb.id, "created_at": fb.created_at}


@router.get("/admin/feedback", response_model=PaginatedResponse[FeedbackItem])
def admin_list_feedback(
    current_user: _FeedbackReviewer,
    db: DbSession,
    tag: Annotated[str | None, Query()] = None,
    date_from: Annotated[str | None, Query()] = None,
    date_to: Annotated[str | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = FeedbackService(db).list_admin(
        tag=tag, date_from=date_from, date_to=date_to, offset=offset, limit=limit
    )
    return PaginatedResponse(
        items=[
            FeedbackItem(
                id=r.id,
                user_id=r.user_id,
                user_name=r.user_name,
                rating=r.rating,
                tag=r.tag,
                content=r.content,
                created_at=r.created_at,
            )
            for r in items
        ],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.post("/admin/feedback/export")
def export_feedback(
    current_user: _FeedbackReviewer,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from core.config import MAX_EXPORT_ROWS
    from models import Feedback

    fb = db.query(Feedback).order_by(Feedback.created_at.desc()).limit(MAX_EXPORT_ROWS + 1).all()
    columns = [
        ColumnDef("反馈内容", key="content"),
        ColumnDef("评分", key="rating", fmt=lambda v: str(v) if v else ""),
        ColumnDef("创建时间", value=lambda r: r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""),
    ]
    return export_response(fb, columns, "用户反馈", "用户反馈", format)


@router.get("/admin/feedback/stats", response_model=list[FeedbackDailyItem])
def feedback_stats(
    current_user: _FeedbackReviewer,
    db: DbSession,
    date_from: Annotated[str | None, Query()] = None,
    date_to: Annotated[str | None, Query()] = None,
):
    return FeedbackService(db).daily_stats(date_from=date_from, date_to=date_to)
