from infrastructure.cache import EmotionCache, InitiativeCache


class TestEmotionCache:

    def test_get_creates_default(self):
        cache = EmotionCache()
        state = cache.get(1)
        assert state.score == 0
        assert state.state == "neutral"

    def test_set_and_get(self):
        cache = EmotionCache()
        cache.set(1, score=2, state="engaged", note="良好")
        state = cache.get(1)
        assert state.score == 2
        assert state.state == "engaged"

    def test_cleanup_removes(self):
        cache = EmotionCache()
        cache.set(1, score=1, state="neutral", note="")
        assert cache.size == 1
        cache.cleanup(1)
        assert cache.size == 0
        state = cache.get(1)
        assert state.score == 0  # creates fresh default

    def test_cleanup_completed(self):
        cache = EmotionCache()
        cache.set(1, score=0, state="neutral", note="")
        cache.set(2, score=0, state="neutral", note="")
        cache.set(3, score=0, state="neutral", note="")
        removed = cache.cleanup_completed({1, 3})
        assert removed == 2
        assert cache.size == 1


class TestInitiativeCache:

    def test_update_and_get_timer(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        assert cache.get_timer(1, 0.0) == 1000.0
        assert cache.get_timer(999, 5.0) == 5.0

    def test_last_trigger(self):
        cache = InitiativeCache()
        assert cache.get_last_trigger(1) == 0.0
        cache.set_last_trigger(1, 2000.0)
        assert cache.get_last_trigger(1) == 2000.0

    def test_update_timer_clears_trigger(self):
        cache = InitiativeCache()
        cache.set_last_trigger(1, 2000.0)
        cache.update_timer(1, 3000.0)
        assert cache.get_last_trigger(1) == 0.0

    def test_cleanup(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        cache.set_last_trigger(1, 2000.0)
        assert cache.size == 1
        cache.cleanup(1)
        assert cache.size == 0

    def test_cleanup_completed(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        cache.update_timer(2, 2000.0)
        removed = cache.cleanup_completed({1})
        assert removed >= 1
        assert cache.size == 1
