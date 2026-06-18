"""Shared embedding helper."""

import logging
import os

import httpx

log = logging.getLogger(__name__)


def get_embedding(text: str) -> list[float] | None:
    """同步嵌入调用 —— 用于启动索引场景。"""
    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
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


async def get_embedding_async(text: str) -> list[float] | None:
    """异步嵌入调用 —— 用于请求处理场景，不阻塞事件循环。"""
    import asyncio

    return await asyncio.to_thread(get_embedding, text)
