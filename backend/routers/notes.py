from fastapi import APIRouter

from core.deps import CurrentUser, DbSession
from schemas import DeleteResponse, NoteCreateRequest, NoteItem
from services.note import NoteService

router = APIRouter(prefix="/api/notes", tags=["笔记"])


@router.get("/{record_id}", response_model=list[NoteItem])
def get_notes(
    record_id: int,
    current_user: CurrentUser,
    db: DbSession,
):
    return NoteService(db).get_notes(record_id, current_user)


@router.post("/{record_id}", response_model=NoteItem)
def save_note(
    record_id: int,
    req: NoteCreateRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    return NoteService(db).save_note(record_id, req.content, current_user)


@router.put("/{note_id}", response_model=NoteItem)
def update_note(
    note_id: int,
    req: NoteCreateRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    return NoteService(db).update_note(note_id, req.content, current_user)


@router.delete("/{note_id}", response_model=DeleteResponse)
def delete_note(
    note_id: int,
    current_user: CurrentUser,
    db: DbSession,
):
    NoteService(db).delete_note(note_id, current_user)
    return {"message": "笔记已删除"}
