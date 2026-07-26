"""Unit tests for initiative engine."""

from datetime import UTC, datetime

import pytest

from prompts.training.initiative import (
    should_initiate,
)
from contexts.training.session.cache import InitiativeCache


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


class TestInitiativeCache:
    def test_timer_lifecycle(self, db_session):
        record = _create_record(db_session)
        db_session.commit()

        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(record.id, now, db_session)
        db_session.commit()

        after = cache.get_timer(record.id, now + 30, db_session)
        assert after == now

    def test_trigger_cooldown(self, db_session):
        record = _create_record(db_session)
        db_session.commit()

        cache = InitiativeCache()
        old_time = datetime.now(UTC).timestamp() - 120
        cache.update_timer(record.id, old_time, db_session)
        db_session.commit()

        personality = {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "low"}

        result = should_initiate(record.id, cache, db_session, personality, trust=50, comfort=50)
        assert result is True

        result2 = should_initiate(record.id, cache, db_session, personality, trust=50, comfort=50)
        assert result2 is False

    def test_cleanup(self, db_session):
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
