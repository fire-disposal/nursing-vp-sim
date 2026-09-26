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


async def _end_by_patient_walkout(ctx: PipelineContext, app) -> None:
    """患者中止访谈 → 终结会话（复用 /end 的幂等路径：finalize + 入队评分）。

    在 SIDE_EFFECTS 阶段执行：此时 persister 已提交本轮 student+patient 消息，
    因此评分读到的转录包含患者最后一句话（这才是「走人」的完整体现）。

    提交边界：本函数只提交**自己写的东西**（走人标记、终结状态、运行时清理），
    不再由 side_effects 兜底 ``ctx.db.commit()`` —— 正式产物（回合消息）的提交
    归 persister 的事务 B（docs/15 §八：侧效果与正式产物分离）。
    """
    from modules.training.router.scoring import _run_scoring_background
    from modules.training.session.finalize import (
        END_ORIGIN_PATIENT_WALKOUT,
        cleanup_session_runtime,
        finalize_training,
        mark_patient_walkout,
    )

    now = datetime.now(UTC)
    record_id = ctx.record.id
    mark_patient_walkout(ctx.record, at=now)
    # 走人标记先落库：即便随后终结抢锁失败，chat 准入守卫也必须看到「患者已中止」
    _commit_side_effect(ctx, action="patient_walkout_mark")
    claimed, kind, case_data = finalize_training(ctx.db, record_id, ended_at=now, origin=END_ORIGIN_PATIENT_WALKOUT)
    if not claimed:
        log.warning("Patient walkout: record not finalizable (already ending?): record_id=%d", record_id)
        return
    if kind != TrainingStatus.COMPLETED or case_data is None:
        _commit_side_effect(ctx, action="patient_walkout_finalize")
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
    _commit_side_effect(ctx, action="patient_walkout")
    log.info(
        "训练因患者中止访谈结束: record_id=%d",
        record_id,
        extra={"user_id": ctx.current_user.id, "action": "training_patient_walkout"},
    )


def _commit_side_effect(ctx: PipelineContext, *, action: str) -> None:
    """侧效果的提交边界（best-effort，失败只记日志：不得回滚正式产物）。"""
    try:
        ctx.db.commit()
    except Exception:
        try:
            ctx.db.rollback()
        except Exception:
            log.warning("Rollback failed after side effect error: %s", action, exc_info=True)
        log.warning("Side effect commit failed: %s record_id=%d", action, ctx.record.id, exc_info=True)
