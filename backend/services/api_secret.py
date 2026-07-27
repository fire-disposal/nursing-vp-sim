"""ApiSecret business logic — admin CRUD."""

import logging
import re

from sqlalchemy.orm import Session

from core.exceptions import ConflictError, ValidationError
from core.unit_of_work import unit_of_work
from infrastructure.llm import decrypt_api_key, encrypt_api_key
from models import ApiSecret
from repositories.api_secret import ApiSecretRepository

log = logging.getLogger(__name__)


class ApiSecretService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = ApiSecretRepository(db)

    def list_all(self) -> list[ApiSecret]:
        return self.repo.list_all(order_by=ApiSecret.created_at.desc())

    def list_for_admin(self) -> list[dict]:
        secrets = self.repo.list_all(order_by=ApiSecret.created_at.desc())
        result = []
        for s in secrets:
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
                    "priority": s.priority or 0,
                    "model_override": s.model_override,
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
            raise ValidationError("密钥不存在")
        with unit_of_work(self.db, conflict_detail="更新密钥失败"):
            editable = (
                "label",
                "base_url",
                "price_input_per_1m",
                "price_output_per_1m",
                "monthly_cost_limit",
                "priority",
                "model_override",
            )
            for field in editable:
                val = data.get(field)
                if val is not None:
                    setattr(s, field, val)

    def delete(self, secret_id: int) -> None:
        s = self.repo.get(secret_id)
        if not s:
            raise ValidationError("密钥不存在")
        from models import LLMCallLog

        with unit_of_work(self.db, conflict_detail="删除密钥失败"):
            self.db.query(LLMCallLog).filter(LLMCallLog.secret_id == secret_id).update(
                {LLMCallLog.secret_id: None}, synchronize_session=False
            )
            self.repo.delete(s)
