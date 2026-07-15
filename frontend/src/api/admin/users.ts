import type { components } from "../api-types.gen";
import { api } from "../client";

type Schemas = components["schemas"];

export const getUsers = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_UserBrief_"]>("/admin/users", { params });

export const getStats = () => api.get<Schemas["AdminStats"]>("/admin/stats");

export const updateUser = (
	id: number | string,
	data: Schemas["UserUpdateRequest"],
) => api.put<Schemas["UserBrief"]>(`/admin/users/${id}`, data);

export const batchCreateUsers = (users: Schemas["BatchUserItem"][]) =>
	api.post<Schemas["BatchCreateResult"]>("/admin/users/batch", users);

export const deleteUser = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/admin/users/${id}`);

export const bulkAssignClass = (userIds: number[], classId: number) =>
	api.post<{ assigned: number; skipped: number; errors: string[] }>(
		"/admin/users/bulk-assign-class",
		{ user_ids: userIds, class_id: classId },
	);

export const getStudentDetail = (userId: number | string) =>
	api.get<Schemas["StudentDetail"]>(`/admin/users/${userId}`);
