"""RAG retriever — similarity search over knowledge chunks."""

import logging
import os

from core.database import SessionLocal
from models import KnowledgeChunk

log = logging.getLogger(__name__)


def _get_embedding(text: str) -> list[float] | None:
    """Same embedding function as indexer."""
    import httpx

    api_key = os.getenv("DEEPSEEK_API_KEY", "")
    if not api_key:
        return None
    try:
        resp = httpx.post(
            "https://api.deepseek.com/v1/embeddings",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={"model": "text-embedding-v2", "input": text[:8000]},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"][0]["embedding"]
    except Exception:
        log.exception("Embedding failed")
        return None


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0
    return dot / (norm_a * norm_b)


def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Retrieve top-k relevant knowledge chunks for a query."""
    query_emb = _get_embedding(query)
    if query_emb is None:
        log.warning("Cannot retrieve: embedding failed")
        return []

    db = SessionLocal()
    try:
        chunks = db.query(KnowledgeChunk).filter(KnowledgeChunk.embedding.isnot(None)).all()

        scored = []
        for c in chunks:
            if not c.embedding:
                continue
            sim = _cosine_similarity(query_emb, c.embedding)
            scored.append((sim, c))

        scored.sort(key=lambda x: x[0], reverse=True)
        top = scored[:top_k]

        results = []
        for sim, c in top:
            results.append(
                {
                    "source": c.source,
                    "section": c.section,
                    "chunk_text": c.chunk_text,
                    "score": round(sim, 4),
                }
            )
            log.debug("RAG hit: %s/%s (score=%.3f)", c.source, c.section, sim)

        return results
    finally:
        db.close()


def format_context(results: list[dict]) -> str:
    """Format retrieved chunks into a context string for LLM prompt."""
    if not results:
        return ""

    parts = ["【参考教材信息】"]
    for i, r in enumerate(results, 1):
        src = r["source"].replace("textbook:", "")
        parts.append(f"[{i}] 来源: {src} | {r['section']}")
        parts.append(r["chunk_text"][:500])
        parts.append("")

    return "\n".join(parts)
