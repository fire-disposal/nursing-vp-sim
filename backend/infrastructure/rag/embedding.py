"""Shared embedding helper."""

import logging
import os

import httpx

log = logging.getLogger(__name__)


def get_embedding(text: str) -> list[float] | None:
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        log.warning("DEEPSEEK_API_KEY not set, skipping embedding")
        return None
    try:
        resp = httpx.post(
            "https://api.deepseek.com/v1/embeddings",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": "text-embedding-v2", "input": text[:8000]},
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()["data"][0]["embedding"]
    except Exception:
        log.exception("Embedding failed")
        return None
