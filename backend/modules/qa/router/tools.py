"""QA LLM tool definitions and tool handler builders.

Exposes tool schemas to the QA LLM and builds handlers backed by knowledge_base.
"""

import asyncio
import json
import logging
from typing import Any

log = logging.getLogger(__name__)

QA_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "list_textbooks",
            "description": "列出所有可用的护理学教材（仅书名和章节数）",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_chapters",
            "description": "列出指定教材的所有章节标题（不含正文内容）",
            "parameters": {
                "type": "object",
                "properties": {
                    "textbook": {
                        "type": "string",
                        "description": "教材名称，如'内科护理学'、'外科护理学'、'新编护理学基础'",
                    }
                },
                "required": ["textbook"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search",
            "description": "在护理学教材中全文关键词搜索，返回匹配的章节片段（≤500字）及其位置信息。可用于快速定位相关知识点。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词或短语，如'肺炎护理措施'、'术后并发症'"},
                    "textbook": {
                        "type": "string",
                        "description": "限定在指定教材中搜索（可选，不填则搜索全部教材）",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_section",
            "description": "读取指定教材某章节下某小节的完整正文内容。先用 search() 定位到具体小节后，再用此工具读取完整内容。",
            "parameters": {
                "type": "object",
                "properties": {
                    "textbook": {"type": "string", "description": "教材名称"},
                    "chapter": {"type": "string", "description": "章节标题"},
                    "heading": {"type": "string", "description": "小节标题（## 标题）"},
                },
                "required": ["textbook", "chapter", "heading"],
            },
        },
    },
]


def build_tool_handlers() -> dict:
    """Build async tool handlers backed by chapter_index."""
    from modules.qa.knowledge_base.chapter_index import list_chapters, list_textbooks, read_section, search

    handlers = {
        "list_textbooks": lambda _: json.dumps(list_textbooks(), ensure_ascii=False),
        "list_chapters": lambda args: json.dumps(list_chapters(args.get("textbook", "")), ensure_ascii=False),
        "search": lambda args: json.dumps(
            search(query=args.get("query", ""), textbook=args.get("textbook") or None),
            ensure_ascii=False,
        ),
        "read_section": lambda args: read_section(
            textbook=args.get("textbook", ""),
            chapter=args.get("chapter", ""),
            heading=args.get("heading", ""),
        ),
    }
    async_handlers = {}
    for name, fn in handlers.items():
        async_handlers[name] = lambda args, _fn=fn: asyncio.to_thread(_fn, args)
    return async_handlers


def pre_search(question: str) -> list[dict[str, str]]:
    """Quick keyword search to provide citation metadata + snippets. Never raises."""
    try:
        from modules.qa.knowledge_base.chapter_index import search as chapter_search

        results = chapter_search(question, top_k=2)
        return [
            {
                "source": r["textbook"],
                "section": f"{r['chapter']}/{r['heading']}",
                "snippet": r.get("snippet", ""),
            }
            for r in results
        ]
    except Exception:
        log.warning("Pre-search failed for citations", exc_info=True)
        return []


def inject_search_context(
    llm_messages: list[dict],
    citations: list[dict],
    *,
    snippets_only: bool = False,
) -> None:
    """Inject search context into messages as system context."""
    if not citations:
        return
    try:
        from modules.qa.knowledge_base.chapter_index import read_section

        parts = ["【参考教材信息】"]
        parts.append("以下是从教材中检索到的相关片段，引用时请注明来源。")
        for i, c in enumerate(citations, 1):
            parts.append(f"[{i}] [来源: {c['source']} > {c['section']}]")
            if snippets_only:
                text = c.get("snippet", "")
            else:
                text = read_section(c["source"], c["section"].split("/")[0], c["section"].split("/")[1])[:1500]
            if text:
                parts.append(text)
            parts.append("")
        llm_messages.insert(1, {"role": "system", "content": "\n".join(parts)})
    except Exception:
        log.warning("Context injection failed", exc_info=True)
