"""Stateless DB operations for ProfileRouter.

Each method owns its own session to avoid coupling with request-scoped sessions.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from infra.llm.profile import PROFILES

if TYPE_CHECKING:
    from models import ApiSecret


class LLMDataService:
    @staticmethod
    def load_all() -> tuple[dict[int, ApiSecret], dict[str, ApiSecret]]:
        from core.database import SessionLocal
        from models import ApiSecret

        db = SessionLocal()
        try:
            now = datetime.now(UTC)
            profiles = db.query(ApiSecret).order_by(ApiSecret.priority.asc(), ApiSecret.id.asc()).all()

            recovered = 0
            for p in profiles:
                if p.status == "degraded" and p.degraded_until:
                    from core.datetime_utils import ensure_utc

                    dt = ensure_utc(p.degraded_until)
                    if dt <= now:
                        p.status = "active"
                        p.degraded_reason = None
                        p.degraded_until = None
                        p.consecutive_failures = 0
                        recovered += 1
            if recovered:
                db.commit()

            profiles_map = {p.id: p for p in profiles}

            bindings_map: dict[str, ApiSecret] = {}
            # active non-degraded ApiSecret. All purposes share the same key pool.
            for purpose in PROFILES:
                for p in profiles:
                    if p.status == "active":
                        bindings_map[purpose] = p
                        break

            return profiles_map, bindings_map
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def get_profile(secret_id: int) -> ApiSecret | None:
        from core.database import SessionLocal
        from models import ApiSecret

        db = SessionLocal()
        try:
            return db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
        finally:
            db.close()

    @staticmethod
    def persist_stats(secret_id: int, data: dict) -> None:
        from core.database import SessionLocal
        from models import ApiSecret

        db = SessionLocal()
        try:
            db_p = db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
            if db_p:
                for field in (
                    "call_count_today",
                    "total_tokens_today",
                    "total_cost_today",
                    "monthly_cost_used",
                    "stats_date",
                    "stats_month",
                    "last_used_at",
                    "status",
                    "degraded_reason",
                    "degraded_until",
                    "consecutive_failures",
                ):
                    val = data.get(field)
                    if val is not None:
                        setattr(db_p, field, val)
                db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
