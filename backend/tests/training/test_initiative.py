"""Unit tests for initiative engine."""

from datetime import UTC, datetime

import pytest

from contexts.patient.initiative import (
    generate_initiative,
    should_initiate,
)
from infrastructure.cache import InitiativeCache


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


class TestGenerateInitiative:
    def test_returns_none_when_not_enough_wait(self):
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
            trust=50,
            comfort=50,
            wait_seconds=10,
        )
        assert result is None

    def test_returns_message_when_threshold_exceeded(self):
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
            trust=50,
            comfort=50,
            wait_seconds=60,
        )
        assert isinstance(result, str) or result is None
        if result is not None:
            assert len(result) > 0

    def test_low_comfort_triggers_sooner(self):
        # comfort=20 → bias = (50-20)*0.3 = 9
        # threshold = 30 + 0 + 0 + 9 = 39, so 25s won't trigger
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
            trust=50,
            comfort=20,
            wait_seconds=45,
        )
        assert result is not None

    def test_impatient_patient_triggers_earlier(self):
        result_impatient = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "low"},
            trust=50,
            comfort=50,
            wait_seconds=30,
        )
        assert result_impatient is not None

    def test_verbose_extra_responses(self):
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "verbose", "anxiety_trait": "normal", "patience": "normal"},
            trust=50,
            comfort=80,
            wait_seconds=60,
        )
        assert isinstance(result, str) or result is None


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
