import asyncio
import logging
import re
import threading
from datetime import UTC, datetime

from core.config import AUTO_SCORE_COVERED_INQUIRIES_MIN, AUTO_SCORE_STUDENT_CHARS_MIN, AUTO_SCORE_AI_CHARS_MIN, CLEANUP_INTERVAL_SECONDS
from core.database import SessionLocal
from models import Case, Message, TrainingRecord

log = logging.getLogger(__name__)


def count_covered_inquiries(inquiries: list[str], student_text: str) -> int:
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


def should_auto_score(messages, case_data: dict) -> bool:
    inquiries = case_data.get("required_inquiries", [])
    student_text = "".join(m.content for m in messages if getattr(m, "role", None) == "student")
    ai_text = "".join(m.content for m in messages if getattr(m, "role", None) == "patient")

    covered = count_covered_inquiries(inquiries, student_text)
    student_chars = len(student_text)
    ai_chars = len(ai_text)

    return (
        covered >= AUTO_SCORE_COVERED_INQUIRIES_MIN
        and student_chars >= AUTO_SCORE_STUDENT_CHARS_MIN
        and ai_chars >= AUTO_SCORE_AI_CHARS_MIN
    )


async def run_cleanup_loop():
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
        try:
            _cleanup_once()
        except Exception:
            log.exception("自动结算循环异常")


def _cleanup_once():
    from sqlalchemy import text

    db = SessionLocal()
    try:
        now = datetime.now(UTC)
        timeout_records = (
            db.query(TrainingRecord)
            .filter(TrainingRecord.status == "in_progress")
            .filter(
                text(
                    "training_records.start_time + (training_records.time_limit * interval '1 minute') < :now"
                ).bindparams(now=now)
            )
            .all()
        )

        if not timeout_records:
            return

        log.info("发现 %d 个超时会话，开始自动结算", len(timeout_records))

        for record in timeout_records:
            try:
                messages = (
                    db.query(Message)
                    .filter(Message.record_id == record.id)
                    .order_by(Message.created_at)
                    .all()
                )

                case = db.query(Case).filter(Case.id == record.case_id).first()
                case_data = case.case_data if case and case.case_data else {}

                record.status = "completed"
                record.end_time = now

                if should_auto_score(messages, case_data):
                    record.scoring_status = "pending"
                    db.commit()

                    from routers.training import _run_scoring_background, _try_acquire_scoring

                    if _try_acquire_scoring(record.id):
                        t = threading.Thread(
                            target=_run_scoring_background,
                            args=(record.id, case_data),
                            daemon=True,
                        )
                        t.start()
                        log.info(
                            "自动结算+评分: record_id=%d covered=%d students=%d ai=%d",
                            record.id,
                            count_covered_inquiries(
                                case_data.get("required_inquiries", []),
                                "".join(m.content for m in messages if m.role == "student"),
                            ),
                            sum(len(m.content) for m in messages if m.role == "student"),
                            sum(len(m.content) for m in messages if m.role == "patient"),
                        )
                    else:
                        log.warning("自动结算: record_id=%d 评分锁已被占用，跳过评分", record.id)
                else:
                    db.commit()
                    log.info(
                        "自动结算(跳过评分): record_id=%d covered=%d students=%d ai=%d",
                        record.id,
                        count_covered_inquiries(
                            case_data.get("required_inquiries", []),
                            "".join(m.content for m in messages if m.role == "student"),
                        ),
                        sum(len(m.content) for m in messages if m.role == "student"),
                        sum(len(m.content) for m in messages if m.role == "patient"),
                    )
            except Exception:
                log.exception("自动结算 record_id=%d 失败", record.id)
                db.rollback()
    finally:
        db.close()
