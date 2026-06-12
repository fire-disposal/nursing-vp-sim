import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];
type LLMCallLogItem = Schemas["LLMCallLogItem"];
type Paginated = Schemas["PaginatedResponse_LLMCallLogItem_"];

export const getLLMStats = () =>
	api.get<Schemas["LLMStatsResponse"]>("/admin/llm-stats");

export const getLLMLogs = (params: Record<string, unknown> = {}) =>
	api.get<Paginated>("/admin/llm-logs", {
		params: { aggregate_patient_chat: true, ...params },
	});

export const getLogDetail = (logId: number) =>
	api.get<LLMCallLogItem>(`/admin/llm-logs/${logId}`);

export const getRecordLogs = (recordId: number) =>
	api.get<Paginated>("/admin/llm-logs", {
		params: {
			aggregate_patient_chat: false,
			record_id: recordId,
			limit: 100,
		},
	});

export const exportLLMLogs = (dateFrom?: string, dateTo?: string) => {
	const params: Record<string, string> = {};
	if (dateFrom) params.date_from = dateFrom;
	if (dateTo) params.date_to = dateTo;
	return api.get<Blob>("/admin/llm-logs/export", {
		params,
		responseType: "blob",
	});
};
