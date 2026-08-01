import { reportError } from "@/utils/telemetry";
import type { InitiativeStateData, StreamDonePayload } from "./sse";
import { postStream } from "./stream";

export async function sendMessageStream(
	recordId: number | string,
	content: string,
	onChunk: (text: string) => void,
	onDone: (id?: number) => void,
	onError: (msg: string) => void,
	onSystem?: (text: string) => void,
	signal?: AbortSignal,
	onEmotionChange?: (change: {
		state: string;
		trust: number;
		comfort: number;
	}) => void,
	onInitiative?: (data: { content: string }) => void,
	onInitiativeState?: (data: InitiativeStateData) => void,
) {
	return postStream({
		url: `/api/chat/${recordId}/message/stream`,
		body: { content },
		signal,
		reportFailure: (kind, message, url) => reportError(kind, message, url),
		handlers: {
			onChunk,
			onDone: (id) => onDone(id),
			onError,
			onSystem,
			onEmotionChange,
			onInitiative,
			onInitiativeState,
		},
	});
}

export async function correctLastMessageStream(
	recordId: number | string,
	content: string,
	onChunk: (text: string) => void,
	onDone: (payload: StreamDonePayload) => void,
	onError: (msg: string) => void,
	onSystem?: (text: string) => void,
	signal?: AbortSignal,
	onEmotionChange?: (change: {
		state: string;
		trust: number;
		comfort: number;
	}) => void,
	onInitiative?: (data: { content: string }) => void,
	onInitiativeState?: (data: InitiativeStateData) => void,
) {
	return postStream({
		url: `/api/chat/${recordId}/message/correct-last/stream`,
		body: { content },
		signal,
		reportFailure: (kind, message, url) => reportError(kind, message, url),
		handlers: {
			onChunk,
			onDone: (_id, _citations, payload) => onDone(payload ?? {}),
			onError,
			onSystem,
			onEmotionChange,
			onInitiative,
			onInitiativeState,
		},
	});
}
