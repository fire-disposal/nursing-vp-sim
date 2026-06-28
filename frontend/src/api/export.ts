import { api } from "./client";

import type { ApiPath } from "./api-path";

export const exportRecords = () =>
	api.post<Blob>("/export/records", null, { responseType: "blob" });

export const exportRecordDetail = (id: number | string) =>
	api.post<Blob>(`/export/record/${id}`, null, { responseType: "blob" });
