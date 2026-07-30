"""Knowledge base accessor — hierarchical textbook navigation for LLM Tool Calls.

Design:
  1. list_textbooks() → browse top-level textbooks
  2. list_chapters(textbook) → browse chapters in a textbook (titles only)
  3. search(query, textbook=None) → full-text keyword search, returns snippets with location
  4. read_section(textbook, chapter, heading) → read one specific section (## heading block)

All data loaded from filesystem. No API calls. LLM-safe: snippets capped at ~500 chars,
never dumps entire chapters.
"""

import logging
import re
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

TEXTBOOKS_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "textbooks"

# ── In-memory index ──
_index: dict[str, Any] | None = None  # textbook → chapter → [section chunks]


def _read_file(filepath: Path) -> str:
    try:
        return filepath.read_text(encoding="utf-8")
    except Exception:
        log.warning("Failed to read: %s", filepath)
        return ""


def _split_sections(content: str) -> list[tuple[str, str]]:
    """Split markdown by ## headings. Returns [(heading, body), ...]."""
    sections = []
    current_heading = ""
    current_lines = []
    for line in content.split("\n"):
        m = re.match(r"^##\s+(.+)$", line)
        if m:
            if current_heading or current_lines:
                body = "\n".join(current_lines).strip()
                if len(body) > 20:
                    sections.append((current_heading, body))
            current_heading = m.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_heading or current_lines:
        body = "\n".join(current_lines).strip()
        if len(body) > 20:
            sections.append((current_heading or "概述", body))
    return sections


def _parse_filename(filepath: Path) -> dict | None:
    """'内科护理学_02_第二章_呼吸系统疾病病人的护理.md' → {textbook, chapter_title}."""
    stem = filepath.stem
    parts = stem.split("_", 2)
    if len(parts) < 3:
        return None
    return {"textbook": parts[0], "chapter_num": parts[1], "chapter_title": parts[2]}


def _build() -> dict[str, Any]:
    """Build hierarchical index: textbook → chapter → sections."""
    index: dict[str, dict] = {}
    for filepath in sorted(TEXTBOOKS_DIR.rglob("*.md")):
        meta = _parse_filename(filepath)
        if not meta:
            continue
        content = _read_file(filepath)
        sections = _split_sections(content)

        tb = meta["textbook"]
        if tb not in index:
            index[tb] = {"name": tb, "chapters": {}}

        chapter_key = meta["chapter_title"]
        index[tb]["chapters"][chapter_key] = {
            "title": meta["chapter_title"],
            "num": meta["chapter_num"],
            "sections": [{"heading": h, "body": b} for h, b in sections],
        }

    total = sum(len(tb["chapters"]) for tb in index.values())
    log.info("Knowledge index built: %d textbooks, %d chapters", len(index), total)
    return index


def _ensure_index() -> dict[str, Any]:
    global _index
    if _index is None:
        _index = _build()
    return _index




# ── Tools exposed to LLM ──


def list_textbooks() -> list[dict]:
    """Return all textbooks. Tool: list_textbooks()."""
    idx = _ensure_index()
    return [{"textbook": name, "chapters": len(tb["chapters"])} for name, tb in idx.items()]


def list_chapters(textbook: str) -> list[dict]:
    """Return chapters in a textbook (titles + section counts). Tool: list_chapters()."""
    idx = _ensure_index()
    tb = idx.get(textbook)
    if not tb:
        return []
    return [
        {
            "textbook": textbook,
            "chapter": ch["title"],
            "sections": len(ch["sections"]),
        }
        for ch in tb["chapters"].values()
    ]


def search(query: str, textbook: str | None = None, top_k: int = 5) -> list[dict]:
    """Full-text keyword search across sections. Returns snippets with location.

    Each result: {textbook, chapter, heading, snippet (≤500 chars), match_count}
    """
    idx = _ensure_index()
    terms = [w.strip() for w in re.split(r"[,，\s]+", query) if len(w.strip()) >= 2]

    if not terms:
        terms = [query]

    scored: list[tuple[int, dict]] = []
    textbooks = [textbook] if textbook else list(idx.keys())

    for tb_name in textbooks:
        tb = idx.get(tb_name)
        if not tb:
            continue
        for ch_title, ch in tb["chapters"].items():
            for sec in ch["sections"]:
                body_lower = sec["body"].lower()
                matches = 0
                for t in terms:
                    count = body_lower.count(t.lower())
                    if t.lower() in ch_title.lower():
                        count += 1  # bonus for chapter title match
                    matches += count
                if matches > 0:
                    # Show ~500 chars centered on the first match, not just the start
                    first_pos = min(
                        (body_lower.find(t.lower()) for t in terms if body_lower.find(t.lower()) >= 0),
                        default=0,
                    )
                    start = max(0, first_pos - 120)
                    snippet = sec["body"][start : start + 500]
                    scored.append(
                        (
                            matches,
                            {
                                "textbook": tb_name,
                                "chapter": ch_title,
                                "heading": sec["heading"],
                                "snippet": snippet,
                                "match_count": matches,
                            },
                        )
                    )

    scored.sort(key=lambda x: x[0], reverse=True)
    return [r for _, r in scored[:top_k]]


def read_section(textbook: str, chapter: str, heading: str) -> str:
    """Return the full body of a specific section. Tool: read_section().

    Returns full section text (may be longer than snippet from search).
    """
    idx = _ensure_index()
    tb = idx.get(textbook)
    if not tb:
        return f"教材 '{textbook}' 不存在。"
    ch = tb["chapters"].get(chapter)
    if not ch:
        return f"章节 '{chapter}' 不存在于 {textbook} 中。"
    for sec in ch["sections"]:
        if sec["heading"] == heading:
            return sec["body"]
    return f"小节 '{heading}' 不存在于 {textbook} > {chapter} 中。"
