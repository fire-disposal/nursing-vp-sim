"""Unit tests for EmotionRepository — optimistic-lock persistence via an in-memory fake session.

No database is used; the fake implements the subset of the Session API the
repository touches: query/filter/first/update/add/flush/delete.
"""

from models import TrainingSessionEmotionEvent, TrainingSessionEmotionState
from modules.training.patient_ai.emotion import EmoState, EmotionDelta, EmotionVector
from modules.training.patient_ai.emotion.events import (
    AppliedEmotionEvent,
    EmotionEventType,
)
from modules.training.patient_ai.emotion.repository import EmotionRepository
from tests._fakes import UpdateCapableFakeSession


def _seed_state(session: UpdateCapableFakeSession, record_id: int, *, trust=0.5, version=1, last_turn_id=None):
    row = TrainingSessionEmotionState(
        record_id=record_id,
        trust=trust,
        anxiety=0.3,
        irritation=0.2,
        cooperation=0.6,
        version=version,
        last_turn_id=last_turn_id,
    )
    session.add(row)
    return row


class TestGet:
    def test_missing_returns_none(self):
        repo = EmotionRepository()
        assert repo.get(1, UpdateCapableFakeSession()) is None

    def test_returns_state_from_row(self):
        session = UpdateCapableFakeSession()
        _seed_state(session, 7, trust=0.8, version=3, last_turn_id="t1")
        state = EmotionRepository().get(7, session)
        assert state.vector.trust == 0.8
        assert state.version == 3
        assert state.last_turn_id == "t1"


class TestGetOrCreate:
    def test_returns_existing(self):
        session = UpdateCapableFakeSession()
        _seed_state(session, 2, trust=0.9)
        state = EmotionRepository().get_or_create(2, session)
        assert state.vector.trust == 0.9
        assert len(session.added) == 1  # no new row

    def test_creates_default_when_missing(self):
        session = UpdateCapableFakeSession()
        state = EmotionRepository().get_or_create(5, session)
        assert state.vector == EmotionVector.neutral()
        assert state.version == 1
        assert len(session.added) == 1

    def test_creates_with_custom_default(self):
        session = UpdateCapableFakeSession()
        v = EmotionVector(trust=0.1, anxiety=0.9, irritation=0.0, cooperation=0.1)
        state = EmotionRepository().get_or_create(5, session, default_vector=v)
        assert state.vector.trust == 0.1


class TestSave:
    def test_success_path_bumps_version(self):
        session = UpdateCapableFakeSession()
        _seed_state(session, 1, version=2)
        repo = EmotionRepository()
        state = EmoState(
            vector=EmotionVector(trust=0.7, anxiety=0.2, irritation=0.1, cooperation=0.5),
            version=2,
            last_turn_id="exam-temp-1",
        )
        saved = repo.save(1, state, session)
        assert saved.vector.trust == 0.7
        row = session.query(TrainingSessionEmotionState).filter(TrainingSessionEmotionState.record_id == 1).first()
        assert row.version == 3
        assert row.trust == 0.7
        assert row.last_turn_id == "exam-temp-1"

    def test_optimistic_lock_conflict_merges_delta(self):
        session = UpdateCapableFakeSession()
        _seed_state(session, 1, trust=0.5, version=1)
        repo = EmotionRepository()
        stale = EmoState(
            vector=EmotionVector(trust=0.9, anxiety=0.2, irritation=0.1, cooperation=0.5),
            version=1,
            last_turn_id="x",
        )
        saved = repo.save(1, stale, session)
        # delta (0.4, -0.1, -0.1, -0.1) applied onto current 0.5 → 0.9
        assert saved.vector.trust == 0.9
        row = session.query(TrainingSessionEmotionState).filter(TrainingSessionEmotionState.record_id == 1).first()
        assert row.version == 2

    def test_conflict_exhausted_still_writes(self):
        session = UpdateCapableFakeSession()
        # 每次更新都失败：无匹配行（不存在版本）
        repo = EmotionRepository()
        state = EmoState(
            vector=EmotionVector(trust=0.6, anxiety=0.2, irritation=0.1, cooperation=0.5),
            version=99,
            last_turn_id="y",
        )
        saved = repo.save(1, state, session)
        assert saved.vector.trust == 0.6
        rows = session.query(TrainingSessionEmotionState).filter(TrainingSessionEmotionState.record_id == 1).all()
        assert len(rows) == 1
        assert rows[0].version == 1  # 无匹配行时按新建处理


class TestAppendEvents:
    def test_appends_rows_and_flushes(self):
        session = UpdateCapableFakeSession()
        repo = EmotionRepository()
        events = [
            AppliedEmotionEvent(
                type=EmotionEventType.EMPATHY,
                confidence=0.9,
                evidence="我理解",
                delta=EmotionDelta(trust=2, anxiety=0, irritation=0, cooperation=0),
                before=EmotionVector.neutral(),
                after=EmotionVector(trust=0.52, anxiety=0.5, irritation=0.5, cooperation=0.5),
            )
        ]
        repo.append_events(3, "turn-1", events, session)
        rows = session.query(TrainingSessionEmotionEvent).all()
        assert len(rows) == 1
        assert rows[0].record_id == 3
        assert rows[0].turn_id == "turn-1"
        assert rows[0].event_type == "empathy"
        assert rows[0].confidence == 0.9
        assert rows[0].delta["trust"] == 2


class TestCleanup:
    def test_removes_state_and_events(self):
        session = UpdateCapableFakeSession()
        _seed_state(session, 9)
        repo = EmotionRepository()
        repo.cleanup(9, session)
        assert session.query(TrainingSessionEmotionState).all() == []
