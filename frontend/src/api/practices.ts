import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const getPractices = (params?: Record<string, unknown>) =>
	api.get<Schemas["PaginatedResponse_PracticeItem_"]>("/admin/practices" satisfies ApiPath as string, { params });

export const getPractice = (id: number) =>
	api.get<Schemas["PracticeItem"]>(`/admin/practices/${id}` as ApiPath);

export const createPractice = (data: Schemas["PracticeCreate"]) =>
	api.post<Schemas["PracticeItem"]>("/admin/practices" satisfies ApiPath as string, data);

export const updatePractice = (id: number, data: Schemas["PracticeUpdate"]) =>
	api.put<Schemas["PracticeItem"]>(`/admin/practices/${id}` as ApiPath, data);

export const deletePractice = (id: number) =>
	api.delete<Schemas["DeleteResponse"]>(`/admin/practices/${id}` as ApiPath);
