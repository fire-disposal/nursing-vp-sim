"""PostGuard — swappable identity-leak detection strategies."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from contexts.patient.guard import IDENTITY_LEAK_PATTERNS, get_identity_correction_note, has_identity_leak


@dataclass
class GuardResult:
    passed: bool
    correction_note: str | None = None
    trigger_detail: str | None = None


class PostGuard(ABC):
    name: str = ""

    @abstractmethod
    async def check(self, reply: str) -> GuardResult:
        ...


class PatternGuard(PostGuard):
    name = "pattern"

    def __init__(self, patterns: list[str] | None = None):
        self._patterns = patterns if patterns is not None else list(IDENTITY_LEAK_PATTERNS)

    async def check(self, reply: str) -> GuardResult:
        if has_identity_leak(reply):
            return GuardResult(
                passed=False,
                correction_note=get_identity_correction_note(),
                trigger_detail="identity_leak_pattern",
            )
        return GuardResult(passed=True)


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
