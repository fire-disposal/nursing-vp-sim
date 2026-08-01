import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./client";
import { postStream } from "./stream";

type Schemas = components["schemas"];

export const createQASession = (question: string, ragEnabled?: boolean, signal?: AbortSignal) =>
	api.post<Schemas["QAAskResponse"]>("/qa/sessions" satisfies ApiPath as string, { question, rag_enabled: ragEnabled }, { signal });

export const getQASessions = () =>
	api.get<Schemas["QASessionItem"][]>("/qa/sessions" satisfies ApiPath as string);

export const deleteQASession = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/qa/sessions/${id}` as ApiPath);

export const getQASessionMessages = (sessionId: number | string) =>
	api.get<Schemas["QAMessageItem"][]>(`/qa/sessions/${sessionId}/messages` as ApiPath);

export const getQAHistoryAll = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_QASessionAdminItem_"]>("/qa/history/all" satisfies ApiPath as string, {
		params,
	});

export const getQASessionMessagesAdmin = (sessionId: number | string) =>
	api.get<Schemas["QAMessageItem"][]>(`/qa/history/all/${sessionId}/messages` as ApiPath);

export const getSectionText = (source: string, section: string) =>
	api.get<{ source: string; section: string; text: string }>(
		"/qa/section-text" as string,
		{ params: { source, section } },
	);

export async function askInQASessionStream(
	sessionId: number | string,
	question: string,
	ragEnabled: boolean,
	onChunk: (text: string) => void,
	onDone: (id?: number, citations?: Array<{ source: string; section: string }>) => void,
	onError: (msg: string) => void,
	signal?: AbortSignal,
) {
	return postStream({
		url: `/api/qa/sessions/${sessionId}/ask/stream`,
		body: { question, rag_enabled: ragEnabled },
		signal,
		handlers: { onChunk, onDone, onError },
	});
}
