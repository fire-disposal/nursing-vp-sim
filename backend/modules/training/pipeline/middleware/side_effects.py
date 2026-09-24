"""side_effects — post-reply effects: emotion state push (immediate), initiative state."""

import logging
from datetime import UTC, datetime

from core.statuses import TrainingStatus
from infra.queue import QueueFullError
from modules.training.patient_ai.initiative import (
    MAX_INITIATIVE_PER_SESSION,
    get_initiative_policy_seconds,
)

from ..context import (
    STATE_DONE_PAYLOAD,
    STATE_EMOTION_CHANGE,
    STATE_EMOTION_DOMINANT,
    STATE_FEATURES,
    STATE_PATIENT_WALKOUT,
    PipelineContext,
)

log = logging.getLogger(__name__)


async def side_effects(ctx: PipelineContext, next_mw) -> None:
    await next_mw()

    if ctx.error or ctx.should_shortcut:
        return

    app = ctx.app_state
    features = ctx.state.get(STATE_FEATURES) or {}

    has_emotion = features.get("emotion", False)
    if has_emotion and ctx.llm_reply:
        # 推送 4D emotion_change（统一 0-100 刻度 + dominant_state，见 serialize_emotion_vector）
        change_4d = ctx.state.get(STATE_EMOTION_CHANGE)
        dominant = ctx.state.get(STATE_EMOTION_DOMINANT)
        if change_4d and dominant:
            from modules.training.patient_ai.emotion import EmotionVector
            from modules.training.patient_ai.emotion.renderer import serialize_emotion_vector

            vector = EmotionVector(
                trust=change_4d.get("trust", 0.5),
                anxiety=change_4d.get("anxiety", 0.5),
                irritation=change_4d.get("irritation", 0.5),
                cooperation=change_4d.get("cooperation", 0.5),
            )
            ctx.system_events.append(
                {
                    "emotion_change": {
                        **serialize_emotion_vector(vector),
                        "dominant_state": dominant,
                    }
                }
            )
    has_initiative = features.get("patient_initiative", False)

    if has_initiative and ctx.llm_reply:
        initiative_cache = getattr(app, "initiative_cache", None)
        if initiative_cache is not None:
            try:
                case_data = ctx.case_data or {}
                personality = case_data.get("personality", {}) or case_data.get("patient_info", {}).get(
                    "personality", {}
                )
                from modules.training.patient_ai.emotion import EmotionRepository, EmotionVector

                repo = EmotionRepository()
                state = repo.get(ctx.record.id, ctx.db)
                vector = state.vector if state else EmotionVector.neutral()

                elapsed, threshold = get_initiative_policy_seconds(
                    ctx.record.id, initiative_cache, ctx.db, vector, personality
                )
                count = initiative_cache.get_count(ctx.record.id, ctx.db)
                max_reached = count >= MAX_INITIATIVE_PER_SESSION
                ctx.system_events.append(
                    {
                        "initiative_state": {
                            "elapsed_seconds": round(elapsed, 1),
                            "threshold_seconds": round(threshold, 1),
                            "percent": min(100, round(elapsed / max(1, threshold) * 100, 1)),
                            "initiative_count": count,
                            "max_reached": max_reached,
                        }
                    }
                )
            except Exception:
                log.warning("Initiative state emission failed: record_id=%d", ctx.record.id, exc_info=True)

    if has_emotion and ctx.state.get(STATE_PATIENT_WALKOUT):
        try:
            await _end_by_patient_walkout(ctx, app)
        except Exception:
            log.exception("Patient walkout finalization failed: record_id=%d", ctx.record.id)

    try:
        ctx.db.commit()
    except Exception:
        ctx.db.rollback()
        log.warning("Side effects commit failed: record_id=%d", ctx.record.id, exc_info=True)


async def _end_by_patient_walkout(ctx: PipelineContext, app) -> None:
    """患者中止访谈 → 终结会话（复用 /end 的幂等路径：finalize + 入队评分）。

    在 SIDE_EFFECTS 阶段执行：此时 persister 已提交本轮 student+patient 消息，
    因此评分读到的转录包含患者最后一句话（这才是「走人」的完整体现）。
    """
    from modules.training.router.scoring import _run_scoring_background
    from modules.training.session.finalize import (
        cleanup_session_runtime,
        finalize_training,
        mark_patient_walkout,
    )

    now = datetime.now(UTC)
    record_id = ctx.record.id
    mark_patient_walkout(ctx.record, at=now)
    claimed, kind, case_data = finalize_training(ctx.db, record_id, ended_at=now)
    if not claimed:
        log.warning("Patient walkout: record not finalizable (already ending?): record_id=%d", record_id)
        return
    if kind != TrainingStatus.COMPLETED or case_data is None:
        return

    try:
        # 闭包在 worker 阶段才执行，彼时 ctx.record 已随请求 session 脱离（DetachedInstanceError）：
        # 只能捕获标量，不能在闭包里回读 ORM 属性。
        await app.task_queue.enqueue(
            lambda: _run_scoring_background(
                record_id,
                case_data,
                llm_client=app.llm_client,
                tracker=getattr(app, "scoring_tracker", None),
                realtime_hub=app.realtime_hub,
            ),
            priority=5,
        )
    except QueueFullError:
        # 响应已在流式输出中，无法回 503：残留的 pending 交给 settlement 的卡死评分清扫
        log.error("Patient walkout: scoring queue full: record_id=%d", record_id)

    ctx.state[STATE_DONE_PAYLOAD] = {
        **(ctx.state.get(STATE_DONE_PAYLOAD) or {}),
        "ended": True,
        "end_reason": "patient_walkout",
    }
    cleanup_session_runtime(ctx.record, app, ctx.db)
    log.info(
        "训练因患者中止访谈结束: record_id=%d",
        record_id,
        extra={"user_id": ctx.current_user.id, "action": "training_patient_walkout"},
    )
