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
import math
import re
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

# ── 中文分词（无外部依赖）─────────────────────────────────────────────
# 中文查询没有空格，若只按 [,，\s]+ 切分，整句会变成单个 term，退化成整串子串
# 匹配 → 典型问题（「肺炎病人的护理措施有哪些？」）恒 0 命中。这里对每段中文同时
# 保留整词（≤6 字，覆盖「肺炎护理」这类短语）与字符二元组，兼顾召回与排序精度。
_CJK_RUN_RE = re.compile(r"[\u4e00-\u9fff]+")
_WORD_RUN_RE = re.compile(r"[0-9a-zA-Z]+")
_MAX_CJK_TERM_LEN = 6
# 检索成本 ≈ term 数 × 全库正文（当前 ~2.5M 字）。问题框允许 4096 字，
# 长文粘贴一刀切进来（每字一个 2-gram）会把单次检索拖到十几秒，故设上限：
# 保留靠前的 term —— 中文问句的主题在句首。
_MAX_TERMS = 40

# BM25 参数（标准默认值）：tf 饱和 + 文档长度归一化
_BM25_K1 = 1.2
_BM25_B = 0.75


def _tokenize(query: str) -> list[str]:
    """把查询切成检索 term（中文 2-gram + 短整词；英文/数字整词）。去重保序、有上限。"""
    terms: list[str] = []
    for run in _CJK_RUN_RE.findall(query):
        if len(run) <= _MAX_CJK_TERM_LEN:
            terms.append(run)
        terms.extend(run[i : i + 2] for i in range(len(run) - 1))
    terms.extend(_WORD_RUN_RE.findall(query))

    seen: set[str] = set()
    unique: list[str] = []
    for raw in terms:
        term = raw.strip().lower()
        if len(term) < 2 or term in seen:
            continue
        seen.add(term)
        unique.append(term)
        if len(unique) >= _MAX_TERMS:
            break
    return unique


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

    排序用 BM25（k1=1.2, b=0.75）：idf 让「肺炎」这类领域词压过「病人」「护理」这类
    全教材高频词，文档长度归一化让超长小节不会仅因为长就霸榜（教材小节可达数万字）。
    """
    terms = _tokenize(query)
    if not terms:
        return []

    idx = _ensure_index()
    textbooks = [textbook] if textbook else list(idx.keys())

    sections: list[tuple[str, str, dict]] = []
    for tb_name in textbooks:
        tb = idx.get(tb_name)
        if not tb:
            continue
        for ch_title, ch in tb["chapters"].items():
            sections.extend((tb_name, ch_title, sec) for sec in ch["sections"])
    if not sections:
        return []

    corpus = len(sections)
    avgdl = sum(len(sec["body"]) for _, _, sec in sections) / corpus

    df: dict[str, int] = dict.fromkeys(terms, 0)
    hits: list[tuple[str, str, dict, list[int], str]] = []  # + 各 term 计数 + 小写正文
    for tb_name, ch_title, sec in sections:
        body_lower = sec["body"].lower()
        ch_lower = ch_title.lower()
        counts = []
        for term in terms:
            count = body_lower.count(term)
            if count == 0 and term in ch_lower:
                count = 1  # 章节标题命中记一次
            counts.append(count)
        if any(counts):
            hits.append((tb_name, ch_title, sec, counts, body_lower))
            for i, count in enumerate(counts):
                if count:
                    df[terms[i]] += 1

    if not hits:
        return []

    idf = {term: math.log(1 + (corpus - df[term] + 0.5) / (df[term] + 0.5)) for term in terms if df[term]}

    scored: list[tuple[float, str, str, str, dict]] = []
    for tb_name, ch_title, sec, counts, body_lower in hits:
        length_norm = _BM25_K1 * (1 - _BM25_B + _BM25_B * len(sec["body"]) / avgdl)
        score = sum(
            idf[terms[i]] * count * (_BM25_K1 + 1) / (count + length_norm) for i, count in enumerate(counts) if count
        )
        positions = [body_lower.find(term) for i, term in enumerate(terms) if counts[i] and body_lower.find(term) >= 0]
        start = max(0, min(positions, default=0) - 120)
        scored.append(
            (
                score,
                tb_name,
                ch_title,
                sec["heading"],
                {
                    "textbook": tb_name,
                    "chapter": ch_title,
                    "heading": sec["heading"],
                    "snippet": sec["body"][start : start + 500],
                    "match_count": sum(counts),
                },
            )
        )

    scored.sort(key=lambda row: (-row[0], row[1], row[2], row[3]))
    return [row[4] for row in scored[:top_k]]


# ── 引用 key（chapter/heading）─────────────────────────────────────────
# 引用卡片把「小节」当成一个不透明字符串在检索、上下文注入与 /api/qa/section-text
# 之间传递，拼接与解析必须成对：小节标题里可能有 "/"（教材实有「断肢/指再植」），
# 因此只按第一个 "/" 切分（章节标题不含 "/"，由 data/textbooks 的文件名保证）。


def make_section_key(chapter: str, heading: str) -> str:
    """构造引用 key：``chapter/heading``。"""
    return f"{chapter}/{heading}"


def parse_section_key(section_key: str) -> tuple[str, str]:
    """解析引用 key → (chapter, heading)。无 "/" 时章节为空串。"""
    chapter, sep, heading = section_key.partition("/")
    if not sep:
        return "", section_key
    return chapter, heading


def _find_section(tb: dict, chapter: str, heading: str) -> str | None:
    ch = tb["chapters"].get(chapter)
    if not ch:
        return None
    for sec in ch["sections"]:
        if sec["heading"] == heading:
            return sec["body"]
    return None


def read_section_by_key(textbook: str, section_key: str) -> str | None:
    """按引用 key 读取小节正文；教材/章节/小节不存在时返回 None（调用方决定降级）。"""
    tb = _ensure_index().get(textbook)
    if not tb:
        return None
    chapter, heading = parse_section_key(section_key)
    return _find_section(tb, chapter, heading)


def read_section(textbook: str, chapter: str, heading: str) -> str:
    """Return the full body of a specific section. Tool: read_section().

    Returns full section text (may be longer than snippet from search).
    """
    idx = _ensure_index()
    tb = idx.get(textbook)
    if not tb:
        return f"教材 '{textbook}' 不存在。"
    if chapter not in tb["chapters"]:
        return f"章节 '{chapter}' 不存在于 {textbook} 中。"
    body = _find_section(tb, chapter, heading)
    if body is None:
        return f"小节 '{heading}' 不存在于 {textbook} > {chapter} 中。"
    return body
