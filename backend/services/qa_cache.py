"""QA 问答响应缓存 —— 同问题避免重复 LLM 调用

仅对 create_session（新会话首问）生效，ask_in_session（多轮追问）因有对话上下文不适用。
"""

import asyncio
import hashlib
import logging
import time

log = logging.getLogger(__name__)

_MAX_ENTRIES = 200
_TTL_SECONDS = 3600


class QACache:
    def __init__(self):
        self._store: dict[str, tuple[str, float]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def _key(question: str) -> str:
        return hashlib.sha256(question.strip().encode()).hexdigest()

    async def get(self, question: str) -> str | None:
        key = self._key(question)
        async with self._lock:
            if key in self._store:
                answer, ts = self._store[key]
                if time.monotonic() - ts < _TTL_SECONDS:
                    return answer
                del self._store[key]
        return None

    async def set(self, question: str, answer: str):
        key = self._key(question)
        async with self._lock:
            if len(self._store) >= _MAX_ENTRIES:
                cutoff = time.monotonic() - _TTL_SECONDS
                expired = [k for k, (_, ts) in self._store.items() if ts < cutoff]
                for k in expired:
                    del self._store[k]
            if len(self._store) < _MAX_ENTRIES:
                self._store[key] = (answer, time.monotonic())

    def size(self) -> int:
        return len(self._store)


_cache = QACache()


def get_qa_cache() -> QACache:
    return _cache
