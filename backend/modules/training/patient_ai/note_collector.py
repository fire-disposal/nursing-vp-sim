"""NoteCollector — 每轮状态注记收集（供 PatientState 槽位装配）。

四域重构后不再是 "author_note"，而是 per-turn 状态消息（情绪策略/操作注记）
的来源。这里只做**收集**：来源异常不影响本轮其余来源；选择/排序/裁剪/预算
全部交给 ``context.assembler.ContextAssembler``（docs/15 §八：装配权集中一处）。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from modules.training.context.fragment import ContextFragment
    from modules.training.pipeline.context import PipelineContext

from .note_source import NoteSource

log = logging.getLogger(__name__)


class NoteCollector:
    def __init__(self) -> None:
        self._sources: list[NoteSource] = []

    def add(self, source: NoteSource) -> None:
        self._sources.append(source)

    @property
    def sources(self) -> list[NoteSource]:
        return list(self._sources)

    async def collect(self, ctx: PipelineContext) -> list[ContextFragment]:
        fragments: list[ContextFragment] = []
        for src in self._sources:
            try:
                fragment = await src.collect(ctx)
            except Exception:
                log.exception("NoteSource %s failed", src.name)
                continue
            if fragment is not None:
                fragments.append(fragment)
        return fragments
