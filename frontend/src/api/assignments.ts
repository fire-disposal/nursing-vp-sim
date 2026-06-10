import { api } from "./axios-instance";

export const createAssignment = (data: any) => api.post<any>("/assignments", data);

export const getAssignments = (params?: Record<string, unknown>) => api.get<any>("/assignments", { params });

export const getAssignment = (id: string) => api.get<any>(`/assignments/${id}`);

export const updateAssignment = (id: string, data: any) => api.put<any>(`/assignments/${id}`, data);

export const deleteAssignment = (id: string) => api.delete(`/assignments/${id}`);

export const exportAssignment = (id: string) => api.get(`/assignments/${id}/export`, { responseType: "blob" });

export const getStudentAssignments = () => api.get<any[]>("/students/assignments");

export const startAssignment = (assignmentId: string) => api.post<any>(`/training/start-from-assignment?assignment_id=${assignmentId}`);
