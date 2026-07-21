"""NoteCollector — pipeline-level author_note assembly with budget management."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from contexts.training.pipeline.context import PipelineContext

from .note_source import NoteSource

log = logging.getLogger(__name__)

from infrastructure.llm.token_counter import estimate_tokens

MAX_AUTHOR_NOTE_TOKENS = 300


def _truncate_tokens(text: str, max_tokens: int) -> str:
    # CJK ~0.6 token/char → ~1.67 char/token，用 1.5 保守估算
    max_chars = int(max_tokens * 1.5)
    return text[:max_chars] + "\u2026" if len(text) > max_chars else text


class NoteCollector:
    def __init__(self) -> None:
        self._sources: list[NoteSource] = []

    def add(self, source: NoteSource) -> None:
        self._sources.append(source)

    async def collect(self, ctx: PipelineContext) -> str:
        notes: list[tuple[int, str, str]] = []
        for src in self._sources:
            try:
                text = await src.collect(ctx)
                if text and text.strip():
                    notes.append((src.priority, src.name, text.strip()))
            except Exception:
                log.exception("NoteSource %s failed", src.name)
        notes.sort(key=lambda x: x[0])
        return self._budget_join(notes)

    def _budget_join(self, notes: list[tuple[int, str, str]]) -> str:
        budget = MAX_AUTHOR_NOTE_TOKENS
        selected: list[str] = []
        dropped: list[str] = []
        for _, _name, text in notes:
            cost = estimate_tokens(text)
            if cost > budget:
                if not selected:
                    selected.append(_truncate_tokens(text, budget))
                dropped.append(_name)
                continue
            selected.append(text)
            budget -= cost
        if dropped:
            log.warning("NoteCollector dropped sources due to budget: %s", dropped)
        return "\u3010" + " | ".join(selected) + "\u3011" if selected else ""
