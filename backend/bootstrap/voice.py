"""TTS bootstrap — load TTS connection pool and client state."""

import logging

log = logging.getLogger(__name__)


def init_tts(app_state):
    """Load TTS state into app. Non-fatal on failure."""
    try:
        from core.database import SessionLocal
        from modules.voice.service import load_tts_state

        db_voice = SessionLocal()
        try:
            load_tts_state(app_state, db_voice)
        finally:
            db_voice.close()
    except Exception:
        app_state.tts_client = None
        app_state.tts_pool = None
        app_state.tts_config = {}
        log.exception("TTS client init failed (non-fatal)")
