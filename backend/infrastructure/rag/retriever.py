"""RAG retriever — keyword-based search over knowledge chunks with full-section inclusion."""

import logging

from core.database import SessionLocal
from models import KnowledgeChunk

from .medical_terms import extract_keywords, tokenize

log = logging.getLogger(__name__)


def _load_chunks() -> list:
    """Load all indexed chunks from DB."""
    db = SessionLocal()
    try:
        return db.query(KnowledgeChunk).order_by(KnowledgeChunk.source, KnowledgeChunk.section).all()
    finally:
        db.close()


def _keyword_score(chunk_text: str, query_tokens: set, medical_keywords: set) -> int:
    """Score chunk by keyword overlap. Medical terms weighted higher."""
    score = 0
    lower = chunk_text.lower()
    for kw in medical_keywords:
        if kw in lower:
            score += 6
    for token in query_tokens:
        if len(token) >= 2 and token in lower:
            score += 1
    return score


def _build_full_section(chunk) -> str:
    """For a matched chunk, retrieve the full section (all chunks sharing source+chapter)."""
    section_prefix = "/".join(chunk.section.split("/")[:2]) if "/" in chunk.section else chunk.section
    db = SessionLocal()
    try:
        siblings = (
            db.query(KnowledgeChunk)
            .filter(
                KnowledgeChunk.source == chunk.source,
                KnowledgeChunk.section.like(f"{section_prefix}%"),
            )
            .order_by(KnowledgeChunk.section)
            .all()
        )
        if not siblings:
            return chunk.chunk_text
        parts = []
        for s in siblings:
            if s.chunk_text not in parts:
                parts.append(s.chunk_text)
        return "\n\n".join(parts)
    finally:
        db.close()


async def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Keyword-based retrieval. Returns top-k chunks (each chunk = one markdown section).

    Does NOT require embeddings — uses jieba tokenisation + medical term matching.
    Deduplicates by source+chapter so each textbook chapter contributes at most 1 result.
    """
    import asyncio

    def _search() -> list[dict]:
        chunks = _load_chunks()
        if not chunks:
            return []

        query_tokens = set(tokenize(query))
        categories = extract_keywords(query)
        all_keywords = set()
        for cat_list in categories.values():
            all_keywords.update(cat_list)

        scored = []
        for c in chunks:
            score = _keyword_score(c.chunk_text, query_tokens, all_keywords)
            if score > 0:
                scored.append((score, c))

        scored.sort(key=lambda x: x[0], reverse=True)

        results = []
        seen_chapters: set[tuple[str, str]] = set()
        for score, c in scored:
            chapter_key = "/".join(c.section.split("/")[:2]) if "/" in c.section else c.section
            chapter_id = (c.source, chapter_key)
            if chapter_id in seen_chapters:
                continue
            seen_chapters.add(chapter_id)

            results.append(
                {
                    "source": c.source,
                    "section": c.section,
                    "chunk_text": c.chunk_text,
                    "score": score,
                }
            )
            if len(results) >= top_k:
                break

        return results

    return await asyncio.to_thread(_search)


def format_context(results: list[dict]) -> tuple[str, list[dict[str, str]]]:
    """Format retrieved chunks as LLM context with citation metadata."""
    if not results:
        return "", []
    parts = ["【参考教材信息】"]
    citations: list[dict[str, str]] = []
    instruction = (
        "请仅引用与问题直接相关的教材内容，不要强行添加无关引用。如需引用，请使用格式 [来源: 教材名 > 章节名]。"
    )
    parts.append(instruction)
    for i, r in enumerate(results, 1):
        src = r["source"].replace("textbook:", "")
        section_key = "/".join(r["section"].split("/")[:2]) if "/" in r["section"] else r["section"]
        parts.append(f"[{i}] [来源: {src} > {section_key}]")
        parts.append(r["chunk_text"])
        parts.append("")
        citations.append({"source": src, "section": section_key})
    return "\n".join(parts), citations
