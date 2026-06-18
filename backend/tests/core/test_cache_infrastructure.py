from infrastructure.cache import EmotionCache, InitiativeCache


class TestEmotionCache:
    def test_get_returns_none_for_missing(self):
        cache = EmotionCache()
        assert cache.get(1) is None

    def test_set_and_get(self):
        cache = EmotionCache()
        state = object()
        cache.set(1, state)
        assert cache.get(1) is state

    def test_cleanup_removes(self):
        cache = EmotionCache()
        cache.set(1, object())
        assert cache.get(1) is not None
        cache.cleanup(1)
        assert cache.get(1) is None

    def test_cleanup_completed(self):
        cache = EmotionCache()
        cache.set(1, object())
        cache.set(2, object())
        cache.set(3, object())
        removed = cache.cleanup_completed({1, 3})
        assert removed == 2
        assert cache.get(1) is None
        assert cache.get(2) is not None
        assert cache.get(3) is None

    def test_all_ids(self):
        cache = EmotionCache()
        cache.set(1, object())
        cache.set(2, object())
        assert 1 in cache.all_ids
        assert 2 in cache.all_ids


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
        assert cache.get_timer(1, 0.0) == 1000.0
        cache.cleanup(1)
        assert cache.get_timer(1, 0.0) == 0.0
        assert cache.get_last_trigger(1) == 0.0

    def test_cleanup_completed(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        cache.update_timer(2, 2000.0)
        removed = cache.cleanup_completed({1})
        assert removed >= 1
        assert cache.get_timer(1, 0.0) == 0.0
        assert cache.get_timer(2, 0.0) == 2000.0

    def test_all_ids(self):
        cache = InitiativeCache()
        cache.update_timer(1, 1000.0)
        cache.set_last_trigger(2, 2000.0)
        ids = cache.all_ids
        assert 1 in ids
        assert 2 in ids
