"""Tests for ScoringProgressTracker."""

import time

from infrastructure.scoring_progress import ScoringProgressTracker


class TestScoringProgressTracker:
    def test_lifecycle(self):
        t = ScoringProgressTracker(ttl=600)
        t.start(1)
        assert t.get(1) is not None
        assert t.get(1).phase == "loading"
        assert t.get(1).percentage == 0

        t.update(1, "scoring", 30, "正在评分")
        entry = t.get(1)
        assert entry.phase == "scoring"
        assert entry.percentage == 30
        assert entry.message == "正在评分"

        t.remove(1)
        assert t.get(1) is None

    def test_update_overwrites(self):
        t = ScoringProgressTracker(ttl=600)
        t.start(1)
        t.update(1, "scoring", 50, "中期")
        t.update(1, "feedback", 75, "后期")
        entry = t.get(1)
        assert entry.phase == "feedback"
        assert entry.percentage == 75

    def test_unknown_record_returns_none(self):
        t = ScoringProgressTracker(ttl=600)
        assert t.get(999) is None

    def test_completed_kept_for_short_period(self):
        t = ScoringProgressTracker(ttl=600)
        t.start(1)
        t.update(1, "completed", 100, "完成")
        # Completed entries are kept for 60s
        assert t.get(1) is not None

    def test_cleanup_expired_ttl(self):
        t = ScoringProgressTracker(ttl=0.1)
        t.start(1)
        assert t.get(1) is not None
        time.sleep(0.15)
        # After TTL, get() triggers cleanup
        assert t.get(1) is None

    def test_multiple_records_independent(self):
        t = ScoringProgressTracker(ttl=600)
        t.start(1)
        t.start(2)
        t.update(1, "scoring", 30, "record 1")
        t.update(2, "feedback", 70, "record 2")
        assert t.get(1).phase == "scoring"
        assert t.get(2).phase == "feedback"

    def test_remove_nonexistent_no_error(self):
        t = ScoringProgressTracker(ttl=600)
        t.remove(999)  # should not raise
