from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from core.exceptions import LLMParseError, NoProviderAvailable
from infrastructure.llm.client import CallContext, LLMClient


@pytest.fixture
def mock_http():
    http = MagicMock(spec=httpx.AsyncClient)
    http.post = AsyncMock()
    return http


@pytest.fixture
def mock_router():
    router = MagicMock()
    mock_config = MagicMock()
    mock_config.id = 1
    mock_config.model = "test-model"
    mock_config.secret = MagicMock()
    mock_config.secret.base_url = "https://test.api.com"
    mock_config.secret.price_input_per_1m = 1.0
    mock_config.secret.price_output_per_1m = 2.0
    router.select.return_value = mock_config
    router.get_decrypted_key.return_value = "sk-test-key"
    router.report_result = AsyncMock()
    return router


@pytest.fixture
def mock_log_worker():
    return MagicMock()


@pytest.fixture
def client(mock_http, mock_router, mock_log_worker):
    return LLMClient(
        http=mock_http,
        router=mock_router,
        log_worker=mock_log_worker,
        concurrency=10,
    )


def _make_resp(content: str, tokens: int = 50):
    resp = MagicMock()
    resp.json.return_value = {
        "choices": [{"message": {"content": content}}],
        "usage": {"total_tokens": tokens},
    }
    resp.status_code = 200
    return resp


class TestLLMClientCall:
    @pytest.mark.asyncio
    async def test_successful_call(self, client, mock_http):
        mock_http.post.return_value = _make_resp("Hello, patient!")
        result = await client.call(
            [{"role": "user", "content": "Hi"}],
            purpose="patient_chat",
            ctx=CallContext(user_id=1, record_id=10),
        )
        assert result == "Hello, patient!"
        mock_http.post.assert_called_once()

    @pytest.mark.asyncio
    async def test_calls_router_select(self, client, mock_http, mock_router):
        mock_http.post.return_value = _make_resp("ok")
        await client.call([{"role": "user", "content": "test"}], purpose="qa")
        mock_router.select.assert_called_with("qa")

    @pytest.mark.asyncio
    async def test_calls_report_result(self, client, mock_http, mock_router):
        mock_http.post.return_value = _make_resp("ok", tokens=42)
        await client.call([{"role": "user", "content": "test"}], purpose="qa")
        mock_router.report_result.assert_called_once()
        call_args = mock_router.report_result.call_args
        assert call_args.kwargs["success"] is True
        assert call_args.kwargs["tokens"] == 42

    @pytest.mark.asyncio
    async def test_logs_on_success(self, client, mock_http, mock_log_worker):
        mock_http.post.return_value = _make_resp("test response")
        await client.call([{"role": "user", "content": "test"}], purpose="qa")
        mock_log_worker.enqueue.assert_called()
        enq_kwargs = mock_log_worker.enqueue.call_args.kwargs
        assert enq_kwargs["status"] == "success"
        assert enq_kwargs["purpose"] == "qa"
        assert enq_kwargs["response_text"] == "test response"

    @pytest.mark.asyncio
    async def test_logs_on_failure(self, client, mock_http, mock_log_worker):
        resp = httpx.Response(500, request=httpx.Request("POST", "http://x"))
        mock_http.post.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=object(),
            response=resp,
        )

        with pytest.raises(NoProviderAvailable):
            await client.call(
                [{"role": "user", "content": "test"}],
                purpose="qa",
                max_retries=0,
            )
        enq_kwargs = mock_log_worker.enqueue.call_args.kwargs
        assert enq_kwargs["status"] == "failed"


class TestLLMClientCallJSON:
    @pytest.mark.asyncio
    async def test_successful_json_call(self, client, mock_http):
        mock_http.post.return_value = _make_resp('{"score": 85}')
        result = await client.call_json(
            [{"role": "user", "content": "score"}],
            purpose="scoring",
        )
        assert result == {"score": 85}

    @pytest.mark.asyncio
    async def test_json_parse_failure(self, client, mock_http):
        mock_http.post.return_value = _make_resp("not json")
        with pytest.raises(LLMParseError):
            await client.call_json(
                [{"role": "user", "content": "test"}],
                purpose="scoring",
            )


class TestCallContext:
    def test_defaults(self):
        ctx = CallContext()
        assert ctx.purpose == "other"
        assert ctx.user_id is None

    def test_custom_values(self):
        ctx = CallContext(purpose="scoring", user_id=5, record_id=10)
        assert ctx.purpose == "scoring"
        assert ctx.user_id == 5
        assert ctx.record_id == 10
