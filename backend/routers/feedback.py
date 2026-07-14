from typing import Annotated

from fastapi import APIRouter, Depends, Query

from core.deps import DbSession
from core.security import get_current_user, require_permission
from infrastructure.exporter import ColumnDef, export_response
from models import Feedback, User
from schemas import (
    FeedbackDailyItem,
    FeedbackItem,
    FeedbackReplyRequest,
    FeedbackSubmit,
    FeedbackSubmitResponse,
    PaginatedResponse,
)
from services.feedback import FeedbackService

router = APIRouter(prefix="/api", tags=["反馈"])

_AnyUser = Annotated[User, Depends(get_current_user)]
_FeedbackReviewer = Annotated[User, Depends(require_permission("feedback_review"))]


@router.post("/feedback", response_model=FeedbackSubmitResponse)
def submit_feedback(req: FeedbackSubmit, current_user: _AnyUser, db: DbSession):
    fb = FeedbackService(db).submit(current_user.id, req.rating, req.tag, req.content)
    return {"id": fb.id, "created_at": fb.created_at}


@router.get("/my-feedback", response_model=PaginatedResponse[FeedbackItem])
def my_feedback(
    current_user: _AnyUser,
    db: DbSession,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
):
    items, total = FeedbackService(db).list_my(current_user.id, offset=offset, limit=limit)
    return PaginatedResponse(
        items=[_to_item(r) for r in items],
        total=total, offset=offset, limit=limit,
    )


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
        items=[_to_item(r) for r in items],
        total=total, offset=offset, limit=limit,
    )


@router.put("/admin/feedback/{feedback_id}/reply", response_model=FeedbackItem)
def reply_feedback(
    feedback_id: int,
    req: FeedbackReplyRequest,
    current_user: _FeedbackReviewer,
    db: DbSession,
):
    admin_name = current_user.display_name or current_user.username
    fb = FeedbackService(db).reply(feedback_id, req.reply, admin_name)
    return _to_item_from_model(fb)


@router.post("/admin/feedback/export")
def export_feedback(
    current_user: _FeedbackReviewer,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from core.config import MAX_EXPORT_ROWS

    fb = db.query(Feedback).order_by(Feedback.created_at.desc()).limit(MAX_EXPORT_ROWS + 1).all()
    columns = [
        ColumnDef("反馈内容", key="content"),
        ColumnDef("评分", key="rating", fmt=lambda v: str(v) if v else ""),
        ColumnDef("标签", key="tag"),
        ColumnDef("版本", key="version"),
        ColumnDef("开发者回复", key="developer_reply"),
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


def _to_item(r) -> FeedbackItem:
    return FeedbackItem(
        id=r.id, user_id=r.user_id, user_name=r.user_name,
        rating=r.rating, tag=r.tag, content=r.content,
        version=getattr(r, "version", ""),
        developer_reply=r.developer_reply, replied_at=r.replied_at,
        created_at=r.created_at,
    )


def _to_item_from_model(fb: Feedback) -> FeedbackItem:
    return FeedbackItem(
        id=fb.id, user_id=fb.user_id, user_name="",
        rating=fb.rating, tag=fb.tag, content=fb.content,
        version=fb.version,
        developer_reply=fb.developer_reply, replied_at=fb.replied_at,
        created_at=fb.created_at,
    )
