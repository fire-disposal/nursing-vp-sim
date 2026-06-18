import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

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
	api.get(`/assignments/${id}/export` as ApiPath, { responseType: "blob" });

export const getStudentAssignments = () =>
	api.get<Schemas["StudentAssignmentItem"][]>("/students/assignments" satisfies ApiPath as string);

export const startAssignment = (assignmentId: string) =>
	api.post<{ record_id: number; greeting: string; case_name: string }>(
		`/training/start-from-assignment?assignment_id=${assignmentId}` as ApiPath,
	);
