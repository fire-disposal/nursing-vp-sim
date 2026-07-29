"""TTS router transaction lifecycle regressions."""

from collections.abc import AsyncIterator
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from routers import tts as tts_router
from schemas.voice import TTSSynthesizeRequest
from services.tts import TTSStreamInfo


class _FakeTTSService:
    def __init__(self, db):
        self.db = db

    async def stream_synthesize(self, **kwargs):
        async def gen() -> AsyncIterator[bytes]:
            yield b"pcm"

        return TTSStreamInfo(speaker="voice", emotion=kwargs["emotion_state"], sample_rate=24000), gen()


@pytest.mark.asyncio
async def test_stream_tts_releases_db_transaction_before_returning_stream(monkeypatch):
    monkeypatch.setattr(tts_router, "check_tts_limit", AsyncMock(return_value=None))
    monkeypatch.setattr(tts_router, "TTSService", _FakeTTSService)

    db = MagicMock()
    cache = MagicMock()
    cache.get.return_value = None
    request = SimpleNamespace(
        app=SimpleNamespace(
            state=SimpleNamespace(
                emotion_cache=cache,
                tts_pool=object(),
                tts_config={"timeout": 8, "speaker_library": None},
            )
        )
    )
    user = SimpleNamespace(id=7)
    req = TTSSynthesizeRequest(text="你好", record_id=123)

    response = await tts_router.synthesize_stream(req, user, db, request)

    assert response.status_code == 200
    assert db.rollback.call_count == 2
    cache.set.assert_not_called()
