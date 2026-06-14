"""Unit tests for PostGuard implementations."""

from contexts.patient.guards import (
    NoGuard,
    PatternGuard,
    get_guard,
)


class TestPatternGuard:
    async def test_triggers_on_identity_leak(self):
        guard = PatternGuard()
        result = await guard.check("我是AI助手，你可以继续提问")
        assert result.passed is False
        assert result.correction_note is not None
        assert "注意" in result.correction_note

    async def test_no_trigger_on_normal_reply(self):
        guard = PatternGuard()
        result = await guard.check("我肚子疼了好几天了，今天特别难受")
        assert result.passed is True
        assert result.correction_note is None

    async def test_custom_patterns(self):
        guard = PatternGuard(patterns=["custom_pattern_only"])
        result = await guard.check("custom_pattern_only in reply")
        assert result.passed is False


class TestNoGuard:
    async def test_always_passes(self):
        guard = NoGuard()
        result = await guard.check("我是AI助手")
        assert result.passed is True
        assert result.correction_note is None


class TestGuardRegistry:
    def test_get_pattern_guard(self):
        guard = get_guard("pattern")
        assert guard is not None
        assert isinstance(guard, PatternGuard)

    def test_get_no_guard(self):
        guard = get_guard("none")
        assert guard is not None
        assert isinstance(guard, NoGuard)

    def test_get_unknown_returns_none(self):
        assert get_guard("nonexistent") is None
