import httpx
import pytest

from core.exceptions import LLMRateLimited, NoProviderAvailable
from infrastructure.llm.circuit import async_retry, backoff_delay


class TestBackoffDelay:

    def test_increases_with_attempt(self):
        d0 = backoff_delay(0)
        d2 = backoff_delay(2)
        assert d0 < d2

    def test_max_cap(self):
        d10 = backoff_delay(10)
        assert d10 <= 16.5


class TestAsyncRetry:

    @pytest.mark.asyncio
    async def test_success_first_try(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            return "ok"

        result = await async_retry(fn, max_retries=2)
        assert result == "ok"
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_timeout(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise httpx.TimeoutException("timeout")
            return "ok"

        result = await async_retry(fn, max_retries=3)
        assert result == "ok"
        assert call_count == 3

    @pytest.mark.asyncio
    async def test_exhaust_retries_raises(self):
        async def fn():
            raise httpx.ConnectError("refused")

        with pytest.raises(NoProviderAvailable):
            await async_retry(fn, max_retries=1)

    @pytest.mark.asyncio
    async def test_all_429_raises_rate_limited(self):
        async def fn():
            resp = httpx.Response(429, request=httpx.Request("POST", "http://x"))
            raise httpx.HTTPStatusError("429", request=object(), response=resp)

        with pytest.raises(LLMRateLimited):
            await async_retry(fn, max_retries=1)

    @pytest.mark.asyncio
    async def test_non_retryable_status_raises_immediately(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            resp = httpx.Response(400, request=httpx.Request("POST", "http://x"))
            raise httpx.HTTPStatusError("400", request=object(), response=resp)

        with pytest.raises(httpx.HTTPStatusError):
            await async_retry(fn, max_retries=3)
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_retry_on_5xx(self):
        call_count = 0

        async def fn():
            nonlocal call_count
            call_count += 1
            if call_count < 2:
                resp = httpx.Response(503, request=httpx.Request("POST", "http://x"))
                raise httpx.HTTPStatusError("503", request=object(), response=resp)
            return "ok"

        result = await async_retry(fn, max_retries=2)
        assert result == "ok"
        assert call_count == 2
