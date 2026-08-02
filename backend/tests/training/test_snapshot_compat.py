"""Unit tests for prompt snapshot compat reader (v1 flat / v2 versioned)."""

from modules.training.pipeline.snapshot_compat import PromptSnapshot, read_prompt_snapshot


class TestReadPromptSnapshot:
    def test_none_or_empty_returns_none(self):
        assert read_prompt_snapshot(None) is None
        assert read_prompt_snapshot({}) is None

    def test_v1_flat_keys(self):
        raw = {"system": "系统提示", "dynamic": "动态内容"}
        snap = read_prompt_snapshot(raw)
        assert snap == PromptSnapshot(
            schema_version=1,
            purpose="patient_chat",
            system="系统提示",
            dynamic="动态内容",
        )

    def test_v1_missing_keys_default_empty(self):
        snap = read_prompt_snapshot({"system": "s"})
        assert snap.dynamic == ""

    def test_v2_versioned_segments(self):
        raw = {
            "schema_version": 2,
            "purpose": "scoring",
            "segments": {"system": "sys", "dynamic": "dyn"},
        }
        snap = read_prompt_snapshot(raw)
        assert snap.schema_version == 2
        assert snap.purpose == "scoring"
        assert snap.system == "sys"
        assert snap.dynamic == "dyn"

    def test_v2_missing_segments_default_empty(self):
        raw = {"schema_version": 2, "purpose": "chat"}
        snap = read_prompt_snapshot(raw)
        assert snap.system == ""
        assert snap.dynamic == ""

    def test_v2_default_purpose(self):
        raw = {"schema_version": 3, "segments": {"system": "s"}}
        snap = read_prompt_snapshot(raw)
        assert snap.purpose == "patient_chat"
        assert snap.schema_version == 3

    def test_version_at_least_2_takes_segments_path(self):
        assert read_prompt_snapshot({"schema_version": 2}).schema_version == 2
