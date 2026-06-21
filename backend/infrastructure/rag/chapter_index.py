"""Chapter index — embedding-based chapter search for QA knowledge retrieval.

Replaces the broken rag-kw + IDF pipeline with:
  1. Chapter title + summary embedding via DeepSeek embedding API
  2. Cosine similarity matching at query time
  3. Full chapter content loading for context injection
"""

import asyncio
import logging
import math
from typing import Any

import httpx

from core.database import SessionLocal
from models import KnowledgeChunk

log = logging.getLogger(__name__)

# Cache embeddings in memory (small: ~70 chapters × 1536 dims)
_embedding_cache: dict[str, list[float]] | None = None
_chapter_entries: list[dict[str, Any]] | None = None


async def _get_embedding(text: str, api_key: str, base_url: str) -> list[float]:
    """Get embedding vector for text via DeepSeek embedding API."""
    url = f"{base_url}/v1/embeddings"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30, connect=15)) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={"model": "text-embedding-v2", "input": text[:8000]},
            )
            resp.raise_for_status()
            return resp.json()["data"][0]["embedding"]
    except Exception:
        log.exception("Chapter embedding failed, text preview: %s", text[:80])
        return []


async def _build_chapter_index() -> tuple[list[dict], dict[str, list[float]]]:
    """Build chapter-level index from knowledge_chunks.

    Groups chunks by (source, top-level section), creates a summary from
    the first 500 chars of each chapter's content, and computes embeddings.
    """
    db = SessionLocal()
    try:
        chunks = db.query(KnowledgeChunk).order_by(KnowledgeChunk.source, KnowledgeChunk.section).all()
    finally:
        db.close()

    # Group chunks by chapter (source + top-level section)
    chapters: dict[str, dict] = {}
    for c in chunks:
        chapter_key = "/".join(c.section.split("/")[:2]) if "/" in c.section else c.section
        key = f"{c.source}::{chapter_key}"
        if key not in chapters:
            chapters[key] = {
                "key": key,
                "source": c.source.replace("textbook:", ""),
                "chapter": chapter_key,
                "title": chapter_key.split("/")[-1] if "/" in chapter_key else chapter_key,
                "chunks": [],
            }
        chapters[key]["chunks"].append(c.chunk_text)

    # Build summaries (first 500 chars of each chapter)
    entries = []
    for chapter in chapters.values():
        full_text = "\n\n".join(chapter["chunks"])
        summary = full_text[:500]
        entries.append(
            {
                "key": chapter["key"],
                "source": chapter["source"],
                "chapter": chapter["chapter"],
                "title": chapter["title"],
                "full_text": full_text,
                "summary": summary,
            }
        )

    log.info("Chapter index: %d chapters from knowledge_chunks", len(entries))
    return entries


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def ensure_index(api_key: str, base_url: str) -> None:
    """Build chapter embedding index. Call once at startup or first query."""
    global _embedding_cache, _chapter_entries
    if _embedding_cache is not None:
        return

    entries = await _build_chapter_index()
    _chapter_entries = entries

    embeddings: dict[str, list[float]] = {}
    for i, entry in enumerate(entries):
        text = f"{entry['source']} - {entry['title']}\n{entry['summary']}"
        vec = await _get_embedding(text, api_key, base_url)
        if vec:
            embeddings[entry["key"]] = vec
        if (i + 1) % 10 == 0:
            log.info("Chapter embedding progress: %d/%d", i + 1, len(entries))
        await asyncio.sleep(0.3)  # Rate limit: be gentle to embedding API

    _embedding_cache = embeddings
    log.info("Chapter embedding index ready: %d vectors", len(embeddings))


async def search_chapter(
    query: str,
    api_key: str,
    base_url: str,
    top_k: int = 1,
) -> list[dict[str, Any]]:
    """Search for the most relevant chapter given a query.

    Returns list of {source, chapter, title, text} dicts.
    """
    if _embedding_cache is None or _chapter_entries is None:
        await ensure_index(api_key, base_url)

    if not _embedding_cache or not _chapter_entries:
        return []

    query_vec = await _get_embedding(query, api_key, base_url)
    if not query_vec:
        return []

    scored = []
    for entry in _chapter_entries:
        entry_vec = _embedding_cache.get(entry["key"])
        if not entry_vec:
            continue
        sim = _cosine_similarity(query_vec, entry_vec)
        scored.append((sim, entry))

    scored.sort(key=lambda x: x[0], reverse=True)

    results = []
    seen_sources: set[str] = set()
    for sim, entry in scored[: top_k * 3]:  # Allow dedup across sources
        if entry["source"] in seen_sources:
            continue
        seen_sources.add(entry["source"])
        results.append(
            {
                "source": entry["source"],
                "chapter": entry["chapter"],
                "title": entry["title"],
                "text": entry["full_text"],
                "score": round(sim, 4),
            }
        )
        if len(results) >= top_k:
            break

    return results


def format_chapter_context(results: list[dict]) -> tuple[str, list[dict[str, str]]]:
    """Format retrieved chapter as LLM context with citation metadata."""
    if not results:
        return "", []

    parts = ["【参考教材信息】"]
    instruction = (
        "以下是从护理学教材中检索到的相关章节内容。请仅引用与问题直接相关的部分，"
        "不要强行添加无关引用。如需引用，请使用格式 [来源: 教材名 > 章节名]。"
    )
    parts.append(instruction)
    citations: list[dict[str, str]] = []

    for i, r in enumerate(results, 1):
        section_key = "/".join(r["chapter"].split("/")[:2]) if "/" in r["chapter"] else r["chapter"]
        parts.append(f"[{i}] [来源: {r['source']} > {section_key}]")
        parts.append(r["text"])
        parts.append("")
        citations.append({"source": r["source"], "section": section_key})

    return "\n".join(parts), citations
