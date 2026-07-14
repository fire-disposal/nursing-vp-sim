"""Unit tests for the v3 TTS bidirectional WebSocket client.

The bidirectional WebSocket protocol requires a live Volcengine API endpoint
and cannot be meaningfully unit-tested with mocks.  Integration tests should
be run against the staging environment with a valid API key.
"""

import pytest

from infrastructure.tts.client import TTSRequest


class TestVolcBidirectionalTTSClient:
    def test_request_fields(self) -> None:
        req = TTSRequest(text="你好", speech_rate=15, loudness_rate=-10)
        assert req.text == "你好"
        assert req.speech_rate == 15
        assert req.loudness_rate == -10
        assert req.fmt == "mp3"
        assert req.sample_rate == 24000

    @pytest.mark.skip(reason="requires live Volcengine API endpoint")
    async def test_integration_synthesize(self) -> None:
        pass
