"""ApiSecret + LLMConfig business logic — admin CRUD + infrastructure queries."""

import logging
import re
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.unit_of_work import unit_of_work
from infrastructure.llm import decrypt_api_key, encrypt_api_key
from models import ApiSecret, LLMConfig
from repositories.base import Repository

log = logging.getLogger(__name__)


class ApiSecretRepository(Repository[ApiSecret]):
    model = ApiSecret


class LLMConfigRepository(Repository[LLMConfig]):
    model = LLMConfig


class ApiSecretService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ApiSecretRepository(db)

    def list_all(self) -> list[ApiSecret]:
        return self.repo.list_all(order_by=ApiSecret.created_at.desc())

    def list_with_config_counts(self) -> list[dict]:
        secrets = self.repo.list_all(order_by=ApiSecret.created_at.desc())
        result = []
        for s in secrets:
            config_count = self.db.query(LLMConfig).filter(LLMConfig.secret_id == s.id).count()
            result.append(
                {
                    "id": s.id,
                    "label": s.label,
                    "key_suffix": s.key_suffix,
                    "base_url": s.base_url or "",
                    "status": s.status,
                    "degraded_reason": s.degraded_reason,
                    "degraded_until": s.degraded_until,
                    "price_input_per_1m": float(s.price_input_per_1m),
                    "price_output_per_1m": float(s.price_output_per_1m),
                    "monthly_cost_limit": float(s.monthly_cost_limit) if s.monthly_cost_limit else None,
                    "call_count_today": s.call_count_today or 0,
                    "total_tokens_today": s.total_tokens_today or 0,
                    "total_cost_today": float(s.total_cost_today or 0),
                    "monthly_cost_used": float(s.monthly_cost_used or 0),
                    "config_count": config_count,
                    "last_used_at": s.last_used_at,
                    "created_at": s.created_at,
                    "updated_at": s.updated_at,
                }
            )
        return result

    def create(self, data: dict) -> dict:
        if data.get("base_url") and not re.match(r"^https?://", data["base_url"]):
            raise ValidationError("base_url 必须以 http:// 或 https:// 开头")

        raw_key = data.get("raw_key", "")
        for existing in self.repo.list_all():
            try:
                if decrypt_api_key(existing.encrypted_key) == raw_key:
                    raise ConflictError("该 API Key 已存在，请勿重复添加")
            except Exception as exc:
                log.debug("decrypt check skipped: %s", exc)
                continue

        suffix = raw_key[-4:] if len(raw_key) >= 4 else "****"
        with unit_of_work(self.db, conflict_detail="创建密钥失败"):
            s = self.repo.add(
                ApiSecret(
                    label=data["label"],
                    encrypted_key=encrypt_api_key(raw_key),
                    key_suffix=suffix,
                    base_url=data.get("base_url", ""),
                    price_input_per_1m=data.get("price_input_per_1m", 0),
                    price_output_per_1m=data.get("price_output_per_1m", 0),
                    monthly_cost_limit=data.get("monthly_cost_limit"),
                )
            )
        self.db.refresh(s)
        return {"id": s.id, "key_suffix": s.key_suffix}

    def update(self, secret_id: int, data: dict) -> None:
        s = self.repo.get(secret_id)
        if not s:
            raise NotFoundError("档案不存在")
        if data.get("base_url") and not re.match(r"^https?://", data["base_url"]):
            raise ValidationError("base_url 必须以 http:// 或 https:// 开头")
        with unit_of_work(self.db, conflict_detail="更新密钥失败"):
            for field in ("label", "base_url", "price_input_per_1m", "price_output_per_1m", "monthly_cost_limit"):
                val = data.get(field)
                if val is not None:
                    setattr(s, field, val)

    def delete(self, secret_id: int) -> None:
        s = self.repo.get(secret_id)
        if not s:
            raise NotFoundError("档案不存在")
        count = self.db.query(LLMConfig).filter(LLMConfig.secret_id == secret_id).count()
        if count > 0:
            raise ValidationError(f"该档案有 {count} 个用途绑定，先解除")
        with unit_of_work(self.db, conflict_detail="删除密钥失败"):
            self.repo.delete(s)


class LLMConfigService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = LLMConfigRepository(db)

    def list_all(self, purpose: str | None = None) -> list[dict]:
        q = self.db.query(LLMConfig)
        if purpose:
            q = q.filter(LLMConfig.purpose == purpose)
        configs = q.order_by(LLMConfig.purpose).all()
        secrets_map = {s.id: s for s in self.db.query(ApiSecret).all()}
        result = []
        for c in configs:
            s = secrets_map.get(c.secret_id)
            result.append(
                {
                    "id": c.id,
                    "secret_id": c.secret_id,
                    "secret_label": s.label if s else "",
                    "secret_suffix": s.key_suffix if s else "",
                    "base_url": s.base_url or "" if s else "",
                    "label": c.label or "",
                    "purpose": c.purpose,
                    "status": c.status,
                    "created_at": c.created_at,
                    "updated_at": c.updated_at,
                }
            )
        return result

    def create_or_reactivate(self, secret_id: int, purpose: str, label: str) -> int:
        secret = self.db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
        if not secret:
            raise NotFoundError("档案不存在")

        existing = (
            self.db.query(LLMConfig).filter(LLMConfig.secret_id == secret_id, LLMConfig.purpose == purpose).first()
        )
        with unit_of_work(self.db, conflict_detail="创建用途指派失败"):
            if existing:
                existing.label = label or ""
                existing.status = "active"
                return existing.id

            cfg = self.repo.add(
                LLMConfig(
                    secret_id=secret_id,
                    purpose=purpose,
                    label=label or "",
                )
            )
        self.db.refresh(cfg)
        return cfg.id

    def update(self, config_id: int, data: dict) -> None:
        cfg = self.repo.get(config_id)
        if not cfg:
            raise NotFoundError("指派不存在")
        with unit_of_work(self.db, conflict_detail="更新用途指派失败"):
            for f in ("secret_id", "purpose", "status", "label"):
                val = data.get(f)
                if val is not None:
                    setattr(cfg, f, val)

    def delete(self, config_id: int) -> None:
        cfg = self.repo.get(config_id)
        if not cfg:
            raise NotFoundError("指派不存在")
        with unit_of_work(self.db, conflict_detail="删除用途指派失败"):
            self.repo.delete(cfg)

    def toggle(self, config_id: int) -> str:
        cfg = self.repo.get(config_id)
        if not cfg:
            raise NotFoundError("指派不存在")
        with unit_of_work(self.db, conflict_detail="切换指派状态失败"):
            cfg.status = "active" if cfg.status == "disabled" else "disabled"
        return cfg.status

    def reset(self, config_id: int) -> None:
        cfg = self.repo.get(config_id)
        if not cfg:
            raise NotFoundError("指派不存在")
        with unit_of_work(self.db, conflict_detail="重置指派失败"):
            secret = self.db.query(ApiSecret).filter(ApiSecret.id == cfg.secret_id).first()
            if secret:
                secret.status = "active"
                secret.degraded_reason = None
                secret.degraded_until = None
                secret.consecutive_failures = 0
            cfg.status = "active"


class LLMDataService:
    """Stateless DB operations for ProfileRouter — each method owns its own session."""

    @staticmethod
    def load_all() -> tuple[dict[int, ApiSecret], dict[str, object]]:
        from sqlalchemy.orm import joinedload

        from core.database import SessionLocal
        from models import ApiSecret as AS
        from models import LLMConfig as LC

        db = SessionLocal()
        try:
            now = datetime.now(UTC)
            profiles = db.query(AS).all()
            bindings = db.query(LC).options(joinedload(LC.secret)).all()

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
            bindings_map = {}
            for b in bindings:
                bindings_map[b.purpose] = b

            return profiles_map, bindings_map
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def get_profile(secret_id: int) -> ApiSecret | None:
        from core.database import SessionLocal

        db = SessionLocal()
        try:
            return db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
        finally:
            db.close()

    @staticmethod
    def persist_stats(secret_id: int, data: dict) -> None:
        from core.database import SessionLocal

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
