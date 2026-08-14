import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const getDurationStats = (period = "month") =>
	api.get<Schemas["DurationStats"]>(`/stats/duration?period=${period}` as ApiPath);

export const getTrends = (period = "month") =>
	api.get<Schemas["TrendStats"]>(`/stats/trends?period=${period}` as ApiPath);

export const getTeacherSummary = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_TeacherSummaryItem_"]>(
		"/stats/teacher-summary" as ApiPath,
		{ params },
	);

export const getStudentRanking = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_RankingItem_"]>("/stats/ranking" as ApiPath, {
		params,
	});

export const getClassStudents = (classId: number) =>
	api.get<Schemas["ClassStudentItem"][]>("/stats/class-students" as ApiPath, {
		params: { class_id: classId },
	});
