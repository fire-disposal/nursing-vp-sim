import { api } from "./client";

export const exportRecords = () =>
	api.post<Blob>("/export/records", null, { responseType: "blob" });

export const exportRecordDetail = (id: number | string) =>
	api.post<Blob>(`/export/record/${id}`, null, { responseType: "blob" });
