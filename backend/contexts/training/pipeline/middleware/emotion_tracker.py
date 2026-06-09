# backend/contexts/training/pipeline/middleware/emotion_tracker.py
from backend.contexts.patient.emotion import get_emotion, classify_intent


async def emotion_tracker(ctx):
    """情绪跟踪中间件：分类意图 → 更新情绪状态 → 写入 ctx.state"""
    student_text = ctx.student_display or ctx.student_input
    if not student_text:
        return ctx

    emotion = get_emotion(ctx.record.id)
    intent = classify_intent(student_text)
    emotion.update(intent)

    ctx.state["emotion_note"] = emotion.note
    return ctx
