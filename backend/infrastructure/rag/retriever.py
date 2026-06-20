"""RAG retriever — keyword-based search over knowledge chunks with IDF weighting."""

import logging
from math import log as _log

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


def _build_idf(chunks: list, query_tokens: set, medical_keywords: set) -> dict[str, float]:
    """Compute IDF weights: tokens appearing in many chunks -> low weight."""
    df: dict[str, int] = {}
    for c in chunks:
        lower = c.chunk_text.lower()
        seen = set()
        for kw in medical_keywords:
            if kw in lower and kw not in seen:
                df[kw] = df.get(kw, 0) + 1
                seen.add(kw)
        for token in query_tokens:
            if len(token) >= 2 and token in lower and token not in seen:
                df[token] = df.get(token, 0) + 1
                seen.add(token)
    total = max(len(chunks), 1)
    return {term: _log(2 + total / max(df[term], 1)) for term in df}


def _keyword_score(chunk_text: str, query_tokens: set, medical_keywords: set, idf: dict[str, float]) -> float:
    """Score chunk by IDF-weighted keyword overlap."""
    score = 0.0
    lower = chunk_text.lower()
    for kw in medical_keywords:
        if kw in lower:
            score += 6 * idf.get(kw, 1.0)
    for token in query_tokens:
        if len(token) >= 2 and token in lower:
            score += 1 * idf.get(token, 1.0)
    return score


async def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Keyword-based retrieval with IDF weighting. Deduplicates by textbook+chapter."""
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

        idf = _build_idf(chunks, query_tokens, all_keywords)
        scored = []
        for c in chunks:
            score = _keyword_score(c.chunk_text, query_tokens, all_keywords, idf)
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
                    "score": round(score, 2),
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
