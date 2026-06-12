import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const createAssignment = (data: Schemas["AssignmentCreateRequest"]) =>
	api.post<Schemas["AssignmentDetail"]>("/assignments", data);

export const getAssignments = (params?: Record<string, unknown>) =>
	api.get<{
		items: Schemas["AssignmentListItem"][];
		total: number;
		offset: number;
		limit: number;
	}>("/assignments", { params });

export const getAssignment = (id: string) =>
	api.get<Schemas["AssignmentDetail"]>(`/assignments/${id}`);

export const updateAssignment = (
	id: string,
	data: Schemas["AssignmentUpdateRequest"],
) => api.put<Schemas["AssignmentDetail"]>(`/assignments/${id}`, data);

export const deleteAssignment = (id: string) =>
	api.delete(`/assignments/${id}`);

export const exportAssignment = (id: string) =>
	api.get(`/assignments/${id}/export`, { responseType: "blob" });

export const getStudentAssignments = () =>
	api.get<Schemas["StudentAssignmentItem"][]>("/students/assignments");

export const startAssignment = (assignmentId: string) =>
	api.post<{ record_id: number; greeting: string; case_name: string }>(
		`/training/start-from-assignment?assignment_id=${assignmentId}`,
	);
