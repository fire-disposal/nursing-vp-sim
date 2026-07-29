"""Unit tests for identity leak detection."""

from modules.training.patient_ai.guards import (
    get_identity_correction_note,
    has_identity_leak,
)


class TestHasIdentityLeak:
    def test_triggers_on_identity_leak(self):
        assert has_identity_leak("我是AI助手，你可以继续提问") is True

    def test_triggers_on_semantic_variant(self):
        assert has_identity_leak("作为一个AI，我来回答你的问题") is True

    def test_no_trigger_on_normal_reply(self):
        assert has_identity_leak("我肚子疼了好几天了，今天特别难受") is False

    def test_empty_reply(self):
        assert has_identity_leak("") is False
        assert has_identity_leak("   ") is False

    def test_correction_note_not_empty(self):
        note = get_identity_correction_note()
        assert len(note) > 10
        assert "注意" in note
