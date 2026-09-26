"""审计写入入口：**只暴露** `record()` 与 `record_detached()`（append-only 的第一层）。

事务语义（最容易做错的地方，2026-09-26 审计研究 §3.2）：

- `record(db, ...)` —— 与业务变更**同一事务**。业务回滚时审计一起回滚，这是**正确**的：
  没发生的变更不该留下"已发生"的记录。
- `record_detached(...)` —— **独立 session**。用于"被拒绝 / 失败的尝试"（403/409/门禁拒绝）：
  业务侧会 rollback，如果审计也在那个事务里，"有人尝试越权"的证据会被一起回滚掉 ——
  而这恰恰是最需要留下的记录。

刻意不做的事：不提供 update/delete；不引入异步队列（LLM 成本统计那套队列在超预算时**丢最旧**，
`infra/llm/logging.py`，审计不能接受静默丢弃）。
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from models import AuditLog
from models.audit import AUDIT_OUTCOME_DENIED, AUDIT_OUTCOME_FAILURE, AUDIT_OUTCOME_SUCCESS

if TYPE_CHECKING:
    from fastapi import Request
    from sqlalchemy.orm import Session

    from models import User

log = logging.getLogger(__name__)

# ── action 常量：与 core/permissions.py 同思路，集中一处便于审查与查询 ──────────────
ACTION_ROLE_CREATED = "role.created"
ACTION_ROLE_UPDATED = "role.updated"
ACTION_ROLE_DELETED = "role.deleted"
ACTION_USER_CREATED = "user.created"
ACTION_USER_UPDATED = "user.updated"
ACTION_USER_DEACTIVATED = "user.deactivated"
ACTION_USER_ACTIVATED = "user.activated"
ACTION_USER_DELETED = "user.deleted"
ACTION_USER_PASSWORD_RESET = "user.password_reset"
ACTION_USER_BULK_IMPORTED = "user.bulk_imported"
ACTION_USER_BULK_ASSIGNED = "user.bulk_assigned"
ACTION_SECRET_CREATED = "secret.created"
ACTION_SECRET_UPDATED = "secret.updated"
ACTION_SECRET_DELETED = "secret.deleted"
ACTION_ACCESS_DENIED = "access.denied"
ACTION_EXPORT_DOWNLOADED = "export.downloaded"
ACTION_FEEDBACK_REPLIED = "feedback.replied"
ACTION_CASE_PUBLISHED = "case.published"
ACTION_CASE_PUBLISH_REJECTED = "case.publish_rejected"
ACTION_CASE_ARCHIVED = "case.archived"
ACTION_CASE_DELETED = "case.deleted"
ACTION_CASE_OPEN_CHANGED = "case.open_changed"

TARGET_TYPE_USER = "user"
TARGET_TYPE_ROLE = "role"
TARGET_TYPE_SECRET = "secret"
TARGET_TYPE_EXPORT = "export"
TARGET_TYPE_FEEDBACK = "feedback"
TARGET_TYPE_CASE = "case"


def _actor_fields(actor: User | None) -> dict[str, Any]:
    """操作者快照：ID 会在删用户后被 SET NULL，因此同时存可读身份。"""
    if actor is None:
        return {"actor_id": None, "actor_username": None, "actor_display_name": None, "actor_role": None}
    return {
        "actor_id": actor.id,
        "actor_username": actor.username,
        "actor_display_name": actor.display_name,
        "actor_role": actor.role.name if actor.role else None,
    }


def _request_fields(request: Request | None) -> dict[str, Any]:
    if request is None:
        return {
            "request_id": None,
            "ip": None,
            "user_agent": None,
            "request_method": None,
            "request_path": None,
        }
    # 复用限流那套信任模型（只有 nginx 覆盖写的头才可信），不要另写一份 IP 取值
    from core.rate_limits import get_client_ip

    client_ip: str | None
    try:
        client_ip = get_client_ip(request)
    except Exception:  # pragma: no cover - 防御：取 IP 失败不得影响审计
        client_ip = None
    return {
        "request_id": getattr(request.state, "request_id", None),
        "ip": client_ip,
        "user_agent": (request.headers.get("user-agent") or "")[:255] or None,
        "request_method": request.method,
        "request_path": str(request.url.path)[:200],
    }


def _actor_from_request(request: Request | None, actor: User | None) -> dict[str, Any]:
    """`request.state.audit_actor` 由 `require_permission` 的 checker 写入
    （那是全仓唯一必然拿到 `User` 的 choke point）——显式传入的 actor 优先。"""
    if actor is None and request is not None:
        actor = getattr(request.state, "audit_actor", None)
    return _actor_fields(actor)


def record(
    db: Session,
    *,
    action: str,
    target_type: str,
    target_id: str | int | None = None,
    target_label: str | None = None,
    actor: User | None = None,
    request: Request | None = None,
    outcome: str = AUDIT_OUTCOME_SUCCESS,
    payload: dict[str, Any] | None = None,
    error_detail: str | None = None,
) -> AuditLog:
    """与业务**同一事务**落一行审计（调用方负责 commit）。"""
    entry = AuditLog(
        action=action,
        target_type=target_type,
        target_id=None if target_id is None else str(target_id)[:64],
        target_label=(target_label or None) and str(target_label)[:120],
        outcome=outcome,
        payload=payload or {},
        error_detail=(error_detail or None) and str(error_detail)[:500],
        **_actor_from_request(request, actor),
        **_request_fields(request),
    )
    db.add(entry)
    return entry


def record_detached(
    request: Request | None = None,
    *,
    action: str,
    target_type: str,
    target_id: str | int | None = None,
    target_label: str | None = None,
    actor: User | None = None,
    outcome: str = AUDIT_OUTCOME_DENIED,
    payload: dict[str, Any] | None = None,
    error_detail: str | None = None,
) -> None:
    """用**独立 session** 落一行：业务侧回滚也要留下（拒绝/失败场景）。

    独立 session 的失败**不得**影响业务返回 → 只记日志不外抛。
    """
    from core.database import SessionLocal

    db = SessionLocal()
    try:
        record(
            db,
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            actor=actor,
            request=request,
            outcome=outcome,
            payload=payload,
            error_detail=error_detail,
        )
        db.commit()
    except Exception:  # pragma: no cover - 审计失败不阻塞业务
        db.rollback()
        log.exception("审计写入失败（独立 session）：action=%s target=%s", action, target_type)
    finally:
        db.close()


__all__ = [
    "ACTION_ACCESS_DENIED",
    "ACTION_CASE_ARCHIVED",
    "ACTION_CASE_DELETED",
    "ACTION_CASE_OPEN_CHANGED",
    "ACTION_CASE_PUBLISHED",
    "ACTION_CASE_PUBLISH_REJECTED",
    "ACTION_EXPORT_DOWNLOADED",
    "ACTION_FEEDBACK_REPLIED",
    "ACTION_ROLE_CREATED",
    "ACTION_ROLE_DELETED",
    "ACTION_ROLE_UPDATED",
    "ACTION_SECRET_CREATED",
    "ACTION_SECRET_DELETED",
    "ACTION_SECRET_UPDATED",
    "ACTION_USER_ACTIVATED",
    "ACTION_USER_BULK_ASSIGNED",
    "ACTION_USER_BULK_IMPORTED",
    "ACTION_USER_CREATED",
    "ACTION_USER_DEACTIVATED",
    "ACTION_USER_DELETED",
    "ACTION_USER_PASSWORD_RESET",
    "ACTION_USER_UPDATED",
    "AUDIT_OUTCOME_DENIED",
    "AUDIT_OUTCOME_FAILURE",
    "AUDIT_OUTCOME_SUCCESS",
    "TARGET_TYPE_CASE",
    "TARGET_TYPE_EXPORT",
    "TARGET_TYPE_FEEDBACK",
    "TARGET_TYPE_ROLE",
    "TARGET_TYPE_SECRET",
    "TARGET_TYPE_USER",
    "record",
    "record_detached",
]
