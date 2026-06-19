"""Session state caches — DB-backed for multi-worker safety."""

from __future__ import annotations

import logging
from collections.abc import Set as AbstractSet
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from contexts.patient.emotion import EmotionState
    from models import TrainingSessionState

log = logging.getLogger(__name__)


class EmotionCache:
    """DB-backed emotion state cache."""

    def __init__(self) -> None:
        pass

    def get(self, record_id: int, db: Session) -> object | None:
        from models import TrainingSessionState

        row = db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()
        if row is None or not isinstance(row.emotion_state, dict) or not row.emotion_state.get("trust"):
            return None
        from contexts.patient.emotion import EmotionState

        return EmotionState.from_dict(row.emotion_state)

    def set(self, record_id: int, state: EmotionState, db: Session) -> None:
        from contexts.patient.emotion import EmotionState
        from models import TrainingSessionState

        if isinstance(state, EmotionState):
            row = db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()
            if row:
                row.emotion_state = state.to_dict()
            else:
                row = TrainingSessionState(record_id=record_id, emotion_state=state.to_dict())
                db.add(row)

    def cleanup(self, record_id: int, db: Session) -> None:
        from models import TrainingSessionState

        row = db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()
        if row:
            db.delete(row)

    def cleanup_completed(self, completed_ids: AbstractSet[int], db: Session) -> int:
        from models import TrainingSessionState

        if not completed_ids:
            return 0
        return (
            db.query(TrainingSessionState)
            .filter(TrainingSessionState.record_id.in_(list(completed_ids)))
            .delete(synchronize_session=False)
        )

    @property
    def all_ids(self) -> AbstractSet[int]:
        return set()


class InitiativeCache:
    """DB-backed initiative timer cache."""

    def __init__(self) -> None:
        pass

    def _get_row(self, record_id: int, db: Session) -> TrainingSessionState | None:
        from models import TrainingSessionState

        return db.query(TrainingSessionState).filter(TrainingSessionState.record_id == record_id).first()

    def update_timer(self, record_id: int, timestamp: float, db: Session) -> None:
        row = self._get_row(record_id, db)
        if row:
            row.initiative_timer = timestamp
            row.initiative_last_trigger = None
        else:
            from models import TrainingSessionState

            db.add(TrainingSessionState(record_id=record_id, initiative_timer=timestamp))
            db.flush()

    def get_timer(self, record_id: int, default: float, db: Session) -> float:
        row = self._get_row(record_id, db)
        if row and row.initiative_timer is not None:
            return row.initiative_timer
        return default

    def get_last_trigger(self, record_id: int, db: Session) -> float:
        row = self._get_row(record_id, db)
        if row and row.initiative_last_trigger is not None:
            return row.initiative_last_trigger
        return 0.0

    def set_last_trigger(self, record_id: int, timestamp: float, db: Session) -> None:
        row = self._get_row(record_id, db)
        if row:
            row.initiative_last_trigger = timestamp
        else:
            from models import TrainingSessionState

            db.add(TrainingSessionState(record_id=record_id, initiative_last_trigger=timestamp))
            db.flush()

    def cleanup(self, record_id: int, db: Session) -> None:
        row = self._get_row(record_id, db)
        if row:
            row.initiative_timer = None
            row.initiative_last_trigger = None

    def cleanup_completed(self, completed_ids: AbstractSet[int], db: Session) -> int:
        from models import TrainingSessionState

        if not completed_ids:
            return 0
        return (
            db.query(TrainingSessionState)
            .filter(TrainingSessionState.record_id.in_(list(completed_ids)))
            .delete(synchronize_session=False)
        )

    @property
    def all_ids(self) -> AbstractSet[int]:
        return set()
