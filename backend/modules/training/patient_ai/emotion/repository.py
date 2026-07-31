"""四维情绪持久化 — 乐观锁 + 事件历史 append-only。

EmotionRepository: 读写 training_session_emotion_state + training_session_emotion_event。
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import TYPE_CHECKING

from models import TrainingSessionEmotionEvent, TrainingSessionEmotionState

from .events import AppliedEmotionEvent
from .models import EmotionDelta, EmotionState, EmotionVector

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

log = logging.getLogger(__name__)

MAX_RETRY = 2


class EmotionRepository:
    """四维情绪状态持久化。

    乐观锁：UPDATE … WHERE version = expected_version。
    失败时最多重试 MAX_RETRY 次。
    """

    def __init__(self) -> None:
        pass

    def get(self, record_id: int, db: Session) -> EmotionState | None:
        """读取当前 4D 状态。不存在返回 None。"""
        row = db.query(TrainingSessionEmotionState).filter(
            TrainingSessionEmotionState.record_id == record_id
        ).first()
        if row is None:
            return None
        return EmotionState(
            vector=EmotionVector(
                trust=float(row.trust),
                anxiety=float(row.anxiety),
                irritation=float(row.irritation),
                cooperation=float(row.cooperation),
            ),
            version=row.version,
            last_turn_id=row.last_turn_id,
            updated_at=row.updated_at,
        )

    def get_or_create(
        self,
        record_id: int,
        db: Session,
        default_vector: EmotionVector | None = None,
    ) -> EmotionState:
        """读取状态，不存在则创建并返回默认。"""
        state = self.get(record_id, db)
        if state is not None:
            return state
        v = default_vector or EmotionVector.neutral()
        row = TrainingSessionEmotionState(
            record_id=record_id,
            trust=v.trust,
            anxiety=v.anxiety,
            irritation=v.irritation,
            cooperation=v.cooperation,
            version=1,
        )
        db.add(row)
        db.flush()
        return EmotionState(vector=v, version=1)

    def save(
        self,
        record_id: int,
        state: EmotionState,
        db: Session,
    ) -> EmotionState:
        """乐观锁保存。失败时重试（最多 MAX_RETRY 次）。

        返回最终保存成功的状态。
        """
        for attempt in range(MAX_RETRY + 1):
            rows = (
                db.query(TrainingSessionEmotionState)
                .filter(
                    TrainingSessionEmotionState.record_id == record_id,
                    TrainingSessionEmotionState.version == state.version,
                )
                .update(
                    {
                        "trust": state.vector.trust,
                        "anxiety": state.vector.anxiety,
                        "irritation": state.vector.irritation,
                        "cooperation": state.vector.cooperation,
                        "version": state.version + 1,
                        "last_turn_id": state.last_turn_id,
                        "updated_at": datetime.now(UTC),
                    },
                    synchronize_session="fetch",
                )
            )
            if rows > 0:
                db.flush()
                return state

            if attempt < MAX_RETRY:
                log.warning(
                    "Emotion optimistic lock conflict: record_id=%d version=%d, retrying",
                    record_id,
                    state.version,
                )
                current = self.get(record_id, db)
                if current is None:
                    row = TrainingSessionEmotionState(
                        record_id=record_id,
                        trust=state.vector.trust,
                        anxiety=state.vector.anxiety,
                        irritation=state.vector.irritation,
                        cooperation=state.vector.cooperation,
                        version=1,
                        last_turn_id=state.last_turn_id,
                    )
                    db.add(row)
                    db.flush()
                    return state
                state = EmotionState(
                    vector=current.vector.apply(
                        EmotionDelta(
                            trust=state.vector.trust - current.vector.trust,
                            anxiety=state.vector.anxiety - current.vector.anxiety,
                            irritation=state.vector.irritation - current.vector.irritation,
                            cooperation=state.vector.cooperation - current.vector.cooperation,
                        )
                    ),
                    version=current.version,
                    last_turn_id=state.last_turn_id,
                )

        log.error(
            "Emotion optimistic lock exhausted: record_id=%d",
            record_id,
        )
        # 最终强制写入
        db.query(TrainingSessionEmotionState).filter(
            TrainingSessionEmotionState.record_id == record_id,
        ).update(
            {
                "trust": state.vector.trust,
                "anxiety": state.vector.anxiety,
                "irritation": state.vector.irritation,
                "cooperation": state.vector.cooperation,
                "version": state.version + 1,
                "last_turn_id": state.last_turn_id,
                "updated_at": datetime.now(UTC),
            },
            synchronize_session="fetch",
        )
        db.flush()
        return state

    def append_events(
        self,
        record_id: int,
        turn_id: str,
        events: list[AppliedEmotionEvent],
        db: Session,
    ) -> None:
        """批量写入事件历史。"""
        for event in events:
            row = TrainingSessionEmotionEvent(
                record_id=record_id,
                turn_id=turn_id,
                event_type=event.type.value,
                confidence=event.confidence,
                evidence=event.evidence,
                delta=event.delta.to_dict(),
                before_state=event.before.to_dict(),
                after_state=event.after.to_dict(),
            )
            db.add(row)
        db.flush()

    def cleanup(self, record_id: int, db: Session) -> None:
        """删除指定 record 的状态和事件历史。"""
        db.query(TrainingSessionEmotionState).filter(
            TrainingSessionEmotionState.record_id == record_id
        ).delete()
        db.query(TrainingSessionEmotionEvent).filter(
            TrainingSessionEmotionEvent.record_id == record_id
        ).delete()
