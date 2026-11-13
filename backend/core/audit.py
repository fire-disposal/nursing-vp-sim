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
from uuid import uuid4

import sqlalchemy as sa

from models import AuditLog
from models.audit import AUDIT_OUTCOME_DENIED, AUDIT_OUTCOME_FAILURE, AUDIT_OUTCOME_SUCCESS

if TYPE_CHECKING:
    from fastapi import Request
    from sqlalchemy.orm import Session

    from models import User

log = logging.getLogger(__name__)

# ── action 常量：与 core/permissions.py 同思路，集中一处便于审查与查询 ──────────────
ACTION_USER_CREATED = "user.created"
ACTION_USER_UPDATED = "user.updated"
ACTION_USER_DEACTIVATED = "user.deactivated"
ACTION_USER_ACTIVATED = "user.activated"
ACTION_USER_DELETED = "user.deleted"
ACTION_USER_PASSWORD_RESET = "user.password_reset"
ACTION_USER_BULK_IMPORTED = "user.bulk_imported"
ACTION_USER_BULK_ASSIGNED = "user.bulk_assigned"
ACTION_USER_PERSONAS_UPDATED = "user.personas_updated"
ACTION_SECRET_CREATED = "secret.created"
ACTION_SECRET_UPDATED = "secret.updated"
ACTION_SECRET_DELETED = "secret.deleted"
ACTION_ACCESS_DENIED = "access.denied"
ACTION_EXPORT_DOWNLOADED = "export.downloaded"
ACTION_FEEDBACK_REPLIED = "feedback.replied"
ACTION_AUTH_LOGIN_FAILED = "auth.login_failed"
ACTION_AUTH_LOGIN_SUCCEEDED = "auth.login_succeeded"
ACTION_CASE_PUBLISHED = "case.published"
ACTION_CASE_PUBLISH_REJECTED = "case.publish_rejected"
ACTION_CASE_ARCHIVED = "case.archived"
ACTION_CASE_DELETED = "case.deleted"
ACTION_CASE_OPEN_CHANGED = "case.open_changed"
ACTION_SCORE_REVIEW_SUBMITTED = "score.review_submitted"
ACTION_SCORE_RETRY_REQUESTED = "score.retry_requested"
ACTION_CLASS_CREATED = "class.created"
ACTION_CLASS_UPDATED = "class.updated"
ACTION_CLASS_DELETED = "class.deleted"
ACTION_SCHOOL_CREATED = "school.created"
ACTION_SCHOOL_UPDATED = "school.updated"
ACTION_SCHOOL_DELETED = "school.deleted"
ACTION_CLASS_MEMBERS_ADDED = "class.members_added"
ACTION_CLASS_MEMBERS_REMOVED = "class.members_removed"
ACTION_NOTIFICATION_CREATED = "notification.created"
ACTION_NOTIFICATION_UPDATED = "notification.updated"
ACTION_NOTIFICATION_DELETED = "notification.deleted"
ACTION_QUESTIONNAIRE_TEMPLATE_CREATED = "questionnaire_template.created"
ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED = "questionnaire_template.updated"
ACTION_QUESTIONNAIRE_TEMPLATE_DELETED = "questionnaire_template.deleted"
ACTION_AUTH_LOGIN_BLOCKED = "auth.login_blocked"
ACTION_SETTINGS_UPDATED = "settings.updated"

TARGET_TYPE_USER = "user"
TARGET_TYPE_SECRET = "secret"
TARGET_TYPE_EXPORT = "export"
TARGET_TYPE_FEEDBACK = "feedback"
TARGET_TYPE_CASE = "case"
TARGET_TYPE_TRAINING_RECORD = "training_record"
TARGET_TYPE_CLASS = "class"
TARGET_TYPE_SCHOOL = "school"
TARGET_TYPE_NOTIFICATION = "notification"
TARGET_TYPE_QUESTIONNAIRE_TEMPLATE = "questionnaire_template"
TARGET_TYPE_SETTINGS = "settings"


def _actor_fields(actor: User | None, persona: str | None = None) -> dict[str, Any]:
    """操作者快照：ID 会在删用户后被 SET NULL，因此同时存可读身份。

    `persona` 是操作时**生效的视角**（`X-View-Persona` 解析结果，见
    `core.security.get_current_user` 写入的 `request.state.view_persona`）；
    同一账号可持多个视角，只存角色名无法还原当时的权限上下文。
    """
    if actor is None:
        return {
            "actor_id": None,
            "actor_username": None,
            "actor_display_name": None,
            "actor_persona": persona,
        }
    return {
        "actor_id": actor.id,
        "actor_username": actor.username,
        "actor_display_name": actor.display_name,
        "actor_persona": persona,
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


#: `core.audit.record()` 把本次请求产生的事件挂到 `request.state` 的这个键上，
#: 供 `main._log_requests` 在响应生成后补 `AuditResponseResult`（见 `attach_response_status`）。
_REQUEST_ENTRIES_ATTR = "audit_entries"
#: 本次请求的实例键（惰性生成，见 `request_key`）
_REQUEST_KEY_ATTR = "audit_request_key"


def _track_on_request(request: Request | None, entry: AuditLog) -> None:
    """把事件登记到请求状态：**只登记，不改变事务语义**。

    中间件拿它当"这次请求里有哪些审计事件"的候选清单，提交后再按 id 落结果；
    被业务回滚掉的条目在库里没有行（也没有 id），自然不会产生结果。

    这里必须在**提交前**读一次 id，而不是让中间件事后去读实例属性：业务 session 由
    `get_db` 在响应返回时关闭，实例随之过期，读 `.id` 会抛 `DetachedInstanceError`。
    """
    if request is None:
        return
    try:
        # `flush()`（而非 `commit()`）只是把 INSERT 发出去以拿到自增主键：
        # 事务仍归调用方，回滚时这条事件连同 id 一起消失。
        session = sa.inspect(entry).session
        if session is not None and session.is_active:
            session.flush([entry])
        if entry.id is None:
            return
        # 只登记自增主键：中间件不需要（也不该）再碰 ORM 实例
        entries = getattr(request.state, _REQUEST_ENTRIES_ATTR, None) or []
        request.state.audit_entries = [*entries, entry.id]
    except Exception:  # pragma: no cover - 防御：登记失败不得影响审计写入
        log.exception("审计事件登记到 request.state 失败（request_id=%s）", getattr(request.state, "request_id", None))


def _actor_from_request(request: Request | None, actor: User | None) -> dict[str, Any]:
    """`request.state.audit_actor` / `request.state.view_persona` 由
    `core.security.get_current_user` 写入（每个鉴权请求必经），`require_permission`
    再兜一次 —— 显式传入的 actor 优先，但视角始终取请求状态。"""
    if actor is None and request is not None:
        actor = getattr(request.state, "audit_actor", None)
    persona: str | None = None
    if request is not None:
        persona = getattr(request.state, "view_persona", None)
    return _actor_fields(actor, persona)


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
    _track_on_request(request, entry)
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


def request_key(request: Request) -> str:
    """本次请求的**实例键**：`request.state.audit_request_key`，不存在时惰性生成并写回。

    为什么不用客户端的 `X-Request-ID` 做结果键：那是**关联** ID，客户端可以（也会）
    重复发同一个值。状态码如果按它去重/归属，两个不同请求的结果就会串在一起。
    这里的键由服务端在需要时生成，一个请求实例只有一个，重试/重放也不会复用。
    """
    key = getattr(request.state, _REQUEST_KEY_ATTR, None)
    if not key:
        key = uuid4().hex[:32]
        request.state.audit_request_key = key
    return key


def attach_response_status(request: Request | None, status_code: int) -> int:
    """为本次 `/api/` 请求写一行真实 HTTP 结果（**只插入**）。

    调用点：`main._log_requests` 拿到 response 之后（此时业务事务已经结束）。语义：

    - **先确认哪些事件真的提交了**：`request.state.audit_entries` 只是候选清单，
      业务回滚时行已不存在（`audit_logs` 里查不到）；
    - 有已提交事件：每个一行，`audit_log_id` 指向它（部分提交时只写提交的那几条）；
    - 没有一个已提交事件（普通 GET / 纯读取 POST / **事件全部被回滚**）：
      写**一行** `audit_log_id IS NULL`，即"这次请求本身"——请求确实发生了，
      就必须能回答"它回了什么状态码"；
    - 幂等：`(request_key, audit_log_id)` 联合唯一（`audit_log_id` 为 NULL 时靠 `request_key`），
      重复 attach 只跳过，绝不追加第二行；**绝不 UPDATE `audit_logs`**，
      `outcome` 与响应状态码互不推导；
    - 独立 session 写入，失败只记日志 —— 审计结果不得改变业务响应，
      且业务 session 在中间件里不能用（可能已被 `get_db` 关闭）。

    返回新写入的行数（失败时为 0；调用方不需要据此做任何判断）。
    """
    if request is None:
        return 0
    # 候选主键：`record()` 写入时登记的（业务随后可能把它整个回滚掉）
    candidate_ids = {audit_id for audit_id in getattr(request.state, _REQUEST_ENTRIES_ATTR, None) or []}
    key = request_key(request)

    from core.database import SessionLocal
    from models import AuditLog, AuditResponseResult

    db = SessionLocal()
    try:
        # 候选 ≠ 已提交：回滚掉的行在库里不存在，必须先按库里实况确认，
        # 否则会拿一个不存在的 audit_log_id 去写结果（FK 失败 → 整批丢）。
        committed_ids: set[int] = set()
        if candidate_ids:
            committed_ids = {row[0] for row in db.query(AuditLog.id).filter(AuditLog.id.in_(candidate_ids)).all()}
        # 一个已提交事件都没有 → 用 None 表示"这次请求本身"这一行
        targets: list[int | None] = [*sorted(committed_ids)] if committed_ids else [None]

        existing_keys = {
            (row[0], row[1])
            for row in db.query(AuditResponseResult.request_key, AuditResponseResult.audit_log_id)
            .filter(AuditResponseResult.request_key == key)
            .all()
        }
        pending = [audit_id for audit_id in targets if (key, audit_id) not in existing_keys]
        if not pending:
            return 0
        db.add_all(
            [
                AuditResponseResult(
                    audit_log_id=audit_id,
                    request_key=key,
                    request_id=getattr(request.state, "request_id", None),
                    request_method=(request.method or "")[:10] or None,
                    request_path=str(request.url.path)[:200],
                    status_code=status_code,
                )
                for audit_id in pending
            ]
        )
        db.commit()
        return len(pending)
    except Exception:  # pragma: no cover - 审计结果不得影响业务响应
        db.rollback()
        log.exception(
            "审计响应结果写入失败（不影响业务响应）：status=%s request_key=%s candidate_ids=%s",
            status_code,
            key,
            sorted(candidate_ids),
        )
        return 0
    finally:
        db.close()


__all__ = [
    "ACTION_ACCESS_DENIED",
    "ACTION_AUTH_LOGIN_FAILED",
    "ACTION_AUTH_LOGIN_SUCCEEDED",
    "ACTION_CASE_ARCHIVED",
    "ACTION_CASE_DELETED",
    "ACTION_CASE_OPEN_CHANGED",
    "ACTION_CASE_PUBLISHED",
    "ACTION_CASE_PUBLISH_REJECTED",
    "ACTION_CLASS_CREATED",
    "ACTION_CLASS_DELETED",
    "ACTION_CLASS_MEMBERS_ADDED",
    "ACTION_CLASS_MEMBERS_REMOVED",
    "ACTION_CLASS_UPDATED",
    "ACTION_EXPORT_DOWNLOADED",
    "ACTION_FEEDBACK_REPLIED",
    "ACTION_NOTIFICATION_CREATED",
    "ACTION_NOTIFICATION_DELETED",
    "ACTION_NOTIFICATION_UPDATED",
    "ACTION_QUESTIONNAIRE_TEMPLATE_CREATED",
    "ACTION_QUESTIONNAIRE_TEMPLATE_DELETED",
    "ACTION_QUESTIONNAIRE_TEMPLATE_UPDATED",
    "ACTION_SCHOOL_CREATED",
    "ACTION_SCHOOL_DELETED",
    "ACTION_SCHOOL_UPDATED",
    "ACTION_SCORE_RETRY_REQUESTED",
    "ACTION_SCORE_REVIEW_SUBMITTED",
    "ACTION_SECRET_CREATED",
    "ACTION_SECRET_DELETED",
    "ACTION_SECRET_UPDATED",
    "ACTION_SETTINGS_UPDATED",
    "ACTION_USER_ACTIVATED",
    "ACTION_USER_BULK_ASSIGNED",
    "ACTION_USER_BULK_IMPORTED",
    "ACTION_USER_CREATED",
    "ACTION_USER_DEACTIVATED",
    "ACTION_USER_DELETED",
    "ACTION_USER_PASSWORD_RESET",
    "ACTION_USER_PERSONAS_UPDATED",
    "ACTION_USER_UPDATED",
    "AUDIT_OUTCOME_DENIED",
    "AUDIT_OUTCOME_FAILURE",
    "AUDIT_OUTCOME_SUCCESS",
    "TARGET_TYPE_CASE",
    "TARGET_TYPE_CLASS",
    "TARGET_TYPE_EXPORT",
    "TARGET_TYPE_FEEDBACK",
    "TARGET_TYPE_NOTIFICATION",
    "TARGET_TYPE_QUESTIONNAIRE_TEMPLATE",
    "TARGET_TYPE_SCHOOL",
    "TARGET_TYPE_SECRET",
    "TARGET_TYPE_SETTINGS",
    "TARGET_TYPE_TRAINING_RECORD",
    "TARGET_TYPE_USER",
    "attach_response_status",
    "record",
    "record_detached",
    "request_key",
]
