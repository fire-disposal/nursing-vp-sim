"""Database engine safety configuration."""

from core.database import _SESSION_OPTIONS, engine


def test_db_session_options_fail_fast_on_locks():
    assert "statement_timeout=120000" in _SESSION_OPTIONS
    assert "lock_timeout=3000" in _SESSION_OPTIONS
    assert "idle_in_transaction_session_timeout" not in _SESSION_OPTIONS


def test_db_pool_is_bounded():
    pool = engine.pool
    assert pool.size() == 10
    assert pool._max_overflow == 10
    assert pool._timeout == 30
