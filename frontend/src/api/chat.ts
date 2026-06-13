import useAuthStore from "@/stores/authStore";
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
		`/chat/${recordId}/message`,
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
) {
	const doFetch = async (): Promise<Response> => {
		const token = localStorage.getItem("token");
		return fetch(`/api/chat/${recordId}/message/stream`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({ content }),
			signal,
		});
	};

	let resp = await doFetch();

	if (resp.status === 401) {
		try {
			const refreshed = await useAuthStore.getState().refreshAuth();
			if (refreshed) {
				resp = await doFetch();
			}
		} catch {
			useAuthStore.getState().logout();
			if (!window.location.pathname.includes("/login")) {
				window.location.href = "/login";
			}
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
	});
}
