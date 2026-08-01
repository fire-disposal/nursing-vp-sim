from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from core.rate_limits import PgRateLimiter


@pytest.fixture(autouse=True)
def _clean_rate_entries(engine):
    """rate_limit_entries 是真提交写入（绕过 _test_connection），测试间必须清表，
    否则前序测试的计数会累积导致后续断言失败。"""
    with engine.begin() as conn:
        conn.execute(text("DELETE FROM rate_limit_entries"))


class TestIsAllowed:
    async def test_first_request_allowed(self, engine):
        limiter = PgRateLimiter()
        result = await limiter.is_allowed("test_key", max_requests=5, window_seconds=60)
        assert result is True

    async def test_requests_up_to_max_allowed(self, engine):
        limiter = PgRateLimiter()
        for _ in range(5):
            result = await limiter.is_allowed("test_key", max_requests=5, window_seconds=60)
            assert result is True

    async def test_exceeded_max_blocked(self, engine):
        limiter = PgRateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is False

    async def test_different_keys_independent(self, engine):
        limiter = PgRateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is False
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True

    async def test_window_expiration_allows_new_requests(self, engine):
        limiter = PgRateLimiter()
        now = datetime.now(UTC)
        old = now - timedelta(seconds=120)
        with engine.connect() as conn:
            for _ in range(5):
                conn.execute(
                    text("INSERT INTO rate_limit_entries (key, created_at) VALUES (:key, :ts)"),
                    {"key": "test_key", "ts": old},
                )
            conn.commit()

        for _ in range(5):
            assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True

    async def test_window_partial_prune(self, engine):
        limiter = PgRateLimiter()
        now = datetime.now(UTC)
        with engine.connect() as conn:
            conn.execute(
                text("INSERT INTO rate_limit_entries (key, created_at) VALUES (:key, :ts)"),
                {"key": "test_key", "ts": now - timedelta(seconds=120)},
            )
            conn.execute(
                text("INSERT INTO rate_limit_entries (key, created_at) VALUES (:key, :ts)"),
                {"key": "test_key", "ts": now},
            )
            conn.commit()

        assert await limiter.is_allowed("test_key", max_requests=3, window_seconds=60) is True
        assert await limiter.is_allowed("test_key", max_requests=3, window_seconds=60) is True
        assert await limiter.is_allowed("test_key", max_requests=3, window_seconds=60) is False


class TestResetKey:
    async def test_reset_allows_requests_again(self, engine):
        limiter = PgRateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is False

        await limiter.reset_key("test_key")
        assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True

    async def test_reset_nonexistent_key_no_error(self, engine):
        limiter = PgRateLimiter()
        await limiter.reset_key("nonexistent")

    async def test_reset_only_affects_specified_key(self, engine):
        limiter = PgRateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is True
        for _ in range(3):
            assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True

        await limiter.reset_key("key_a")

        assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is False


pytestmark = pytest.mark.integration
