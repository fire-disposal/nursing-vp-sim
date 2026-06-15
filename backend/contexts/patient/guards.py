"""PostGuard — swappable identity-leak detection strategies."""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass

log = logging.getLogger(__name__)

IDENTITY_LEAK_PATTERNS = [
    "我是AI",
    "我是人工智能",
    "我是AI助手",
    "我是虚拟患者",
    "作为AI",
    "作为人工智能",
    "评分标准",
    "教学反馈",
    "你应该继续问",
    "你还需要问",
    "训练模式",
]


def has_identity_leak(reply: str) -> bool:
    if not reply or not reply.strip():
        return False
    reply_lower = reply.lower()
    for pattern in IDENTITY_LEAK_PATTERNS:
        if pattern.lower() in reply_lower:
            log.warning("身份泄露检测: pattern=%r triggered in reply[%d]", pattern, len(reply))
            return True
    return False


def get_identity_correction_note() -> str:
    return "【注意：你在扮演真实患者，你是人不是AI。用患者的语气自然回应，不要提及任何关于训练、评分、系统的内容。】"


@dataclass
class GuardResult:
    passed: bool
    correction_note: str | None = None
    trigger_detail: str | None = None


class PostGuard(ABC):
    name: str = ""

    @abstractmethod
    async def check(self, reply: str) -> GuardResult: ...


class PatternGuard(PostGuard):
    name = "pattern"

    def __init__(self, patterns: list[str] | None = None):
        self._patterns = patterns if patterns is not None else list(IDENTITY_LEAK_PATTERNS)

    async def check(self, reply: str) -> GuardResult:
        if self._match_any(reply):
            return GuardResult(
                passed=False,
                correction_note=get_identity_correction_note(),
                trigger_detail="identity_leak_pattern",
            )
        return GuardResult(passed=True)

    def _match_any(self, reply: str) -> bool:
        if not reply or not reply.strip():
            return False
        reply_lower = reply.lower()
        for pattern in self._patterns:
            if pattern.lower() in reply_lower:
                return True
        return False


class NoGuard(PostGuard):
    name = "none"

    async def check(self, reply: str) -> GuardResult:
        return GuardResult(passed=True)


_guards: dict[str, PostGuard] = {}


def register_guard(guard: PostGuard) -> None:
    _guards[guard.name] = guard


def get_guard(name: str) -> PostGuard | None:
    return _guards.get(name)


register_guard(PatternGuard())
register_guard(NoGuard())
