"""emotion_analysis — inline 4D emotion analysis before patient generation.

Runs BEFORE prompt_builder so the current student's communication behavior
affects the current patient reply.

Native 4D flow (no v2 fallback):
    1. Read current 4D state from DB (EmotionRepository)
    2. Recover toward baseline
    3. Analyze student input via EmotionAnalyzer (LLM)
    4. Apply events via EmotionEngine
    5. Save state (optimistic lock) + event history
    6. Derive behavior policy → store in ctx.state for downstream
"""

from __future__ import annotations

import logging

from modules.training.patient_ai.emotion import (
    EmoState,
    EmotionAnalyzer,
    EmotionEngine,
    EmotionProfile,
    EmotionRepository,
    derive_behavior,
    render_behavior_note,
    resolve_dominant_state,
)
from modules.training.pipeline.context import PipelineContext

log = logging.getLogger(__name__)

STATE_EMOTION_NOTE: str = "_emotion_note"
STATE_EMOTION_CHANGE: str = "_emotion_change"
STATE_EMOTION_DOMINANT: str = "_emotion_dominant"


async def emotion_analysis(ctx: PipelineContext, next_mw) -> None:
    """Analyze student input, update 4D emotion state, prepare behavior note."""
    if ctx.should_shortcut:
        await next_mw()
        return

    features = ctx.state.get("features") or {}
    if not features.get("emotion", False):
        await next_mw()
        return

    app = ctx.app_state

    case_data = getattr(ctx, "case_data", None) or {}
    personality = case_data.get("personality", {}) or {}

    try:
        profile = EmotionProfile.from_personality(personality)
        engine = EmotionEngine()
        repo = EmotionRepository()

        # 1. Read current 4D state (create if first turn)
        state = repo.get_or_create(ctx.record.id, ctx.db)

        # 2. Recover toward baseline (per-turn)
        recovered = engine.recover(state.vector, profile)

        # 3. Analyze student input
        student_text = ctx.student_display or ctx.student_input
        patient_text = ""
        for msg in reversed(ctx.messages):
            if msg.role == "patient":
                patient_text = msg.content or ""
                break

        analyzer = EmotionAnalyzer(app.llm_client)
        result = await analyzer.analyze(
            nurse_message=student_text,
            patient_reply=patient_text,
            user_id=ctx.current_user.id,
            record_id=ctx.record.id,
            case_id=ctx.record.case_id,
        )

        # 4. Apply events
        # T3: turn_id 用单调递增的 max(msg.id)，而非有界 message_count——
        # 上下文截断（120 条）会让 message_count 恒为 120，turn_id 撞车导致
        # 60 轮后情绪系统静默冻结。
        last_msg_id = max((m.id for m in ctx.messages if getattr(m, "id", None)), default=0)
        turn_id = f"{ctx.record.id}-{last_msg_id}"
        if state.last_turn_id == turn_id:
            log.debug("Turn %s already processed, skipping emotion update", turn_id)
        elif result.events:
            work_state = EmoState(vector=recovered, version=state.version)
            new_work_state, applied_events = engine.apply_events(work_state, profile, result.events)

            if applied_events:
                final_state = EmoState(
                    vector=new_work_state.vector,
                    version=state.version,
                    last_turn_id=turn_id,
                )
                # 5. Save (optimistic lock) + event history
                saved = repo.save(ctx.record.id, final_state, ctx.db)
                repo.append_events(ctx.record.id, turn_id, applied_events, ctx.db)
                state = saved
                log.debug(
                    "Emotion updated: %d events, version %d",
                    len(applied_events),
                    saved.version,
                )
            else:
                state = EmoState(vector=recovered, version=state.version)
        else:
            # No events: just update the recovered state without bumping version
            state = EmoState(vector=recovered, version=state.version)

        # 6. Derive behavior policy + note
        policy = derive_behavior(state.vector)
        note = render_behavior_note(policy)
        dominant = resolve_dominant_state(state.vector)

        ctx.state[STATE_EMOTION_NOTE] = note
        ctx.state[STATE_EMOTION_CHANGE] = {
            "trust": round(state.vector.trust, 2),
            "anxiety": round(state.vector.anxiety, 2),
            "irritation": round(state.vector.irritation, 2),
            "cooperation": round(state.vector.cooperation, 2),
        }
        ctx.state[STATE_EMOTION_DOMINANT] = dominant

    except Exception:
        log.warning("Emotion analysis failed: record_id=%d", ctx.record.id, exc_info=True)

    await next_mw()
