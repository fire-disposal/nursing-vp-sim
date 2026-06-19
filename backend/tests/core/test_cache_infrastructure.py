import pytest

from contexts.patient.emotion import EmotionState
from infrastructure.cache import EmotionCache, InitiativeCache


def _create_record(db):
    """Create minimal TrainingRecord for FK constraint in cache tests."""
    from models import Case, TrainingRecord, User

    user = db.query(User).filter(User.username == "__seed_test_user__").first()
    case = db.query(Case).filter(Case.name == "__seed_test_case__").first()
    if not user or not case:
        pytest.skip("No user or case in test DB")
    record = TrainingRecord(
        user_id=user.id,
        case_id=case.id,
        status="in_progress",
        time_limit=20,
    )
    db.add(record)
    db.flush()
    return record


class TestEmotionCache:
    def test_set_and_get(self, db_session):
        record = _create_record(db_session)
        db_session.commit()

        cache = EmotionCache()
        state = EmotionState(trust=70, comfort=60)
        cache.set(record.id, state, db_session)
        db_session.commit()

        loaded = cache.get(record.id, db_session)
        assert loaded is not None
        assert loaded.trust == 70
        assert loaded.comfort == 60

    def test_get_missing_returns_none(self, db_session):
        cache = EmotionCache()
        assert cache.get(99999, db_session) is None

    def test_cleanup(self, db_session):
        record = _create_record(db_session)
        db_session.commit()

        cache = EmotionCache()
        state = EmotionState()
        cache.set(record.id, state, db_session)
        db_session.commit()

        cache.cleanup(record.id, db_session)
        db_session.commit()
        assert cache.get(record.id, db_session) is None

    def test_all_ids_is_always_empty(self):
        cache = EmotionCache()
        assert cache.all_ids == set()


class TestInitiativeCache:
    def test_timer_lifecycle(self, db_session):
        from datetime import UTC, datetime

        record = _create_record(db_session)
        db_session.commit()

        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(record.id, now, db_session)
        db_session.commit()

        after = cache.get_timer(record.id, now + 30, db_session)
        assert after == now

    def test_trigger_cooldown(self, db_session):
        from datetime import UTC, datetime

        record = _create_record(db_session)
        db_session.commit()

        cache = InitiativeCache()
        old_time = datetime.now(UTC).timestamp() - 120
        cache.update_timer(record.id, old_time, db_session)
        cache.set_last_trigger(record.id, 0, db_session)
        db_session.commit()

        assert cache.get_last_trigger(record.id, db_session) == 0.0

    def test_cleanup(self, db_session):
        from datetime import UTC, datetime

        record = _create_record(db_session)
        db_session.commit()

        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(record.id, now, db_session)
        cache.set_last_trigger(record.id, now, db_session)
        db_session.commit()

        cache.cleanup(record.id, db_session)
        db_session.commit()
        assert cache.get_timer(record.id, now + 10, db_session) == now + 10
        assert cache.get_last_trigger(record.id, db_session) == 0.0

    def test_all_ids_is_always_empty(self):
        cache = InitiativeCache()
        assert cache.all_ids == set()
