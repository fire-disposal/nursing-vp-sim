"""Stateless DB operations for ProfileRouter.

Each method owns its own session to avoid coupling with request-scoped sessions.
"""

from __future__ import annotations

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
            secrets = db.query(ApiSecret).all()
            profiles_map: dict[int, ApiSecret] = {}
            bindings_map: dict[str, ApiSecret] = {}
            for s in secrets:
                profiles_map[s.id] = s
                for purpose in PROFILES:
                    bindings_map[purpose] = s
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
                if "call_count_today" in data:
                    db_p.call_count_today = data["call_count_today"]
                if "total_tokens_today" in data:
                    db_p.total_tokens_today = data["total_tokens_today"]
                if "total_cost_today" in data:
                    db_p.total_cost_today = data["total_cost_today"]
                if "monthly_cost_used" in data:
                    db_p.monthly_cost_used = data["monthly_cost_used"]
                if data.get("last_used_at"):
                    db_p.last_used_at = data["last_used_at"]
                if data.get("degraded_reason") is not None:
                    db_p.degraded_reason = data["degraded_reason"]
                if data.get("degraded_until") is not None:
                    db_p.degraded_until = data["degraded_until"]
                if data.get("status") is not None:
                    db_p.status = data["status"]
                db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()
