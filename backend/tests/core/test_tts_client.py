"""Unit tests for the v3 TTS HTTP client (newline-delimited JSON stream)."""

import base64
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from infrastructure.tts.client import TTSRequest, VolcTTSClient


def _ndjson_response(text: str) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.text = text
    resp.raise_for_status = MagicMock()
    return resp


def _client_with_response(resp: MagicMock) -> VolcTTSClient:
    client = VolcTTSClient(api_key="test-key")
    http = MagicMock(spec=httpx.AsyncClient)
    http.post = AsyncMock(return_value=resp)
    client._http = http
    return client


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


async def test_synthesize_accumulates_chunks():
    text = "\n".join(
        [
            f'{{"code":0,"data":"{_b64(b"AAA")}"}}',
            f'{{"code":0,"data":"{_b64(b"BBB")}"}}',
            '{"code":20000000}',
        ]
    )
    client = _client_with_response(_ndjson_response(text))
    audio = await client.synthesize(TTSRequest(text="你好"))
    assert audio == b"AAABBB"


async def test_synthesize_skips_blank_and_non_json_lines():
    text = "\n".join(
        [
            "",
            "not-json",
            f'{{"code":0,"data":"{_b64(b"XYZ")}"}}',
            '{"code":20000000}',
        ]
    )
    client = _client_with_response(_ndjson_response(text))
    audio = await client.synthesize(TTSRequest(text="hi"))
    assert audio == b"XYZ"


async def test_synthesize_raises_on_error_code():
    text = '{"code":1001,"message":"bad speaker"}'
    client = _client_with_response(_ndjson_response(text))
    with pytest.raises(RuntimeError, match="TTS synthesis failed"):
        await client.synthesize(TTSRequest(text="hi"))


async def test_synthesize_raises_on_empty_audio():
    text = '{"code":20000000}'
    client = _client_with_response(_ndjson_response(text))
    with pytest.raises(RuntimeError, match="empty audio"):
        await client.synthesize(TTSRequest(text="hi"))


async def test_health_check_true_on_audio():
    text = f'{{"code":0,"data":"{_b64(b"OK")}"}}\n{{"code":20000000}}'
    client = _client_with_response(_ndjson_response(text))
    assert await client.health_check(speaker="zh_female_vv_uranus_bigtts") is True


async def test_health_check_false_on_error():
    text = '{"code":401,"message":"unauthorized"}'
    client = _client_with_response(_ndjson_response(text))
    assert await client.health_check() is False


def test_build_body_uses_integer_rates():
    client = VolcTTSClient(api_key="k")
    body = client._build_body(TTSRequest(text="hi", speech_rate=15, loudness_rate=-10))
    params = body["req_params"]["audio_params"]
    assert params["speech_rate"] == 15
    assert params["loudness_rate"] == -10
    assert isinstance(params["speech_rate"], int)
