"""Session state caches — DB-backed for multi-worker safety.

Phase 2 (T8)：v2 EmotionCache 已删除（情绪状态统一走 EmotionRepository v3），
仅保留 InitiativeCache。
"""

from __future__ import annotations

import logging
from collections.abc import Set as AbstractSet
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from models import TrainingSessionState

log = logging.getLogger(__name__)


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
            row.initiative_count = 0

    def get_count(self, record_id: int, db: Session) -> int:
        row = self._get_row(record_id, db)
        return row.initiative_count if row else 0

    def increment_count(self, record_id: int, db: Session) -> int:
        row = self._get_row(record_id, db)
        if row:
            row.initiative_count += 1
            return row.initiative_count
        from models import TrainingSessionState

        db.add(TrainingSessionState(record_id=record_id, initiative_count=1))
        db.flush()
        return 1

    def cleanup_completed(self, completed_ids: AbstractSet[int], db: Session) -> int:
        from models import TrainingSessionState

        if not completed_ids:
            return 0
        return (
            db.query(TrainingSessionState)
            .filter(TrainingSessionState.record_id.in_(list(completed_ids)))
            .delete(synchronize_session="fetch")
        )
