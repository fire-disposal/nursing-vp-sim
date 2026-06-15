"""side_effects — post-reply effects including initiative generation."""

import logging

from contexts.patient.emotion import get_emotion
from contexts.patient.initiative import generate_initiative, should_initiate, update_initiative_timer
from models import Message

from ..context import PipelineContext

log = logging.getLogger(__name__)


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    features = ctx.state.get("features") or {}
    if not features.get("patient_initiative") or not ctx.llm_reply:
        return

    app = ctx.app_state
    initiative_cache = getattr(app, "initiative_cache", None)
    emotion_cache = getattr(app, "emotion_cache", None)
    if initiative_cache is None or emotion_cache is None:
        return

    try:
        case_data = ctx.case_data or {}
        personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get("personality", {})
        emotion_state = get_emotion(ctx.record.id, emotion_cache)

        if not should_initiate(
            ctx.record.id, initiative_cache, personality, emotion_state.trust, emotion_state.comfort
        ):
            update_initiative_timer(ctx.record.id, initiative_cache, len(ctx.llm_reply))
            return

        msg_text = generate_initiative(personality, emotion_state.trust, emotion_state.comfort, 999.0)
        if not msg_text:
            return

        msg = Message(record_id=ctx.record.id, role="patient", content=msg_text)
        ctx.db.add(msg)
        ctx.db.commit()
        ctx.db.refresh(msg)

        ctx.state.setdefault("_saved_messages", []).append(msg)
        ctx.state.setdefault("_post_stream_events", []).append({"initiative": {"content": msg_text, "id": msg.id}})
    except Exception:
        log.warning("Initiative generation failed: record_id=%d", ctx.record.id, exc_info=True)
    finally:
        update_initiative_timer(ctx.record.id, initiative_cache, len(ctx.llm_reply or ""))
