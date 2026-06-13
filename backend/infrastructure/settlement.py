"""Async settlement loop — auto-completes timed-out training sessions."""

import asyncio
import logging
import re

from core.config import SCORING_TIMEOUT_SECONDS
from infrastructure.cache import EmotionCache, InitiativeCache
from infrastructure.llm.client import LLMClient
from infrastructure.queue import TaskQueue
from models import Case

log = logging.getLogger(__name__)


def count_covered_inquiries(inquiries: list[str], student_text: str) -> int:
    if not inquiries:
        return 0
    covered = 0
    for inquiry in inquiries:
        cleaned = re.sub(r"[（）()]", " ", inquiry)
        tokens = set()
        for i in range(len(cleaned) - 1):
            token = cleaned[i : i + 2]
            if token.strip():
                tokens.add(token)
        if any(token in student_text for token in tokens):
            covered += 1
    return covered


def should_auto_score(messages: list, case_data: dict) -> bool:
    from core.config import AUTO_SCORE_AI_CHARS_MIN, AUTO_SCORE_COVERED_INQUIRIES_MIN, AUTO_SCORE_STUDENT_CHARS_MIN

    inquiries = case_data.get("required_inquiries", [])
    student_text = "".join(m.content for m in messages if getattr(m, "role", None) == "student")
    ai_text = "".join(m.content for m in messages if getattr(m, "role", None) == "patient")
    covered = count_covered_inquiries(inquiries, student_text)
    return (
        covered >= AUTO_SCORE_COVERED_INQUIRIES_MIN
        and len(student_text) >= AUTO_SCORE_STUDENT_CHARS_MIN
        and len(ai_text) >= AUTO_SCORE_AI_CHARS_MIN
    )


async def settlement_loop(
    repo,
    task_queue: TaskQueue,
    *,
    llm_client: LLMClient,
    pm,
    interval: int = 30,
    emotion_cache: EmotionCache | None = None,
    initiative_cache: InitiativeCache | None = None,
) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            await _settle_once(repo, task_queue, llm_client, pm, emotion_cache, initiative_cache)
        except Exception:
            log.exception("自动结算循环异常")


async def _settle_once(
    repo,
    task_queue: TaskQueue,
    llm_client: LLMClient,
    pm,
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

            await repo.update_scoring_status(record.id, "pending")
            await task_queue.enqueue(
                lambda rid=record.id, cd=case_data: _run_scoring_job(rid, cd, repo, llm_client, pm),
                priority=5,
            )
            log.info("自动结算+评分: record_id=%d", record.id)
        except Exception:
            log.exception("自动结算 record_id=%d 失败", record.id)


async def _run_scoring_job(
    record_id: int,
    case_data: dict,
    repo,
    llm_client: LLMClient,
    pm,
) -> None:
    from contexts.training.score_engine import evaluate_training
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        await repo.update_scoring_status(record_id, "processing")

        await asyncio.wait_for(
            evaluate_training(
                record_id,
                case_data,
                db,
                pm=pm,
                llm_client=llm_client,
            ),
            timeout=SCORING_TIMEOUT_SECONDS,
        )
        await repo.update_scoring_status(record_id, "completed")
        log.info("评分完成: record_id=%d", record_id)
    except TimeoutError:
        await repo.update_scoring_status(record_id, "failed", "评分超时（超过5分钟）")
        log.exception("评分超时 record_id=%d", record_id)
    except Exception as e:
        await repo.update_scoring_status(record_id, "failed", str(e)[:2000] or f"{type(e).__name__}")
        log.exception("评分失败 record_id=%d", record_id)
    finally:
        db.close()


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
