"""Shared Volcengine v3 authentication header builder.

This is the ONLY module shared between the TTS (HTTP) and ASR (WebSocket)
clients. The new Volcengine console issues a single ``X-Api-Key`` that
replaces the legacy ``app_id`` + ``token`` pair.
"""

import uuid

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


def asr_headers(api_key: str, resource_id: str) -> dict[str, str]:
    """Build WebSocket handshake headers for the v3 ASR (SAUC) endpoint.

    Each connection gets fresh request/connect IDs. ``X-Api-Sequence: -1``
    signals a brand-new streaming session.
    """
    return {
        "X-Api-Key": api_key,
        "X-Api-Resource-Id": resource_id,
        "X-Api-Request-Id": uuid.uuid4().hex,
        "X-Api-Connect-Id": uuid.uuid4().hex,
        "X-Api-Sequence": "-1",
    }
