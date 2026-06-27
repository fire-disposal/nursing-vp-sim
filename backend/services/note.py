from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.exceptions import AuthError, NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from models import Note, TrainingRecord, User
from repositories.note import NoteRepository


class NoteService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = NoteRepository(db)

    def get_notes(self, record_id: int, current_user: User) -> list[Note]:
        record = self.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise NotFoundError("记录不存在")
        if record.user_id != current_user.id:
            if not current_user.has_permission("record_notes"):
                raise AuthError("无权查看", status_code=403)
        return self.repo.list_by_record(record_id)

    def save_note(self, record_id: int, content: str, current_user: User) -> Note:
        record = self.db.query(TrainingRecord).filter(TrainingRecord.id == record_id).first()
        if not record:
            raise NotFoundError("记录不存在")
        if record.user_id != current_user.id:
            raise AuthError("只能在自己的训练中记笔记", status_code=403)
        if record.status != "in_progress":
            raise ValidationError("训练已结束")

        with unit_of_work(self.db, conflict_detail="笔记创建冲突"):
            return self.repo.add(
                Note(
                    record_id=record_id,
                    user_id=current_user.id,
                    content=content,
                )
            )

    def update_note(self, note_id: int, content: str, current_user: User) -> Note:
        note = self.repo.get_or_404(note_id, "笔记不存在")
        if note.user_id != current_user.id:
            raise AuthError("只能编辑自己的笔记", status_code=403)

        note.content = content
        note.updated_at = datetime.now(UTC)
        with unit_of_work(self.db, conflict_detail="笔记更新冲突"):
            self.db.flush()
        return note

    def delete_note(self, note_id: int, current_user: User) -> None:
        note = self.repo.get_or_404(note_id, "笔记不存在")
        if note.user_id != current_user.id:
            raise AuthError("只能删除自己的笔记", status_code=403)

        with unit_of_work(self.db, conflict_detail="笔记删除冲突"):
            self.repo.delete(note)
