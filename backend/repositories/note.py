from models import Note
from repositories.base import Repository


class NoteRepository(Repository[Note]):
    model = Note

    def list_by_record(self, record_id: int) -> list[Note]:
        return self.list(Note.record_id == record_id, order_by=Note.updated_at.desc())

    def get_by_id(self, note_id: int) -> Note | None:
        return self.get(note_id)
