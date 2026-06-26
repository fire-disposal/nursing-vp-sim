import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const fetchRubrics = () =>
	api.get<Schemas["RubricResponse"][]>("/admin/rubrics");

export const getActiveRubric = () =>
	api.get<Schemas["RubricResponse"]>("/admin/rubrics/active");

export const createRubric = (data: Record<string, unknown>) =>
	api.post<Schemas["RubricResponse"]>("/admin/rubrics", data);

export const updateRubric = (
	id: number | string,
	data: Record<string, unknown>,
) => api.put<Schemas["RubricResponse"]>(`/admin/rubrics/${id}`, data);

export const deleteRubric = (id: number | string) =>
	api.delete(`/admin/rubrics/${id}`);

export const activateRubric = (id: number | string) =>
	api.post(`/admin/rubrics/${id}/activate`);
