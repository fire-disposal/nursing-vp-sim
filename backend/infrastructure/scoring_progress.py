"""Scoring progress tracker — DB-backed."""

from __future__ import annotations

import logging

from core.database import SessionLocal
from models import ScoringProgress as ScoringProgressModel

log = logging.getLogger(__name__)


class ScoringProgressTracker:
    def set(self, record_id: int, stage: str, percent: int, message: str = "") -> None:
        db = SessionLocal()
        try:
            row = db.query(ScoringProgressModel).filter(ScoringProgressModel.record_id == record_id).first()
            if row:
                row.stage = stage
                row.percent = percent
                row.message = message
            else:
                row = ScoringProgressModel(record_id=record_id, stage=stage, percent=percent, message=message)
                db.add(row)
            db.commit()
        except Exception:
            log.exception("Failed to update scoring progress for record %d", record_id)
            db.rollback()
        finally:
            db.close()

    def get(self, record_id: int) -> dict | None:
        db = SessionLocal()
        try:
            row = db.query(ScoringProgressModel).filter(ScoringProgressModel.record_id == record_id).first()
            if row is None:
                return None
            return {
                "stage": row.stage,
                "percent": row.percent,
                "message": row.message or "",
            }
        finally:
            db.close()

    def get_progress(self, record_id: int) -> dict | None:
        return self.get(record_id)

    def start(self, record_id: int) -> None:
        self.set(record_id, "loading", 0, "开始评分")

    def update(self, record_id: int, stage: str, pct: int, msg: str) -> None:
        self.set(record_id, stage, pct, msg)
