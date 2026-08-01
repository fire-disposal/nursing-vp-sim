"""Unit tests for initiative engine — pure, no database."""

from datetime import UTC, datetime

from models import TrainingSessionState
from modules.training.patient_ai.emotion import EmotionVector
from modules.training.patient_ai.initiative import should_initiate
from modules.training.session.cache import InitiativeCache
from tests._fakes import FakeSession


class TestInitiativeCache:
    def test_timer_lifecycle(self):
        db = FakeSession()
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now, db)

        assert cache.get_timer(1, now + 30, db) == now

    def test_trigger_cooldown(self):
        db = FakeSession()
        cache = InitiativeCache()
        old_time = datetime.now(UTC).timestamp() - 120
        # init row with full column defaults (SQLAlchemy fills them on flush)
        db.rows[1] = TrainingSessionState(record_id=1, initiative_timer=old_time, initiative_count=0)

        personality = {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "low"}
        vector = EmotionVector(trust=0.5, anxiety=0.5, irritation=0.0, cooperation=0.5)

        assert should_initiate(1, cache, db, personality, vector) is True
        assert should_initiate(1, cache, db, personality, vector) is False

    def test_cleanup(self):
        db = FakeSession()
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now, db)
        cache.set_last_trigger(1, now, db)

        cache.cleanup(1, db)
        assert cache.get_timer(1, now + 10, db) == now + 10
        assert cache.get_last_trigger(1, db) == 0.0
