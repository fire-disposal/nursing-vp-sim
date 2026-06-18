import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getDurationStats = (period = "month") =>
	api.get<Schemas["DurationStats"]>(`/stats/duration?period=${period}` as ApiPath);

export const getTrends = (period = "month") =>
	api.get<Schemas["TrendStats"]>(`/stats/trends?period=${period}` as ApiPath);

export const getTeacherSummary = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_TeacherSummaryItem_"]>(
		"/stats/teacher-summary" satisfies ApiPath as string,
		{ params },
	);

export const getStudentRanking = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_RankingItem_"]>("/stats/ranking" satisfies ApiPath as string, {
		params,
	});
