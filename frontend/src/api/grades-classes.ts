import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const getGrades = () =>
	api.get<Schemas["GradeResponse"][]>("/admin/grades");

export const createGrade = (data: Schemas["GradeCreate"]) =>
	api.post<Schemas["GradeResponse"]>("/admin/grades", data);

export const updateGrade = (
	id: number | string,
	data: Schemas["GradeUpdate"],
) => api.put<Schemas["GradeResponse"]>(`/admin/grades/${id}`, data);

export const deleteGrade = (id: number | string) =>
	api.delete(`/admin/grades/${id}` as ApiPath);

export const getClasses = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["ClassResponse"][]>("/admin/classes", { params });

export const createClass = (data: Schemas["ClassCreate"]) =>
	api.post<Schemas["ClassResponse"]>("/admin/classes", data);

export const updateClass = (
	id: number | string,
	data: Schemas["ClassUpdate"],
) => api.put<Schemas["ClassResponse"]>(`/admin/classes/${id}`, data);

export const deleteClass = (id: number | string) =>
	api.delete(`/admin/classes/${id}` as ApiPath);

export const getClassSummary = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["ClassSummaryItemSchema"][]>("/stats/class-summary", {
		params,
	});
