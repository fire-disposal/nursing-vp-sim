import type { ApiPath } from "../api-path";
import { api } from "../client";

/** 审计日志条目（后端 modules/admin/audit_logs.py::_to_item 的输出形状）。 */
export interface AuditLogItem {
	id: number;
	created_at: string | null;
	actor_id: number | null;
	actor_username: string | null;
	actor_display_name: string | null;
	actor_role: string | null;
	action: string;
	target_type: string;
	target_id: string | null;
	target_label: string | null;
	outcome: "success" | "denied" | "failure";
	payload: Record<string, unknown>;
	error_detail: string | null;
	request_id: string | null;
	ip: string | null;
	request_method: string | null;
	request_path: string | null;
}

export interface AuditLogPage {
	items: AuditLogItem[];
	total: number;
	offset: number;
	limit: number;
}

export const getAuditLogs = (params: Record<string, unknown> = {}) =>
	api.get<AuditLogPage>("/admin/audit-logs" satisfies ApiPath as string, { params });
