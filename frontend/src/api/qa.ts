import type { components } from "./api-types.gen";
import { api } from "./axios-instance";

type Schemas = components["schemas"];

export const createQASession = (question: string) => api.post<Schemas["QAAskResponse"]>("/qa/sessions", { question });

export const getQASessions = () => api.get<Schemas["QASessionItem"][]>("/qa/sessions");

export const deleteQASession = (id: number | string) => api.delete<Schemas["MessageResponse"]>(`/qa/sessions/${id}`);

export const getQASessionMessages = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/sessions/${sessionId}/messages`);

export const askInQASession = (sessionId: number | string, question: string) =>
  api.post<Schemas["QAAskResponse"]>(`/qa/sessions/${sessionId}/ask`, { question });

export const getQAHistoryAll = (params: Record<string, unknown> = {}) =>
  api.get<Schemas["PaginatedResponse_QASessionAdminItem_"]>("/qa/history/all", { params });

export const getQASessionMessagesAdmin = (sessionId: number | string) => api.get<Schemas["QAMessageItem"][]>(`/qa/history/all/${sessionId}/messages`);
