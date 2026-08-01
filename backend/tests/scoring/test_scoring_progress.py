"""Tests for ScoringProgressTracker (in-memory dict)."""

from infra.scoring_progress import ScoringProgressTracker


class TestScoringProgressTracker:
    def test_lifecycle(self):
        t = ScoringProgressTracker()
        t.start(1)
        entry = t.get(1)
        assert entry is not None
        assert entry["stage"] == "loading"
        assert entry["percent"] == 0

        t.update(1, "scoring", 30, "正在评分")
        entry = t.get(1)
        assert entry["stage"] == "scoring"
        assert entry["percent"] == 30
        assert entry["message"] == "正在评分"

    def test_update_overwrites(self):
        t = ScoringProgressTracker()
        t.start(1)
        t.update(1, "scoring", 50, "中期")
        t.update(1, "feedback", 75, "后期")
        entry = t.get(1)
        assert entry["stage"] == "feedback"
        assert entry["percent"] == 75

    def test_unknown_record_returns_none(self):
        t = ScoringProgressTracker()
        assert t.get(999) is None

    def test_get_progress_alias(self):
        t = ScoringProgressTracker()
        t.set(1, "scoring", 50, "test")
        assert t.get_progress(1) == t.get(1)

    def test_multiple_records_independent(self):
        t = ScoringProgressTracker()
        t.start(1)
        t.start(2)
        t.update(1, "scoring", 30, "record 1")
        t.update(2, "feedback", 70, "record 2")
        assert t.get(1)["stage"] == "scoring"
        assert t.get(2)["stage"] == "feedback"
