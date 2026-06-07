import type { components } from "../api-types.gen";
import { api } from "../axios-instance";

type Schemas = components["schemas"];

export const getLLMStats = () => api.get<Schemas["LLMStatsResponse"]>("/admin/llm-stats");

export const getLLMLogs = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_LLMCallLogItem_"]>("/admin/llm-logs", {
    params: { aggregate_patient_chat: true, ...params },
  });

export const exportLLMLogs = (dateFrom?: string, dateTo?: string) => {
  const params: Record<string, string> = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  return api.get<Blob>("/admin/llm-logs/export", { params, responseType: "blob" });
};
