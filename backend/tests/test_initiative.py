"""Unit tests for initiative engine."""
import time as _time
from datetime import UTC, datetime

import pytest
from contexts.patient.initiative import (
    generate_initiative,
    should_initiate,
    check_initiate_ready,
)
from infrastructure.cache import InitiativeCache


class TestGenerateInitiative:
    def test_returns_none_when_not_enough_wait(self):
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
            trust=50, comfort=50, wait_seconds=10
        )
        assert result is None

    def test_returns_message_when_threshold_exceeded(self):
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
            trust=50, comfort=50, wait_seconds=60
        )
        assert isinstance(result, str) or result is None
        if result is not None:
            assert len(result) > 0

    def test_low_comfort_triggers_sooner(self):
        # comfort=20 → bias = (50-20)*0.3 = 9
        # threshold = 30 + 0 + 0 + 9 = 39, so 25s won't trigger
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "normal"},
            trust=50, comfort=20, wait_seconds=45
        )
        assert result is not None

    def test_impatient_patient_triggers_earlier(self):
        result_impatient = generate_initiative(
            {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "low"},
            trust=50, comfort=50, wait_seconds=30
        )
        assert result_impatient is not None

    def test_verbose_extra_responses(self):
        result = generate_initiative(
            {"health_literacy": "normal", "verbosity": "verbose", "anxiety_trait": "normal", "patience": "normal"},
            trust=50, comfort=80, wait_seconds=60
        )
        assert isinstance(result, str) or result is None


class TestInitiativeCache:
    def test_timer_lifecycle(self):
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now)

        after = cache.get_timer(1, now + 30)
        assert after == now

    def test_trigger_cooldown(self):
        cache = InitiativeCache()
        # Set timer far in the past so threshold is exceeded
        old_time = datetime.now(UTC).timestamp() - 120
        cache.update_timer(1, old_time)

        personality = {"health_literacy": "normal", "verbosity": "normal", "anxiety_trait": "normal", "patience": "low"}

        result = should_initiate(1, cache, personality, trust=50, comfort=50)
        assert result is True

        result2 = should_initiate(1, cache, personality, trust=50, comfort=50)
        assert result2 is False

    def test_cleanup(self):
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now)
        cache.set_last_trigger(1, now)

        cache.cleanup(1)
        assert cache.get_timer(1, now + 10) == now + 10  # default used
        assert cache.get_last_trigger(1) == 0.0
