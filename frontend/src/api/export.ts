import { api } from "./axios-instance";

export const exportRecords = () =>
	api.get<Blob>("/export/records", { responseType: "blob" });

export const exportRecordDetail = (id: number | string) =>
	api.get<Blob>(`/export/record/${id}`, { responseType: "blob" });
