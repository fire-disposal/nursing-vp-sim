import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

/**
 * 训练趋势（按日）。`dateFrom` 为空 = 不限下界。
 *
 * **时间窗由调用方显式给出**：服务端不再接受 `period: week|month|all`（那是后端在猜
 * "周/月"，和列表的 `date_from` 是两套语义）。窗口用上海自然日零点，
 * 例如 `${shanghaiDateKey(new Date(), -6)}T00:00:00+08:00`。
 */
export const getTrends = (dateFrom?: string) =>
	api.get<Schemas["TrendStats"]>("/stats/trends" as ApiPath, {
		params: dateFrom ? { date_from: dateFrom } : undefined,
	});

export const getTeacherSummary = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_TeacherSummaryItem_"]>(
		"/stats/teacher-summary" as ApiPath,
		{ params },
	);
