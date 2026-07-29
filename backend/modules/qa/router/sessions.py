import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from core.database import get_db
from core.pagination import paginate
from core.security import require_permission
from models import QARecord, QASession, User
from schemas import (
    DeleteResponse,
    PaginatedResponse,
    QAMessageItem,
    QASessionAdminItem,
    QASessionItem,
)

from ..citations import extract_citations

log = logging.getLogger(__name__)

router = APIRouter()


@router.get("/sessions", response_model=list[QASessionItem])
def list_sessions(
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
    db: Annotated[Session, Depends(get_db)],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    return (
        db.query(QASession)
        .filter(QASession.user_id == current_user.id)
        .order_by(QASession.updated_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.delete("/sessions/{session_id}", response_model=DeleteResponse)
def delete_session(
    session_id: int,
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    session = (
        db.query(QASession)
        .filter(
            QASession.id == session_id,
            QASession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    db.query(QARecord).filter(QARecord.session_id == session_id).delete()
    db.delete(session)
    db.commit()

    log.info(
        f"会话删除: session_id={session_id}",
        extra={"user_id": current_user.id, "user_role": current_user.role.name if current_user.role else ""},
    )
    return {"message": "删除成功"}


def _enrich_message(record) -> dict:
    clean, citations = extract_citations(record.content)
    msg = {
        "id": record.id,
        "role": record.role,
        "content": clean,
        "created_at": record.created_at,
    }
    if citations:
        msg["citations"] = citations
    return msg


@router.get("/sessions/{session_id}/messages", response_model=list[QAMessageItem])
def get_session_messages(
    session_id: int,
    current_user: Annotated[User, Depends(require_permission("qa_access"))],
    db: Annotated[Session, Depends(get_db)],
):
    session = (
        db.query(QASession)
        .filter(
            QASession.id == session_id,
            QASession.user_id == current_user.id,
        )
        .first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    records = db.query(QARecord).filter(QARecord.session_id == session_id).order_by(QARecord.created_at.asc()).all()
    return [_enrich_message(r) for r in records]


@router.get("/history/all", response_model=PaginatedResponse[QASessionAdminItem])
def get_all_qa_history(
    current_user: Annotated[User, Depends(require_permission("stats_view"))],
    db: Annotated[Session, Depends(get_db)],
    limit: Annotated[int, Query(ge=1, le=200)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
    search: Annotated[str | None, Query(description="搜索学生姓名/学号/会话标题")] = None,
):
    base = (
        db.query(
            QASession.id,
            QASession.user_id,
            QASession.title,
            QASession.created_at,
            QASession.updated_at,
            User.display_name.label("student_name"),
            User.student_id.label("student_code"),
            func.count(QARecord.id).label("message_count"),
        )
        .outerjoin(User, QASession.user_id == User.id)
        .outerjoin(QARecord, QARecord.session_id == QASession.id)
    )
    if search:
        term = f"%{search}%"
        base = base.filter(
            or_(
                User.display_name.ilike(term),
                User.student_id.ilike(term),
                QASession.title.ilike(term),
            )
        )
    base = base.group_by(QASession.id, User.display_name, User.student_id).order_by(QASession.updated_at.desc())

    rows, total = paginate(base, offset, limit)
    items = [
        QASessionAdminItem(
            id=r.id,
            user_id=r.user_id,
            student_name=r.student_name or "",
            student_code=r.student_code or "",
            title=r.title,
            message_count=r.message_count,
            created_at=r.created_at,
            updated_at=r.updated_at,
        )
        for r in rows
    ]
    return PaginatedResponse(items=items, total=total, offset=offset, limit=limit)


@router.get("/history/all/{session_id}/messages", response_model=list[QAMessageItem])
def get_session_messages_admin(
    session_id: int,
    current_user: Annotated[User, Depends(require_permission("stats_view"))],
    db: Annotated[Session, Depends(get_db)],
):
    session = db.query(QASession).filter(QASession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    records = db.query(QARecord).filter(QARecord.session_id == session_id).order_by(QARecord.created_at.asc()).all()
    return [_enrich_message(r) for r in records]
