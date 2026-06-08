"""Async settlement loop — auto-completes timed-out training sessions."""

import asyncio
import logging
import re
from datetime import UTC, datetime

from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.queue import TaskQueue
from models import Case, Message

log = logging.getLogger(__name__)


def _count_covered_inquiries(inquiries: list[str], student_text: str) -> int:
    """Count how many required inquiries are covered by student messages."""
    if not inquiries:
        return 0
    covered = 0
    for inquiry in inquiries:
        cleaned = re.sub(r"[（）()]", " ", inquiry)
        tokens = set()
        for i in range(len(cleaned) - 1):
            token = cleaned[i:i + 2]
            if token.strip():
                tokens.add(token)
        if any(token in student_text for token in tokens):
            covered += 1
    return covered


def _should_auto_score(messages: list, case_data: dict, auto_score_config: dict | None = None) -> bool:
    """Check if a session has enough content for auto-scoring."""
    from core.config import AUTO_SCORE_AI_CHARS_MIN, AUTO_SCORE_COVERED_INQUIRIES_MIN, AUTO_SCORE_STUDENT_CHARS_MIN

    inquiries = case_data.get("required_inquiries", [])
    student_text = "".join(m.content for m in messages if getattr(m, "role", None) == "student")
    ai_text = "".join(m.content for m in messages if getattr(m, "role", None) == "patient")
    covered = _count_covered_inquiries(inquiries, student_text)
    return (
        covered >= AUTO_SCORE_COVERED_INQUIRIES_MIN
        and len(student_text) >= AUTO_SCORE_STUDENT_CHARS_MIN
        and len(ai_text) >= AUTO_SCORE_AI_CHARS_MIN
    )


async def settlement_loop(
    repo,
    task_queue: TaskQueue,
    interval: int = 30,
    emotion_cache: EmotionCache | None = None,
    initiative_cache: InitiativeCache | None = None,
) -> None:
    """Periodic loop: find timed-out sessions, mark completed, optionally trigger scoring."""
    while True:
        await asyncio.sleep(interval)
        try:
            await _settle_once(repo, task_queue, emotion_cache, initiative_cache)
        except Exception:
            log.exception("自动结算循环异常")


async def _settle_once(
    repo,
    task_queue: TaskQueue,
    emotion_cache: EmotionCache | None,
    initiative_cache: InitiativeCache | None,
) -> None:
    timeout_records = await repo.find_timeout_records()
    if not timeout_records:
        if emotion_cache and initiative_cache:
            await _cleanup_orphaned_cache(repo, emotion_cache, initiative_cache)
        return

    log.info("发现 %d 个超时会话，开始自动结算", len(timeout_records))

    from core.database import SessionLocal

    for record in timeout_records:
        try:
            messages = await repo.find_messages(record.id)

            case_data = {}
            db = SessionLocal()
            try:
                case = db.query(Case).filter(Case.id == record.case_id).first()
                if case and case.case_data:
                    case_data = case.case_data
            finally:
                db.close()

            await repo.mark_completed(record.id)

            if emotion_cache:
                emotion_cache.cleanup(record.id)
            if initiative_cache:
                initiative_cache.cleanup(record.id)

            if _should_auto_score(messages, case_data):
                await repo.update_scoring_status(record.id, "pending")
                await task_queue.enqueue(
                    lambda rid=record.id, cd=case_data: _run_scoring_job(rid, cd, repo),
                    priority=5,
                )
                log.info("自动结算+评分: record_id=%d", record.id)
            else:
                log.info("自动结算(跳过评分): record_id=%d", record.id)
        except Exception:
            log.exception("自动结算 record_id=%d 失败", record.id)


async def _run_scoring_job(record_id: int, case_data: dict, repo) -> None:
    """Run scoring as a background task with status tracking."""
    from core.database import SessionLocal
    from services.scoring.engine import evaluate_training

    db = SessionLocal()
    try:
        await repo.update_scoring_status(record_id, "processing")

        # TODO(v2): infra.py deleted — use Depends injection or TaskQueue
        client = get_client()
        router = get_router()
        pm = get_pm()
        log_worker = get_log_worker()

        await asyncio.wait_for(
            evaluate_training(
                record_id, case_data, db,
                pm=pm, router=router, log_worker=log_worker, client=client,
            ),
            timeout=300,
        )
        await repo.update_scoring_status(record_id, "completed")
        log.info("评分完成: record_id=%d", record_id)
    except TimeoutError:
        await repo.update_scoring_status(record_id, "failed", "评分超时（超过5分钟）")
        log.exception("评分超时 record_id=%d", record_id)
    except Exception as e:
        await repo.update_scoring_status(record_id, "failed", str(e)[:2000])
        log.exception("评分失败 record_id=%d", record_id)
    finally:
        db.close()


async def _cleanup_orphaned_cache(
    repo, emotion_cache: EmotionCache, initiative_cache: InitiativeCache
) -> None:
    """Remove cache entries for already-completed records."""
    record_ids: set[int] = set()
    record_ids.update(emotion_cache._store.keys())
    record_ids.update(initiative_cache._timers.keys())
    record_ids.update(initiative_cache._last_triggers.keys())

    if not record_ids:
        return

    from core.database import SessionLocal
    from models import TrainingRecord

    db = SessionLocal()
    try:
        completed = set(
            row[0] for row in db.query(TrainingRecord.id).filter(
                TrainingRecord.id.in_(list(record_ids)),
                TrainingRecord.status == "completed",
            ).all()
        )
    finally:
        db.close()

    e_removed = emotion_cache.cleanup_completed(completed)
    i_removed = initiative_cache.cleanup_completed(completed)
    if e_removed or i_removed:
        log.info("清理了 %d emotion + %d initiative 缓存条目", e_removed, i_removed)
