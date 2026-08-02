from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from core.config import FEEDBACK_BOT_NAME, FEEDBACK_BOT_TOKEN
from core.database import get_db
from core.deps import DbSession
from core.security import get_current_user, require_permission
from infra.exporter import ColumnDef, export_response
from models import Feedback, User
from modules.feedback.service import FeedbackService
from schemas import (
    FeedbackDailyItem,
    FeedbackItem,
    FeedbackReplyRequest,
    FeedbackSubmitResponse,
    PaginatedResponse,
    StorageStatsResponse,
)

router = APIRouter(prefix="/api", tags=["反馈"])

_AnyUser = Annotated[User, Depends(get_current_user)]
_FeedbackReviewer = Annotated[User, Depends(require_permission("feedback_review"))]


@router.post("/feedback", response_model=FeedbackSubmitResponse)
async def submit_feedback(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    rating: int = Form(default=3, ge=1, le=5),
    tag: str = Form(default="", max_length=20),
    content: str | None = Form(None),
    images: list[UploadFile] | None = File(None),
):
    image_data = None
    if images:
        image_data = [(await img.read(), img.content_type or "application/octet-stream") for img in images]

    fb = FeedbackService(db).submit(current_user.id, rating, tag, content, image_data)
    img_count = FeedbackService(db).image_count_for_feedback(fb.id)
    return {"id": fb.id, "image_count": img_count, "created_at": fb.created_at}


@router.get("/feedback/{feedback_id}/images/{image_id}")
def get_feedback_image(
    feedback_id: int,
    image_id: int,
    current_user: _AnyUser,
    db: DbSession,
):
    service = FeedbackService(db)
    img = service.get_image(feedback_id, image_id)
    feedback = db.get(Feedback, feedback_id)
    if feedback is None:
        raise HTTPException(status_code=404, detail="反馈不存在")
    if feedback.user_id != current_user.id and not current_user.has_permission("feedback_review"):
        raise HTTPException(status_code=404)
    return Response(content=bytes(img.image_data), media_type=img.mime_type)


@router.get("/my-feedback", response_model=PaginatedResponse[FeedbackItem])
def my_feedback(
    current_user: _AnyUser,
    db: DbSession,
    tag: Annotated[str | None, Query()] = None,
    replied: Annotated[bool | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
):
    items, total = FeedbackService(db).list_my(current_user.id, tag=tag, replied=replied, offset=offset, limit=limit)
    return PaginatedResponse(
        items=[_to_item(r) for r in items],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/admin/feedback", response_model=PaginatedResponse[FeedbackItem])
def admin_list_feedback(
    current_user: _FeedbackReviewer,
    db: DbSession,
    tag: Annotated[str | None, Query()] = None,
    date_from: Annotated[str | None, Query()] = None,
    date_to: Annotated[str | None, Query()] = None,
    search: Annotated[str | None, Query(max_length=50)] = None,
    replied: Annotated[bool | None, Query()] = None,
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
):
    items, total = FeedbackService(db).list_admin(
        tag=tag, date_from=date_from, date_to=date_to, search=search, replied=replied, offset=offset, limit=limit
    )
    return PaginatedResponse(
        items=[_to_item(r) for r in items],
        total=total,
        offset=offset,
        limit=limit,
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


@router.get("/admin/feedback/storage-stats", response_model=StorageStatsResponse)
def feedback_storage_stats(
    current_user: _FeedbackReviewer,
    db: DbSession,
):
    return FeedbackService(db).storage_stats()


@router.post("/admin/feedback/export")
def export_feedback(
    current_user: _FeedbackReviewer,
    db: DbSession,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    from core.config import MAX_EXPORT_ROWS

    fb_list = db.query(Feedback).order_by(Feedback.created_at.desc()).limit(MAX_EXPORT_ROWS + 1).all()

    feedback_ids = [f.id for f in fb_list]
    if feedback_ids:
        from sqlalchemy import func

        from models.feedback_image import FeedbackImage as FI

        counts = (
            db.query(FI.feedback_id, func.count(FI.id).label("cnt"))
            .filter(FI.feedback_id.in_(feedback_ids))
            .group_by(FI.feedback_id)
            .all()
        )
        count_map = {c.feedback_id: c.cnt for c in counts}
    else:
        count_map = {}

    columns = [
        ColumnDef("反馈内容", key="content"),
        ColumnDef("评分", key="rating", fmt=lambda v: str(v) if v else ""),
        ColumnDef("标签", key="tag"),
        ColumnDef("版本", key="version"),
        ColumnDef("图片数", value=lambda r: str(count_map.get(r.id, 0))),
        ColumnDef("开发者回复", key="developer_reply"),
        ColumnDef("创建时间", value=lambda r: r.created_at.strftime("%Y-%m-%d %H:%M:%S") if r.created_at else ""),
    ]
    return export_response(fb_list, columns, "用户反馈", "用户反馈", format)


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
        id=r.id,
        user_id=r.user_id,
        user_name=r.user_name,
        rating=r.rating,
        tag=r.tag,
        content=r.content,
        version=getattr(r, "version", ""),
        image_count=getattr(r, "image_count", 0),
        image_ids=getattr(r, "image_ids", []) or [],
        developer_reply=r.developer_reply,
        replied_at=r.replied_at,
        created_at=r.created_at,
    )


def _to_item_from_model(fb: Feedback) -> FeedbackItem:
    images = fb.images
    image_count = len(images) if isinstance(images, list) and images else 0
    return FeedbackItem(
        id=fb.id,
        user_id=fb.user_id,
        user_name="",
        rating=fb.rating,
        tag=fb.tag,
        content=fb.content,
        version=fb.version,
        image_count=image_count,
        developer_reply=fb.developer_reply,
        replied_at=fb.replied_at,
        created_at=fb.created_at,
    )


# ── Bot API (外部 AI 接入，独立 token) ──


def _check_bot_token(token: str) -> None:
    if not FEEDBACK_BOT_TOKEN:
        raise HTTPException(status_code=404)
    if token != FEEDBACK_BOT_TOKEN:
        raise HTTPException(status_code=403)


@router.get("/feedback/bot")
def bot_list_feedback(
    db: DbSession,
    token: str = Query(...),
    since: str | None = Query(None, description="ISO datetime, e.g. 2026-07-01T00:00:00"),
    version: str | None = Query(None, description="Exact version, e.g. 2026.07.14-10"),
    tag: str | None = Query(None, description="Filter by tag: bug/feature/experience/content/ui/other"),
    replied: bool | None = Query(None, description="true=已回复, false=未回复"),
    include_fixed: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _check_bot_token(token)
    return FeedbackService(db).bot_list(
        since=since,
        version=version,
        tag=tag,
        replied=replied,
        include_fixed=include_fixed,
        limit=limit,
        offset=offset,
    )


@router.patch("/feedback/bot/{feedback_id}")
def bot_mark_fix_attempted(
    feedback_id: int,
    db: DbSession,
    token: str = Query(...),
):
    _check_bot_token(token)
    return FeedbackService(db).bot_mark_fix_attempted(feedback_id)


@router.put("/feedback/bot/{feedback_id}/reply", response_model=FeedbackItem)
def bot_reply_feedback(
    feedback_id: int,
    req: FeedbackReplyRequest,
    db: DbSession,
    token: str = Query(...),
    overwrite: bool = Query(default=False, description="已有回复时是否覆盖（默认拒绝，防止覆盖人工回复）"),
):
    """Bot 直写开发者回复 — 写入 developer_reply 并推送用户通知。"""
    _check_bot_token(token)
    fb = FeedbackService(db).bot_reply(feedback_id, req.reply, FEEDBACK_BOT_NAME, overwrite=overwrite)
    return _to_item_from_model(fb)
