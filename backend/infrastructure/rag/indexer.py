"""Knowledge base indexer — reads textbooks, chunks, embeds, stores."""

import hashlib
import logging
import os
import re
from pathlib import Path

from core.database import SessionLocal
from models import KnowledgeChunk

from .embedding import get_embedding

log = logging.getLogger(__name__)

TEXTBOOKS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "textbooks"


def _read_textbooks() -> list[dict]:
    """Read all markdown textbook files and split into chapters."""
    chunks = []
    for filepath in sorted(TEXTBOOKS_DIR.rglob("*.md")):
        rel_path = os.path.relpath(str(filepath), str(TEXTBOOKS_DIR))
        parts = rel_path.replace("\\", "/").split("/")
        textbook = parts[0] if len(parts) > 0 else "unknown"
        chapter = parts[1] if len(parts) > 1 else Path(filepath).stem

        with open(filepath, encoding="utf-8") as f:
            content = f.read()

        sections = _split_by_headings(content)
        for i, (heading, body) in enumerate(sections):
            chunk_text = f"## {heading}\n\n{body}" if heading else body
            if len(chunk_text.strip()) < 20:
                continue
            chunks.append(
                {
                    "source": f"textbook:{textbook}",
                    "section": f"{chapter}/{heading or f'seg_{i}'}",
                    "chunk_text": chunk_text.strip(),
                }
            )
    log.info("Read %d chunks from textbooks", len(chunks))
    return chunks


def _split_by_headings(content: str) -> list[tuple[str, str]]:
    """Split markdown content by ## or ### headings."""
    lines = content.split("\n")
    sections = []
    current_heading = ""
    current_body = []
    for line in lines:
        m = re.match(r"^(#{2,3})\s+(.+)$", line)
        if m:
            if current_heading or current_body:
                sections.append((current_heading, "\n".join(current_body).strip()))
            current_heading = m.group(2).strip()
            current_body = []
        else:
            current_body.append(line)
    if current_heading or current_body:
        sections.append((current_heading, "\n".join(current_body).strip()))
    return [(h, b) for h, b in sections if len(b.strip()) > 20]


def _content_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def index_all(force: bool = False) -> int:
    """Index all textbooks. Returns count of new chunks indexed."""
    chunks = _read_textbooks()
    db = SessionLocal()
    try:
        existing = set(r[0] for r in db.query(KnowledgeChunk.id).all())
        _ = existing

        indexed = 0
        for chunk in chunks:
            exists = (
                db.query(KnowledgeChunk)
                .filter(
                    KnowledgeChunk.source == chunk["source"],
                    KnowledgeChunk.section == chunk["section"],
                )
                .first()
            )
            if exists and not force:
                continue

            embedding = get_embedding(chunk["chunk_text"])
            if embedding is None:
                continue
            record = KnowledgeChunk(
                source=chunk["source"],
                section=chunk["section"],
                chunk_text=chunk["chunk_text"],
                embedding=embedding,
            )
            db.add(record)
            indexed += 1

            if indexed % 10 == 0:
                db.commit()

        db.commit()
        log.info("Indexed %d new chunks (total %d)", indexed, len(chunks))
        return indexed
    except Exception:
        db.rollback()
        log.exception("Indexing failed")
        return 0
    finally:
        db.close()


def check_indexed() -> int:
    """Return count of indexed chunks."""
    db = SessionLocal()
    try:
        return db.query(KnowledgeChunk).count()
    finally:
        db.close()
