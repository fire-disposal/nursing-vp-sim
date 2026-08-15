"""Unit tests for initiative gaps — fallback wording and trigger bookkeeping."""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

import pytest

from models import TrainingSessionEmotionState
from modules.training.patient_ai.initiative import (
    _last_resort_fallback,
    apply_initiative_penalty,
    mark_initiative_triggered,
    update_initiative_timer,
)
from modules.training.session.cache import InitiativeCache
from tests._fakes import FakeSession, UpdateCapableFakeSession

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


def _db(fake) -> "Session":
    return cast("Session", fake)


class TestLastResortFallback:
    def test_known_moods_have_custom_text(self):
        assert _last_resort_fallback("沉默回避") == "（沉默地等着）"
        assert _last_resort_fallback("焦虑不安") == "[不安地挪动身体]"
        assert _last_resort_fallback("开放信任") == "你还有什么想了解的？"
        assert _last_resort_fallback("正常") == "还有什么要问的吗？"

    def test_unknown_mood_falls_back(self):
        assert _last_resort_fallback("什么鬼") == "……"


class TestTriggerBookkeeping:
    def test_mark_initiative_triggered_increments_count(self):
        from models import TrainingSessionState

        cache = InitiativeCache()
        db = FakeSession()
        db.add(TrainingSessionState(record_id=1, initiative_count=0))
        count = mark_initiative_triggered(1, cache, _db(db))
        assert count == 1
        assert mark_initiative_triggered(1, cache, _db(db)) == 2

    def test_update_initiative_timer_sets_now(self):
        from models import TrainingSessionState

        cache = InitiativeCache()
        db = FakeSession()
        db.add(TrainingSessionState(record_id=1, initiative_count=0))
        before = datetime.now(UTC).timestamp()
        update_initiative_timer(1, cache, _db(db))
        state = db.rows.get(1)
        assert state is not None
        assert state.initiative_timer >= before  # ty: ignore[unresolved-attribute]


class TestInitiativePenalty:
    """回归：v2 残留的 repo.apply() 已不存在，惩罚必须通过 v3 API 真实落库。"""

    def _state_row(self, db: UpdateCapableFakeSession, record_id: int, trust: float = 0.5):
        row = TrainingSessionEmotionState(
            record_id=record_id,
            trust=trust,
            anxiety=0.3,
            irritation=0.2,
            cooperation=0.6,
            version=1,
        )
        db.add(row)
        return row

    def test_penalty_applies_trust_and_cooperation_delta(self):
        db = UpdateCapableFakeSession()
        self._state_row(db, 1, trust=0.5)
        cache = InitiativeCache()

        result = apply_initiative_penalty(1, cache, _db(db))

        assert result["trust"] == 42  # 0.50-0.08=0.42 → 0-100 序列化
        row = db.query(TrainingSessionEmotionState).filter(TrainingSessionEmotionState.record_id == 1).first()
        assert row is not None
        assert row.trust == 0.42  # ty: ignore[unresolved-attribute]
        assert row.cooperation == pytest.approx(0.56, abs=1e-9)  # ty: ignore[unresolved-attribute]
        assert row.version == 2  # ty: ignore[unresolved-attribute]

    def test_penalty_noop_without_state(self):
        db = UpdateCapableFakeSession()
        cache = InitiativeCache()
        assert apply_initiative_penalty(1, cache, _db(db)) == {}
        assert db.query(TrainingSessionEmotionState).all() == []

    def test_penalty_clamps_at_zero(self):
        db = UpdateCapableFakeSession()
        self._state_row(db, 1, trust=0.02)
        cache = InitiativeCache()
        result = apply_initiative_penalty(1, cache, _db(db))
        assert result["trust"] == 0.0
