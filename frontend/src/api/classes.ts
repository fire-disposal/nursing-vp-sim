import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

/** 班级列表（可按 cohort_label 精确过滤）。 */
export const getClasses = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["ClassResponse"][]>("/admin/classes", { params });

/** 班级详情（含成员花名册）。 */
export const getClass = (id: number | string) =>
	api.get<Schemas["ClassDetailResponse"]>(`/admin/classes/${id}` as ApiPath);

export const createClass = (data: Schemas["ClassCreate"]) =>
	api.post<Schemas["ClassResponse"]>("/admin/classes", data);

export const updateClass = (id: number | string, data: Schemas["ClassUpdate"]) =>
	api.put<Schemas["ClassResponse"]>(`/admin/classes/${id}` as ApiPath, data);

export const deleteClass = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/admin/classes/${id}` as ApiPath);

/** 班级成员分页列表；`role` 过滤 student/teacher，`search` 匹配用户名/姓名/学号。 */
export const getClassMembers = (
	classId: number | string,
	params: Record<string, unknown> = {},
) =>
	api.get<Schemas["PaginatedResponse_ClassMemberItem_"]>(
		`/admin/classes/${classId}/members` as ApiPath,
		{ params },
	);

/** 批量添加成员（重复添加幂等；角色冲突由后端报错，不静默覆盖）。 */
export const addClassMembers = (
	classId: number | string,
	userIds: number[],
	memberRole: "student" | "teacher" = "student",
) =>
	api.post<Schemas["ClassMemberMutationResult"]>(
		`/admin/classes/${classId}/members` as ApiPath,
		{ user_ids: userIds, member_role: memberRole },
	);

export const removeClassMembers = (classId: number | string, userIds: number[]) =>
	api.post<Schemas["ClassMemberMutationResult"]>(
		`/admin/classes/${classId}/members/bulk-remove` as ApiPath,
		{ user_ids: userIds },
	);

export const removeClassMember = (classId: number | string, userId: number) =>
	api.delete<Schemas["DeleteResponse"]>(
		`/admin/classes/${classId}/members/${userId}` as ApiPath,
	);

/** 班级训练聚合（只读统计）。 */
export const getClassSummary = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["ClassSummaryItemSchema"][]>(
		"/stats/class-summary" as ApiPath,
		{ params },
	);
