import useAuthStore from "@/stores/authStore";
import { waitForOnline } from "@/utils/network";
import type { ApiPath } from "./api-path";
import type { components } from "./api-types.gen";
import { api } from "./axios-instance";
import { readSSEStream } from "./sse";

type Schemas = components["schemas"];

export const sendMessage = (
	recordId: number | string,
	content: string,
	signal?: AbortSignal,
) =>
	api.post<Schemas["ChatMessageResponse"]>(
		`/chat/${recordId}/message` as ApiPath,
		{ content },
		{ signal },
	);

export async function sendMessageStream(
	recordId: number | string,
	content: string,
	onChunk: (text: string) => void,
	onDone: (id?: number) => void,
	onError: (msg: string) => void,
	onSystem?: (text: string) => void,
	signal?: AbortSignal,
	onExamResult?: (result: {
		type: string;
		data: Record<string, unknown>;
	}) => void,
	onEmotionChange?: (change: {
		state: string;
		trust: number;
		comfort: number;
	}) => void,
	onInitiative?: (data: { content: string }) => void,
	onInitiativeState?: (data: { elapsed_seconds: number; threshold_seconds: number; percent: number }) => void,
) {
	const MAX_RETRIES = 3;
	const FETCH_TIMEOUT = 30_000;

	const doFetch = (timeoutSignal?: AbortSignal): Promise<Response> => {
		const token = useAuthStore.getState().token;
		const combined = signal
			? combineAbortSignals(signal, timeoutSignal)
			: timeoutSignal;
		return fetch(`/api/chat/${recordId}/message/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ content }),
			signal: combined,
		});
	};

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const timeoutController = new AbortController();
			const fetchTimeout = setTimeout(() => timeoutController.abort(), FETCH_TIMEOUT);

			let resp: Response;
			try {
				resp = await doFetch(timeoutController.signal);
			} finally {
				clearTimeout(fetchTimeout);
			}

			if (resp.status === 401) {
				try {
					const refreshed = await useAuthStore.getState().refreshAuth();
					if (refreshed) {
						resp = await doFetch();
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
				onSystem,
				onExamResult,
				onEmotionChange,
				onInitiative,
				onInitiativeState,
			});
			return;
		} catch (e: unknown) {
			if (signal?.aborted) return;
			if ((e as Error)?.name === "AbortError") {
				onError("请求超时，请重试");
				return;
			}
			const isNetworkError = e instanceof TypeError || (e as { code?: string }).code === "ERR_NETWORK";
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

function combineAbortSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
	const valid = signals.filter(Boolean) as AbortSignal[];
	if (valid.length === 0) return new AbortController().signal;
	if (valid.length === 1) return valid[0];

	const controller = new AbortController();
	for (const s of valid) {
		if (s.aborted) {
			controller.abort(s.reason);
			return controller.signal;
		}
		s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
	}
	return controller.signal;
}
