import time
from unittest.mock import patch

import pytest

from middleware.rate_limits import RateLimiter


class TestIsAllowed:
    async def test_first_request_allowed(self):
        limiter = RateLimiter()
        result = await limiter.is_allowed("test_key", max_requests=5, window_seconds=60)
        assert result is True

    async def test_requests_up_to_max_allowed(self):
        limiter = RateLimiter()
        for _ in range(5):
            result = await limiter.is_allowed("test_key", max_requests=5, window_seconds=60)
            assert result is True

    async def test_exceeded_max_blocked(self):
        limiter = RateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is False

    async def test_different_keys_independent(self):
        limiter = RateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is False
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True

    async def test_window_expiration_allows_new_requests(self):
        limiter = RateLimiter()
        with patch("middleware.rate_limits.time.time") as mock_time:
            mock_time.return_value = 1000.0
            for _ in range(5):
                assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True
            assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is False

            mock_time.return_value = 1100.0
            for _ in range(5):
                assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True

    async def test_window_partial_prune(self):
        limiter = RateLimiter()
        with patch("middleware.rate_limits.time.time") as mock_time:
            mock_time.return_value = 1000.0
            await limiter.is_allowed("test_key", max_requests=3, window_seconds=60)
            mock_time.return_value = 1020.0
            await limiter.is_allowed("test_key", max_requests=3, window_seconds=60)
            mock_time.return_value = 1040.0
            await limiter.is_allowed("test_key", max_requests=3, window_seconds=60)

            mock_time.return_value = 1061.0
            assert await limiter.is_allowed("test_key", max_requests=3, window_seconds=60) is True

            assert await limiter.is_allowed("test_key", max_requests=3, window_seconds=60) is False


class TestResetKey:
    async def test_reset_allows_requests_again(self):
        limiter = RateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is False

        await limiter.reset_key("test_key")
        assert await limiter.is_allowed("test_key", max_requests=5, window_seconds=60) is True

    async def test_reset_nonexistent_key_no_error(self):
        limiter = RateLimiter()
        await limiter.reset_key("nonexistent")

    async def test_reset_only_affects_specified_key(self):
        limiter = RateLimiter()
        for _ in range(5):
            assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is True
        for _ in range(3):
            assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True

        await limiter.reset_key("key_a")

        assert await limiter.is_allowed("key_a", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is True
        assert await limiter.is_allowed("key_b", max_requests=5, window_seconds=60) is False


class TestCleanup:
    async def test_removes_stale_keys(self):
        limiter = RateLimiter()
        with patch("middleware.rate_limits.time.time") as mock_time:
            mock_time.return_value = 1000.0
            await limiter.is_allowed("stale_key", max_requests=5, window_seconds=60)
            await limiter.is_allowed("fresh_key", max_requests=5, window_seconds=60)

            mock_time.return_value = 2000.0
            await limiter.is_allowed("fresh_key", max_requests=5, window_seconds=60)

            await limiter.cleanup(max_age_seconds=600)

            assert await limiter.is_allowed("stale_key", max_requests=5, window_seconds=60) is True
            assert await limiter.is_allowed("fresh_key", max_requests=5, window_seconds=60) is True

    async def test_keeps_fresh_keys(self):
        limiter = RateLimiter()
        with patch("middleware.rate_limits.time.time") as mock_time:
            mock_time.return_value = 1000.0
            await limiter.is_allowed("fresh_key", max_requests=5, window_seconds=60)

            mock_time.return_value = 1010.0
            await limiter.cleanup(max_age_seconds=600)

            assert len(limiter._store) == 1

    async def test_cleanup_with_default_max_age(self):
        limiter = RateLimiter()
        with patch("middleware.rate_limits.time.time") as mock_time:
            mock_time.return_value = 1000.0
            await limiter.is_allowed("old_key", max_requests=5, window_seconds=60)

            mock_time.return_value = 2000.0
            await limiter.cleanup()

            assert len(limiter._store) == 0

    async def test_cleanup_empty_store(self):
        limiter = RateLimiter()
        await limiter.cleanup()
