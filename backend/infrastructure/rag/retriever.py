"""RAG retriever — LLM-driven keyword search with IDF weighting."""

import logging
from math import log as _log

from core.database import SessionLocal
from models import KnowledgeChunk

log = logging.getLogger(__name__)


def _load_chunks() -> list:
    db = SessionLocal()
    try:
        return db.query(KnowledgeChunk).order_by(KnowledgeChunk.source, KnowledgeChunk.section).all()
    finally:
        db.close()


def _split_terms(query: str) -> list[str]:
    """Split comma/space-separated search terms, filter noise."""
    import re

    STOP = {"的", "了", "是", "在", "和", "与", "或", "及", "如何", "怎么", "什么", "步骤", "方法", "注意", "要点", "护理", "病人", "患者", "进行", "处理", "使用"}
    terms = []
    for t in re.split(r"[，,、\s\n]+", query):
        t = t.strip()
        if len(t) >= 2 and t not in STOP:
            terms.append(t)
    return terms


def _build_idf(chunks: list, terms: list[str]) -> dict[str, float]:
    df: dict[str, int] = {}
    for c in chunks:
        lower = c.chunk_text.lower()
        seen = set()
        for term in terms:
            if term in lower and term not in seen:
                df[term] = df.get(term, 0) + 1
                seen.add(term)
    total = max(len(chunks), 1)
    return {term: _log(2 + total / max(df[term], 1)) for term in df}


def _score(chunk_text: str, terms: list[str], idf: dict[str, float]) -> float:
    lower = chunk_text.lower()
    return sum(idf.get(t, 1.0) for t in terms if t in lower)


async def retrieve(query: str, top_k: int = 3) -> list[dict]:
    """Keyword-based retrieval with IDF weighting."""
    import asyncio

    def _search() -> list[dict]:
        chunks = _load_chunks()
        if not chunks:
            return []

        terms = _split_terms(query)
        if not terms:
            return []

        idf = _build_idf(chunks, terms)
        scored = [(s, c) for c in chunks if (s := _score(c.chunk_text, terms, idf)) > 0]
        scored.sort(key=lambda x: x[0], reverse=True)

        results = []
        seen: set[tuple[str, str]] = set()
        for score, c in scored:
            ch = "/".join(c.section.split("/")[:2]) if "/" in c.section else c.section
            key = (c.source, ch)
            if key in seen:
                continue
            seen.add(key)
            results.append({"source": c.source, "section": c.section, "chunk_text": c.chunk_text, "score": round(score, 2)})
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
