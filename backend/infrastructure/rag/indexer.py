"""Knowledge base indexer — reads textbooks, chunks by heading, stores to DB."""

import hashlib
import logging
import os
import re
from pathlib import Path

from core.database import SessionLocal
from models import KnowledgeChunk

log = logging.getLogger(__name__)

TEXTBOOKS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "textbooks"


def _read_textbooks() -> list[dict]:
    """Read all markdown textbook files and split by headings."""
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
    """Split markdown content by ## headings only. ### headings stay as body content."""
    lines = content.split("\n")
    sections = []
    current_heading = ""
    current_body = []
    for line in lines:
        m = re.match(r"^##\s+(.+)$", line)
        if m:
            if current_heading or current_body:
                body = "\n".join(current_body).strip()
                if len(body) > 20:
                    sections.append((current_heading, body))
            current_heading = m.group(1).strip()
            current_body = []
        else:
            current_body.append(line)
    if current_heading or current_body:
        body = "\n".join(current_body).strip()
        if len(body) > 20:
            sections.append((current_heading, body))
    return sections


def _content_hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8"), usedforsecurity=False).hexdigest()


def index_all(force: bool = False) -> int:
    """Index all textbooks into knowledge_chunks. Returns count of chunks stored."""
    chunks = _read_textbooks()
    db = SessionLocal()
    try:
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

            record = KnowledgeChunk(
                source=chunk["source"],
                section=chunk["section"],
                chunk_text=chunk["chunk_text"],
            )
            db.add(record)
            indexed += 1

            if indexed % 20 == 0:
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
