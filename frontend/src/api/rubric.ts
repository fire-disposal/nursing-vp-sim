import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const fetchRubrics = () =>
	api.get<Schemas["RubricResponse"][]>("/admin/api/rubrics");

export const getActiveRubric = () =>
	api.get<Schemas["RubricResponse"]>("/admin/api/rubrics/active");

export const createRubric = (data: Record<string, unknown>) =>
	api.post<Schemas["RubricResponse"]>("/admin/api/rubrics", data);

export const updateRubric = (
	id: number | string,
	data: Record<string, unknown>,
) => api.put<Schemas["RubricResponse"]>(`/admin/api/rubrics/${id}`, data);

export const deleteRubric = (id: number | string) =>
	api.delete(`/admin/api/rubrics/${id}`);

export const activateRubric = (id: number | string) =>
	api.post(`/admin/api/rubrics/${id}/activate`);
