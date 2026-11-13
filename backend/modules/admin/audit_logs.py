"""审计日志查询与导出（`audit_view` / `audit_export`）。

严格沿用本仓列表约定：
- 筛选键只在这里定义一次（`AuditLogFilters`），列表与导出都 `Depends()` 注入它；
- 谓词只写一次（`_filtered_query`），公开入口 `list_filtered`；
- 导出取 `MAX_EXPORT_ROWS + 1` 行，超限由 `infra/exporter.py` 统一 400（不静默截断）。

只读：本模块没有任何写路径（append-only 的第一层；另有模型无 updated_at、守卫测试、A6 的 DB 触发器）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Annotated, Any

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import or_

from core.config import MAX_EXPORT_ROWS
from core.deps import DbSession
from core.exceptions import ValidationError
from core.pagination import paginate
from core.security import require_permission
from infra.exporter import ColumnDef, ExportAudit, export_response
from models import AuditLog, AuditResponseResult, User
from schemas.admin import AuditLogItem
from schemas.common import PaginatedResponse

router = APIRouter(prefix="/audit-logs", tags=["审计日志"])

_Viewer = Annotated[User, Depends(require_permission("audit_view"))]
_Exporter = Annotated[User, Depends(require_permission("audit_export"))]


@dataclass(slots=True)
class AuditLogFilters:
    """审计列表 / 导出的筛选（唯一事实来源）。

    键名与前端 `query-params.ts` 的 `AuditLogParams`（由 OpenAPI 派生）一一对应。
    """

    actor_id: Annotated[int | None, Query(description="按操作者 ID 过滤")] = None
    action: Annotated[str | None, Query(max_length=64, description="动作，如 role.updated")] = None
    target_type: Annotated[str | None, Query(max_length=32, description="目标类型，如 user/role")] = None
    outcome: Annotated[str | None, Query(pattern="^(success|denied|failure)$", description="结果")] = None
    date_from: Annotated[str | None, Query(description="起始时间 ISO（含）")] = None
    date_to: Annotated[str | None, Query(description="结束时间 ISO（含）")] = None
    search: Annotated[str | None, Query(max_length=50, description="关键字（操作者/目标/动作/请求路径）")] = None


class AuditLogService:
    def __init__(self, db: Session):
        self.db = db

    def _filtered_query(self, filters: AuditLogFilters):
        q = self.db.query(AuditLog)
        if filters.actor_id is not None:
            q = q.filter(AuditLog.actor_id == filters.actor_id)
        if filters.action:
            q = q.filter(AuditLog.action == filters.action)
        if filters.target_type:
            q = q.filter(AuditLog.target_type == filters.target_type)
        if filters.outcome:
            q = q.filter(AuditLog.outcome == filters.outcome)
        if filters.date_from:
            q = q.filter(AuditLog.created_at >= _parse_dt(filters.date_from, "date_from"))
        if filters.date_to:
            q = q.filter(AuditLog.created_at <= _parse_dt(filters.date_to, "date_to"))
        if filters.search:
            term = f"%{filters.search}%"
            q = q.filter(
                or_(
                    AuditLog.actor_username.ilike(term),
                    AuditLog.target_label.ilike(term),
                    AuditLog.action.ilike(term),
                    AuditLog.request_path.ilike(term),
                )
            )
        return q

    def list_filtered(self, filters: AuditLogFilters, *, offset: int, limit: int) -> tuple[list[AuditLog], int]:
        """列表与导出的唯一入口（口径一致，导出不会漏筛）。"""
        q = self._filtered_query(filters).order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        return paginate(q, offset, limit)

    def response_statuses(self, rows: list[AuditLog]) -> dict[int, int]:
        """本页审计事件的 HTTP 状态码（**一次查询**，不做 N+1）。

        结果表按 `audit_log_id` 唯一；没查到的行（历史数据 / 结果未写入）不出现，
        调用方按 `None` 处理。
        """
        audit_ids = [row.id for row in rows]
        if not audit_ids:
            return {}
        pairs = (
            self.db.query(AuditResponseResult.audit_log_id, AuditResponseResult.status_code)
            .filter(AuditResponseResult.audit_log_id.in_(audit_ids))
            .all()
        )
        return {audit_log_id: status_code for audit_log_id, status_code in pairs}


def _parse_dt(value: str, field: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)  # 3.11+ 直接接受尾随 Z
    except ValueError as exc:
        raise ValidationError(f"无效的时间格式 {field}: {value}") from exc
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _to_item(row: AuditLog, response_status: int | None = None) -> AuditLogItem:
    return AuditLogItem(
        id=row.id,
        created_at=row.created_at.isoformat() if row.created_at else None,
        actor_id=row.actor_id,
        actor_username=row.actor_username,
        actor_display_name=row.actor_display_name,
        actor_persona=row.actor_persona,
        action=row.action,
        target_type=row.target_type,
        target_id=row.target_id,
        target_label=row.target_label,
        outcome=row.outcome,
        payload=row.payload or {},
        error_detail=row.error_detail,
        request_id=row.request_id,
        ip=row.ip,
        request_method=row.request_method,
        request_path=row.request_path,
        response_status=response_status,
    )


def _audit_filters(filters: Any) -> dict[str, Any]:
    """把筛选 DTO 序列化进审计 payload：日后能还原"这次导出当时筛了什么"。"""
    from dataclasses import asdict

    try:
        return asdict(filters)
    except TypeError:
        return {}


@router.get("", response_model=PaginatedResponse[AuditLogItem])
def list_audit_logs(
    current_user: _Viewer,
    db: DbSession,
    filters: Annotated[AuditLogFilters, Depends()],
    offset: Annotated[int, Query(ge=0)] = 0,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
):
    service = AuditLogService(db)
    rows, total = service.list_filtered(filters, offset=offset, limit=limit)
    statuses = service.response_statuses(rows)
    return PaginatedResponse(
        items=[_to_item(r, statuses.get(r.id)) for r in rows], total=total, offset=offset, limit=limit
    )


@router.post("/export")
def export_audit_logs(
    current_user: _Exporter,
    db: DbSession,
    filters: Annotated[AuditLogFilters, Depends()],
    request: Request,
    format: str = Query("csv", pattern="^(csv|xlsx)$"),
):
    # 与列表同一筛选 DTO、同一服务入口；多取一条以便 export_response 统一判超限
    service = AuditLogService(db)
    rows, _total = service.list_filtered(filters, offset=0, limit=MAX_EXPORT_ROWS + 1)
    # 超限时 export_response 会统一 400，这里取的那批状态码随请求一起丢弃，不产生额外写
    statuses = service.response_statuses(rows)
    columns = [
        ColumnDef("时间", value=lambda r: r.created_at.isoformat() if r.created_at else ""),
        ColumnDef("操作者", value=lambda r: r.actor_username or ""),
        ColumnDef("视角", value=lambda r: getattr(r, "actor_persona", None) or ""),
        ColumnDef("动作", key="action"),
        ColumnDef("目标类型", key="target_type"),
        ColumnDef("目标", value=lambda r: r.target_label or r.target_id or ""),
        ColumnDef("结果", key="outcome"),
        ColumnDef("HTTP 状态", value=lambda r: "" if r.id not in statuses else str(statuses[r.id])),
        ColumnDef("详情", value=lambda r: str(r.payload or {})),
        ColumnDef("IP", value=lambda r: r.ip or ""),
        ColumnDef("request_id", value=lambda r: r.request_id or ""),
    ]
    audit = ExportAudit(request=request, target_label="审计日志", filters=_audit_filters(filters))

    return export_response(rows, columns, "审计日志", "审计日志", format, audit=audit)
