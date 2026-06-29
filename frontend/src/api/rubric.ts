import { api } from "./client";

export interface RubricResponse {
	id: number;
	name: string;
	version: string;
	description: string | null;
	total_max: number;
	raw_max: number;
	raw_scale: number;
	dimensions: Record<string, unknown>[];
	is_active: boolean;
	created_at: string;
	updated_at: string;
}

export const fetchRubrics = () =>
	api.get<RubricResponse[]>("/admin/rubrics" as string);

export const getActiveRubric = () =>
	api.get<RubricResponse>("/admin/rubrics/active" as string);

export const createRubric = (data: Record<string, unknown>) =>
	api.post<RubricResponse>("/admin/rubrics" as string, data);

export const updateRubric = (
	id: number | string,
	data: Record<string, unknown>,
) => api.put<RubricResponse>(`/admin/rubrics/${id}` as string, data);

export const deleteRubric = (id: number | string) =>
	api.delete(`/admin/rubrics/${id}` as string);

export const activateRubric = (id: number | string) =>
	api.post(`/admin/rubrics/${id}/activate` as string);
