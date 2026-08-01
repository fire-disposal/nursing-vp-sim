"""Cache semantics tests — pure, no database.

EmotionCache / InitiativeCache only need query().filter().first() and
add() / flush() / delete(); the in-memory FakeSession covers that.
"""

from datetime import UTC, datetime

from modules.training.patient_ai.emotion import EmotionState
from modules.training.session.cache import EmotionCache, InitiativeCache
from tests._fakes import FakeSession


class TestEmotionCache:
    def test_set_and_get(self):
        db = FakeSession()
        cache = EmotionCache()
        state = EmotionState(trust=70, comfort=60)
        cache.set(1, state, db)

        loaded = cache.get(1, db)
        assert loaded is not None
        assert loaded.trust == 70
        assert loaded.comfort == 60

    def test_get_missing_returns_none(self):
        cache = EmotionCache()
        assert cache.get(99999, FakeSession()) is None

    def test_cleanup(self):
        db = FakeSession()
        cache = EmotionCache()
        cache.set(1, EmotionState(), db)

        cache.cleanup(1, db)
        assert cache.get(1, db) is None


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
        cache.update_timer(1, old_time, db)
        cache.set_last_trigger(1, 0, db)

        assert cache.get_last_trigger(1, db) == 0.0

    def test_cleanup(self):
        db = FakeSession()
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now, db)
        cache.set_last_trigger(1, now, db)

        cache.cleanup(1, db)
        assert cache.get_timer(1, now + 10, db) == now + 10
        assert cache.get_last_trigger(1, db) == 0.0
