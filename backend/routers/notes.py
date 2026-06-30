"""Notes API — lightweight structured notes with optional training record binding."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from core.exceptions import NotFoundError
from core.security import get_current_user
from models import Note, User

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/notes", tags=["笔记"])


class NoteCreateRequest(BaseModel):
    record_id: int | None = None
    type: str = "free"
    title: str = ""
    content: dict = Field(default_factory=dict)
    tags: list[str] | None = None
    is_private: bool = True


class NoteUpdateRequest(BaseModel):
    type: str | None = None
    title: str | None = None
    content: dict | None = None
    tags: list[str] | None = None
    is_private: bool | None = None


class NoteResponse(BaseModel):
    id: int
    record_id: int | None
    user_id: int
    type: str
    title: str
    content: dict
    tags: list[str] | None
    is_private: bool
    training_type: str | None
    created_at: str
    updated_at: str


@router.get("", response_model=list[NoteResponse])
def list_notes(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
    record_id: int | None = Query(None),
):
    q = db.query(Note).filter(Note.user_id == current_user.id)
    if record_id is not None:
        q = q.filter(Note.record_id == record_id)
    notes = q.order_by(Note.created_at.desc()).all()
    return [_note_to_resp(n) for n in notes]


@router.post("", response_model=NoteResponse, status_code=201)
def create_note(
    req: NoteCreateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    note = Note(
        record_id=req.record_id,
        user_id=current_user.id,
        type=req.type,
        title=req.title,
        content_jsonb=req.content,
        tags=req.tags,
        is_private=req.is_private,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _note_to_resp(note)


@router.get("/{note_id}", response_model=NoteResponse)
def get_note(
    note_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note or (note.is_private and note.user_id != current_user.id):
        raise NotFoundError("笔记不存在")
    return _note_to_resp(note)


@router.put("/{note_id}", response_model=NoteResponse)
def update_note(
    note_id: int,
    req: NoteUpdateRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note or note.user_id != current_user.id:
        raise NotFoundError("笔记不存在")
    for field in ("type", "title", "tags", "is_private"):
        val = getattr(req, field, None)
        if val is not None:
            setattr(note, field, val)
    if req.content is not None:
        note.content_jsonb = req.content
    db.commit()
    db.refresh(note)
    return _note_to_resp(note)


@router.delete("/{note_id}")
def delete_note(
    note_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_db)],
):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note or note.user_id != current_user.id:
        raise NotFoundError("笔记不存在")
    db.delete(note)
    db.commit()
    return {"ok": True}


def _note_to_resp(n: Note) -> NoteResponse:
    return NoteResponse(
        id=n.id,
        record_id=n.record_id,
        user_id=n.user_id,
        type=n.type,
        title=n.title,
        content=n.content_jsonb if isinstance(n.content_jsonb, dict) else {"text": str(n.content)},
        tags=n.tags,
        is_private=n.is_private,
        training_type=n.training_type,
        created_at=str(n.created_at) if n.created_at else "",
        updated_at=str(n.updated_at) if n.updated_at else "",
    )
