/**
 * SSE 流式读取器 — 请求级流式响应（两车道模型之 SSE 车道）。
 *
 * SSE 处理"一次请求的流式响应"（LLM 聊天、QA），与 WS 分离。
 * 使用 fetch Response.body.getReader（非 EventSource），支持 401 刷新重试。
 *
 * ── 两车道模型 ──
 * HTTP  → 请求/响应：CRUD、登录、拉数据
 * SSE   → 请求流式响应：LLM 聊天逐字、QA/RAG（本文件）
 * WS    → 会话级双向实时：查体、评分、scene:state（@/hooks/useTrainingWS.ts）
 */

export interface InitiativeStateData {
	elapsed_seconds: number;
	threshold_seconds: number;
	percent: number;
}

export interface StreamDonePayload {
	id?: number;
	student_id?: number;
	patient_id?: number;
	corrections_used?: number;
	corrections_remaining?: number;
	citations?: Array<{ source: string; section: string }>;
}

export interface SSEHandlers {
	onChunk?: (text: string) => void;
	onDone?: (id?: number, citations?: Array<{ source: string; section: string }>, payload?: StreamDonePayload) => void;
	onError?: (msg: string) => void;
	onSystem?: (text: string) => void;
	onEmotionChange?: (data: { state: string; trust: number; comfort: number }) => void;
	onInitiative?: (data: { content: string }) => void;
	onInitiativeState?: (data: InitiativeStateData) => void;
}

const STREAM_IDLE_TIMEOUT = 60_000;

export async function readSSEStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	handlers: SSEHandlers,
	abortSignal?: AbortSignal,
) {
	const decoder = new TextDecoder();
	let buffer = "";
	let idleTimer: ReturnType<typeof setTimeout> | null = null;

	function resetIdleTimer() {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			reader.cancel();
			handlers.onError?.("响应超时，请重试");
		}, STREAM_IDLE_TIMEOUT);
	}

	function clearIdleTimer() {
		if (idleTimer) {
			clearTimeout(idleTimer);
			idleTimer = null;
		}
	}

	resetIdleTimer();

	try {
		while (true) {
			if (abortSignal?.aborted) {
				clearIdleTimer();
				return;
			}
			const { done, value } = await reader.read();
			if (done) break;
			resetIdleTimer();

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() || "";

			for (const line of lines) {
				if (!line.startsWith("data: ")) continue;
				try {
					const data = JSON.parse(line.slice(6));
					if (data.error) {
						clearIdleTimer();
						handlers.onError?.(data.error);
						try { reader.cancel(); } catch { /* ignore */ }
						return;
					}
				if (data.system) { handlers.onSystem?.(data.system); continue; }
				if (data.emotion_change) { handlers.onEmotionChange?.(data.emotion_change); continue; }
					if (data.initiative_state) { handlers.onInitiativeState?.(data.initiative_state); continue; }
					if (data.initiative) { handlers.onInitiative?.(data.initiative); continue; }
					if (data.done) {
						clearIdleTimer();
						handlers.onDone?.(data.id, data.citations, data as StreamDonePayload);
						try { reader.cancel(); } catch { /* ignore */ }
						return;
					}
					if (data.content) handlers.onChunk?.(data.content);
				} catch (e) {
					console.warn("[SSE] malformed chunk:", e);
				}
			}
		}
	} finally {
		clearIdleTimer();
		try { reader.cancel(); } catch { /* ignore */ }
	}
}
