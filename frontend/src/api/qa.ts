import useAuthStore from "@/stores/authStore";
import { waitForOnline } from "@/utils/network";
import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";
import { readSSEStream } from "./sse";

type Schemas = components["schemas"];

export const createQASession = (question: string) =>
	api.post<Schemas["QAAskResponse"]>("/qa/sessions" satisfies ApiPath as string, { question });

export const getQASessions = () =>
	api.get<Schemas["QASessionItem"][]>("/qa/sessions" satisfies ApiPath as string);

export const deleteQASession = (id: number | string) =>
	api.delete<Schemas["DeleteResponse"]>(`/qa/sessions/${id}` as ApiPath);

export const getQASessionMessages = (sessionId: number | string) =>
	api.get<Schemas["QAMessageItem"][]>(`/qa/sessions/${sessionId}/messages` as ApiPath);

export const askInQASession = (sessionId: number | string, question: string) =>
	api.post<Schemas["QAAskResponse"]>(`/qa/sessions/${sessionId}/ask` as ApiPath, {
		question,
	});

export const getQAHistoryAll = (params: Record<string, unknown> = {}) =>
	api.get<Schemas["PaginatedResponse_QASessionAdminItem_"]>("/qa/history/all" satisfies ApiPath as string, {
		params,
	});

export const getQASessionMessagesAdmin = (sessionId: number | string) =>
	api.get<Schemas["QAMessageItem"][]>(`/qa/history/all/${sessionId}/messages` as ApiPath);

export async function askInQASessionStream(
	sessionId: number | string,
	question: string,
	onChunk: (text: string) => void,
	onDone: (id?: number) => void,
	onError: (msg: string) => void,
	signal?: AbortSignal,
) {
	const MAX_RETRIES = 3;
	const FETCH_TIMEOUT = 30_000;

	const doFetch = async (timeoutSignal?: AbortSignal): Promise<Response> => {
		const token = useAuthStore.getState().token;
		return fetch(`/api/qa/sessions/${sessionId}/ask/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ question }),
			signal: timeoutSignal || signal,
		});
	};

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			let resp = await doFetch();

			if (resp.status === 401) {
				try {
					const refreshed = await useAuthStore.getState().refreshAuth();
					if (refreshed) {
						const retryTimeout = AbortSignal.timeout(FETCH_TIMEOUT);
						resp = await doFetch(retryTimeout);
					}
				} catch {
					useAuthStore.getState().logout();
					return;
				}
			}

			if (!resp.ok) {
				const err = await resp.json().catch(() => ({ detail: "请求失败" }));
				onError(err.detail || "请求失败");
				return;
			}

			if (!resp.body) {
				onError("响应体为空");
				return;
			}

			const reader = resp.body.getReader();
			await readSSEStream(reader, {
				onChunk,
				onDone,
				onError,
			});
			return;
		} catch (e: unknown) {
			if (signal?.aborted) return;
			const isNetworkError =
				e instanceof TypeError || (e as { code?: string }).code === "ERR_NETWORK";
			if (!isNetworkError || attempt >= MAX_RETRIES) {
				onError(e instanceof Error ? e.message : "连接失败");
				return;
			}
			if (!navigator.onLine) {
				onError?.("网络已断开，等待恢复...");
				try {
					await waitForOnline();
				} catch {
					onError("等待网络超时，请稍后重试");
					return;
				}
			} else {
				await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
			}
		}
	}
}
