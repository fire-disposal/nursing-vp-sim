"""QA 问答系统 —— 缓存 + 历史构建

QACache: 同问题避免重复 LLM 调用（仅对新会话首问生效）
build_qa_history: 从 DB 构建对话历史 messages
"""

import asyncio
import hashlib
import logging
import time

from sqlalchemy.orm import Session

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


def build_qa_history(session_id: int, db: Session) -> list[dict]:
    """从 DB 查询 QA 会话历史，构建 role-mapped messages 列表（最多 8 轮）"""
    from models import QARecord

    history = (
        db.query(QARecord)
        .filter(QARecord.session_id == session_id)
        .order_by(QARecord.created_at.desc())
        .limit(16)
        .all()
    )
    history.reverse()
    return [{"role": "user" if r.role == "user" else "assistant", "content": r.content} for r in history]
