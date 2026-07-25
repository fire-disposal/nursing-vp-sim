"""Shared Volcengine v3 authentication header builder.

Provides HTTP headers for the v3 TTS endpoint.
The new Volcengine console issues a single ``X-Api-Key`` that
replaces the legacy ``app_id`` + ``token`` pair.
"""

VOLC_BASE_URL = "https://openspeech.bytedance.com"
VOLC_WS_BASE_URL = "wss://openspeech.bytedance.com"


def tts_headers(api_key: str, resource_id: str) -> dict[str, str]:
    """Build HTTP headers for the v3 TTS unidirectional endpoint."""
    return {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": resource_id,
        "Content-Type": "application/json",
        # Ask the server to echo the billed character count back to us.
        "X-Control-Require-Usage-Tokens-Return": "*",
    }
