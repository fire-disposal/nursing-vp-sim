"""RAG retriever — similarity search over knowledge chunks."""

import asyncio
import logging

from core.database import SessionLocal
from models import KnowledgeChunk

from .embedding import get_embedding_async

log = logging.getLogger(__name__)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0
    return dot / (norm_a * norm_b)


async def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Retrieve top-k chunks (async-safe: embedding + DB run in thread pool)."""
    query_emb = await get_embedding_async(query)
    if query_emb is None:
        return []

    def _query() -> list[dict]:
        db = SessionLocal()
        try:
            chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.embedding.isnot(None)).limit(1000).all()
            scored = []
            for c in chunks:
                if not c.embedding:
                    continue
                sim = _cosine_similarity(query_emb, c.embedding)
                scored.append((sim, c))
            scored.sort(key=lambda x: x[0], reverse=True)
            results = []
            for sim, c in scored[:top_k]:
                results.append(
                    {
                        "source": c.source,
                        "section": c.section,
                        "chunk_text": c.chunk_text,
                        "score": round(sim, 4),
                    }
                )
            return results
        finally:
            db.close()

    return await asyncio.to_thread(_query)


def format_context(results: list[dict]) -> str:
    if not results:
        return ""
    parts = ["【参考教材信息】"]
    for i, r in enumerate(results, 1):
        src = r["source"].replace("textbook:", "")
        parts.append(f"[{i}] 来源: {src} | {r['section']}")
        parts.append(r["chunk_text"][:500])
        parts.append("")
    return "\n".join(parts)
