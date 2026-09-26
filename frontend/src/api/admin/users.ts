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

/** 批量把用户加入班级（member_role 决定以学生还是教师身份加入）。 */
export const bulkAssignClass = (
	userIds: number[],
	classId: number,
	memberRole: "student" | "teacher" = "student",
) =>
	api.post<Schemas["BulkAssignClassResult"]>("/admin/users/bulk-assign-class", {
		user_ids: userIds,
		class_id: classId,
		member_role: memberRole,
	});

export const getStudentDetail = (userId: number | string) =>
	api.get<Schemas["StudentDetail"]>(`/admin/users/${userId}`);
