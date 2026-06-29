"""Patient AI subsystem — generic utilities."""
from .note_source import NoteSource, OperationNoteSource
from .prompt import build_patient_chat_messages

__all__ = ["NoteSource", "OperationNoteSource", "build_patient_chat_messages"]
