import type { ApiPath } from "./api-path";
import { api } from "./axios-instance";

export const getNursingRecord = (recordId: number) =>
	api.get<Record<string, unknown>>(`/nursing-records/${recordId}` as ApiPath);

export const saveNursingRecord = (
	recordId: number,
	data: Record<string, unknown>,
) => api.post<Record<string, unknown>>(`/nursing-records/${recordId}` as ApiPath, data);
