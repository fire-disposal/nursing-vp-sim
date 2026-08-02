"""Unit tests for Volcengine TTS auth header builder."""

from infra.volc.auth import VOLC_BASE_URL, VOLC_WS_BASE_URL, tts_headers


class TestTtsHeaders:
    def test_contains_api_key_and_resource(self):
        headers = tts_headers("my-api-key", "resource-123")
        assert headers["X-Api-Key"] == "my-api-key"
        assert headers["X-Api-Resource-Id"] == "resource-123"

    def test_json_content_type(self):
        headers = tts_headers("k", "r")
        assert headers["Content-Type"] == "application/json"

    def test_usage_tokens_return_requested(self):
        headers = tts_headers("k", "r")
        assert headers["X-Control-Require-Usage-Tokens-Return"] == "*"

    def test_base_urls(self):
        assert VOLC_BASE_URL == "https://openspeech.bytedance.com"
        assert VOLC_WS_BASE_URL == "wss://openspeech.bytedance.com"
