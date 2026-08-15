"""Cache semantics tests — pure, no database.

Phase 2 (T8)：v2 EmotionCache 已删除（情绪统一走 EmotionRepository v3）。
"""

from datetime import UTC, datetime
from typing import TYPE_CHECKING, cast

from modules.training.session.cache import InitiativeCache
from tests._fakes import FakeSession

if TYPE_CHECKING:
    from sqlalchemy.orm import Session


_DB = cast("Session", FakeSession())


def _fake_db() -> "Session":
    return cast("Session", FakeSession())


class TestInitiativeCache:
    def test_timer_lifecycle(self):
        db = _fake_db()
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now, db)

        assert cache.get_timer(1, now + 30, db) == now

    def test_trigger_cooldown(self):
        db = _fake_db()
        cache = InitiativeCache()
        old_time = datetime.now(UTC).timestamp() - 120
        cache.update_timer(1, old_time, db)
        cache.set_last_trigger(1, 0, db)

        assert cache.get_last_trigger(1, db) == 0.0

    def test_cleanup(self):
        db = _fake_db()
        cache = InitiativeCache()
        now = datetime.now(UTC).timestamp()
        cache.update_timer(1, now, db)
        cache.set_last_trigger(1, now, db)

        cache.cleanup(1, db)
        assert cache.get_timer(1, now + 10, db) == now + 10
        assert cache.get_last_trigger(1, db) == 0.0
