"""Volcengine shared helpers (v3 authentication)."""

from infrastructure.volc.auth import (
    VOLC_BASE_URL,
    VOLC_WS_BASE_URL,
    asr_headers,
    tts_headers,
)

__all__ = [
    "VOLC_BASE_URL",
    "VOLC_WS_BASE_URL",
    "asr_headers",
    "tts_headers",
]
