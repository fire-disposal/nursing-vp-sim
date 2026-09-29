"""审计日志响应 schema。

与 ``modules/admin/audit_logs.py::_to_item`` 逐字段同形；此前该端点返回裸 dict，
因而审计日志不在 OpenAPI 生成契约里（前端只能手写类型）。
"""

from typing import Any

from pydantic import BaseModel


class AuditLogItem(BaseModel):
    """一条审计日志（append-only，字段多为可空的历史快照）。"""

    id: int
    created_at: str | None
    actor_id: int | None
    actor_username: str | None
    actor_display_name: str | None
    actor_role: str | None
    action: str
    target_type: str
    target_id: str | None
    target_label: str | None
    outcome: str
    payload: dict[str, Any]
    error_detail: str | None
    request_id: str | None
    ip: str | None
    request_method: str | None
    request_path: str | None
