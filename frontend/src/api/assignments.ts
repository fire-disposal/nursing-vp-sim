import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";

type Schemas = components["schemas"];

export const createAssignment = (data: Schemas["AssignmentCreateRequest"]) =>
	api.post<Schemas["AssignmentDetail"]>("/assignments" satisfies ApiPath as string, data);

export const getAssignments = (params?: Record<string, unknown>) =>
	api.get<Schemas["PaginatedResponse_AssignmentListItem_"]>(
		"/assignments" satisfies ApiPath as string,
		{ params },
	);

export const getAssignment = (id: string) =>
	api.get<Schemas["AssignmentDetail"]>(`/assignments/${id}` as ApiPath);

export const updateAssignment = (
	id: string,
	data: Schemas["AssignmentUpdateRequest"],
) => api.put<Schemas["AssignmentDetail"]>(`/assignments/${id}` as ApiPath, data);

export const deleteAssignment = (id: string) =>
	api.delete(`/assignments/${id}` as ApiPath);

export const exportAssignment = (id: string) =>
	api.post(`/assignments/${id}/export` as ApiPath, null, { responseType: "blob" });

export const getStudentAssignments = () =>
	api.get<Schemas["StudentAssignmentItem"][]>("/students/assignments" satisfies ApiPath as string);

/** 学生作业详情与公开训练要求；响应形状由 OpenAPI 统一生成。 */
export type StudentAssignmentAttempt = Schemas["StudentAssignmentAttempt"];
export type StudentAssignmentDetail = Schemas["StudentAssignmentDetail"];
export type StudentRequiredActivity = Schemas["StudentRequiredActivity"];
export type StudentRequiredArtifact = Schemas["StudentRequiredArtifact"];

export const getStudentAssignment = (id: string) =>
	api.get<StudentAssignmentDetail>(
		`/students/assignments/${id}` as ApiPath,
	);

export const startAssignment = (assignmentId: string) =>
	api.post<Schemas["TrainingStartResponse"]>(
		`/training/start-from-assignment?assignment_id=${assignmentId}` as ApiPath,
	);
