import logging
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from core.exceptions import LLMParseError, NoProviderAvailable
from infra.llm.client import CallContext, LLMClient


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
        assert call_args.kwargs["total_tokens"] == 42

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


class TestStreamFinishReason:
    """``finish_reason`` 是"输出被截断"的唯一可靠信号（2026-09-27）。

    没有它，评分链路的截断只能靠 JSON 形状猜，无法区分"模型说完了"与"被输出上限切断"——
    而这两者对应完全不同的处置（前者改提示词结构，后者调输出预算）。
    """

    @pytest.mark.asyncio
    async def test_length_finish_reason_warns_and_reports(self, client, caplog):
        seen: list[str] = []

        async def fake_do_stream(messages, state, *args, **kwargs):
            state.usage = {"prompt_tokens": 100, "completion_tokens": 16384, "total_tokens": 16484}
            state.finish_reason = "length"
            yield '{"total_score": 1'

        async def on_finish(reason: str) -> None:
            seen.append(reason)

        client._do_stream = fake_do_stream

        with caplog.at_level(logging.WARNING):
            chunks = [
                chunk
                async for chunk in client.stream(
                    [{"role": "user", "content": "x"}], purpose="scoring", on_finish=on_finish
                )
            ]

        assert chunks == ['{"total_score": 1']
        assert seen == ["length"]
        assert "被长度上限截断" in caplog.text

    @pytest.mark.asyncio
    async def test_stop_finish_reason_reports_without_warning(self, client, caplog):
        seen: list[str] = []

        async def fake_do_stream(messages, state, *args, **kwargs):
            state.usage = {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
            state.finish_reason = "stop"
            yield "ok"

        async def on_finish(reason: str) -> None:
            seen.append(reason)

        client._do_stream = fake_do_stream

        with caplog.at_level(logging.WARNING):
            _ = [
                chunk
                async for chunk in client.stream([{"role": "user", "content": "x"}], purpose="qa", on_finish=on_finish)
            ]

        assert seen == ["stop"]
        assert "被长度上限截断" not in caplog.text


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
