import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import require_permission
from models import QARecord, QASession, User
from schemas import (
    DeleteResponse,
    QAMessageItem,
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
