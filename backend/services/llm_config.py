"""LLMConfig business logic — admin CRUD for purpose-to-secret bindings."""

import logging

from sqlalchemy.orm import Session

from core.exceptions import NotFoundError
from core.unit_of_work import unit_of_work
from models import ApiSecret, LLMConfig
from repositories.llm_config import LLMConfigRepository

log = logging.getLogger(__name__)


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
                    "model_override": c.model_override,
                    "status": c.status,
                    "created_at": c.created_at,
                    "updated_at": c.updated_at,
                }
            )
        return result

    def create_or_reactivate(self, secret_id: int, purpose: str, label: str, model_override: str | None = None) -> int:
        secret = self.db.query(ApiSecret).filter(ApiSecret.id == secret_id).first()
        if not secret:
            raise NotFoundError("档案不存在")

        with unit_of_work(self.db, conflict_detail="创建用途指派失败"):
            self.db.query(LLMConfig).filter(
                LLMConfig.purpose == purpose,
                LLMConfig.secret_id != secret_id,
                LLMConfig.status == "active",
            ).update({"status": "disabled"}, synchronize_session=False)

            existing = (
                self.db.query(LLMConfig).filter(LLMConfig.secret_id == secret_id, LLMConfig.purpose == purpose).first()
            )
            if existing:
                existing.label = label or ""
                existing.status = "active"
                if model_override is not None:
                    existing.model_override = model_override
                return existing.id

            cfg = self.repo.add(
                LLMConfig(
                    secret_id=secret_id,
                    purpose=purpose,
                    label=label or "",
                    model_override=model_override,
                )
            )
        self.db.refresh(cfg)
        return cfg.id

    def update(self, config_id: int, data: dict) -> None:
        cfg = self.repo.get(config_id)
        if not cfg:
            raise NotFoundError("指派不存在")
        with unit_of_work(self.db, conflict_detail="更新用途指派失败"):
            for f in ("secret_id", "purpose", "status", "label", "model_override"):
                if f in data:
                    setattr(cfg, f, data[f])

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
