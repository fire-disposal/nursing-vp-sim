import type { ApiPath } from "../api-path";
import type { components } from "../api-types.gen";
import { api } from "../client";

/** 审计日志条目：直接取 OpenAPI 生成物（新增字段如 `actor_persona` 不再手抄一遍）。 */
export type AuditLogItem = components["schemas"]["AuditLogItem"];

export interface AuditLogPage {
	items: AuditLogItem[];
	total: number;
	offset: number;
	limit: number;
}

export const getAuditLogs = (params: Record<string, unknown> = {}) =>
	api.get<AuditLogPage>("/admin/audit-logs" satisfies ApiPath as string, { params });
