"""emotion_tracker middleware — classify intent and update emotion model."""


async def emotion_tracker(ctx, next_mw):
    from contexts.patient.emotion import classify_intent, get_emotion
    from core.feature_flags import is_enabled

    if ctx.should_shortcut or ctx.error:
        await next_mw()
        return

    if not is_enabled(ctx.record, "emotion"):
        await next_mw()
        return

    student_text = ctx.student_display or ctx.student_input
    if not student_text:
        await next_mw()
        return

    cache = ctx.app_state.emotion_cache
    emotion = get_emotion(ctx.record.id, cache)
    intent = classify_intent(student_text)
    emotion.update(intent)

    ctx.state["emotion_note"] = emotion.note
    ctx.state["_emotion_change"] = {
        "state": emotion.state,
        "trust": emotion.trust,
        "comfort": emotion.comfort,
    }
    ctx.system_events.append(
        {
            "emotion_change": {
                "state": emotion.state,
                "trust": emotion.trust,
                "comfort": emotion.comfort,
            }
        }
    )
    await next_mw()
