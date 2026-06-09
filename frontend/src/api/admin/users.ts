import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const getUsers = (params: Record<string, unknown> = {}) => api.get<Schemas["PaginatedResponse_UserBrief_"]>("/admin/users", { params });

export const getStats = () => api.get<Schemas["AdminStats"]>("/admin/stats");

export const updateUser = (id: number | string, data: Schemas["UserUpdateRequest"]) => api.put<Schemas["UserBrief"]>(`/admin/users/${id}`, data);

export const batchCreateUsers = (users: Schemas["BatchUserItem"][]) => api.post<Schemas["BatchCreateResult"]>("/admin/users/batch", users);

export const deleteUser = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/admin/users/${id}`);

export const getStudentDetail = (userId: number | string) => api.get<Schemas["StudentDetail"]>(`/admin/users/${userId}`);
