"""Async settlement loop — auto-completes timed-out training sessions.

Does NOT auto-score — only marks timed-out sessions as completed
and cleans up in-memory caches. Scoring is always user-initiated.
"""

import asyncio
import logging

from infrastructure.cache import EmotionCache, InitiativeCache

log = logging.getLogger(__name__)


async def settlement_loop(
    repo,
    *,
    interval: int = 30,
    emotion_cache: EmotionCache | None = None,
    initiative_cache: InitiativeCache | None = None,
) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await _settle_once(repo, emotion_cache, initiative_cache)
        except Exception:
            log.exception("自动结算循环异常")


async def _settle_once(
    repo,
    emotion_cache: EmotionCache | None,
    initiative_cache: InitiativeCache | None,
) -> None:
    timeout_records = await repo.find_timeout_records()
    if not timeout_records:
        if emotion_cache and initiative_cache:
            await _cleanup_orphaned_cache(repo, emotion_cache, initiative_cache)
        return

    log.info("发现 %d 个超时会话，标记为已完成", len(timeout_records))

    for record in timeout_records:
        try:
            await repo.mark_completed(record.id)

            if emotion_cache:
                emotion_cache.cleanup(record.id)
            if initiative_cache:
                initiative_cache.cleanup(record.id)

            log.info("自动结算: record_id=%d (无评分)", record.id)
        except Exception:
            log.exception("自动结算 record_id=%d 失败", record.id)


async def _cleanup_orphaned_cache(repo, emotion_cache: EmotionCache, initiative_cache: InitiativeCache) -> None:
    record_ids: set[int] = set(emotion_cache.all_ids | initiative_cache.all_ids)

    if not record_ids:
        return

    from core.database import SessionLocal
    from models import TrainingRecord

    db = SessionLocal()
    try:
        completed = set(
            row[0]
            for row in db.query(TrainingRecord.id)
            .filter(
                TrainingRecord.id.in_(list(record_ids)),
                TrainingRecord.status == "completed",
            )
            .all()
        )
    finally:
        db.close()

    e_removed = emotion_cache.cleanup_completed(completed)
    i_removed = initiative_cache.cleanup_completed(completed)
    if e_removed or i_removed:
        log.info("清理了 %d emotion + %d initiative 缓存条目", e_removed, i_removed)
