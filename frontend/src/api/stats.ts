import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const getDurationStats = (period = "month") => api.get<Schemas["DurationStats"]>(`/stats/duration?period=${period}`);

export const getTrends = (period = "month") => api.get<Schemas["TrendStats"]>(`/stats/trends?period=${period}`);

export const getTeacherSummary = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_TeacherSummaryItem_"]>("/stats/teacher-summary", { params });

export const getStudentRanking = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_RankingItem_"]>("/stats/ranking", { params });
