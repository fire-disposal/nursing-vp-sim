"""Citations marker embedding — zero-migration persistence via HTML comment in content."""

import logging

log = logging.getLogger(__name__)


import base64 as _b64
import json as _json_lib

CITATIONS_MARKER = "<!--qa-citations:"


def embed_citations(content: str, citations: list[dict[str, str]]) -> str:
    """Encode citations as a trailing HTML comment so they survive DB roundtrip."""
    if not citations:
        return content
    payload = _b64.b64encode(_json_lib.dumps(citations, ensure_ascii=False).encode()).decode()
    return f"{content}\n\n{CITATIONS_MARKER}{payload}-->"


def extract_citations(content: str) -> tuple[str, list[dict[str, str]] | None]:
    """Extract embedded citations from content. Returns (clean_content, citations_or_none)."""
    idx = content.rfind(CITATIONS_MARKER)
    if idx == -1:
        return content, None
    try:
        payload_start = idx + len(CITATIONS_MARKER)
        payload_end = content.index("-->", payload_start)
        payload = content[payload_start:payload_end]
        citations = _json_lib.loads(_b64.b64decode(payload))
        clean = content[:idx].rstrip()
        return clean, citations
    except Exception:
        log.warning("citation parsing failed", exc_info=True)
        return content, None


def clean_content(content: str) -> str:
    """Strip citations marker without extracting."""
    idx = content.rfind(CITATIONS_MARKER)
    if idx == -1:
        return content
    return content[:idx].rstrip()
